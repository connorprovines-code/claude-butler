import { spawnAgent, getQueueStatus } from './spawner.js';
import { findSkill, buildPrompt, listSkills } from './skills.js';
import { listJobs } from './scheduler.js';
import { getRateLimitInfo } from './auth.js';
import { resolveModel } from './model-picker.js';
import { getSession, saveSession, clearSession, getSessionInfo } from './sessions.js';
import config from './config.js';
import logger from './logger.js';

// ──── Built-in Commands ────
const BUILTINS = {
  '/help': handleHelp,
  '/status': handleStatus,
  '/skills': handleSkillsList,
  '/jobs': handleJobs,
  '/queue': handleQueue,
  '/cancel': handleCancel,
};

// ──── Session reset triggers ────
const SESSION_RESET_PHRASES = ['new session', 'fresh start', 'reset session'];

function isSessionReset(message) {
  const lower = message.toLowerCase().trim();
  return SESSION_RESET_PHRASES.some(phrase => lower === phrase);
}

// ──── Main Router ────
// Takes a message string, returns { response, isAsync }
async function route(message, { userId, sendFn }) {
  const trimmed = message.trim();

  // Check built-in commands first
  const cmd = trimmed.split(/\s/)[0].toLowerCase();
  if (BUILTINS[cmd]) {
    const response = await BUILTINS[cmd](trimmed, { userId });
    return { response, isAsync: false };
  }

  // Check for session reset
  if (isSessionReset(trimmed)) {
    const had = getSessionInfo(userId);
    clearSession(userId);
    if (had) {
      return {
        response: `🔄 Session cleared (was active for ${had.idleFor}s). Next message starts fresh.`,
        isAsync: false
      };
    }
    return {
      response: `🔄 No active session — next message starts fresh.`,
      isAsync: false
    };
  }

  // Look up active session for resume
  const existingSessionId = getSession(userId);

  // Check for skill match
  const skill = findSkill(trimmed);

  if (skill) {
    logger.info(`Matched skill: ${skill.name}`, { message: trimmed.slice(0, 80) });

    // Resolve model: skill override > auto-detect from message
    const model = resolveModel(skill.model, trimmed);

    // Send "working" indicator
    const resumeTag = existingSessionId ? ' (resuming)' : '';
    await sendFn(`⚡ *${skill.name}* — spawning agent (${model})${resumeTag}...`);

    const prompt = buildPrompt(skill, trimmed);
    const result = await spawnAgent(prompt, {
      cwd: skill.cwd,
      maxTurns: skill.maxTurns,
      model,
      resume: existingSessionId,
      onProgress: async (agentId, snippet) => {
        // Optional: send progress dots for long tasks
      }
    });

    // Save session for continuity
    if (result.sessionId) {
      saveSession(userId, result.sessionId);
    }

    if (result.success) {
      return {
        response: `✅ *${skill.name}* (${result.duration}s):\n\n${truncate(result.output, 3500)}`,
        isAsync: false
      };
    } else {
      return {
        response: `❌ *${skill.name}* failed after ${result.duration}s:\n${result.error}`,
        isAsync: false
      };
    }
  }

  // No skill match → treat as freeform prompt to Claude
  const freeformModel = resolveModel(null, trimmed);
  const resumeTag = existingSessionId ? ' (resuming)' : '';
  logger.info('Freeform prompt', { message: trimmed.slice(0, 80), model: freeformModel, resume: !!existingSessionId });
  await sendFn(`🧠 Thinking (${freeformModel})${resumeTag}...`);

  const result = await spawnAgent(trimmed, {
    cwd: config.agents.defaultCwd,
    maxTurns: 10, // Lower for freeform to keep it snappy
    model: freeformModel,
    resume: existingSessionId
  });

  // Save session for continuity
  if (result.sessionId) {
    saveSession(userId, result.sessionId);
  }

  if (result.success) {
    return {
      response: truncate(result.output, 3500),
      isAsync: false
    };
  } else {
    return {
      response: `❌ Agent failed: ${result.error}`,
      isAsync: false
    };
  }
}

// ──── Built-in Handlers ────

async function handleHelp() {
  const skills = listSkills();
  let msg = `🤖 *Claude Butler*\n\n`;
  msg += `*Commands:*\n`;
  msg += `/help — This message\n`;
  msg += `/status — System status\n`;
  msg += `/skills — List available skills\n`;
  msg += `/jobs — List scheduled jobs\n`;
  msg += `/queue — Show agent queue\n\n`;
  msg += `*Session:*\n`;
  msg += `Say "new session" or "fresh start" to clear context and start over.\n\n`;
  msg += `*Usage:*\n`;
  msg += `Send any message to spawn a Claude agent.\n`;
  msg += `Follow-up messages within ${config.sessions?.ttlMinutes ?? 30} min resume the same conversation.\n\n`;

  if (skills.length > 0) {
    msg += `*Quick Skills:*\n`;
    for (const s of skills.slice(0, 10)) {
      msg += `• *${s.name}* — ${s.description}\n`;
      msg += `  Triggers: ${s.triggers.join(', ')}\n`;
    }
  }

  return msg;
}

async function handleStatus(_, { userId }) {
  const queue = getQueueStatus();
  const rate = getRateLimitInfo(userId);
  const jobs = listJobs();
  const session = getSessionInfo(userId);

  let msg = `📊 *Status*\n\n`;
  msg += `*Agents:* ${queue.active} active, ${queue.waiting} queued\n`;
  msg += `*Max concurrent:* ${queue.maxConcurrent}\n`;
  msg += `*Rate limit:* ${rate.remaining}/${config.rateLimit.perMinute} remaining\n`;
  msg += `*Scheduled jobs:* ${jobs.length}\n`;

  if (session) {
    msg += `\n*Session:* Active (idle ${session.idleFor}s)\n`;
  } else {
    msg += `\n*Session:* None (next message starts fresh)\n`;
  }

  if (queue.agents.length > 0) {
    msg += `\n*Running:*\n`;
    for (const a of queue.agents) {
      msg += `• ${a.id} (${a.runningFor}s) — ${a.prompt}\n`;
    }
  }

  return msg;
}

async function handleSkillsList() {
  const skills = listSkills();

  if (skills.length === 0) {
    return `No skills installed. Add skill directories to the /skills folder.`;
  }

  let msg = `🛠 *Skills (${skills.length}):*\n\n`;
  for (const s of skills) {
    msg += `*${s.name}*\n`;
    msg += `  ${s.description}\n`;
    msg += `  Triggers: \`${s.triggers.join('`, `')}\`\n`;
    if (s.hasSchedule) msg += `  ⏰ Has schedule\n`;
    msg += `\n`;
  }

  return msg;
}

async function handleJobs() {
  const jobs = listJobs();

  if (jobs.length === 0) {
    return `No scheduled jobs running. Add schedule.json to a skill directory.`;
  }

  let msg = `⏰ *Scheduled Jobs:*\n\n`;
  for (const j of jobs) {
    msg += `• *${j.name}* — \`${j.cron}\`\n`;
    if (j.description) msg += `  ${j.description}\n`;
  }

  return msg;
}

async function handleQueue() {
  const status = getQueueStatus();

  let msg = `📋 *Queue:*\n`;
  msg += `Active: ${status.active}/${status.maxConcurrent}\n`;
  msg += `Waiting: ${status.waiting}\n`;

  if (status.agents.length > 0) {
    msg += `\n*Agents:*\n`;
    for (const a of status.agents) {
      msg += `• \`${a.id}\` — ${a.runningFor}s — ${a.prompt}\n`;
    }
  } else {
    msg += `\nNo agents running.`;
  }

  return msg;
}

async function handleCancel() {
  // Note: p-queue doesn't support canceling individual items easily.
  // This clears the waiting queue but can't kill running processes.
  const status = getQueueStatus();
  return `⚠️ Cancel not yet supported for running agents.\nQueue: ${status.active} active, ${status.waiting} waiting.`;
}

function truncate(text, max) {
  if (!text) return '[no output]';
  // Clean up ANSI codes that Claude CLI might emit
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  if (clean.length <= max) return clean;
  return clean.slice(0, max) + '\n\n_[...truncated]_';
}

export { route };
