import config from './config.js';
import logger from './logger.js';

// ──── Rate Limiter ────
// Sliding window per-user rate limiting
const userWindows = new Map();

function isRateLimited(userId) {
  const now = Date.now();
  const windowMs = 60_000; // 1 minute
  const max = config.rateLimit.perMinute;

  if (!userWindows.has(userId)) {
    userWindows.set(userId, []);
  }

  const timestamps = userWindows.get(userId);

  // Prune entries older than the window
  while (timestamps.length > 0 && timestamps[0] < now - windowMs) {
    timestamps.shift();
  }

  if (timestamps.length >= max) {
    return true;
  }

  timestamps.push(now);
  return false;
}

function getRateLimitInfo(userId) {
  const now = Date.now();
  const windowMs = 60_000;
  const timestamps = userWindows.get(userId) || [];
  const recent = timestamps.filter(t => t >= now - windowMs);
  const remaining = Math.max(0, config.rateLimit.perMinute - recent.length);
  const resetMs = recent.length > 0 ? (recent[0] + windowMs) - now : 0;

  return { used: recent.length, remaining, resetInSeconds: Math.ceil(resetMs / 1000) };
}

// ──── Auth ────
function isAuthorized(userId) {
  return config.telegram.allowedUserIds.includes(String(userId));
}

// ──── Combined middleware ────
// Returns { allowed: true } or { allowed: false, reason: string }
function checkAuth(userId) {
  if (!isAuthorized(userId)) {
    logger.warn(`Unauthorized access attempt from user ${userId}`);
    return { allowed: false, reason: 'unauthorized' };
  }

  if (isRateLimited(userId)) {
    const info = getRateLimitInfo(userId);
    logger.warn(`Rate limited user ${userId}`, info);
    return {
      allowed: false,
      reason: 'rate_limited',
      detail: `Rate limited. Try again in ${info.resetInSeconds}s.`
    };
  }

  return { allowed: true };
}

export { checkAuth, isAuthorized, isRateLimited, getRateLimitInfo };
