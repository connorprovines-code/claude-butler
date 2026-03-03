import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { getScheduledSkills, buildPrompt } from './skills.js';
import { spawnAgent } from './spawner.js';
import { getAll as getReminders, dismissOnce } from './reminders.js';
import config from './config.js';
import logger from './logger.js';

// Active cron jobs
const jobs = new Map();
// Active reminder jobs (keyed by reminder id)
const reminderJobs = new Map();

// File watcher for reminders.json — auto-syncs when agents edit it directly
let reminderWatcher = null;

// Callback to send messages back to user
let sendCallback = null;

function setSendCallback(fn) {
  sendCallback = fn;
}

function startScheduledSkills() {
  const scheduled = getScheduledSkills();

  for (const skill of scheduled) {
    const { cron: cronExpr, description } = skill.schedule;

    if (!cron.validate(cronExpr)) {
      logger.error(`Invalid cron expression for skill ${skill.name}: ${cronExpr}`);
      continue;
    }

    // Stop existing job if re-loading
    if (jobs.has(skill.name)) {
      jobs.get(skill.name).stop();
    }

    const job = cron.schedule(cronExpr, async () => {
      logger.info(`Scheduled skill triggered: ${skill.name}`);

      if (sendCallback) {
        await sendCallback(`⏰ Running scheduled task: *${skill.name}*`);
      }

      try {
        const prompt = buildPrompt(skill, skill.schedule.prompt || skill.description);
        const result = await spawnAgent(prompt, {
          cwd: skill.cwd,
          maxTurns: skill.maxTurns,
          model: skill.model
        });

        if (sendCallback) {
          if (result.success) {
            logger.info(`Sending scheduled result for ${skill.name}`, { outputLength: result.output.length });
            await sendCallback(`✅ *${skill.name}* completed:\n\n${truncate(result.output, 3500)}`);
          } else {
            logger.info(`Sending scheduled failure for ${skill.name}`, { error: result.error });
            await sendCallback(`❌ *${skill.name}* failed: ${result.error}`);
          }
        } else {
          logger.warn(`No sendCallback set for scheduled skill ${skill.name}`);
        }
      } catch (err) {
        logger.error(`Scheduled skill ${skill.name} error`, { error: err.message });
        if (sendCallback) {
          logger.info(`Sending scheduled error for ${skill.name}`);
          await sendCallback(`❌ *${skill.name}* error: ${err.message}`);
        }
      }
    });

    jobs.set(skill.name, job);
    logger.info(`Scheduled: ${skill.name} (${cronExpr}) - ${description || ''}`);
  }

  logger.info(`${jobs.size} scheduled jobs active`);
}

function syncReminders() {
  const currentIds = new Set(reminderJobs.keys());
  const reminders = getReminders();
  const fileIds = new Set(reminders.map(r => r.id));

  // Stop jobs for reminders that were removed from the file
  for (const id of currentIds) {
    if (!fileIds.has(id)) {
      logger.info(`Reminder ${id} removed from file — stopping cron job`);
      reminderJobs.get(id).stop();
      reminderJobs.delete(id);
    }
  }

  // Start jobs for reminders that were added to the file
  for (const reminder of reminders) {
    if (!currentIds.has(reminder.id)) {
      if (!cron.validate(reminder.cron)) {
        logger.error(`Invalid cron for reminder ${reminder.id}: ${reminder.cron}`);
        continue;
      }
      const job = cron.schedule(reminder.cron, async () => {
        logger.info(`Reminder fired: ${reminder.id}`);
        if (sendCallback) {
          await sendCallback(reminder.message);
        }
        if (reminder.once) {
          dismissOnce(reminder.id);
          job.stop();
          reminderJobs.delete(reminder.id);
        }
      });
      reminderJobs.set(reminder.id, job);
      logger.info(`Reminder added from file: ${reminder.id} (${reminder.cron})`);
    }
  }
}

function startReminders() {
  for (const [id, job] of reminderJobs) {
    job.stop();
  }
  reminderJobs.clear();

  const reminders = getReminders();

  for (const reminder of reminders) {
    if (!cron.validate(reminder.cron)) {
      logger.error(`Invalid cron for reminder ${reminder.id}: ${reminder.cron}`);
      continue;
    }

    const job = cron.schedule(reminder.cron, async () => {
      logger.info(`Reminder fired: ${reminder.id}`);
      if (sendCallback) {
        await sendCallback(reminder.message);
      }
      if (reminder.once) {
        dismissOnce(reminder.id);
        job.stop();
        reminderJobs.delete(reminder.id);
      }
    });

    reminderJobs.set(reminder.id, job);
    logger.info(`Reminder scheduled: ${reminder.id} (${reminder.cron})`);
  }

  logger.info(`${reminderJobs.size} reminder jobs active`);

  // Watch reminders.json for external changes (e.g. spawned agents editing it)
  const remindersFile = path.join(config.paths.root, 'state', 'reminders.json');
  if (reminderWatcher) {
    reminderWatcher.close();
  }
  let debounceTimer = null;
  reminderWatcher = fs.watch(remindersFile, () => {
    // Debounce — file writes can trigger multiple events
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      logger.info('reminders.json changed externally — syncing cron jobs');
      syncReminders();
    }, 500);
  });
  reminderWatcher.on('error', (err) => {
    logger.error('Reminder file watcher error', { error: err.message });
  });
}

function stopReminderJob(id) {
  const job = reminderJobs.get(id);
  if (job) {
    job.stop();
    reminderJobs.delete(id);
    return true;
  }
  return false;
}

function listReminderJobs() {
  return Array.from(reminderJobs.keys());
}

function stopAllJobs() {
  for (const [name, job] of jobs) {
    job.stop();
    logger.info(`Stopped scheduled job: ${name}`);
  }
  jobs.clear();

  for (const [id, job] of reminderJobs) {
    job.stop();
    logger.info(`Stopped reminder job: ${id}`);
  }
  reminderJobs.clear();

  if (reminderWatcher) {
    reminderWatcher.close();
    reminderWatcher = null;
  }
}

function listJobs() {
  return Array.from(jobs.keys()).map(name => {
    const skill = getScheduledSkills().find(s => s.name === name);
    return {
      name,
      cron: skill?.schedule?.cron || 'unknown',
      description: skill?.schedule?.description || ''
    };
  });
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n\n[...truncated]';
}

export { startScheduledSkills, startReminders, stopReminderJob, listReminderJobs, stopAllJobs, listJobs, setSendCallback };
