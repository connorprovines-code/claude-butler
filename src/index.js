import fs from 'fs';
import config from './config.js';
import logger from './logger.js';
import { loadSkills } from './skills.js';
import { startScheduledSkills, setSendCallback, stopAllJobs } from './scheduler.js';
import * as telegram from './channels/telegram.js';

// ──── Ensure directories exist ────
function ensureDirs() {
  const dirs = [config.paths.skills, config.paths.logs];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ──── Startup ────
async function main() {
  console.log(`
  ╔═══════════════════════════════════╗
  ║        Claude Butler v1.0         ║
  ║   Personal AI Agent Dispatcher    ║
  ╚═══════════════════════════════════╝
  `);

  ensureDirs();

  // Load skills
  loadSkills();

  // Start Telegram bot
  const bot = telegram.start();

  // Wire scheduler to send messages to owner
  setSendCallback(telegram.getSendToOwner());

  // Start scheduled skills
  startScheduledSkills();

  logger.info('Claude Butler is running', {
    allowedUsers: config.telegram.allowedUserIds.length,
    maxConcurrent: config.agents.maxConcurrent,
    timeout: config.agents.timeoutSeconds
  });

  // ──── Graceful shutdown ────
  const shutdown = (signal) => {
    logger.info(`Received ${signal}, shutting down...`);
    stopAllJobs();
    telegram.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // ──── Unhandled error safety net ────
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    // Don't crash on non-fatal errors
    if (err.code === 'EFATAL') {
      shutdown('EFATAL');
    }
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', {
      error: reason instanceof Error ? reason.message : String(reason)
    });
  });
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
