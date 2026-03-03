import fs from 'fs';
import path from 'path';
import config from './config.js';

const STATE_FILE = path.join(config.paths.root, 'state', 'inflight.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

function trackStart(agentId, userId, prompt) {
  const data = load();
  data[agentId] = { userId, prompt: prompt.slice(0, 120), startedAt: Date.now() };
  save(data);
}

function trackEnd(agentId) {
  const data = load();
  delete data[agentId];
  save(data);
}

// Returns any tasks that were in-flight when the process last died
function getOrphaned() {
  const data = load();
  return Object.values(data);
}

function clearAll() {
  save({});
}

export { trackStart, trackEnd, getOrphaned, clearAll };
