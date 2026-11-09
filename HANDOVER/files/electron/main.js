const { app, BrowserWindow, ipcMain, dialog, shell, desktopCapturer, powerSaveBlocker, session, systemPreferences } = require('electron');
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
const { filterSttText } = require('./sttFilter');

let mainWindow;
const getMainWindow = () => mainWindow;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function setupMediaPermissions() {
  const allowed = new Set(['media', 'audioCapture', 'microphone']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {});
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

// ============================================================
// SYSTEM TIME — Real local time
// ============================================================
ipcMain.handle('get-system-time', () => {
  return {
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
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
};

ipcMain.handle('get-weather', async (_event, params) => {
  return getWeather(params || {});
});

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
      // Restart after 5 seconds if it crashes (but not if app is quitting)
      if (code !== 0 && !appQuitting) {
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
function getEnvKey(keyName) {
  if (process.env[keyName]) return process.env[keyName];
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const match = content.match(new RegExp(`^(?:VITE_)?${keyName}\\s*=\\s*(.+)$`, 'm'));
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    } catch (_) {}
  }
  return '';
}

function convertTo16kWav(buffer) {
  return new Promise((resolve) => {
    const ffmpegBin = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
    let child;
    try {
      child = spawn(ffmpegBin, [
        '-loglevel', 'error',
        '-i', 'pipe:0',
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

async function transcribeWithGemini(buffer, mimeType, apiKey) {
  let targetBuffer = buffer;
  let targetMime = (mimeType || 'audio/webm').split(';')[0];

  // Fast transcode to 16kHz WAV (~50ms) for 2.5x faster Gemini audio processing
  try {
    const wav = await convertTo16kWav(buffer);
    if (wav && wav.byteLength > 0) {
      targetBuffer = wav;
      targetMime = 'audio/wav';
    }
  } catch (_) {}

  const base64Data = targetBuffer.toString('base64');
  const models = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite'];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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

    try {
      const t0 = Date.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const data = await res.json();
        const candidate = data?.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        const part = parts.find((p) => p?.text || p?.audioTranscription?.text) ?? parts[0];
        const text = filterSttText(part?.audioTranscription?.text || part?.text || '');
        if (text) {
          console.log(`[STT] Heard (${model}, ${Date.now() - t0}ms): "${text}"`);
          return text;
        }
      }
    } catch (err) {
      console.warn(`[STT Gemini] Model ${model} error:`, err.message);
    }
  }
  return '';
}

async function transcribeWithGroq(buffer, mimeType, apiKey) {
  const cleanMime = (mimeType || 'audio/webm').split(';')[0];
  const blob = new Blob([buffer], { type: cleanMime });
  const form = new FormData();
  form.append('file', blob, 'audio.webm');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'text');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) return '';
  return filterSttText(await res.text());
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
    }, 1500);

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

    // 1. Groq Whisper (Ultra-fast ~150ms if key configured)
    const groqKey = getEnvKey('GROQ_API_KEY');
    if (groqKey) {
      try {
        const text = filterSttText(await transcribeWithGroq(buf, mimeType, groqKey));
        if (text) return text;
      } catch (err) {
        console.warn('[STT] Groq error:', err.message);
      }
    }

    // 2. Gemini Multimodal Audio STT (Uses existing Gemini key from .env)
    const geminiKey = getEnvKey('GEMINI_API_KEY');
    if (geminiKey) {
      try {
        const text = filterSttText(await transcribeWithGemini(buf, mimeType, geminiKey));
        if (text) return text;
      } catch (err) {
        console.warn('[STT] Gemini error:', err.message);
      }
    }

    // 3. Local Whisper Bridge fallback (whisper_bridge.py)
    try {
      const text = filterSttText(await transcribeWithLocalBridge(buf));
      if (text) return text;
    } catch (err) {
      console.warn('[STT] Local bridge error:', err.message);
    }

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
  memory.createSession();
  googleAuth.init(app);
  setupMediaPermissions();

  createWindow();
  startStatsWorker();
  startVoiceServer();
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
