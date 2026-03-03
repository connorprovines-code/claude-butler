import fs from 'fs';
import path from 'path';
import config from './config.js';

const REMINDERS_FILE = path.join(config.paths.root, 'state', 'reminders.json');

function load() {
  if (!fs.existsSync(REMINDERS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function save(reminders) {
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

function getAll() {
  return load();
}

function dismiss(id) {
  const reminders = load();
  const updated = reminders.filter(r => r.id !== id);
  if (updated.length === reminders.length) return false;
  save(updated);
  return true;
}

function dismissAll() {
  save([]);
}

// Called by scheduler after a once=true reminder fires
function dismissOnce(id) {
  const reminders = load();
  const r = reminders.find(r => r.id === id);
  if (r?.once) dismiss(id);
}

export { getAll, dismiss, dismissAll, dismissOnce };
