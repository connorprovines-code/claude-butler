import { spawn } from 'child_process';
import path from 'path';
import PQueue from 'p-queue';
import config from './config.js';
import logger from './logger.js';

// ──── Agent Queue ────
// Limits concurrent Claude CLI processes to prevent overload
const queue = new PQueue({
  concurrency: config.agents.maxConcurrent,
  timeout: config.agents.timeoutSeconds * 1000,
  throwOnTimeout: true
});

// Track active agents for status reporting
const activeAgents = new Map();

function getQueueStatus() {
  return {
    active: queue.pending,
    waiting: queue.size,
    maxConcurrent: config.agents.maxConcurrent,
    agents: Array.from(activeAgents.values()).map(a => ({
      id: a.id,
      prompt: a.prompt.slice(0, 80),
      startedAt: a.startedAt,
      runningFor: Math.round((Date.now() - a.startedAt) / 1000)
    }))
  };
}

// ──── Spawn a Claude CLI agent ────
// Returns { success, output, error, duration, sessionId }
async function spawnAgent(prompt, options = {}) {
  const {
    cwd = config.agents.defaultCwd,
    maxTurns = 25,
    onProgress = null, // callback for streaming updates
    model = null,      // optional model override
    resume = null      // session ID to resume
  } = options;

  const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return queue.add(async () => {
    const startTime = Date.now();

    activeAgents.set(agentId, {
      id: agentId,
      prompt,
      startedAt: startTime,
      cwd
    });

    logger.info(`Agent ${agentId} started`, {
      prompt: prompt.slice(0, 100),
      cwd,
      resume: resume ? resume.slice(0, 12) : null
    });

    try {
      const result = await runClaude(agentId, prompt, { cwd, maxTurns, onProgress, model, resume });
      const duration = Math.round((Date.now() - startTime) / 1000);

      logger.info(`Agent ${agentId} completed in ${duration}s`, {
        outputLength: result.output.length,
        sessionId: result.sessionId?.slice(0, 12)
      });

      return { success: true, output: result.output, duration, agentId, sessionId: result.sessionId };
    } catch (err) {
      const duration = Math.round((Date.now() - startTime) / 1000);

      logger.error(`Agent ${agentId} failed after ${duration}s`, { error: err.message });

      return {
        success: false,
        output: null,
        error: err.message,
        duration,
        agentId,
        sessionId: null
      };
    } finally {
      activeAgents.delete(agentId);
    }
  });
}

// ──── Low-level Claude CLI runner ────
// Returns { output, sessionId }
function runClaude(agentId, prompt, { cwd, maxTurns, onProgress, model, resume }) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--max-turns', String(maxTurns),
      '--output-format', 'json',
      '--permission-mode', 'bypassPermissions',
      '--mcp-config', path.join(config.paths.root, '.mcp.json')
    ];

    if (model) {
      args.push('--model', model);
    }

    if (resume) {
      args.push('--resume', resume);
    }

    args.push('-p', prompt);

    const proc = spawn(config.agents.claudeCliPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // Create process group for clean kills
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    // Kill the entire process group (negative PID)
    function killProcessGroup(signal) {
      try {
        process.kill(-proc.pid, signal);
      } catch {
        // Fallback to direct kill if group kill fails
        try { proc.kill(signal); } catch {}
      }
    }

    // Timeout kill
    const timeout = setTimeout(() => {
      killed = true;
      killProcessGroup('SIGTERM');
      // Force kill after 10s grace
      setTimeout(() => killProcessGroup('SIGKILL'), 10_000);
    }, config.agents.timeoutSeconds * 1000);

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;

      // Stream progress updates (for long-running agents)
      if (onProgress && stdout.length % 500 < text.length) {
        onProgress(agentId, stdout.slice(-200));
      }

      // Safety: cap output at 100KB to prevent memory issues
      if (stdout.length > 100_000) {
        killed = true;
        killProcessGroup('SIGTERM');
        clearTimeout(timeout);
        resolve(parseResult(stdout.slice(0, 100_000) + '\n\n[Output truncated at 100KB]'));
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}. Is 'claude' installed and in PATH?`));
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (killed) {
        resolve(parseResult(stdout || `[Agent timed out after ${config.agents.timeoutSeconds}s]`));
        return;
      }

      if (code !== 0 && !stdout) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }

      // Even with non-zero exit, if we got output, return it
      resolve(parseResult(stdout));
    });
  });
}

// ──── Parse JSON result from Claude CLI ────
// Extracts the text output and session ID from --output-format json
function parseResult(raw) {
  try {
    const json = JSON.parse(raw);

    // Handle error results (e.g. max turns exceeded)
    if (json.is_error || json.subtype === 'error') {
      const errorMsg = json.result || 'Agent encountered an error';
      return {
        output: `[Error] ${errorMsg}`,
        sessionId: json.session_id || null
      };
    }

    return {
      output: json.result || raw,
      sessionId: json.session_id || null
    };
  } catch {
    // If JSON parsing fails (truncated output, timeout, etc.), return raw text
    return {
      output: raw,
      sessionId: null
    };
  }
}

export { spawnAgent, getQueueStatus };
