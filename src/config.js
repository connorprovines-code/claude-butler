import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function required(key) {
  const val = process.env[key];
  if (!val) {
    console.error(`\n  Missing required env var: ${key}`);
    console.error(`  Run "npm run setup" to configure.\n`);
    process.exit(1);
  }
  return val;
}

const config = {
  telegram: {
    token: required('TELEGRAM_BOT_TOKEN'),
    allowedUserIds: required('ALLOWED_USER_IDS')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)
  },

  agents: {
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_AGENTS || '2', 10),
    timeoutSeconds: parseInt(process.env.AGENT_TIMEOUT_SECONDS || '300', 10),
    claudeCliPath: process.env.CLAUDE_CLI_PATH || 'claude',
    defaultCwd: process.env.DEFAULT_CWD || path.join(__dirname, '..')
  },

  sessions: {
    ttlMinutes: parseInt(process.env.SESSION_TTL_MINUTES || '30', 10)
  },

  rateLimit: {
    perMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '10', 10)
  },

  email: {
    address: process.env.GMAIL_ADDRESS || null,
    appPassword: process.env.GMAIL_APP_PASSWORD || null
  },

  paths: {
    root: path.join(__dirname, '..'),
    skills: path.join(__dirname, '..', 'skills'),
    logs: path.join(__dirname, '..', 'logs')
  }
};

export default config;
