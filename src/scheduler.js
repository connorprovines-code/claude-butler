import cron from 'node-cron';
import { getScheduledSkills, buildPrompt } from './skills.js';
import { spawnAgent } from './spawner.js';
import logger from './logger.js';

// Active cron jobs
const jobs = new Map();

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

function stopAllJobs() {
  for (const [name, job] of jobs) {
    job.stop();
    logger.info(`Stopped scheduled job: ${name}`);
  }
  jobs.clear();
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

export { startScheduledSkills, stopAllJobs, listJobs, setSendCallback };
