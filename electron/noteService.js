/**
 * noteService.js — SQLite local note persistence + macOS Apple Notes sync.
 */
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');

let db = null;

function getDbPath() {
  const dir = path.join(app.getPath('userData'), 'jarvis');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'notes.db');
}

function initNotesDb() {
  if (db) return db;
  const Database = require('better-sqlite3');
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT,
      folder TEXT DEFAULT 'General',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      apple_note_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
  `);
  return db;
}

function rowToNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content || '',
    folder: row.folder || 'General',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appleNoteId: row.apple_note_id || null,
  };
}

/**
 * Sync a note to macOS Apple Notes via osascript
 */
function createAppleNote(title, content) {
  if (process.platform !== 'darwin') return Promise.resolve({ success: false });
  const safeTitle = (title || 'Quick Note').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeBody = (content || title || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `tell application "Notes"
    tell default account
      make new note at folder "Notes" with properties {name:"${safeTitle}", body:"${safeBody}"}
    end tell
  end tell`;

  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 8000 }, (err, stdout) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true, output: stdout ? stdout.trim() : 'OK' });
    });
  });
}

/**
 * Add a new note
 */
async function addNote({ title, content = '', folder = 'General', syncApple = true }) {
  initNotesDb();
  const id = randomUUID();
  const now = Date.now();
  const cleanTitle = String(title || 'Note').trim();
  const cleanContent = String(content || '').trim();

  let appleNoteCreated = false;
  if (syncApple) {
    try {
      const appleRes = await createAppleNote(cleanTitle, cleanContent);
      appleNoteCreated = appleRes.success;
    } catch (_) {}
  }

  db.prepare(
    `INSERT INTO notes (id, title, content, folder, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, cleanTitle, cleanContent, folder, now, now);

  const saved = rowToNote(db.prepare('SELECT * FROM notes WHERE id = ?').get(id));
  return { ...saved, appleNoteCreated };
}

/**
 * List notes
 */
function listNotes({ limit = 20, folder = null } = {}) {
  initNotesDb();
  const rows = folder
    ? db.prepare('SELECT * FROM notes WHERE folder = ? ORDER BY updated_at DESC LIMIT ?').all(folder, limit)
    : db.prepare('SELECT * FROM notes ORDER BY updated_at DESC LIMIT ?').all(limit);
  return rows.map(rowToNote);
}

/**
 * Search notes by keyword
 */
function searchNotes({ query, limit = 10 } = {}) {
  initNotesDb();
  if (!query || !query.trim()) return listNotes({ limit });
  const q = `%${query.trim()}%`;
  const rows = db.prepare(
    `SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT ?`
  ).all(q, q, limit);
  return rows.map(rowToNote);
}

/**
 * Delete a note
 */
function deleteNote(id) {
  initNotesDb();
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  return true;
}

module.exports = {
  initNotesDb,
  addNote,
  listNotes,
  searchNotes,
  deleteNote,
};
