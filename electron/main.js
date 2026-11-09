const { app, BrowserWindow, screen, ipcMain, dialog, shell, desktopCapturer, powerSaveBlocker, session, systemPreferences } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { execFile, exec, spawn, execSync } = require('child_process');
const os = require('os');
const memory = require('./memoryService');
const { detectLanguage } = require('./languageDetect');
const macTools = require('./macTools');
const googleAuth = require('./googleAuth');
const elevenLabs = require('./elevenLabs');
const { createCalendarHandlers } = require('./tools/calendar');
const { createGmailHandlers } = require('./tools/gmail');
const { createWeatherHandlers, getWeather } = require('./tools/weather');
const { calendar_fetch_structured } = require('./tools/calendar');
const { filterSttText } = require('./sttFilter');
const tasks = require('./taskService');
const music = require('./musicService');
const { createGoogleTasksHandlers, createGoogleTask } = require('./tools/googleTasks');
const noteService = require('./noteService');
const macSchedule = require('./tools/macSchedule');

let mainWindow;
const getMainWindow = () => mainWindow;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.userAgentFallback = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function setupMediaPermissions() {
  const allowed = new Set(['media', 'audioCapture', 'microphone', 'videoCapture', 'camera']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {});
    systemPreferences.askForMediaAccess('camera').catch(() => {});
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#020810',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
      v8CacheOptions: 'bypassHeatCheck',
    },
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] [Level ${level}] ${message} (at ${sourceId}:${line})`);
  });

  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            const img = await mainWindow.capturePage();
            const previewPath = '/Users/milton/.gemini/antigravity/brain/f0317e93-5a83-4ebf-b78e-7cbbd09164b7/ui_preview.png';
            fs.writeFileSync(previewPath, img.toPNG());
            console.log('[Electron] UI preview captured to:', previewPath);
          }
        } catch (_) {}
      }, 1500);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Periodic capture watcher or on-demand
  ipcMain.handle('capture-snapshot', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const img = await mainWindow.capturePage();
        const previewPath = '/Users/milton/.gemini/antigravity/brain/f0317e93-5a83-4ebf-b78e-7cbbd09164b7/ui_preview.png';
        fs.writeFileSync(previewPath, img.toPNG());
        return true;
      }
    } catch (_) {}
    return false;
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Window controls
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() || false);

ipcMain.on('show-main-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('broadcast-event', (event, { channel, payload }) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && event.sender.id !== mainWindow.webContents.id) {
      mainWindow.webContents.send('broadcast-event', { channel, payload });
    }
  } catch (e) {
    console.error('[Electron] broadcast-event error:', e.message);
  }
});

// ============================================================
// SYSTEM TIME — Real local time
// ============================================================
ipcMain.handle('get-system-time', () => {
  return {
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }),
    timestamp: Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
});

// ============================================================
// LOCATION — IP-based, cached 1 hour
// ============================================================
let cachedLocation = null;
let lastLocationFetch = 0;

ipcMain.handle('get-location', async () => {
  const now = Date.now();
  if (cachedLocation && (now - lastLocationFetch) < 3600000) return cachedLocation;
  try {
    const http = require('http');
    const data = await new Promise((resolve, reject) => {
      const req = http.get('http://ip-api.com/json/', { timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Location request timed out'));
      });
      req.on('error', reject);
    });
    cachedLocation = {
      city: data.city || 'Unknown',
      country: data.country || 'Unknown',
      region: data.regionName || '',
      lat: data.lat || 0,
      lon: data.lon || 0,
      timezone: data.timezone || '',
    };
    lastLocationFetch = now;
    return cachedLocation;
  } catch (e) {
    console.error('Location fetch failed:', e.message);
    return cachedLocation || { city: 'Unknown', country: 'Unknown', region: '', lat: 0, lon: 0, timezone: '' };
  }
});

ipcMain.handle('get-env-keys', () => {
  return {
    groq: getEnvKey('GROQ_API_KEY') || '',
    gemini: getEnvKey('GEMINI_API_KEY') || getEnvKey('VITE_GEMINI_API_KEY') || '',
  };
});

// ============================================================
// STATS WORKER THREAD & BLOCKERS
// ============================================================
let statsWorker = null;
let latestStats = null;

function startStatsWorker() {
  if (statsWorker) {
    try { statsWorker.terminate(); } catch (e) {}
  }
  statsWorker = new Worker(path.join(__dirname, 'workers/statsWorker.js'));
  statsWorker.on('message', (data) => {
    latestStats = data;
  });
  statsWorker.on('error', (err) => {
    console.error('Stats worker error:', err);
    if (!appQuitting) {
      setTimeout(startStatsWorker, 5000);
    }
  });
  statsWorker.on('exit', (code) => {
    console.log(`Stats worker exited with code ${code}`);
    if (code !== 0 && !appQuitting) {
      setTimeout(startStatsWorker, 5000);
    }
  });
}

ipcMain.handle('get-system-stats', async () => {
  return latestStats;
});

let activeBlockerId = null;
let blockerTimeout = null;

ipcMain.on('ai-started', () => {
  if (activeBlockerId === null) {
    activeBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    console.log('[main] Power save blocker started, ID:', activeBlockerId);
  }
  if (blockerTimeout) {
    clearTimeout(blockerTimeout);
  }
  blockerTimeout = setTimeout(() => {
    if (activeBlockerId !== null && powerSaveBlocker.isStarted(activeBlockerId)) {
      powerSaveBlocker.stop(activeBlockerId);
      console.log('[main] Power save blocker stopped (timeout 60s), ID:', activeBlockerId);
      activeBlockerId = null;
    }
    blockerTimeout = null;
  }, 60000);
});

ipcMain.on('ai-stopped', () => {
  if (blockerTimeout) {
    clearTimeout(blockerTimeout);
    blockerTimeout = null;
  }
  if (activeBlockerId !== null && powerSaveBlocker.isStarted(activeBlockerId)) {
    powerSaveBlocker.stop(activeBlockerId);
    console.log('[main] Power save blocker stopped (ai-stopped), ID:', activeBlockerId);
    activeBlockerId = null;
  }
});

// ============================================================
// MEMORY SYSTEM IPC HANDLERS
// ============================================================
ipcMain.handle('memory-build-prompt', async (_event, message) => {
  try {
    return memory.buildSystemPrompt(message, cachedLocation);
  } catch (err) {
    console.error('memory-build-prompt error:', err.message);
    return null;
  }
});

ipcMain.handle('memory-save-turn', async (_event, userMsg, aiResponse) => {
  try {
    memory.autoExtractAndSave(memory.getCurrentSessionId(), userMsg, aiResponse);
    return true;
  } catch (err) {
    console.error('memory-save-turn error:', err.message);
    return false;
  }
});

ipcMain.handle('memory-get-all', async () => {
  try {
    return memory.getAllObservations();
  } catch (err) {
    return [];
  }
});

ipcMain.handle('memory-get-profile', async () => {
  try {
    return memory.getUserProfile();
  } catch (err) {
    return {};
  }
});

ipcMain.handle('memory-get-sessions', async () => {
  try {
    return memory.getRecentSessions(50);
  } catch (err) {
    return [];
  }
});

ipcMain.handle('memory-delete', async (_event, id) => {
  try {
    memory.deleteObservation(id);
    return true;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('memory-search', async (_event, query) => {
  try {
    return memory.searchObservations(query);
  } catch (err) {
    return [];
  }
});

ipcMain.handle('check-language-command', async (_event, message) => {
  try {
    return memory.checkLanguageCommand(message);
  } catch (err) {
    console.error('check-language-command error:', err.message);
    return null;
  }
});

ipcMain.handle('get-language-mode', async () => {
  try {
    return memory.getLanguageMode();
  } catch (err) {
    console.error('get-language-mode error:', err.message);
    return 'auto';
  }
});

ipcMain.handle('set-language-mode', async (_event, mode) => {
  try {
    memory.setLanguageMode(mode);
    return true;
  } catch (err) {
    console.error('set-language-mode error:', err.message);
    return false;
  }
});

ipcMain.handle('memory-summarize-session', async (_event, messages) => {
  try {
    const sessionId = memory.getCurrentSessionId();
    let convo = messages;
    if (!convo || !Array.isArray(convo) || convo.length === 0) {
      if (fs.existsSync(CHAT_LOG_PATH)) {
        try { convo = JSON.parse(fs.readFileSync(CHAT_LOG_PATH, 'utf-8')); } catch (_) {}
      }
    }
    if (sessionId && Array.isArray(convo) && convo.length > 0) {
      await memory.summarizeSession(sessionId, convo);
    }
    return true;
  } catch (err) {
    console.error('memory-summarize-session error:', err.message);
    return false;
  }
});

ipcMain.handle('memory-create-session', async () => {
  try {
    return memory.createSession();
  } catch (err) {
    console.error('memory-create-session error:', err.message);
    return null;
  }
});

// ============================================================
// PC CONTROL — Tool Execution System (macOS + Google)
// ============================================================
const TOOL_HANDLERS = {
  ...macTools.createToolHandlers(getMainWindow),
  ...createCalendarHandlers(getMainWindow),
  ...createGmailHandlers(getMainWindow),
  ...createWeatherHandlers(getMainWindow),
  ...createGoogleTasksHandlers(getMainWindow),
  task_add: async (params) => {
    const title = params.title || params.summary || params.reminder || '';
    if (!title) return { success: false, error: 'Missing title' };
    let dueAt = null;
    let remindAt = null;
    if (params.due_at) dueAt = new Date(params.due_at).getTime();
    if (params.remind_at) remindAt = new Date(params.remind_at).getTime();
    if (!remindAt && dueAt) remindAt = dueAt;
    if (!dueAt && remindAt) dueAt = remindAt;

    let googleTaskId = null;
    let googleSynced = false;
    try {
      if (googleAuth.isConnected()) {
        const gRes = await createGoogleTask({ title, dueAt: dueAt || remindAt });
        if (gRes.success && gRes.id) {
          googleTaskId = gRes.id;
          googleSynced = true;
        }
      }
    } catch (_) {}

    const task = tasks.addTask({ title, dueAt, remindAt, googleTaskId });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tasks-updated');
    }
    const dueStr = dueAt ? ` for ${new Date(dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
    const syncStr = googleSynced ? ' (synced to Google Tasks)' : '';
    return { success: true, output: `Reminder set: ${task.title}${dueStr}, Sir.${syncStr}`, task, googleSynced };
  },
  task_list: async () => {
    const list = tasks.listTasks({ limit: 10 });
    if (!list.length) return { success: true, output: 'No open tasks, Sir.' };
    const lines = list.map((t, i) => {
      const due = t.dueAt ? new Date(t.dueAt).toLocaleString() : 'anytime';
      const tag = t.googleTaskId ? ' 🌐' : '';
      return `${i + 1}. ${t.title}${tag} (due ${due})`;
    });
    return { success: true, output: lines.join('\n'), tasks: list };
  },
  task_complete: async (params) => {
    const id = params.id || params.task_id;
    if (!id) return { success: false, error: 'Missing task id' };
    tasks.completeTask(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tasks-updated');
    }
    return { success: true, output: 'Task marked complete, Sir.' };
  },
  note_take: async (params) => {
    const title = params.title || 'Quick Note';
    const content = params.content || params.body || params.text || title;
    const res = await noteService.addNote({ title, content, syncApple: true });
    const appleStr = res.appleNoteCreated ? ' and saved to Apple Notes' : '';
    return {
      success: true,
      output: `Note saved: "${title}"${appleStr}, Sir.`,
      note: res,
    };
  },
  note_list: async (params) => {
    const limit = parseInt(params.limit, 10) || 10;
    const list = noteService.listNotes({ limit });
    if (!list.length) return { success: true, output: 'No saved notes found, Sir.' };
    const lines = list.map((n, i) => `${i + 1}. ${n.title}: ${n.content.slice(0, 80)}`);
    return {
      success: true,
      output: `Here are your recent notes, Sir:\n${lines.join('\n')}`,
      notes: list,
    };
  },
  note_search: async (params) => {
    const query = params.query || params.keyword || '';
    if (!query) return { success: false, error: 'Missing search query' };
    const list = noteService.searchNotes({ query });
    if (!list.length) return { success: true, output: `No notes found matching "${query}", Sir.` };
    const lines = list.map((n, i) => `${i + 1}. ${n.title} (${new Date(n.updatedAt).toLocaleDateString()}): ${n.content}`);
    return {
      success: true,
      output: `Found ${list.length} note(s) matching "${query}":\n${lines.join('\n')}`,
      notes: list,
    };
  },
  note_delete: async (params) => {
    const id = params.id || params.note_id;
    if (!id) return { success: false, error: 'Missing note id' };
    noteService.deleteNote(id);
    return { success: true, output: 'Note removed, Sir.' };
  },
  music_play: async (params) => {
    const query = params.query || params.song || params.track || '';
    const launched = await music.launchYouTubeMusic({ query, show: false });
    if (!launched.success) {
      return { success: false, error: launched.error || 'Could not play music' };
    }
    const trackMsg = launched.track && launched.track !== 'a song' ? `Alright, playing ${launched.track}.` : 'Alright, playing a song.';
    return { success: true, output: trackMsg, track: launched.track };
  },
  music_pause: async () => {
    await music.pausePlayback();
    return { success: true, output: 'Music paused, Sir.' };
  },
  music_resume: async () => {
    await music.resumePlayback();
    return { success: true, output: 'Music resumed, Sir.' };
  },
};

ipcMain.handle('get-weather', async (_event, params) => {
  return getWeather(params || {});
});

/**
 * Ask Choso Island to open the notch on a tab.
 * Payload: string tab OR { tab, day, date, hold }
 * choso://focus?tab=calendar&day=friday&date=2026-11-13&hold=10
 */
function normalizeChosoFocusArgs(raw) {
  const opts = typeof raw === 'string' || raw == null ? { tab: raw || 'home' } : { ...raw };
  let key = String(opts.tab || 'home').toLowerCase().trim();
  if (key === 'schedule' || key === 'agenda' || key === 'events') key = 'calendar';
  if (key === 'reminders' || key === 'todo' || key === 'task') key = 'tasks';
  if (key === 'music' || key === 'player') key = 'home';
  const allowed = new Set(['calendar', 'tasks', 'home', 'shelf', 'clipboard']);
  if (!allowed.has(key)) key = 'home';
  return {
    tab: key,
    day: opts.day ? String(opts.day).toLowerCase() : undefined,
    date: opts.date ? String(opts.date) : undefined,
    hold: opts.hold != null ? Number(opts.hold) : 10,
  };
}

ipcMain.handle('choso-focus', async (_event, raw) => {
  const { tab: key, day, date, hold } = normalizeChosoFocusArgs(raw);
  const params = new URLSearchParams({ tab: key, hold: String(hold || 10) });
  if (day) params.set('day', day);
  if (date) params.set('date', date);
  const url = `choso://focus?${params.toString()}`;
  try {
    const { execFile } = require('child_process');
    // -g: don't steal focus from Alfred mid-speech (faster perceived handoff).
    await new Promise((resolve, reject) => {
      execFile('open', ['-g', url], { timeout: 4000 }, (err) => (err ? reject(err) : resolve()));
    });
    console.log('[Choso] Focused notch:', key, day || date || '');
    return { success: true, tab: key, url };
  } catch (e) {
    console.warn('[Choso] Focus failed:', e.message);
    return { success: false, error: e.message, tab: key, url };
  }
});

ipcMain.handle('choso-close', async () => {
  const url = 'choso://close';
  try {
    const { execFile } = require('child_process');
    await new Promise((resolve, reject) => {
      execFile('open', ['-g', url], { timeout: 3000 }, (err) => (err ? reject(err) : resolve()));
    });
    console.log('[Choso] Closed notch');
    return { success: true };
  } catch (e) {
    console.warn('[Choso] Close failed:', e.message);
    return { success: false, error: e.message };
  }
});

function scheduleRangeToParams(range = 'week', targetDay = null, isNextDay = false, matchedMonthIndex = null, matchedYear = null) {
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  const day = now.getDay(); // 0 is Sun, 1 is Mon, 2 is Tue
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);

  const nextMon = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  const nextSun = new Date(nextMon.getFullYear(), nextMon.getMonth(), nextMon.getDate() + 6);

  let timeMin, timeMax;

  if (targetDay) {
    const dayMap = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
    const offset = dayMap[targetDay.toLowerCase()] ?? 4;
    const baseMon = (range === 'next_week' || isNextDay) ? nextMon : monday;
    const targetDate = new Date(baseMon.getFullYear(), baseMon.getMonth(), baseMon.getDate() + offset);
    timeMin = startOfDay(targetDate).toISOString();
    timeMax = endOfDay(targetDate).toISOString();
  } else if (range === 'today') {
    timeMin = startOfDay(now).toISOString();
    timeMax = endOfDay(now).toISOString();
  } else if (range === 'tomorrow') {
    const tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timeMin = startOfDay(tom).toISOString();
    timeMax = endOfDay(tom).toISOString();
  } else if (range === 'next_week') {
    timeMin = startOfDay(nextMon).toISOString();
    timeMax = endOfDay(nextSun).toISOString();
  } else if (range === 'next_year' || (matchedYear && matchedYear > now.getFullYear())) {
    const targetYear = matchedYear || (now.getFullYear() + 1);
    const firstDay = new Date(targetYear, 0, 1, 0, 0, 0, 0);
    const lastDay = new Date(targetYear, 11, 31, 23, 59, 59, 999);
    timeMin = firstDay.toISOString();
    timeMax = lastDay.toISOString();
  } else if (range === 'year' || range === 'this_year' || (matchedYear && matchedYear === now.getFullYear())) {
    const targetYear = matchedYear || now.getFullYear();
    const firstDay = new Date(targetYear, 0, 1, 0, 0, 0, 0);
    const lastDay = new Date(targetYear, 11, 31, 23, 59, 59, 999);
    timeMin = firstDay.toISOString();
    timeMax = lastDay.toISOString();
  } else if (matchedYear) {
    const firstDay = new Date(matchedYear, 0, 1, 0, 0, 0, 0);
    const lastDay = new Date(matchedYear, 11, 31, 23, 59, 59, 999);
    timeMin = firstDay.toISOString();
    timeMax = lastDay.toISOString();
  } else if (range === 'next_month') {
    let nextYear = now.getFullYear();
    let nextMonth = now.getMonth() + 1;
    if (nextMonth > 11) {
      nextMonth = 0;
      nextYear += 1;
    }
    const firstDay = new Date(nextYear, nextMonth, 1);
    const lastDay = new Date(nextYear, nextMonth + 1, 0);
    timeMin = startOfDay(firstDay).toISOString();
    timeMax = endOfDay(lastDay).toISOString();
  } else if (range === 'named_month' && matchedMonthIndex !== null && matchedMonthIndex !== undefined) {
    let targetYear = now.getFullYear();
    if (matchedMonthIndex < now.getMonth()) targetYear += 1;
    const firstDay = new Date(targetYear, matchedMonthIndex, 1);
    const lastDay = new Date(targetYear, matchedMonthIndex + 1, 0);
    timeMin = startOfDay(firstDay).toISOString();
    timeMax = endOfDay(lastDay).toISOString();
  } else if (range === 'month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    timeMin = startOfDay(firstDay).toISOString();
    timeMax = endOfDay(lastDay).toISOString();
  } else {
    // "week" -> Strictly current week: start of Monday through end of Sunday
    timeMin = startOfDay(monday).toISOString();
    timeMax = endOfDay(sunday).toISOString();
  }

  return { time_min: timeMin, time_max: timeMax, max_results: 50 };
}

ipcMain.handle('get-calendar-events', async (_event, params = {}) => {
  try {
    const computed = scheduleRangeToParams(
      params.range || 'week',
      params.targetDay,
      params.isNextDay,
      params.matchedMonthIndex,
      params.matchedYear
    );
    const merged = { ...computed, ...params };
    // Voice hot path: Mac EventKit only (same as Choso). Don't block on Google.
    const macResult = await macSchedule.fetchMacCalendarEvents(merged, null);
    if (macResult?.macConnected) return macResult;

    // Fallback only when Choso bridge is down.
    try {
      const googleResult = await calendar_fetch_structured(merged);
      return { ...googleResult, macConnected: false, source: googleResult.source || 'google' };
    } catch (ge) {
      console.warn('[Calendar] Google fallback failed:', ge.message);
      return macResult || { success: false, events: [], error: ge.message };
    }
  } catch (e) {
    return { success: false, events: [], error: e.message };
  }
});

ipcMain.handle('tasks-list', async (_event, opts) => {
  const limit = Math.min(50, Number(opts?.limit) || 20);
  try {
    // Mac Reminders only — skip merging SQLite demo/local tasks into speech.
    return await macSchedule.fetchMacTasks({ limit, localTasks: [] });
  } catch (e) {
    console.warn('[Tasks] Mac Reminders fetch failed:', e.message);
    return tasks.listTasks({
      includeCompleted: Boolean(opts?.includeCompleted),
      limit,
    });
  }
});
ipcMain.handle('tasks-add', async (_event, payload) => {
  try {
    return { success: true, task: tasks.addTask(payload || {}) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('tasks-complete', async (_event, id) => {
  try {
    return { success: true, task: tasks.completeTask(id) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('tasks-toggle', async (_event, id) => {
  try {
    return { success: true, task: tasks.toggleTask(id) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('tasks-delete', async (_event, id) => {
  try {
    tasks.deleteTask(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('tasks-due-reminders', async () => tasks.dueReminders());
ipcMain.handle('tasks-clear-reminder', async (_event, id) => {
  tasks.clearReminder(id);
  return true;
});

// Notes IPC
ipcMain.handle('notes-list', async (_event, opts) => noteService.listNotes(opts || {}));
ipcMain.handle('notes-add', async (_event, payload) => {
  try {
    return { success: true, note: await noteService.addNote(payload || {}) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('notes-search', async (_event, query) => noteService.searchNotes({ query }));
ipcMain.handle('notes-delete', async (_event, id) => {
  try {
    noteService.deleteNote(id);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('music-launch', async (_event, opts) => {
  const res = await music.launchYouTubeMusic(opts || {});
  if (!opts?.show && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
  }
  return res;
});
ipcMain.handle('music-now-playing', async (_event, { appName } = {}) => {
  return await music.getNowPlaying(appName || music.DEFAULT_APP);
});
ipcMain.handle('music-toggle', async () => music.togglePlayback());
ipcMain.handle('music-pause', async () => music.pausePlayback());
ipcMain.handle('music-resume', async () => music.resumePlayback());
ipcMain.handle('music-next', async () => music.nextTrack());
ipcMain.handle('music-prev', async () => music.prevTrack());
ipcMain.handle('music-seek', async (_event, seconds) => music.seekTo(seconds));
ipcMain.handle('music-set-volume', async (_event, vol) => music.setVolume(vol));
ipcMain.handle('music-toggle-window', async () => music.toggleWindow());

// Main IPC handler for tool execution
ipcMain.handle('execute-tool', async (_event, toolName, params) => {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }
  try {
    console.log(`[TOOL] Executing: ${toolName}`, params);
    const result = await handler(params || {});
    console.log(`[TOOL] ${toolName} → ${result.success ? 'OK' : 'FAIL'}`);
    return result;
  } catch (e) {
    console.error(`[TOOL] ${toolName} error:`, e.message);
    return { success: false, error: e.message };
  }
});

// ============================================================
// CHAT LOG PERSISTENCE — JSON-based message history
// ============================================================
const CHAT_LOG_DIR = path.join(app.getPath('userData'), 'jarvis');
const CHAT_LOG_PATH = path.join(CHAT_LOG_DIR, 'jarvis_chatlog.json');

ipcMain.handle('save-chat-log', async (_event, messages) => {
  try {
    if (!fs.existsSync(CHAT_LOG_DIR)) fs.mkdirSync(CHAT_LOG_DIR, { recursive: true });
    const toSave = (messages || []).slice(-50);
    fs.writeFileSync(CHAT_LOG_PATH, JSON.stringify(toSave, null, 2));
    return true;
  } catch (e) {
    console.error('Failed to save chat log:', e.message);
    return false;
  }
});

ipcMain.handle('load-chat-log', async () => {
  try {
    if (fs.existsSync(CHAT_LOG_PATH)) {
      return JSON.parse(fs.readFileSync(CHAT_LOG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load chat log:', e.message);
  }
  return [];
});

ipcMain.handle('clear-chat-log', async () => {
  try {
    if (fs.existsSync(CHAT_LOG_PATH)) fs.unlinkSync(CHAT_LOG_PATH);
    return true;
  } catch (e) {
    console.error('Failed to clear chat log:', e.message);
    return false;
  }
});

ipcMain.handle('get-chat-log-size', async () => {
  try {
    if (fs.existsSync(CHAT_LOG_PATH)) {
      const stats = fs.statSync(CHAT_LOG_PATH);
      return (stats.size / 1024).toFixed(1); // KB
    }
  } catch {}
  return '0';
});

// ============================================================
// VOLUME CONTROL — macOS osascript
// ============================================================
ipcMain.handle('volume-up', async () => macTools.changeMacVolume(10));
ipcMain.handle('volume-down', async () => macTools.changeMacVolume(-10));
ipcMain.handle('volume-mute', async () => macTools.toggleMacMute());
ipcMain.handle('set-volume', async (_event, level) => macTools.setMacVolume(level));

// ============================================================
// GOOGLE OAUTH — Calendar + Gmail
// ============================================================
ipcMain.handle('google-get-status', async () => {
  try {
    return await googleAuth.getStatus();
  } catch (e) {
    return { connected: false, configured: false, error: e.message };
  }
});

ipcMain.handle('google-connect', async () => {
  try {
    return await googleAuth.connect();
  } catch (e) {
    return { connected: false, error: e.message };
  }
});

ipcMain.handle('google-disconnect', async () => {
  try {
    return googleAuth.disconnect();
  } catch (e) {
    return { connected: false, error: e.message };
  }
});

// ============================================================
// VOICE CAPABILITIES (RealtimeSTT)
// ============================================================
let voiceServer = null;
let appQuitting = false;

function killProcessTree(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      // /T = kill child processes, /F = force
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch (e) {
    // Process may have already exited
    try { proc.kill(); } catch (_) {}
  }
}

function getPythonPath() {
  const isWin = process.platform === 'win32';
  
  // 1. Check if configured in .env
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const match = envContent.match(/^PYTHON_PATH\s*=\s*(.+)$/m);
      if (match) {
        const pPath = match[1].trim().replace(/^["']|["']$/g, '');
        if (fs.existsSync(pPath)) {
          console.log('[Python Resolver] Found PYTHON_PATH in .env:', pPath);
          return pPath;
        }
      }
    } catch (_) {}
  }

  // 2. Check if configured in .vscode/settings.json
  const vscodeSettingsPath = path.join(__dirname, '../.vscode/settings.json');
  if (fs.existsSync(vscodeSettingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(vscodeSettingsPath, 'utf-8'));
      const interpreterPath = settings['python.defaultInterpreterPath'] || settings['python.interpreterPath'];
      if (interpreterPath) {
        let resolvedPath = interpreterPath;
        resolvedPath = resolvedPath.replace(/\${workspaceFolder}/g, path.join(__dirname, '..'));
        if (resolvedPath.startsWith('.')) {
          resolvedPath = path.resolve(__dirname, '..', resolvedPath);
        }
        if (fs.existsSync(resolvedPath)) {
          console.log('[Python Resolver] Found VS Code selected interpreter:', resolvedPath);
          return resolvedPath;
        }
      }
    } catch (_) {}
  }

  // 3. Check for virtual environment in the workspace (.venv or venv)
  const venvPaths = [
    isWin ? '../.venv/Scripts/python.exe' : '../.venv/bin/python',
    isWin ? '../venv/Scripts/python.exe' : '../venv/bin/python',
  ];
  for (const vp of venvPaths) {
    const fullVp = path.resolve(__dirname, vp);
    if (fs.existsSync(fullVp)) {
      console.log('[Python Resolver] Found workspace virtual environment:', fullVp);
      return fullVp;
    }
  }

  // 4. Default fallback
  const fallback = isWin ? 'python' : 'python3';
  console.log('[Python Resolver] Using system fallback:', fallback);
  return fallback;
}

function startVoiceServer() {
  // Browser mic → Groq Whisper is the live STT path. The Python pyaudio server is
  // legacy and only useful when explicitly enabled.
  if (process.env.ENABLE_PYTHON_VOICE !== '1') {
    console.log('[Voice Server] Skipped (browser mic + Groq STT). Set ENABLE_PYTHON_VOICE=1 to enable legacy Python mic.');
    return;
  }

  const scriptPath = path.join(__dirname, '../voice_server.py');
  const pythonPath = getPythonPath();

  console.log('Starting voice server:', scriptPath);
  console.log('Python path:', pythonPath);

  try {
    voiceServer = spawn(pythonPath, [scriptPath], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        HF_HUB_DISABLE_TELEMETRY: '1',
        HF_HUB_DISABLE_PROGRESS_BARS: '1',
        TRANSFORMERS_VERBOSITY: 'error',
        TOKENIZERS_PARALLELISM: 'false',
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    voiceServer.on('error', (err) => {
      console.error('[Voice Server] Spawn error:', err.message);
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('voice-status', `error: ${err.message}`);
      }
    });

    let stderrBuf = '';
    voiceServer.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('TEXT:')) {
          const text = trimmed.replace('TEXT:', '');
          if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('voice-text', text);
          }
        } else if (trimmed.startsWith('STATUS:')) {
          const status = trimmed.replace('STATUS:', '');
          if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('voice-status', status);
          }
        }
      });
    });

    voiceServer.stderr.on('data', (data) => {
      const text = data.toString();
      stderrBuf += text;
      console.log('Voice Server:', text);
    });

    voiceServer.on('close', (code) => {
      console.log(`Voice Server exited with code ${code}`);
      voiceServer = null;
      const missingDeps = /ModuleNotFoundError|No module named/i.test(stderrBuf);
      if (missingDeps) {
        console.warn('[Voice Server] Python voice deps missing — STT disabled. Chat + macOS say TTS still work. See README.');
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('voice-status', 'unavailable');
        }
        return;
      }
      // Restart after 5 seconds if it crashes (but not if app is quitting / missing deps)
      if (code !== 0 && !appQuitting && !missingDeps) {
        setTimeout(startVoiceServer, 5000);
      }
    });
  } catch (err) {
    console.error('Failed to spawn voice server process:', err.message);
  }
}

ipcMain.handle('voice-start', () => {
  try {
    if (voiceServer && voiceServer.stdin && !voiceServer.stdin.destroyed) {
      voiceServer.stdin.write('START\n');
      return true;
    }
  } catch (e) {
    console.error('Failed to send START to voice server:', e.message);
  }
  return false;
});

ipcMain.handle('voice-stop', () => {
  try {
    if (voiceServer && voiceServer.stdin && !voiceServer.stdin.destroyed) {
      voiceServer.stdin.write('STOP\n');
      return true;
    }
  } catch (e) {
    console.error('Failed to send STOP to voice server:', e.message);
  }
  return false;
});

// ── Multi-Tier Transcription System (macOS Electron compatible) ──
/** Best-quality Gemini models first; lite only if flash tiers fail (STT is not the chat model). */
const STT_GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

function getEnvKey(keyName) {
  const bare = keyName.replace(/^VITE_/, '');
  const candidates = [keyName, bare, `VITE_${bare}`];
  for (const k of candidates) {
    if (process.env[k]) return process.env[k];
  }
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const k of candidates) {
        const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = content.match(new RegExp(`^${escaped}\\s*=\\s*(.+)$`, 'm'));
        if (match) return match[1].trim().replace(/^["']|["']$/g, '');
      }
    } catch (_) {}
  }
  return '';
}

function convertTo16kWav(buffer, maxDurationSec = 18) {
  return new Promise((resolve) => {
    const ffmpegBin = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
    let child;
    try {
      child = spawn(ffmpegBin, [
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-t', String(maxDurationSec),
        '-ar', '16000',
        '-ac', '1',
        '-f', 'wav',
        'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (_) {
      return resolve(null);
    }

    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        resolve(null);
      }
    });
    child.on('error', () => resolve(null));
    try {
      child.stdin.write(buffer);
      child.stdin.end();
    } catch (_) {
      resolve(null);
    }
  });
}

async function transcribeGeminiModel(model, targetBuffer, targetMime, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const base64Data = targetBuffer.toString('base64');
  const payload = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: targetMime, data: base64Data } },
          {
            text: 'Transcribe the spoken audio verbatim into text. Output ONLY the transcription text, nothing else. If there is silence, unintelligible noise, or no clear speech, respond with an empty string.',
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.0, maxOutputTokens: 128 },
  };

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(16000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    const snippet = errBody.slice(0, 200);
    const err = new Error(snippet || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const part = parts.find((p) => p?.text || p?.audioTranscription?.text) ?? parts[0];
  const text = filterSttText(part?.audioTranscription?.text || part?.text || '');
  if (text) {
    console.log(`[STT] Heard (${model}, ${Date.now() - t0}ms): "${text}"`);
  }
  return text;
}

async function sttFirstNonEmpty(promises, overallMs = 16000) {
  const list = promises.filter(Boolean);
  if (list.length === 0) return '';

  return new Promise((resolve) => {
    let settled = false;
    let remaining = list.length;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve('');
      }
    }, overallMs);

    const finish = (text) => {
      if (settled) return;
      if (text) {
        settled = true;
        clearTimeout(timer);
        resolve(text);
        return;
      }
      remaining -= 1;
      if (remaining <= 0) {
        settled = true;
        clearTimeout(timer);
        resolve('');
      }
    };

    for (const p of list) {
      Promise.resolve(p)
        .then((text) => finish(text || ''))
        .catch((err) => {
          console.warn('[STT] provider error:', err?.message || err);
          finish('');
        });
    }
  });
}

function pickBestGeminiTranscript(resultsMap) {
  for (const model of STT_GEMINI_MODELS) {
    const text = resultsMap.get(model);
    if (text) return text;
  }
  return '';
}

/** Fire every Gemini STT model at once; prefer best tier that returns (503 on 3.6 does not block lite). */
async function transcribeWithGemini(buffer, mimeType, apiKey) {
  let targetBuffer = buffer;
  let targetMime = (mimeType || 'audio/webm').split(';')[0];

  try {
    const wav = await convertTo16kWav(buffer);
    if (wav && wav.byteLength > 0) {
      targetBuffer = wav;
      targetMime = 'audio/wav';
    }
  } catch (_) {}

  if (targetBuffer.byteLength > 900_000) {
    console.warn('[STT Gemini] Audio clip still large after transcode; trimming may help if uploads fail');
  }

  const results = new Map();
  const overallMs = 14000;
  const liteTier = new Set(['gemini-flash-lite-latest']);

  return new Promise((resolve) => {
    let finished = false;
    let deferTimer = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (deferTimer) clearTimeout(deferTimer);
      clearTimeout(overallTimer);
      resolve(pickBestGeminiTranscript(results));
    };

    const consider = () => {
      const text = pickBestGeminiTranscript(results);
      if (!text) return;

      const winningModel = STT_GEMINI_MODELS.find((m) => results.get(m));
      if (winningModel && liteTier.has(winningModel)) {
        if (!deferTimer) {
          deferTimer = setTimeout(finish, 450);
        }
        return;
      }
      finish();
    };

    const overallTimer = setTimeout(finish, overallMs);

    for (const model of STT_GEMINI_MODELS) {
      transcribeGeminiModel(model, targetBuffer, targetMime, apiKey)
        .then((text) => {
          if (text) results.set(model, text);
          consider();
        })
        .catch((err) => {
          const overload =
            err.status === 503 ||
            err.status === 429 ||
            /503|429|high demand|UNAVAILABLE/i.test(String(err.message || ''));
          if (overload) {
            console.warn(`[STT Gemini] ${model} unavailable (overload) — other models still running`);
          } else {
            console.warn(`[STT Gemini] Model ${model} error:`, String(err.message || err).slice(0, 100));
          }
        });
    }
  });
}

async function transcribeWithGroq(buffer, mimeType, apiKey) {
  let sendBuffer = buffer;
  let fileName = 'audio.webm';
  let blobType = (mimeType || 'audio/webm').split(';')[0];

  try {
    const wav = await convertTo16kWav(buffer);
    if (wav && wav.byteLength > 0) {
      sendBuffer = wav;
      fileName = 'audio.wav';
      blobType = 'audio/wav';
    }
  } catch (_) {}

  const blob = new Blob([sendBuffer], { type: blobType });
  const t0 = Date.now();

  const models = ['whisper-large-v3-turbo', 'whisper-large-v3'];
  for (const model of models) {
    try {
      const form = new FormData();
      form.append('file', blob, fileName);
      form.append('model', model);
      form.append('response_format', 'text');
      form.append('language', 'en');
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(12000),
      });
      const body = await res.text();
      if (res.ok) {
        const text = filterSttText(body);
        if (text) {
          console.log(`[STT] Heard (groq-${model}, ${Date.now() - t0}ms): "${text}"`);
          return text;
        } else if (body.trim()) {
          console.warn('[STT Groq] filtered as noise:', body.trim().slice(0, 80));
        }
        return '';
      }
      console.warn(`[STT Groq] Model ${model} HTTP ${res.status}:`, body.slice(0, 120));
      if (res.status !== 429) break;
    } catch (e) {
      console.warn(`[STT Groq] Model ${model} error:`, e.message);
    }
  }
  return '';
}

function transcribeWithLocalBridge(buffer) {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child?.kill(); } catch (_) {}
        resolve('');
      }
    }, 22000);

    const finish = (result) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      }
    };

    const scriptPath = path.join(__dirname, '../whisper_bridge.py');
    if (!fs.existsSync(scriptPath)) return finish('');
    const pythonPath = getPythonPath();
    let child;
    try {
      child = spawn(pythonPath, [scriptPath], {
        cwd: path.join(__dirname, '..'),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (_) {
      return finish('');
    }

    let out = '';
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => {
      finish(code === 0 ? out.trim() : '');
    });
    child.on('error', () => finish(''));
    if (child.stdin) {
      child.stdin.on('error', () => finish(''));
      try {
        child.stdin.write(buffer);
        child.stdin.end();
      } catch (_) {
        finish('');
      }
    }
  });
}

ipcMain.handle('transcribe-audio', async (_event, audioBuffer, mimeType = 'audio/webm') => {
  try {
    if (!audioBuffer || audioBuffer.byteLength < 500) return '';
    const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

    const groqKey = getEnvKey('GROQ_API_KEY');
    const geminiKey = getEnvKey('GEMINI_API_KEY');

    if (groqKey) {
      try {
        const groqText = await transcribeWithGroq(buf, mimeType, groqKey);
        if (groqText) return groqText;
      } catch (err) {
        console.warn('[STT] Groq error:', err.message);
      }
    }

    if (geminiKey) {
      try {
        const geminiText = filterSttText(await transcribeWithGemini(buf, mimeType, geminiKey));
        if (geminiText) return geminiText;
      } catch (err) {
        console.warn('[STT] Gemini error:', err.message);
      }
    }

    try {
      const text = filterSttText(await transcribeWithLocalBridge(buf));
      if (text) return text;
    } catch (err) {
      console.warn('[STT] Local bridge error:', err.message);
    }

    console.warn('[STT] All tiers returned empty — check GROQ_API_KEY / GEMINI_API_KEY in .env');
    return '';
  } catch (globalErr) {
    console.error('[STT] Transcription handler failed:', globalErr);
    return '';
  }
});

let piperProcess = null;
let sayProcess = null;

// Detect if text contains Urdu characters
function isUrdu(text) {
  return /[\u0600-\u06FF]/.test(text);
}

ipcMain.handle('speak-text', async (event, text) => {
  let textToSpeak = text;
  const langMode = memory.getLanguageMode ? memory.getLanguageMode() : 'auto';

  // Prefer ElevenLabs (Jarvis voice) when configured
  if (elevenLabs.isConfigured()) {
    try {
      const audio = await elevenLabs.speak(String(textToSpeak || ''));
      if (audio && audio.byteLength > 0) return audio;
      console.warn('[TTS] ElevenLabs returned empty — falling back');
    } catch (e) {
      console.error('[TTS] ElevenLabs error:', e.message);
    }
  }

  // On macOS, fall back to system `say` (returns WAV ArrayBuffer)
  if (process.platform === 'darwin') {
    return macTools.speakWithSay(String(textToSpeak || ''));
  }

  // Only transliterate Roman Urdu if language mode is explicitly 'urdu' or 'auto' (and text is not already Urdu script)
  const isUrduTarget = langMode === 'urdu' || (langMode === 'auto' && detectLanguage(text) === 'urdu');

  if (isUrduTarget && !isUrdu(text)) {
    try {
      console.log('[TTS] Roman Urdu detected for Urdu speech. Transliterating to Urdu script via Ollama...');
      
      // Load current model config
      let modelName = 'qwen3.5:4b';
      try {
        const configPath = path.join(app.getPath('userData'), 'jarvis', 'provider_config.json');
        if (fs.existsSync(configPath)) {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (cfg && cfg.model) modelName = cfg.model;
        }
      } catch (e) {}

      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: 'system',
              content: 'You are a professional transliterator. Convert the given Roman Urdu text (English letters) into standard Urdu script (using Arabic characters). Respond ONLY with the Urdu script. No explanations, no translation, no extra text.'
            },
            { role: 'user', content: text }
          ],
          stream: false,
          think: false,
          options: { num_predict: 200 },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        let transliterated = data.message?.content?.trim();
        if (transliterated) {
          // Clean up any markdown wrappers or quotes
          transliterated = transliterated.replace(/^["'`]|["'`]$/g, '').trim();
          console.log(`[TTS] Transliteration success: "${text}" -> "${transliterated}"`);
          textToSpeak = transliterated;
        }
      }
    } catch (err) {
      console.error('[TTS] Transliteration failed:', err.message);
    }
  }

  return new Promise((resolve, reject) => {
    if (piperProcess) {
      piperProcess.kill();
    }

    const piperPath = path.join(__dirname, '../piper_windows_amd64/piper/piper.exe');
    // Use appropriate model based on language
    const modelPath = isUrdu(textToSpeak)
      ? path.join(__dirname, '../piper_windows_amd64/piper/ur_PK-fasih-medium.onnx')
      : path.join(__dirname, '../piper_windows_amd64/piper/en_US-hfc_male-medium.onnx');
    const tempWavPath = path.join(os.tmpdir(), `piper_tts_${Date.now()}.wav`);

    try {
      piperProcess = spawn(piperPath, ['--model', modelPath, '--output_file', tempWavPath]);

      piperProcess.on('error', (err) => {
        console.error('[Piper] Spawn error:', err.message);
        try { fs.unlinkSync(tempWavPath); } catch (e) { }
        piperProcess = null;
        resolve(null);
      });

      piperProcess.on('close', (code) => {
        piperProcess = null;
        if (code === 0) {
          try {
            const audioBuffer = fs.readFileSync(tempWavPath);
            resolve(audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength));
          } catch (e) {
            console.error('Error reading Piper WAV file:', e.message);
            resolve(null);
          } finally {
            try { fs.unlinkSync(tempWavPath); } catch (e) { }
          }
        } else {
          console.error('Piper exited with code:', code);
          try { fs.unlinkSync(tempWavPath); } catch (e) { }
          resolve(null);
        }
      });

      piperProcess.stdin.write(textToSpeak);
      piperProcess.stdin.end();
    } catch (err) {
      console.error('Failed to spawn Piper process:', err.message);
      try { fs.unlinkSync(tempWavPath); } catch (e) { }
      resolve(null);
    }
  });
});

ipcMain.on('stop-speaking', () => {
  try { elevenLabs.stopSpeaking(); } catch (_) {}
  if (piperProcess) {
    piperProcess.kill();
    piperProcess = null;
  }
  if (sayProcess) {
    try { sayProcess.kill(); } catch (_) {}
    sayProcess = null;
  }
  // Also kill any lingering `say` processes started for TTS
  if (process.platform === 'darwin') {
    try { exec('pkill -f "say -o" 2>/dev/null || true'); } catch (_) {}
  }
});

app.whenReady().then(() => {
  // Initialize memory system
  memory.initDatabase();
  tasks.initTasksDb();
  memory.createSession();
  googleAuth.init(app);
  setupMediaPermissions();

  createWindow();
  startStatsWorker();
  startVoiceServer();
  // Prefetch Mac calendar/reminders so the first voice ask isn't cold.
  setTimeout(() => {
    try {
      macSchedule.warmCaches();
    } catch (_) {}
  }, 1500);
});

app.on('before-quit', async (event) => {
  // Prevent default synchronous quit to allow async summarization
  event.preventDefault();
  appQuitting = true;
  console.log('Before-quit: attempting session summarization...');

  try {
    // Read persisted chat log as the conversation source
    let conversation = [];
    try {
      if (fs.existsSync(CHAT_LOG_PATH)) {
        conversation = JSON.parse(fs.readFileSync(CHAT_LOG_PATH, 'utf-8'));
      }
    } catch (e) {
      console.error('Failed to read chat log for summarization:', e.message);
    }

    if (conversation && conversation.length > 0) {
      const sessionId = memory.getCurrentSessionId();
      if (sessionId) {
        // Race summarization against a 5-second timeout
        await Promise.race([
          memory.summarizeSession(sessionId, conversation),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
        console.log('Session summarization completed (or timed out).');
      }
    }
  } catch (e) {
    console.error('Session summarization error:', e.message);
  }

  console.log('Cleaning up processes...');

  // Cleanup memory
  try { memory.closeDatabase(); } catch (e) {}

  // Terminate stats worker
  if (statsWorker) {
    try { statsWorker.terminate(); } catch (e) {}
    statsWorker = null;
  }

  // Kill voice server
  if (voiceServer) killProcessTree(voiceServer);
  voiceServer = null;

  // Kill piper if running
  if (piperProcess) killProcessTree(piperProcess);
  piperProcess = null;

  // Force kill any remaining python processes spawned by us (Windows only)
  if (process.platform === 'win32') {
    try {
      execSync('taskkill /F /IM python.exe /T', { timeout: 3000, stdio: 'ignore' });
    } catch (e) {
      // ignore if no python processes
    }
  }

  // Explicitly exit the app directly
  app.exit(0);
});

app.on('will-quit', () => {
  // Fallback: make absolutely sure everything is dead
  if (statsWorker) {
    try { statsWorker.terminate(); } catch (e) {}
    statsWorker = null;
  }
  if (voiceServer) killProcessTree(voiceServer);
  if (piperProcess) killProcessTree(piperProcess);

  // Final force kill (Windows only)
  if (process.platform === 'win32') {
    try {
      execSync('taskkill /F /IM python.exe /T', { timeout: 3000, stdio: 'ignore' });
    } catch (e) {}
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
