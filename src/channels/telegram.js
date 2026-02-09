import TelegramBot from 'node-telegram-bot-api';
import { checkAuth } from '../auth.js';
import { route } from '../router.js';
import config from '../config.js';
import logger from '../logger.js';

let bot = null;

// ──── Message splitting for Telegram's 4096 char limit ────
function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.5) {
      // No good newline break, split at space
      splitIdx = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitIdx < maxLen * 0.3) {
      // No good break point, hard split
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

// ──── Safe message sender ────
async function safeSend(chatId, text, options = {}) {
  const chunks = splitMessage(text);

  for (const chunk of chunks) {
    try {
      await bot.sendMessage(chatId, chunk, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...options
      });
    } catch (err) {
      // If Markdown fails, retry without formatting
      if (err.message?.includes('parse')) {
        try {
          await bot.sendMessage(chatId, chunk, {
            disable_web_page_preview: true
          });
        } catch (retryErr) {
          logger.error('Failed to send message even without Markdown', {
            error: retryErr.message,
            chatId
          });
        }
      } else {
        logger.error('Failed to send message', { error: err.message, chatId });
      }
    }
  }
}

// ──── Start the bot ────
function start() {
  bot = new TelegramBot(config.telegram.token, { polling: true });

  // Error handling for polling
  bot.on('polling_error', (err) => {
    if (err.code === 'ETELEGRAM' && err.response?.statusCode === 409) {
      logger.error('Another bot instance is already running! Stop it first.');
      process.exit(1);
    }
    logger.error('Telegram polling error', { error: err.message });
  });

  bot.on('error', (err) => {
    logger.error('Telegram error', { error: err.message });
  });

  // ──── Message handler ────
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const text = msg.text;

    // Ignore non-text messages (stickers, photos, etc)
    if (!text) return;

    // Auth + rate limit check
    const auth = checkAuth(userId);
    if (!auth.allowed) {
      if (auth.reason === 'unauthorized') {
        logger.warn(`Blocked unauthorized user ${userId} (${msg.from.username || 'unknown'})`);
        // Don't respond to unauthorized users at all (security)
        return;
      }
      if (auth.reason === 'rate_limited') {
        await safeSend(chatId, `⏳ ${auth.detail}`);
        return;
      }
      return;
    }

    logger.info(`Message from ${msg.from.username || userId}: ${text.slice(0, 80)}`);

    try {
      // Create a send function bound to this chat
      const sendFn = (text) => safeSend(chatId, text);

      // Route the message
      const { response } = await route(text, { userId, sendFn });

      if (response) {
        await safeSend(chatId, response);
      }
    } catch (err) {
      logger.error('Error handling message', {
        error: err.message,
        userId,
        text: text.slice(0, 80)
      });

      await safeSend(chatId, `❌ Internal error: ${err.message.slice(0, 200)}`);
    }
  });

  logger.info('Telegram bot started');
  return bot;
}

// ──── Get a send function for scheduler ────
// Sends to the first authorized user (owner)
function getSendToOwner() {
  const ownerId = config.telegram.allowedUserIds[0];
  return (text) => safeSend(ownerId, text);
}

function stop() {
  if (bot) {
    bot.stopPolling();
    logger.info('Telegram bot stopped');
  }
}

export { start, stop, getSendToOwner };
