import TelegramBot from 'node-telegram-bot-api';
import { checkAuth } from '../auth.js';
import { route } from '../router.js';
import { spawnAgent } from '../spawner.js';
import config from '../config.js';
import logger from '../logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createWriteStream, unlinkSync } from 'fs';
import { get as httpsGet } from 'https';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);

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
      logger.info(`Message sent to ${chatId}`, { length: chunk.length });
    } catch (err) {
      // If Markdown fails, retry without formatting
      if (err.message?.includes('parse')) {
        try {
          await bot.sendMessage(chatId, chunk, {
            disable_web_page_preview: true
          });
          logger.info(`Message sent to ${chatId} (plaintext)`, { length: chunk.length });
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

// ──── Voice transcription ────
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    httpsGet(url, (res) => {
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

async function transcribeVoice(fileId) {
  const fileInfo = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${fileInfo.file_path}`;
  const tmpOgg = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);

  try {
    await downloadFile(fileUrl, tmpOgg);
    const script = `
from faster_whisper import WhisperModel
model = WhisperModel("tiny", device="cpu", compute_type="int8")
segments, _ = model.transcribe("${tmpOgg}", language="en")
print("".join(s.text for s in segments).strip())
`;
    const { stdout } = await execAsync(`python3 -c '${script}'`, { timeout: 60000 });
    return stdout.trim();
  } finally {
    try { unlinkSync(tmpOgg); } catch {}
  }
}

// ──── Audio file analysis ────
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.opus', '.flac', '.aac', '.wma', '.aiff']);

function isAudioDocument(msg) {
  if (!msg.document) return false;
  const name = msg.document.file_name || '';
  return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

async function analyzeAudio(fileId, label = 'audio') {
  const fileInfo = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${fileInfo.file_path}`;
  const ext = path.extname(fileInfo.file_path) || '.audio';
  const tmpSrc = path.join(os.tmpdir(), `audio_${Date.now()}${ext}`);
  const tmpWav = path.join(os.tmpdir(), `audio_${Date.now()}.wav`);

  try {
    await downloadFile(fileUrl, tmpSrc);

    // Convert to WAV for whisper compatibility
    await execAsync(`ffmpeg -y -i "${tmpSrc}" -ar 16000 -ac 1 -f wav "${tmpWav}"`, { timeout: 30000 });

    // Transcribe
    const script = [
      'from faster_whisper import WhisperModel',
      'import sys',
      `model = WhisperModel("small", device="cpu", compute_type="int8")`,
      `segments, info = model.transcribe(sys.argv[1])`,
      `text = " ".join(s.text.strip() for s in segments)`,
      `print(f"[lang={info.language} dur={info.duration:.1f}s]\\n{text}")`
    ].join('\n');

    const { stdout } = await execAsync(`python3 -c '${script}' "${tmpWav}"`, { timeout: 120000 });
    const transcript = stdout.trim();

    if (!transcript) return { transcript: '', analysis: 'No speech detected.' };

    // Ask Claude to understand the audio content
    const prompt = `I have transcribed an audio file (${label}). Please analyze and summarize the content:\n\n${transcript}`;
    const result = await spawnAgent(prompt, {
      cwd: config.agents.defaultCwd,
      maxTurns: 5,
      model: 'haiku'
    });

    return {
      transcript,
      analysis: result.success ? result.output : transcript
    };
  } finally {
    try { unlinkSync(tmpSrc); } catch {}
    try { unlinkSync(tmpWav); } catch {}
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

  // ──── Voice message handler ────
  bot.on('voice', async (msg) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);

    const auth = checkAuth(userId);
    if (!auth.allowed) return;

    await safeSend(chatId, '🎙️ Transcribing...');
    try {
      const text = await transcribeVoice(msg.voice.file_id);
      if (!text) {
        await safeSend(chatId, "Couldn't make out what you said.");
        return;
      }
      logger.info(`Voice transcribed for ${userId}: ${text.slice(0, 80)}`);
      await safeSend(chatId, `_Heard: "${text}"_`);
      const sendFn = (t) => safeSend(chatId, t);
      const { response } = await route(text, { userId, sendFn });
      if (response) await safeSend(chatId, response);
    } catch (err) {
      logger.error('Voice transcription failed', { error: err.message });
      await safeSend(chatId, `❌ Transcription failed: ${err.message.slice(0, 200)}`);
    }
  });

  // ──── Audio file handler ────
  async function handleAudioFile(msg, fileId, label) {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);

    const auth = checkAuth(userId);
    if (!auth.allowed) return;

    await safeSend(chatId, `🎵 Analyzing ${label}...`);
    try {
      const { transcript, analysis } = await analyzeAudio(fileId, label);
      if (!transcript) {
        await safeSend(chatId, '🔇 No speech detected in this audio.');
        return;
      }
      logger.info(`Audio analyzed for ${userId}: ${transcript.slice(0, 80)}`);
      await safeSend(chatId, `*Transcript:*\n_${transcript.slice(0, 500)}_\n\n*Analysis:*\n${analysis}`);
    } catch (err) {
      logger.error('Audio analysis failed', { error: err.message });
      await safeSend(chatId, `❌ Audio analysis failed: ${err.message.slice(0, 200)}`);
    }
  }

  bot.on('audio', (msg) => handleAudioFile(msg, msg.audio.file_id, msg.audio.file_name || 'audio file'));

  bot.on('document', (msg) => {
    if (isAudioDocument(msg)) {
      handleAudioFile(msg, msg.document.file_id, msg.document.file_name || 'audio file');
    }
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
