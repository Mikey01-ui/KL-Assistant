/**
 * Mac Calendar + Reminders for Alfred speech.
 * Calendar: Choso EventKit bridge (same store as the notch).
 * Tasks: Choso bridge first (fast when warm), Reminders.app JXA fallback.
 * Short TTL cache keeps repeat asks snappy.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const BRIDGE_DIR = path.join(
  os.homedir(),
  'Library/Application Support/Choso Island/alfred-bridge'
);

const CACHE_TTL_MS = {
  events: 45_000,
  tasks: 45_000,
};

/** @type {Map<string, { at: number, value: any }>} */
const cache = new Map();

let chosoLikelyRunning = false;
let warmInFlight = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > (hit.ttl || CACHE_TTL_MS.events)) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttl = CACHE_TTL_MS.events) {
  cache.set(key, { at: Date.now(), value, ttl });
  return value;
}

function toDayString(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA');
}

function ensureChosoRunning() {
  if (chosoLikelyRunning) return Promise.resolve(true);
  return new Promise((resolve) => {
    execFile('pgrep', ['-x', 'Choso Island'], { timeout: 1500 }, (err, stdout) => {
      if (!err && String(stdout || '').trim()) {
        chosoLikelyRunning = true;
        resolve(true);
        return;
      }
      execFile('open', ['-ga', 'Choso Island'], { timeout: 4000 }, () => {
        chosoLikelyRunning = true;
        resolve(false);
      });
    });
  });
}

/**
 * Ask Choso to dump EventKit events/tasks into a JSON file, then read it.
 */
async function queryChosoBridge({ type = 'both', timeMin, timeMax } = {}) {
  const id = randomUUID();
  const start = toDayString(timeMin) || toDayString(new Date());
  const end = toDayString(timeMax) || start;
  try {
    fs.mkdirSync(BRIDGE_DIR, { recursive: true });
  } catch (_) {}
  const outPath = path.join(BRIDGE_DIR, `${id}.json`);
  try {
    fs.unlinkSync(outPath);
  } catch (_) {}

  const alreadyRunning = await ensureChosoRunning();
  if (!alreadyRunning) await sleep(700);

  const params = new URLSearchParams({
    type: String(type || 'both'),
    id,
    start,
    end,
  });
  const url = `choso://query?${params.toString()}`;

  try {
    await new Promise((resolve, reject) => {
      execFile('open', ['-g', url], { timeout: 3000 }, (err) => (err ? reject(err) : resolve()));
    });
  } catch (e) {
    console.warn('[MacSchedule] Choso query open failed:', e.message);
    chosoLikelyRunning = false;
    return null;
  }

  const deadline = Date.now() + (alreadyRunning ? 2500 : 6000);
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(outPath)) {
        const raw = fs.readFileSync(outPath, 'utf8');
        try {
          fs.unlinkSync(outPath);
        } catch (_) {}
        const data = JSON.parse(raw);
        if (data && data.success) {
          chosoLikelyRunning = true;
          return data;
        }
      }
    } catch (_) {}
    await sleep(40);
  }
  console.warn('[MacSchedule] Choso bridge timed out for', id);
  return null;
}

function runJxa(script, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', '-e', script],
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
          return;
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

/** Incomplete Apple Reminders via Reminders.app — slow; used as fallback only. */
async function listMacReminders({ limit = 40 } = {}) {
  const script = `
const Reminders = Application("Reminders");
const lists = Reminders.lists();
const out = [];
for (let i = 0; i < lists.length; i++) {
  const list = lists[i];
  let listName = "";
  try { listName = String(list.name()); } catch (e) { continue; }
  let rems = [];
  try { rems = list.reminders.whose({ completed: false })(); } catch (e) { continue; }
  for (let j = 0; j < rems.length; j++) {
    const r = rems[j];
    try {
      const item = {
        id: String(r.id()),
        title: String(r.name()),
        completed: false,
        notes: "",
        list: listName,
        source: "reminders",
        dueAt: null
      };
      try {
        const due = r.dueDate();
        if (due) item.dueAt = due.toISOString ? due.toISOString() : String(due);
      } catch (e) {}
      out.push(item);
    } catch (e2) {}
  }
}
JSON.stringify(out);
`;
  try {
    const raw = await runJxa(script);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, Math.max(1, limit)).map((t) => ({
      id: t.id,
      title: t.title || '(untitled)',
      notes: t.notes || '',
      dueAt: t.dueAt
        ? (typeof t.dueAt === 'number' ? t.dueAt : Date.parse(t.dueAt) || null)
        : null,
      completed: false,
      createdAt: null,
      remindAt: null,
      googleTaskId: null,
      source: 'reminders',
      list: t.list || '',
    }));
  } catch (e) {
    console.warn('[MacSchedule] Reminders JXA failed:', e.message);
    return [];
  }
}

function normalizeBridgeTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.map((t) => ({
    id: t.id,
    title: t.title || '(untitled)',
    notes: t.notes || '',
    dueAt: t.dueAt
      ? (typeof t.dueAt === 'number' ? t.dueAt : Date.parse(t.dueAt) || null)
      : null,
    completed: Boolean(t.completed),
    createdAt: null,
    remindAt: null,
    googleTaskId: null,
    source: t.source || 'reminders',
    list: t.list || '',
  }));
}

function normalizeBridgeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map((e) => ({
    id: e.id,
    title: e.title || '(no title)',
    start: e.start || null,
    end: e.end || null,
    location: e.location || '',
    allDay: Boolean(e.allDay),
    calendar: e.calendar || '',
    source: 'eventkit',
  }));
}

function mergeEvents(primary, secondary) {
  const out = [];
  const seen = new Set();
  const keyOf = (e) => {
    const start = e.start ? String(e.start).slice(0, 16) : '';
    return `${(e.title || '').toLowerCase().trim()}|${start}`;
  };
  for (const list of [primary, secondary]) {
    for (const e of list || []) {
      const k = keyOf(e);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
  }
  out.sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
  return out;
}

/**
 * Prefer Mac EventKit (via Choso). googleResult optional (not awaited on hot path).
 */
async function fetchMacCalendarEvents(params = {}, googleResult = null) {
  const timeMin = params.time_min || params.timeMin || new Date().toISOString();
  const timeMax =
    params.time_max ||
    params.timeMax ||
    new Date(Date.now() + 14 * 86400000).toISOString();
  const cacheKey = `events:${toDayString(timeMin)}:${toDayString(timeMax)}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[MacSchedule] Calendar cache hit (${cached.events?.length || 0}).`);
    return cached;
  }

  const bridge = await queryChosoBridge({
    type: 'events',
    timeMin,
    timeMax,
  });

  const macEvents = normalizeBridgeEvents(bridge?.events);
  const googleEvents = Array.isArray(googleResult?.events) ? googleResult.events : [];

  if (macEvents.length > 0 || bridge?.success) {
    const events = mergeEvents(macEvents, googleEvents);
    console.log(`[MacSchedule] Using ${macEvents.length} Mac EventKit event(s).`);
    return cacheSet(
      cacheKey,
      {
        success: true,
        events,
        source: 'eventkit',
        googleConnected: Boolean(googleResult?.googleConnected),
        macConnected: true,
      },
      CACHE_TTL_MS.events
    );
  }

  if (googleResult && Array.isArray(googleResult.events)) {
    console.log('[MacSchedule] Choso EventKit empty/unavailable — using Google Calendar.');
    return {
      ...googleResult,
      source: googleResult.source || 'google',
      macConnected: false,
    };
  }

  return {
    success: false,
    events: [],
    source: 'none',
    macConnected: false,
    googleConnected: Boolean(googleResult?.googleConnected),
    error: 'Mac calendar bridge unavailable',
  };
}

/**
 * Mac Reminders via Choso EventKit (fast) → JXA fallback. Cache aggressively.
 * Does not merge SQLite demo/local junk when Mac has reminders.
 */
async function fetchMacTasks({ limit = 40, localTasks = [] } = {}) {
  const cacheKey = `tasks:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[MacSchedule] Tasks cache hit (${cached.length}).`);
    return cached.slice(0, limit);
  }

  let mac = [];
  const bridge = await queryChosoBridge({
    type: 'tasks',
    timeMin: new Date(),
    timeMax: new Date(Date.now() + 86400000),
  });
  mac = normalizeBridgeTasks(bridge?.tasks);

  if (mac.length === 0) {
    mac = await listMacReminders({ limit });
  }

  // Prefer Mac Reminders as source of truth; only fall back to Alfred-local if Mac empty.
  const merged = (mac.length > 0 ? mac : Array.isArray(localTasks) ? localTasks : []).slice(
    0,
    limit
  );
  console.log(
    `[MacSchedule] Tasks: ${mac.length} Mac${mac.length ? '' : ` / ${localTasks?.length || 0} local`} → ${merged.length} spoken.`
  );
  return cacheSet(cacheKey, merged, CACHE_TTL_MS.tasks);
}

/** Warm caches in the background so the first voice ask is not cold. */
function warmCaches() {
  if (warmInFlight) return warmInFlight;
  warmInFlight = (async () => {
    try {
      const now = new Date();
      const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
      await Promise.all([
        fetchMacCalendarEvents({
          time_min: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
          time_max: weekEnd.toISOString(),
        }, null).catch(() => null),
        fetchMacTasks({ limit: 20, localTasks: [] }).catch(() => null),
      ]);
      console.log('[MacSchedule] Warm cache ready.');
    } catch (e) {
      console.warn('[MacSchedule] Warm cache failed:', e.message);
    } finally {
      warmInFlight = null;
    }
  })();
  return warmInFlight;
}

function invalidateCaches() {
  cache.clear();
}

module.exports = {
  queryChosoBridge,
  listMacReminders,
  fetchMacCalendarEvents,
  fetchMacTasks,
  warmCaches,
  invalidateCaches,
  BRIDGE_DIR,
};
