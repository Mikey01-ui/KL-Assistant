const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { randomUUID } = require('crypto');

let db = null;

function getDbPath() {
  const dir = path.join(app.getPath('userData'), 'jarvis');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'tasks.db');
}

function initTasksDb() {
  if (db) return db;
  const Database = require('better-sqlite3');
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      due_at INTEGER,
      completed INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      remind_at INTEGER,
      notes TEXT,
      google_task_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_remind ON tasks(remind_at);
  `);

  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN google_task_id TEXT;`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN notes TEXT;`);
  } catch (_) {}

  // Do not seed demo tasks — Alfred speaks Mac Reminders / real user tasks only.
  // One-time cleanup of older demo seeds so they stop leaking into speech.
  try {
    const demoTitles = [
      'Remake Spotify ad',
      'Make Python based ar Jarvis ai',
      'Make brother sams website',
      'Make davinci resolve ai pluggin',
    ];
    const del = db.prepare('DELETE FROM tasks WHERE title = ? AND google_task_id IS NULL');
    for (const title of demoTitles) del.run(title);
  } catch (_) {}

  return db;
}

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    notes: row.notes || '',
    dueAt: row.due_at,
    completed: Boolean(row.completed),
    createdAt: row.created_at,
    remindAt: row.remind_at,
    googleTaskId: row.google_task_id || null,
  };
}

function listTasks({ includeCompleted = false, limit = 20 } = {}) {
  initTasksDb();
  const rows = includeCompleted
    ? db.prepare(
        `SELECT * FROM tasks ORDER BY completed ASC, COALESCE(due_at, 9999999999999) ASC LIMIT ?`
      ).all(limit)
    : db.prepare(
        `SELECT * FROM tasks WHERE completed = 0 ORDER BY COALESCE(due_at, 9999999999999) ASC LIMIT ?`
      ).all(limit);
  return rows.map(rowToTask);
}

function addTask({ title, dueAt = null, remindAt = null, notes = '', googleTaskId = null }) {
  initTasksDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO tasks (id, title, due_at, completed, created_at, remind_at, notes, google_task_id) VALUES (?, ?, ?, 0, ?, ?, ?, ?)`
  ).run(id, String(title || '').trim(), dueAt, now, remindAt, notes, googleTaskId);
  return rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

function setGoogleTaskId(id, googleTaskId) {
  initTasksDb();
  db.prepare('UPDATE tasks SET google_task_id = ? WHERE id = ?').run(googleTaskId, id);
}

function getTaskById(id) {
  initTasksDb();
  return rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

function completeTask(id) {
  initTasksDb();
  db.prepare('UPDATE tasks SET completed = 1 WHERE id = ?').run(id);
  return rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

function toggleTask(id) {
  initTasksDb();
  const current = db.prepare('SELECT completed FROM tasks WHERE id = ?').get(id);
  const next = current && current.completed ? 0 : 1;
  db.prepare('UPDATE tasks SET completed = ? WHERE id = ?').run(next, id);
  return rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

function deleteTask(id) {
  initTasksDb();
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return true;
}

function dueReminders(now = Date.now()) {
  initTasksDb();
  // Clear any severely expired reminders (older than 15 minutes) so they don't spam on boot
  db.prepare(`UPDATE tasks SET remind_at = NULL WHERE remind_at IS NOT NULL AND remind_at < ?`).run(now - 15 * 60 * 1000);

  const rows = db
    .prepare(
      `SELECT * FROM tasks WHERE completed = 0 AND remind_at IS NOT NULL AND remind_at <= ? ORDER BY remind_at ASC LIMIT 5`
    )
    .all(now);
  return rows.map(rowToTask);
}

function clearReminder(id) {
  initTasksDb();
  db.prepare('UPDATE tasks SET remind_at = NULL WHERE id = ?').run(id);
}

module.exports = {
  initTasksDb,
  listTasks,
  addTask,
  completeTask,
  toggleTask,
  deleteTask,
  dueReminders,
  clearReminder,
  setGoogleTaskId,
  getTaskById,
};
