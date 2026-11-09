// ============================================================
// Memory Service — SQLite-based persistent memory for JARVIS
// Uses better-sqlite3 (synchronous) in Electron main process
// DB stored at: %APPDATA%/jarvis/memory.db
// ============================================================

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { detectLanguage } = require('./languageDetect');

let db = null;
let currentSessionId = null;

// ── Date/Time helpers (DD/MM/YYYY, HH:MM:SS) ──────────────────
function getDateStr() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function getTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function getDayOfWeek() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

function getFullTimestamp() {
  return `${getDateStr()} ${getTimeStr()}`;
}

// ── Database Initialization ────────────────────────────────────
function initDatabase() {
  try {
    const Database = require('better-sqlite3');
    const dbDir = path.join(app.getPath('userData'), 'jarvis');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'memory.db');
    db = new Database(dbPath);

    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        day_of_week TEXT NOT NULL,
        summary TEXT DEFAULT '',
        message_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        timestamp TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        day_of_week TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        keywords TEXT DEFAULT '',
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_obs_keywords ON observations(keywords);
      CREATE INDEX IF NOT EXISTS idx_obs_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_obs_session ON observations(session_id);
    `);

    console.log('Memory database initialized:', dbPath);
    return true;
  } catch (err) {
    console.error('Failed to initialize memory database:', err.message);
    return false;
  }
}

// ── Session Management ─────────────────────────────────────────
function createSession() {
  if (!db) return null;
  try {
    const stmt = db.prepare(
      'INSERT INTO sessions (date, time, day_of_week, created_at) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(getDateStr(), getTimeStr(), getDayOfWeek(), getFullTimestamp());
    currentSessionId = result.lastInsertRowid;
    console.log('New memory session:', currentSessionId);
    return currentSessionId;
  } catch (err) {
    console.error('Failed to create session:', err.message);
    return null;
  }
}

function getCurrentSessionId() {
  return currentSessionId;
}

function updateSessionSummary(sessionId, summary, messageCount) {
  if (!db) return;
  try {
    db.prepare(
      'UPDATE sessions SET summary = ?, message_count = ? WHERE id = ?'
    ).run(summary, messageCount, sessionId);
  } catch (err) {
    console.error('Failed to update session summary:', err.message);
  }
}

function getRecentSessions(limit = 5) {
  if (!db) return [];
  try {
    const rows = db.prepare(
      'SELECT * FROM sessions ORDER BY id DESC LIMIT ?'
    ).all(limit);
    return rows.map(r => ({
      ...r,
      isActive: r.id === currentSessionId
    }));
  } catch (err) {
    console.error('Failed to get recent sessions:', err.message);
    return [];
  }
}

// ── User Profile ───────────────────────────────────────────────
function saveUserProfile(key, value) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO user_profile (key, value, updated_at) 
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, getFullTimestamp());
  } catch (err) {
    console.error('Failed to save user profile:', err.message);
  }
}

function getUserProfile() {
  if (!db) return {};
  try {
    const rows = db.prepare('SELECT key, value, updated_at FROM user_profile ORDER BY key').all();
    const profile = {};
    for (const row of rows) {
      profile[row.key] = row.value;
    }
    return profile;
  } catch (err) {
    console.error('Failed to get user profile:', err.message);
    return {};
  }
}

function deleteProfile(key) {
  if (!db) return;
  try {
    db.prepare('DELETE FROM user_profile WHERE key = ?').run(key);
  } catch (err) {
    console.error('Failed to delete profile key:', err.message);
  }
}

// ── Observations ───────────────────────────────────────────────
function saveObservation(sessionId, type, content, keywords) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO observations (session_id, timestamp, date, time, day_of_week, type, content, keywords)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId || currentSessionId,
      getFullTimestamp(),
      getDateStr(),
      getTimeStr(),
      getDayOfWeek(),
      type,
      content,
      keywords
    );
  } catch (err) {
    console.error('Failed to save observation:', err.message);
  }
}

function getAllObservations(limit = 100) {
  if (!db) return [];
  try {
    return db.prepare(
      'SELECT * FROM observations ORDER BY id DESC LIMIT ?'
    ).all(limit);
  } catch (err) {
    console.error('Failed to get observations:', err.message);
    return [];
  }
}

function deleteObservation(id) {
  if (!db) return;
  try {
    db.prepare('DELETE FROM observations WHERE id = ?').run(id);
  } catch (err) {
    console.error('Failed to delete observation:', err.message);
  }
}

function searchObservations(query) {
  if (!db || !query) return [];
  try {
    const { extractKeywords, rankObservations } = require('./memorySearch');
    const keywords = extractKeywords(query);
    if (keywords.length === 0) return [];

    // Build a LIKE query for each keyword
    const conditions = keywords.map(() => 'keywords LIKE ?').join(' OR ');
    const params = keywords.map(k => `%${k}%`);

    const rows = db.prepare(
      `SELECT * FROM observations WHERE ${conditions} ORDER BY id DESC LIMIT 50`
    ).all(...params);

    return rankObservations(rows, keywords, 5);
  } catch (err) {
    console.error('Failed to search observations:', err.message);
    return [];
  }
}

// ── Auto-Extraction ────────────────────────────────────────────
// Extracts user info, topics, tasks, emotions from each message turn
function autoExtractAndSave(sessionId, userMessage, aiResponse) {
  if (!db || !userMessage) return;

  const sid = sessionId || currentSessionId;
  const msgLower = userMessage.toLowerCase();

  // ── Extract user name ──
  const namePatterns = [
    /my name is (\w+)/i,
    /i(?:'m| am) (\w+)/i,
    /call me (\w+)/i,
    /i go by (\w+)/i,
    /this is (\w+)/i,
  ];
  for (const pat of namePatterns) {
    const match = userMessage.match(pat);
    if (match && match[1]) {
      const name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
      // Skip common words that aren't names
      const skipWords = ['a', 'the', 'your', 'here', 'there', 'fine', 'good', 'great', 'okay', 'sure', 'not', 'just', 'doing', 'feeling', 'looking', 'interested', 'curious'];
      if (!skipWords.includes(name.toLowerCase())) {
        saveUserProfile('name', name);
        saveObservation(sid, 'user_info', `User's name is ${name}`, `name,${name.toLowerCase()}`);
      }
      break;
    }
  }

  // ── Extract age ──
  const ageMatch = userMessage.match(/i(?:'m| am) (\d{1,3})(?: years? old)?/i) ||
                   userMessage.match(/my age is (\d{1,3})/i);
  if (ageMatch && ageMatch[1]) {
    const age = parseInt(ageMatch[1]);
    if (age > 0 && age < 150) {
      saveUserProfile('age', String(age));
      saveObservation(sid, 'user_info', `User is ${age} years old`, `age,${age},years`);
    }
  }

  // ── Extract birthday ──
  const bdayMatch = userMessage.match(/my birthday is (.+?)(?:\.|,|$)/i) ||
                    userMessage.match(/born on (.+?)(?:\.|,|$)/i);
  if (bdayMatch && bdayMatch[1]) {
    saveUserProfile('birthday', bdayMatch[1].trim());
    saveObservation(sid, 'user_info', `User's birthday is ${bdayMatch[1].trim()}`, `birthday,born`);
  }

  // ── Extract location ──
  const locMatch = userMessage.match(/i(?:'m| am) (?:from|in|at|based in) (.+?)(?:\.|,|$)/i) ||
                   userMessage.match(/i live in (.+?)(?:\.|,|$)/i);
  if (locMatch && locMatch[1]) {
    const location = locMatch[1].trim();
    if (location.length > 1 && location.length < 50) {
      saveUserProfile('location', location);
      saveObservation(sid, 'user_info', `User is from/in ${location}`, `location,${location.toLowerCase()}`);
    }
  }

  // ── Detect emotion ──
  const emotions = {
    frustrated: ['frustrated', 'annoyed', 'angry', 'mad', 'irritated', 'pissed', 'hate'],
    happy: ['happy', 'excited', 'great', 'awesome', 'love', 'wonderful', 'amazing', 'fantastic'],
    sad: ['sad', 'depressed', 'down', 'unhappy', 'terrible', 'miserable'],
    stressed: ['stressed', 'overwhelmed', 'anxious', 'worried', 'nervous'],
    tired: ['tired', 'exhausted', 'sleepy', 'drained', 'burnt out'],
  };

  for (const [emotion, triggers] of Object.entries(emotions)) {
    if (triggers.some(t => msgLower.includes(t))) {
      saveObservation(sid, 'emotion', `User seems ${emotion}: "${userMessage.substring(0, 80)}"`, `emotion,${emotion}`);
      break;
    }
  }

  // ── Detect tasks / preferences ──
  if (msgLower.match(/i (?:need to|have to|must|should|want to|gonna|going to) /)) {
    saveObservation(sid, 'task', userMessage.substring(0, 200), buildKeywordString(userMessage));
  }

  if (msgLower.match(/i (?:like|prefer|love|enjoy|hate|dislike|don't like) /)) {
    saveObservation(sid, 'preference', userMessage.substring(0, 200), buildKeywordString(userMessage));
  }

  // ── Save general topic ──
  saveObservation(sid, 'topic', userMessage.substring(0, 200), buildKeywordString(userMessage));
}

function buildKeywordString(text) {
  const { extractKeywords } = require('./memorySearch');
  return extractKeywords(text).slice(0, 10).join(',');
}

// ── Language Mode Override ──────────────────────────────────────
// Persistent setting: 'auto' (default), 'english', 'urdu'
function getLanguageMode() {
  const profile = getUserProfile();
  return profile.language_mode || 'auto';
}

function setLanguageMode(mode) {
  saveUserProfile('language_mode', mode);
}

/**
 * checkLanguageCommand(message) → string | null
 *
 * Checks if the user message is a language-override command.
 * Returns a short confirmation string if handled, or null if not a command.
 */
function checkLanguageCommand(message) {
  if (!message || typeof message !== 'string') return null;
  const lower = message.toLowerCase().trim();

  // English override
  if (
    lower.includes('hamesha english') ||
    lower.includes('always english') ||
    lower.includes('only english') ||
    lower.includes('english mein baat') ||
    lower.includes('speak english') ||
    lower.includes('sirf english')
  ) {
    setLanguageMode('english');
    return 'Done, Sir. I will respond in English from now on. Say "auto detect language" to reset.';
  }

  // Urdu override
  if (
    lower.includes('hamesha urdu') ||
    lower.includes('always urdu') ||
    lower.includes('only urdu') ||
    lower.includes('urdu mein baat') ||
    lower.includes('speak urdu') ||
    lower.includes('sirf urdu')
  ) {
    setLanguageMode('urdu');
    return 'Theek hai Sir, ab se main Urdu mein baat karun ga. "auto detect language" bol ke reset kar sakte hain.';
  }

  // Reset to auto
  if (
    lower.includes('auto detect language') ||
    lower.includes('auto language') ||
    lower.includes('language auto')
  ) {
    setLanguageMode('auto');
    return 'Language mode reset to auto-detect, Sir. I\'ll match whatever language you use.';
  }

  return null;
}

// ── Dynamic System Prompt Builder ──────────────────────────────
function buildSystemPrompt(currentMessage, location) {
  const date = getDateStr();
  const time = getTimeStr();
  const day = getDayOfWeek();

  // ── Determine language for THIS turn ──
  const langMode = getLanguageMode();
  let effectiveLang;
  if (langMode === 'auto') {
    effectiveLang = detectLanguage(currentMessage);
  } else {
    effectiveLang = langMode; // 'english' or 'urdu'
  }

  const LANG_INSTRUCTIONS = {
    urdu: `[CRITICAL LANGUAGE RULE — MANDATORY 100% ENFORCEMENT]
You MUST respond ONLY in natural Roman Urdu (Urdu written using Latin/English alphabet letters, e.g. "Sir, main aap ki madad kar sakta hoon").
NEVER use Arabic/Urdu script (such as "میں آپ کی مدد کروں گا").
Even if the user writes in English, you MUST respond in Roman Urdu.
Mix English technical terms naturally (e.g. "CPU", "Settings", "App", "File", "Browser").
This language rule strictly overrides any other language cues in the user's message. Never switch languages.`,

    english: `[CRITICAL LANGUAGE RULE — MANDATORY 100% ENFORCEMENT]
You MUST respond ONLY in pure English.
Even if the user writes in Urdu, Roman Urdu, or any other language, you MUST respond in English 100% of the time.
Do NOT use any Urdu or Roman Urdu words or phrases under any circumstance.
This language rule strictly overrides any other language cues in the user's message. Never switch languages.`,

    auto: `[LANGUAGE INSTRUCTION]
Match the user's language automatically:
- If the user writes in Roman Urdu or Urdu, respond in Roman Urdu (Latin alphabet letters only, no Arabic script).
- If the user writes in English, respond in English.`,
  };

  // ── Fixed core (never truncated) ──
  // Language instruction placed right after identity lines for maximum effect.
  const coreHeader = `You are Alfred Pennyworth — personal butler and loyal aide to Sir.
You are in live, hands-free conversational voice mode.
Speak naturally with calm British composure, addressing the user respectfully as "Sir".
Be direct, helpful, and concise: reply in 1 to 2 punchy, spoken sentences maximum.
Never give long-winded answers, monologues, or over-exaggerated theatrical Batman tropes. Understand Sir's intent and answer directly.
NEVER use markdown formatting, bullet points, asterisks, or numbered lists.

${LANG_INSTRUCTIONS[effectiveLang] || LANG_INSTRUCTIONS.auto}\n`;

  const coreContext = `\nCURRENT CONTEXT:\n` +
    `- Date/Time: ${day}, ${date} at ${time}\n` +
    (location && location.city !== 'Unknown'
      ? `- Location: ${location.city}, ${location.country}\n- Weather context: use location for weather queries\n`
      : '') +
    `- PC Control: Active (you can open apps, control system)\n` +
    `- Web Search: Active via Tavily API\n`;

  // ── User profile (compact, rarely large) ──
  let profileSection = '';
  const profile = getUserProfile();
  if (Object.keys(profile).length > 0) {
    const profileEntries = Object.entries(profile)
      .filter(([k]) => k !== 'language_mode') // don't leak internal setting into prompt
      .map(([k, v]) => `${k}: ${v}`).join(', ');
    if (profile.name) profileSection += `\nYou are speaking with ${profile.name}.\n`;
    if (profileEntries) profileSection += `User Profile: ${profileEntries}\n`;
  }

  // ── Fixed tail (never truncated) ──
  const fixedTail =
    `\nCAPABILITIES:\n` +
    `- Open any app via voice or text\n` +
    `- Search the web for current info\n` +
    `- Control system (volume, screenshot, shutdown)\n` +
    `- Remember user preferences across sessions\n` +
    `\nWhen executing commands, confirm destructive actions.\nKeep responses sharp and intelligent.\nAlways remember and reference past conversations naturally.`;

  // ── Variable sections: cap entries, never touch fixed sections ──
  let variableSections = '';

  // Cap recent sessions at 3 entries
  const sessions = getRecentSessions(5);
  const recentSessions = sessions.filter(s => s.summary).slice(0, 3);
  if (recentSessions.length > 0) {
    variableSections += `\nRecent Sessions:\n`;
    for (const s of recentSessions) {
      variableSections += `- ${s.day_of_week} ${s.date} ${s.time}: ${s.summary.substring(0, 100)}\n`;
    }
  }

  // Cap relevant past context at 3 entries
  if (currentMessage) {
    const relevant = searchObservations(currentMessage).slice(0, 3);
    if (relevant.length > 0) {
      variableSections += `\nRelevant Past Context:\n`;
      for (const obs of relevant) {
        variableSections += `- [${obs.date}] ${obs.content.substring(0, 80)}\n`;
      }
    }
  }

  // End-of-prompt language reminder
  let endLanguageReminder = '';
  if (effectiveLang === 'english') {
    endLanguageReminder = `\n\n[FINAL REMINDER: Reply in pure ENGLISH ONLY. Do NOT use Urdu or Roman Urdu.]`;
  } else if (effectiveLang === 'urdu') {
    endLanguageReminder = `\n\n[FINAL REMINDER: Reply in ROMAN URDU ONLY (Latin/English alphabet). Do NOT reply in English or Arabic script.]`;
  }

  // Assemble: fixed sections wrap the variable content
  let prompt = coreHeader + coreContext + profileSection + variableSections + fixedTail + endLanguageReminder;

  // Safety-net length guard — should rarely fire after the entry caps above
  if (prompt.length > 2000) {
    prompt = coreHeader + coreContext + profileSection + fixedTail;
  }

  return prompt;
}


// ── Session Summarization ──────────────────────────────────────
async function summarizeSession(sessionId, conversation) {
  if (!db || !conversation || conversation.length === 0) return;

  try {
    // Build conversation text for summarization
    const text = conversation
      .slice(-20) // Last 20 messages max
      .map(m => `${m.role}: ${m.content.substring(0, 150)}`)
      .join('\n');

    // Ask Ollama to summarize
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.5:4b',
        messages: [
          {
            role: 'system',
            content: 'Summarize this conversation in 1-2 sentences. Focus on key topics, decisions, and user requests. Be concise.'
          },
          { role: 'user', content: text }
        ],
        stream: false,
        think: false,
        options: { num_predict: 100 },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const summary = data.message?.content || '';
      updateSessionSummary(sessionId, summary, conversation.length);
    }
  } catch (err) {
    // Summarization is best-effort, don't crash
    console.error('Session summarization failed:', err.message);
  }

  // Rotate old sessions — keep last 50
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM sessions').get();
    if (count.c > 50) {
      db.prepare(`
        DELETE FROM observations WHERE session_id IN (
          SELECT id FROM sessions ORDER BY id ASC LIMIT ?
        )
      `).run(count.c - 50);
      db.prepare(
        'DELETE FROM sessions WHERE id NOT IN (SELECT id FROM sessions ORDER BY id DESC LIMIT 50)'
      ).run();
    }
  } catch (err) {
    console.error('Session rotation failed:', err.message);
  }
}

// ── Stats ──────────────────────────────────────────────────────
function getStats() {
  if (!db) return { observations: 0, sessions: 0, profileKeys: 0 };
  try {
    const obs = db.prepare('SELECT COUNT(*) as c FROM observations').get();
    const sess = db.prepare('SELECT COUNT(*) as c FROM sessions').get();
    const prof = db.prepare('SELECT COUNT(*) as c FROM user_profile').get();
    return {
      observations: obs.c,
      sessions: sess.c,
      profileKeys: prof.c,
    };
  } catch (err) {
    return { observations: 0, sessions: 0, profileKeys: 0 };
  }
}

// ── Cleanup ────────────────────────────────────────────────────
function closeDatabase() {
  if (db) {
    try { db.close(); } catch (e) {}
    db = null;
  }
}

module.exports = {
  initDatabase,
  createSession,
  getCurrentSessionId,
  updateSessionSummary,
  getRecentSessions,
  saveUserProfile,
  getUserProfile,
  deleteProfile,
  saveObservation,
  getAllObservations,
  deleteObservation,
  searchObservations,
  autoExtractAndSave,
  buildSystemPrompt,
  summarizeSession,
  getStats,
  closeDatabase,
  checkLanguageCommand,
  getLanguageMode,
  setLanguageMode,
};
