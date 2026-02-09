import { spawn } from 'child_process';
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
// Returns { success, output, error, duration }
async function spawnAgent(prompt, options = {}) {
  const {
    cwd = config.agents.defaultCwd,
    maxTurns = 25,
    onProgress = null, // callback for streaming updates
    model = null       // optional model override
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

    logger.info(`Agent ${agentId} started`, { prompt: prompt.slice(0, 100), cwd });

    try {
      const result = await runClaude(agentId, prompt, { cwd, maxTurns, onProgress, model });
      const duration = Math.round((Date.now() - startTime) / 1000);

      logger.info(`Agent ${agentId} completed in ${duration}s`, {
        outputLength: result.length
      });

      return { success: true, output: result, duration, agentId };
    } catch (err) {
      const duration = Math.round((Date.now() - startTime) / 1000);

      logger.error(`Agent ${agentId} failed after ${duration}s`, { error: err.message });

      return {
        success: false,
        output: null,
        error: err.message,
        duration,
        agentId
      };
    } finally {
      activeAgents.delete(agentId);
    }
  });
}

// ──── Low-level Claude CLI runner ────
function runClaude(agentId, prompt, { cwd, maxTurns, onProgress, model }) {
  return new Promise((resolve, reject) => {
    const args = ['--print', '--max-turns', String(maxTurns)];

    if (model) {
      args.push('--model', model);
    }

    args.push('-p', prompt);

    const proc = spawn(config.agents.claudeCliPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    // Timeout kill
    const timeout = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      // Force kill after 10s grace
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 10_000);
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
        proc.kill('SIGTERM');
        clearTimeout(timeout);
        resolve(stdout.slice(0, 100_000) + '\n\n[Output truncated at 100KB]');
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
        resolve(stdout || `[Agent timed out after ${config.agents.timeoutSeconds}s]`);
        return;
      }

      if (code !== 0 && !stdout) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }

      // Even with non-zero exit, if we got output, return it
      resolve(stdout);
    });
  });
}

export { spawnAgent, getQueueStatus };
