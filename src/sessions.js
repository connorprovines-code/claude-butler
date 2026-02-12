import config from './config.js';
import logger from './logger.js';

// ──── In-memory session store with TTL ────
// Maps userId → { sessionId, timer, lastActivity }
const sessions = new Map();

const TTL_MS = (config.sessions?.ttlMinutes ?? 30) * 60 * 1000;

function getSession(userId) {
  const entry = sessions.get(userId);
  if (!entry) return null;
  return entry.sessionId;
}

function saveSession(userId, sessionId) {
  // Clear any existing timer
  const existing = sessions.get(userId);
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    logger.info(`Session expired for user ${userId}`);
    sessions.delete(userId);
  }, TTL_MS);

  sessions.set(userId, {
    sessionId,
    timer,
    lastActivity: Date.now()
  });

  logger.info(`Session saved for user ${userId}`, { sessionId: sessionId.slice(0, 12) });
}

function clearSession(userId) {
  const existing = sessions.get(userId);
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }
  sessions.delete(userId);
  logger.info(`Session cleared for user ${userId}`);
}

function hasSession(userId) {
  return sessions.has(userId);
}

function getSessionInfo(userId) {
  const entry = sessions.get(userId);
  if (!entry) return null;
  return {
    sessionId: entry.sessionId,
    lastActivity: entry.lastActivity,
    idleFor: Math.round((Date.now() - entry.lastActivity) / 1000)
  };
}

export { getSession, saveSession, clearSession, hasSession, getSessionInfo };
