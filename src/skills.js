import fs from 'fs';
import path from 'path';
import config from './config.js';
import logger from './logger.js';

// ──── Skill Registry ────
const skills = new Map();

function loadSkills() {
  skills.clear();
  const skillsDir = config.paths.skills;

  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
    logger.info('Created skills directory');
    return;
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const configPath = path.join(skillDir, 'skill.json');

    if (!fs.existsSync(configPath)) {
      logger.warn(`Skill ${entry.name} missing skill.json, skipping`);
      continue;
    }

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const skillConfig = JSON.parse(raw);

      // Read CLAUDE.md if present (context for the agent)
      const claudeMdPath = path.join(skillDir, 'CLAUDE.md');
      const context = fs.existsSync(claudeMdPath)
        ? fs.readFileSync(claudeMdPath, 'utf-8')
        : null;

      // Read schedule.json if present
      const schedulePath = path.join(skillDir, 'schedule.json');
      const schedule = fs.existsSync(schedulePath)
        ? JSON.parse(fs.readFileSync(schedulePath, 'utf-8'))
        : null;

      const skill = {
        name: skillConfig.name || entry.name,
        description: skillConfig.description || '',
        triggers: (skillConfig.triggers || []).map(t => t.toLowerCase()),
        promptTemplate: skillConfig.prompt_template || null,
        cwd: skillConfig.cwd || config.agents.defaultCwd,
        maxTurns: skillConfig.max_turns || 25,
        model: skillConfig.model || null,
        context,
        schedule,
        dir: skillDir
      };

      skills.set(skill.name, skill);
      logger.info(`Loaded skill: ${skill.name}`, {
        triggers: skill.triggers,
        hasSchedule: !!schedule
      });
    } catch (err) {
      logger.error(`Failed to load skill ${entry.name}`, { error: err.message });
    }
  }

  logger.info(`${skills.size} skills loaded`);
}

// ──── Find a skill by trigger word ────
function findSkill(message) {
  const lower = message.toLowerCase();

  for (const [, skill] of skills) {
    for (const trigger of skill.triggers) {
      if (lower.includes(trigger)) {
        return skill;
      }
    }
  }
  return null;
}

// ──── Build a prompt from a skill ────
function buildPrompt(skill, userMessage) {
  let prompt = '';

  // Prepend context if available
  if (skill.context) {
    prompt += `Context:\n${skill.context}\n\n`;
  }

  // Use template or pass through
  if (skill.promptTemplate) {
    prompt += skill.promptTemplate.replace('{{message}}', userMessage);
  } else {
    prompt += userMessage;
  }

  return prompt;
}

// ──── Get all skills (for /help listing) ────
function listSkills() {
  return Array.from(skills.values()).map(s => ({
    name: s.name,
    description: s.description,
    triggers: s.triggers,
    hasSchedule: !!s.schedule
  }));
}

// ──── Get scheduled skills ────
function getScheduledSkills() {
  return Array.from(skills.values()).filter(s => s.schedule);
}

export { loadSkills, findSkill, buildPrompt, listSkills, getScheduledSkills };
