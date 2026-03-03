import fs from 'fs';
import path from 'path';
import config from './config.js';
import logger from './logger.js';

const LOG_FILE = path.join(config.paths.root, 'state', 'interactions.jsonl');
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Log an agent interaction (prompt, result, model, duration, errors).
 * Stored as newline-delimited JSON for easy grep/tail.
 */
function logInteraction({ agentId, prompt, model, duration, success, error, outputSnippet }) {
  const entry = {
    ts: new Date().toISOString(),
    agentId,
    prompt: prompt?.slice(0, 200),
    model,
    duration,
    success,
    error: error || null,
    outputSnippet: outputSnippet?.slice(0, 300) || null,
  };

  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    logger.error('Failed to write interaction log', { error: err.message });
  }
}

/**
 * Purge entries older than 30 days. Call on startup.
 */
function purgeOldEntries() {
  if (!fs.existsSync(LOG_FILE)) return;

  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
    const kept = lines.filter(line => {
      try {
        const entry = JSON.parse(line);
        return new Date(entry.ts).getTime() > cutoff;
      } catch {
        return false; // drop malformed lines
      }
    });

    fs.writeFileSync(LOG_FILE, kept.length > 0 ? kept.join('\n') + '\n' : '');
    const purged = lines.length - kept.length;
    if (purged > 0) {
      logger.info(`Purged ${purged} interaction log entries older than 30 days`);
    }
  } catch (err) {
    logger.error('Failed to purge interaction log', { error: err.message });
  }
}

/**
 * Get recent interactions for self-diagnosis.
 * @param {number} count - Number of recent entries to return
 */
function getRecent(count = 20) {
  if (!fs.existsSync(LOG_FILE)) return [];

  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean);
    return lines.slice(-count).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export { logInteraction, purgeOldEntries, getRecent };
