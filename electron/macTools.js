/**
 * Secure macOS system tool handlers for JARVIS.
 * Uses safe execFile argument arrays and Node fs.promises APIs to prevent command injection.
 */
const { exec, execFile, spawn } = require('child_process');
const { dialog, shell, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { getWeather } = require('./tools/weather');

const DANGEROUS_SHELL_PATTERNS = [
  /\brm\b/i, /\brmdir\b/i, /\bunlink\b/i,
  /\bkill\b/i, /\bkillall\b/i, /\bpkill\b/i,
  /\bshutdown\b/i, /\breboot\b/i, /\bhalt\b/i,
  /\bdd\b/i, /\bmkfs\b/i, /\bdiskutil\s+erase/i,
  /\bsudo\b/i, /\bchmod\s+777\b/i,
];

function isDangerousCommand(command) {
  return DANGEROUS_SHELL_PATTERNS.some((pattern) => pattern.test(command));
}

async function confirmAction(mainWindow, message) {
  if (!mainWindow) return false;
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Confirm'],
    defaultId: 0,
    cancelId: 0,
    title: 'Alfred — Action Confirmation',
    message: 'Destructive Action Detected',
    detail: message,
  });
  return result.response === 1;
}

function runShell(command, timeout = 15000) {
  return new Promise((resolve) => {
    exec(command, { timeout, maxBuffer: 1024 * 1024, shell: '/bin/zsh' }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, output: stderr || error.message });
      } else {
        resolve({ success: true, output: (stdout || stderr || 'Command executed successfully').trim() });
      }
    });
  });
}

function runOsascript(script, timeout = 10000) {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, output: stderr || error.message });
      } else {
        resolve({ success: true, output: (stdout || '').trim() || 'OK' });
      }
    });
  });
}

function expandPath(fp) {
  if (!fp) return fp;
  return fp
    .replace(/\$USER/g, os.userInfo().username)
    .replace(/^~(?=$|\/)/, os.homedir());
}

function resolveAppName(name) {
  const map = {
    chrome: 'Google Chrome',
    'google chrome': 'Google Chrome',
    firefox: 'Firefox',
    safari: 'Safari',
    brave: 'Brave Browser',
    edge: 'Microsoft Edge',
    spotify: 'Spotify',
    discord: 'Discord',
    slack: 'Slack',
    notes: 'Notes',
    mail: 'Mail',
    calendar: 'Calendar',
    messages: 'Messages',
    finder: 'Finder',
    terminal: 'Terminal',
    iterm: 'iTerm',
    vscode: 'Visual Studio Code',
    'vs code': 'Visual Studio Code',
    calculator: 'Calculator',
    settings: 'System Settings',
    'system settings': 'System Settings',
    music: 'Music',
    'youtube music': 'YouTube Music',
    youtube: 'YouTube Music',
  };
  return map[name.toLowerCase()] || name;
}

function createToolHandlers(getMainWindow) {
  return {
    open_app: async (params) => {
      const raw = (params.app_name || params.name || '').trim();
      if (!raw) return { success: false, error: 'No app name provided' };
      const appName = resolveAppName(raw);
      return new Promise((resolve) => {
        execFile('/usr/bin/open', ['-a', appName], { timeout: 15000 }, (error, stdout, stderr) => {
          if (error) resolve({ success: false, error: error.message, output: stderr || error.message });
          else resolve({ success: true, output: `Opened ${appName}` });
        });
      });
    },

    close_app: async (params) => {
      const name = (params.name || params.app_name || '').trim();
      if (!name) return { success: false, error: 'No app name provided' };
      return runOsascript(`tell application "${name}" to quit`);
    },

    open_url: async (params) => {
      const url = params.url || '';
      if (!url) return { success: false, error: 'No URL provided' };
      try {
        await shell.openExternal(url.startsWith('http') ? url : `https://${url}`);
        return { success: true, output: `Opened ${url}` };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    open_folder: async (params) => {
      const folderPath = expandPath(params.path || path.join(os.homedir(), 'Desktop'));
      return new Promise((resolve) => {
        execFile('/usr/bin/open', [folderPath], { timeout: 15000 }, (error, stdout, stderr) => {
          if (error) resolve({ success: false, error: error.message, output: stderr || error.message });
          else resolve({ success: true, output: `Opened folder: ${folderPath}` });
        });
      });
    },

    web_search: async (params) => {
      const query = params.query || '';
      if (!query) return { success: false, error: 'No search query provided' };

      // Weather interception: NEVER open Chrome for weather requests
      if (/weather|temperature|forecast|rain|cloudy|snow|sunny|cold|hot|degrees|mausam|barish/i.test(query)) {
        const match = query.match(/(?:weather|temperature|forecast|mausam|barish)(?:\s+(?:in|for|at|ka|ki))?\s+([a-zA-Z\s]+)/i);
        const loc = match ? match[1].replace(/(?:today|now|tomorrow|tonight|this week|aaj|abhi)/gi, '').trim() : '';
        const wResult = await getWeather({ location: loc || '' });
        if (wResult.success && wResult.weatherData) {
          const win = getMainWindow?.();
          if (win && !win.isDestroyed()) {
            win.webContents.send('weather-updated', wResult.weatherData);
          }
        }
        return wResult;
      }

      const tavilyKey = process.env.TAVILY_API_KEY;
      if (!tavilyKey) {
        await shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
        return { success: true, output: `Opened Google search for: "${query}"` };
      }

      try {
        const postData = JSON.stringify({
          query,
          search_depth: 'basic',
          include_answer: true,
          max_results: 5,
        });

        const result = await new Promise((resolve, reject) => {
          const req = https.request('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tavilyKey}`,
              'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 15000,
          }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              try { resolve(JSON.parse(body)); }
              catch { reject(new Error('Invalid response from Tavily API')); }
            });
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Tavily API request timed out')); });
          req.write(postData);
          req.end();
        });

        const contextParts = [];
        if (result.answer) contextParts.push(`[Tavily Answer]\n${result.answer}`);
        (result.results || []).slice(0, 5).forEach((r, i) => {
          contextParts.push(`[${i + 1}] ${r.title || 'No title'}\nURL: ${r.url || ''}\n${r.content || ''}`);
        });
        return {
          success: true,
          output: contextParts.length > 0 ? contextParts.join('\n\n') : 'No relevant results found.',
        };
      } catch (e) {
        return { success: false, error: `Search failed: ${e.message}` };
      }
    },

    take_screenshot: async () => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1920, height: 1080 },
        });
        if (sources.length === 0) return { success: false, error: 'No screen found' };
        const img = sources[0].thumbnail.toPNG();
        const savePath = path.join(os.homedir(), 'Desktop', `screenshot_${Date.now()}.png`);
        await fs.promises.writeFile(savePath, img);
        return { success: true, output: `Screenshot saved to ${savePath}` };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    volume_control: async (params) => {
      const action = (params.action || 'set').toLowerCase();
      if (action === 'mute') {
        return runOsascript('set volume with output muted');
      }
      if (action === 'unmute') {
        return runOsascript('set volume without output muted');
      }
      if (action === 'up') {
        return runOsascript(`
          set o to output volume of (get volume settings)
          set newVol to o + 10
          if newVol > 100 then set newVol to 100
          set volume output volume newVol
        `);
      }
      if (action === 'down') {
        return runOsascript(`
          set o to output volume of (get volume settings)
          set newVol to o - 10
          if newVol < 0 then set newVol to 0
          set volume output volume newVol
        `);
      }

      // Safe clamp: value 0 must not default to 50
      const parsed = params.value !== undefined ? parseInt(params.value, 10) : 50;
      const value = Math.min(100, Math.max(0, isNaN(parsed) ? 50 : parsed));
      return runOsascript(`set volume output volume ${value}`);
    },

    brightness_control: async (params) => {
      const action = (params.action || 'set').toLowerCase();
      if (action === 'up') {
        return runOsascript('tell application "System Events" to key code 144');
      }
      if (action === 'down') {
        return runOsascript('tell application "System Events" to key code 145');
      }
      return {
        success: false,
        error: 'Setting absolute brightness is not supported on macOS without extra tools. Use action=up or action=down.',
      };
    },

    file_control: async (params) => {
      const action = (params.action || '').toLowerCase();
      const fp = expandPath(params.path || '');

      try {
        if (action === 'write') {
          const dir = path.dirname(fp);
          await fs.promises.mkdir(dir, { recursive: true });
          await fs.promises.writeFile(fp, params.content || '', 'utf-8');
          return { success: true, output: `File written successfully: ${fp}` };
        }

        if (action === 'read') {
          const stat = await fs.promises.stat(fp);
          if (stat.size > 2 * 1024 * 1024) {
            const fh = await fs.promises.open(fp, 'r');
            const buf = Buffer.alloc(65536);
            const { bytesRead } = await fh.read(buf, 0, 65536, 0);
            await fh.close();
            const text = buf.toString('utf-8', 0, bytesRead);
            return { success: true, output: text.split('\n').slice(0, 100).join('\n') + '\n...[truncated]' };
          }
          const content = await fs.promises.readFile(fp, 'utf-8');
          return { success: true, output: content.split('\n').slice(0, 100).join('\n') };
        }

        if (action === 'delete') {
          const confirmed = await confirmAction(getMainWindow(), `Delete: ${fp}\n\nThis cannot be undone.`);
          if (!confirmed) return { success: false, output: 'Action cancelled by user.' };
          await fs.promises.rm(fp, { recursive: true, force: true });
          return { success: true, output: `Deleted: ${fp}` };
        }

        if (action === 'create_folder') {
          await fs.promises.mkdir(fp, { recursive: true });
          return { success: true, output: `Created folder: ${fp}` };
        }

        if (action === 'move') {
          const dest = expandPath(params.destination || '');
          await fs.promises.rename(fp, dest);
          return { success: true, output: `Moved ${fp} to ${dest}` };
        }

        if (action === 'copy') {
          const dest = expandPath(params.destination || '');
          await fs.promises.cp(fp, dest, { recursive: true });
          return { success: true, output: `Copied ${fp} to ${dest}` };
        }

        if (action === 'list') {
          const target = fp || '.';
          const entries = await fs.promises.readdir(target, { withFileTypes: true });
          const listing = entries.map((e) => `${e.isDirectory() ? '[DIR] ' : '      '}${e.name}`).join('\n');
          return { success: true, output: listing || '(empty directory)' };
        }

        if (action === 'find') {
          const root = fp || os.homedir();
          const name = params.name || '*';
          return new Promise((resolve) => {
            execFile('/usr/bin/find', [root, '-maxdepth', '5', '-iname', name], { timeout: 30000 }, (error, stdout) => {
              if (error && !stdout) resolve({ success: false, error: error.message });
              else {
                const lines = (stdout || '').trim().split('\n').slice(0, 25).join('\n');
                resolve({ success: true, output: lines || 'No files found.' });
              }
            });
          });
        }

        return { success: false, error: `Unknown file action: ${action}` };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    search_files: async (params) => {
      const query = params.query || '';
      const searchPath = expandPath(params.path || os.homedir());
      const ext = params.extension ? ` -name "*${params.extension}"` : '';
      const pattern = ext ? `*${params.extension}` : `*${query}*`;
      return new Promise((resolve) => {
        execFile('/usr/bin/find', [searchPath, '-maxdepth', '4', '-iname', pattern], { timeout: 30000 }, (error, stdout) => {
          if (error && !stdout) resolve({ success: false, error: error.message });
          else {
            const lines = (stdout || '').trim().split('\n').slice(0, 20).join('\n');
            resolve({ success: true, output: lines || 'No files found.' });
          }
        });
      });
    },

    run_shell: async (params) => {
      const command = params.command || '';
      if (!command) return { success: false, error: 'No command provided' };

      if (isDangerousCommand(command)) {
        const confirmed = await confirmAction(
          getMainWindow(),
          `Command contains potentially destructive operations:\n\n${command}\n\nDo you want to execute it?`
        );
        if (!confirmed) return { success: false, output: 'Command cancelled by user.' };
      }

      return runShell(command);
    },

    run_powershell: async (params) => {
      return createToolHandlers(getMainWindow).run_shell(params);
    },

    get_system_info: async (params) => {
      const type = (params.type || 'all').toLowerCase();

      switch (type) {
        case 'cpu':
          return runShell('top -l 1 -n 0 -s 0 | grep "CPU usage"');
        case 'memory':
          return runShell('vm_stat | perl -ne \'/page size of (\\d+)/ and $size=$1; /Pages\\s+free[^\\d]+(\\d+)/ and $free=$1; /Pages\\s+active[^\\d]+(\\d+)/ and $act=$1; /Pages\\s+inactive[^\\d]+(\\d+)/ and $inact=$1; /Pages\\s+speculative[^\\d]+(\\d+)/ and $spec=$1; /Pages\\s+wired[^\\d]+(\\d+)/ and $wire=$1; END { printf("Memory: Free=%.1fGB, Used=%.1fGB, Wired=%.1fGB\\n", ($free+$spec)*$size/1073741824, ($act+$inact)*$size/1073741824, $wire*$size/1073741824) }\'');
        case 'disk':
          return runShell('df -h / | awk \'NR==2 {printf "Disk: %s total, %s used, %s free (%s capacity)\\n", $2, $3, $4, $5}\'');
        case 'battery':
          return runShell('pmset -g batt | awk \'NR==2 {print "Battery: " $3 " " $4}\'');
        case 'uptime':
          return runShell('uptime');
        case 'processes':
          return runShell('ps aux -r | head -n 10 | awk \'{printf "%-20s %-8s %-6s %-6s\\n", substr($11,1,20), $2, $3"%", $4"%"}\'');
        case 'network':
          return runShell('ifconfig en0 | grep "inet " | awk \'{print "IP: " $2}\'');
        default:
          return runShell('echo "=== System Info ===" && uname -a && uptime && df -h / | tail -1');
      }
    },

    system_power: async (params) => {
      const action = (params.action || '').toLowerCase();
      const labels = { shutdown: 'Shut down', restart: 'Restart', sleep: 'Put to sleep', lock: 'Lock' };
      if (!labels[action]) return { success: false, error: `Unknown power action: ${action}` };

      if (action !== 'lock') {
        const confirmed = await confirmAction(getMainWindow(), `${labels[action]} the computer?`);
        if (!confirmed) return { success: false, output: 'Action cancelled by user.' };
      }

      if (action === 'lock') {
        return new Promise((resolve) => {
          execFile('/usr/bin/pmset', ['displaysleepnow'], { timeout: 5000 }, (err) => {
            if (err) {
              return runOsascript('tell application "System Events" to key code 12 using {control down, command down}')
                .then(resolve);
            }
            resolve({ success: true, output: 'Screen locked successfully.' });
          });
        });
      }

      if (action === 'sleep') {
        return new Promise((resolve) => {
          execFile('/usr/bin/pmset', ['sleepnow'], { timeout: 5000 }, (err) => {
            if (err) resolve({ success: false, error: err.message });
            else resolve({ success: true, output: 'System put to sleep.' });
          });
        });
      }

      if (action === 'shutdown') return runOsascript('tell application "System Events" to shut down');
      if (action === 'restart') return runOsascript('tell application "System Events" to restart');

      return { success: false, error: `Unhandled power action: ${action}` };
    },
  };
}

let activeSayProcess = null;

function speakWithSay(text) {
  return new Promise((resolve) => {
    const stamp = Date.now();
    const aiffPath = path.join(os.tmpdir(), `jarvis_tts_${stamp}.aiff`);
    const wavPath = path.join(os.tmpdir(), `jarvis_tts_${stamp}.wav`);

    const sayProc = spawn('say', ['-o', aiffPath, text], { stdio: ['ignore', 'ignore', 'pipe'] });
    activeSayProcess = sayProc;

    sayProc.on('error', (err) => {
      console.error('[TTS say] spawn error:', err.message);
      activeSayProcess = null;
      resolve(null);
    });

    sayProc.on('close', (code) => {
      activeSayProcess = null;
      if (code !== 0 || !fs.existsSync(aiffPath)) {
        resolve(null);
        return;
      }
      execFile('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, wavPath], (err) => {
        try { fs.unlinkSync(aiffPath); } catch (_) {}
        if (err || !fs.existsSync(wavPath)) {
          console.error('[TTS afconvert]', err?.message || 'missing wav');
          resolve(null);
          return;
        }
        try {
          const audioBuffer = fs.readFileSync(wavPath);
          resolve(audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength));
        } catch (e) {
          console.error('[TTS] read wav failed:', e.message);
          resolve(null);
        } finally {
          try { fs.unlinkSync(wavPath); } catch (_) {}
        }
      });
    });
  });
}

function stopSay() {
  if (activeSayProcess) {
    try { activeSayProcess.kill(); } catch (_) {}
    activeSayProcess = null;
  }
}

module.exports = {
  createToolHandlers,
  confirmAction,
  isDangerousCommand,
  speakWithSay,
  stopSay,
  runShell,
  runOsascript,
};
