const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const { BrowserWindow, session, app } = require('electron');

const DEFAULT_APP = 'YouTube Music';
const FALLBACK_URL = 'https://music.youtube.com';
const MEDIAKEY_BIN = path.join(__dirname, 'bin', 'mediakey');
const CONSISTENT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0';

let ytmusicWindow = null;
let isAppQuitting = false;

if (app) {
  app.on('before-quit', () => {
    isAppQuitting = true;
  });
}

function sendNativeMediaKey(code) {
  return new Promise((resolve) => {
    if (fs.existsSync(MEDIAKEY_BIN)) {
      execFile(MEDIAKEY_BIN, [String(code)], (err) => {
        resolve({ success: !err });
      });
    } else {
      resolve({ success: false });
    }
  });
}

function getRandomTrendingTrack() {
  return new Promise((resolve) => {
    const searchUrl = 'https://www.youtube.com/results?search_query=top+hits+playlist+popular';
    https.get(
      searchUrl,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 4500,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const matches = [...data.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map((m) => m[1]);
          const unique = [...new Set(matches)];
          const randomVid = unique[Math.floor(Math.random() * Math.min(25, unique.length))] || 'Rif-RTvmmss';
          resolve(randomVid);
        });
      }
    ).on('error', () => resolve('Rif-RTvmmss'));
  });
}

function searchYouTubeTrack(query) {
  return new Promise((resolve) => {
    const q = (query && query.trim()) ? query.trim() + ' audio' : 'popular music hits billboard';
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    const req = https.get(
      searchUrl,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 4500,
      },
      (res) => {
        let data = '';
        let resolved = false;
        res.on('data', (chunk) => {
          data += chunk;
          if (!resolved && data.includes('"videoId":"')) {
            const vMatch = data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            const tMatch = data.match(/"title":\{"(?:runs":\[\{"text"|"simpleText"):"([^"]+)"/);
            if (vMatch) {
              resolved = true;
              req.destroy();
              resolve({
                videoId: vMatch[1],
                title: tMatch ? tMatch[1] : (query || 'Music'),
              });
            }
          }
        });
        res.on('end', () => {
          if (!resolved) {
            const vMatch = data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            const tMatch = data.match(/"title":\{"(?:runs":\[\{"text"|"simpleText"):"([^"]+)"/);
            resolve(vMatch ? { videoId: vMatch[1], title: tMatch ? tMatch[1] : (query || 'Music') } : null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function parseYouTubeTitle(rawTitle) {
  if (!rawTitle) return { track: '', artist: '' };
  let cleaned = rawTitle
    .replace(/\s*[-–—|]\s*YouTube(?:\s*Music)?\s*$/i, '')
    .replace(/\s*\((Official\s+(HD\s+|Music\s+)?Video|Audio|Live\s+Session\s*\d*|Lyrics?|Visualizer)\)/gi, '')
    .replace(/\s*\[(Official\s+(HD\s+|Music\s+)?Video|Audio|Lyrics?|Visualizer)\]/gi, '')
    .trim();

  const parts = cleaned.split(/\s*[-–—]\s*/);
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      track: parts.slice(1).join(' - ').trim(),
    };
  }
  return { track: cleaned, artist: 'YouTube' };
}

function parseWindowTitle(title) {
  const raw = String(title || '').trim();
  if (!raw) return { title: '', artist: '', raw: '' };
  const cleaned = raw.replace(/\s*[-–—|]\s*YouTube Music\s*$/i, '').trim();
  const parts = cleaned.split(/\s*[-–—|]\s*/);
  if (parts.length >= 2) {
    return { title: parts[0].trim(), artist: parts.slice(1).join(' - ').trim(), raw };
  }
  return { title: cleaned, artist: '', raw };
}

/**
 * Creates or retrieves the dedicated hidden YouTube Music player window.
 * Strictly underground: show is false by default.
 */
async function getOrCreatePlayerWindow(show = false) {
  if (ytmusicWindow && !ytmusicWindow.isDestroyed()) {
    if (show) {
      ytmusicWindow.show();
      ytmusicWindow.focus();
    }
    return ytmusicWindow;
  }

  const ses = session.fromPartition('persist:ytmusic');
  ses.setUserAgent(CONSISTENT_UA);

  // Strip Electron/Client-Hint traces and ensure a single consistent UA across accounts.google.com and youtube.com
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    delete details.requestHeaders['Sec-CH-UA'];
    delete details.requestHeaders['Sec-CH-UA-Mobile'];
    delete details.requestHeaders['Sec-CH-UA-Platform'];
    delete details.requestHeaders['Sec-CH-UA-Platform-Version'];
    delete details.requestHeaders['Sec-CH-UA-Model'];
    delete details.requestHeaders['X-Client-Data'];
    delete details.requestHeaders['X-Electron'];
    details.requestHeaders['User-Agent'] = CONSISTENT_UA;
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  ytmusicWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 800,
    minHeight: 550,
    title: 'YouTube Music — ALFRED',
    backgroundColor: '#030712',
    show: show,
    webPreferences: {
      partition: 'persist:ytmusic',
      nodeIntegration: false,
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  ytmusicWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('google.com') || url.includes('youtube.com')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            partition: 'persist:ytmusic',
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      };
    }
    return { action: 'allow' };
  });

  // Intercept window close: keep it alive underground in the background!
  ytmusicWindow.on('close', (e) => {
    if (!isAppQuitting) {
      e.preventDefault();
      ytmusicWindow.hide();
    }
  });

  ytmusicWindow.on('closed', () => {
    ytmusicWindow = null;
  });

  return ytmusicWindow;
}

async function isUserSignedIn() {
  try {
    const ses = session.fromPartition('persist:ytmusic');
    const cookies = await ses.cookies.get({ domain: '.youtube.com' });
    return cookies.some(c => c.name === 'SAPISID' || c.name === 'SID');
  } catch (_) {
    return false;
  }
}

/**
 * Main launcher: plays music underground in dedicated Electron BrowserWindow.
 * Never creates or manipulates Chrome tabs.
 */
async function launchYouTubeMusic(opts = {}) {
  const { query = '', show = false } = typeof opts === 'object' ? opts : { query: opts };

  if (query === '__SHOW_WINDOW__') {
    return showMusicWindow();
  }

  const win = await getOrCreatePlayerWindow(show);
  const isGeneric = !query || query === '__RANDOM__' || query === '__LIBRARY__' || query.trim() === '';

  let targetUrl = '';
  let trackTitle = 'a song';

  if (!isGeneric) {
    // Specific song requested!
    console.log(`[Music] Searching for specific track: "${query}"...`);
    const trackInfo = await searchYouTubeTrack(query);
    if (trackInfo?.videoId) {
      targetUrl = `https://music.youtube.com/watch?v=${trackInfo.videoId}`;
      trackTitle = trackInfo.title || query;
      console.log(`[Music] Found videoId: ${trackInfo.videoId} (${trackTitle})`);
    } else {
      targetUrl = `https://music.youtube.com/search?q=${encodeURIComponent(query.trim())}`;
      trackTitle = query;
    }
  } else {
    // Random / Shuffle requested!
    trackTitle = 'a song';
    const signedIn = await isUserSignedIn();
    if (signedIn) {
      console.log('[Music] User is signed in to personal account. Shuffling personal Liked Music...');
      targetUrl = 'https://music.youtube.com/watch?list=LM';
    } else {
      const randomVid = await getRandomTrendingTrack();
      targetUrl = `https://music.youtube.com/watch?v=${randomVid}&list=RDMM${randomVid}`;
      console.log(`[Music] Playing random track with radio mix: ${randomVid}`);
    }
  }

  try {
    await win.loadURL(targetUrl, {
      userAgent: CONSISTENT_UA,
    });
  } catch (err) {
    console.warn('[Music] Error loading URL:', err.message);
  }

  // Script to dismiss popups, unmute, play, and shuffle
  const injectScript = `
    (() => {
      const isGeneric = ${JSON.stringify(isGeneric)};

      function tryPlay() {
        // Dismiss promo popups / "Skip" dialogs
        const dismissBtn = document.querySelector('ytmusic-you-there-renderer button, yt-button-renderer#dismiss-button, button[aria-label="No thanks"], tp-yt-paper-button#dismiss-button');
        if (dismissBtn) dismissBtn.click();

        // If generic (random song), trigger Shuffle
        if (isGeneric) {
          // Check if on Sign-in redirect; if so, redirect to top mix
          if (location.href.includes('ServiceLogin') || document.querySelector('ytmusic-sign-in-button-renderer')) {
            location.href = 'https://music.youtube.com/watch?v=Rif-RTvmmss&list=RDMM';
            return;
          }

          // Click shuffle button on playlist header or player bar
          const shuffleBtn = document.querySelector('button[aria-label*="Shuffle" i]') ||
                             document.querySelector('ytmusic-player-bar paper-icon-button.shuffle') ||
                             document.querySelector('tp-yt-paper-icon-button.shuffle') ||
                             document.querySelector('.shuffle') ||
                             document.querySelector('ytmusic-play-button-renderer');
          if (shuffleBtn) {
            shuffleBtn.click();
          } else {
            // Native shortcut 's' toggles shuffle
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, bubbles: true }));
          }
        }

        const v = document.querySelector('video');
        if (v) {
          v.muted = false;
          v.volume = 1.0;
          if (v.paused) {
            v.play().catch(() => {});
            const playBtn = document.querySelector('#play-pause-button') || document.querySelector('.play-pause-button');
            if (playBtn) playBtn.click();
          }
        }
      }

      tryPlay();
      let count = 0;
      const interval = setInterval(() => {
        count++;
        tryPlay();
        const v = document.querySelector('video');
        if ((v && !v.paused) || count > 16) {
          clearInterval(interval);
        }
      }, 500);
    })()
  `;

  try {
    win.webContents.executeJavaScript(injectScript).catch(() => {});
  } catch (_) {}

  setTimeout(() => {
    if (win && !win.isDestroyed()) {
      win.webContents.executeJavaScript(injectScript).catch(() => {});
    }
  }, 1200);

  return {
    success: true,
    mode: show ? 'foreground' : 'underground',
    appName: 'YouTube Music',
    track: trackTitle,
    isGeneric,
    url: targetUrl,
    playing: true,
  };
}

function showMusicWindow() {
  if (ytmusicWindow && !ytmusicWindow.isDestroyed()) {
    ytmusicWindow.show();
    ytmusicWindow.focus();
    return { success: true, shown: true };
  } else {
    getOrCreatePlayerWindow(true).then((win) => {
      win.loadURL(FALLBACK_URL);
    });
    return { success: true, shown: true };
  }
}

async function getNowPlaying(appName = DEFAULT_APP) {
  if (ytmusicWindow && !ytmusicWindow.isDestroyed()) {
    try {
      const info = await ytmusicWindow.webContents.executeJavaScript(`
        (() => {
          const titleEl = document.querySelector('ytmusic-player-bar .title') || document.querySelector('.middle-controls .title') || document.querySelector('h1.title');
          const bylineEl = document.querySelector('ytmusic-player-bar .byline') || document.querySelector('.middle-controls .byline') || document.querySelector('.byline');
          const imgEl = document.querySelector('ytmusic-player-bar .image img') || document.querySelector('.middle-controls img');
          const vid = document.querySelector('video');

          const track = titleEl?.textContent?.trim() || navigator.mediaSession?.metadata?.title || document.title.replace(/ - YouTube Music$/i, '').replace(/ - YouTube$/i, '') || '';
          const artist = bylineEl?.textContent?.trim() || navigator.mediaSession?.metadata?.artist || '';
          const artUrl = imgEl?.src || navigator.mediaSession?.metadata?.artwork?.[0]?.src || '';
          const isPlaying = vid ? !vid.paused : false;
          const pos = vid ? Math.floor(vid.currentTime) : 0;
          const dur = vid ? Math.floor(vid.duration || 0) : 0;

          return { success: true, track, artist, artUrl, isPlaying, pos, dur };
        })()
      `);

      if (info && info.track) {
        return {
          success: true,
          playing: info.isPlaying,
          appName: 'YouTube Music',
          track: info.track,
          artist: info.artist || 'YouTube Music',
          artUrl: info.artUrl,
          position: info.pos,
          duration: info.dur,
        };
      }
    } catch (_) {}
  }

  return { success: false, playing: false, appName };
}

async function togglePlayback() {
  if (ytmusicWindow && !ytmusicWindow.isDestroyed()) {
    try {
      const res = await ytmusicWindow.webContents.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) {
            v.paused ? v.play() : v.pause();
            return true;
          }
          const playBtn = document.querySelector('#play-pause-button') || document.querySelector('.play-pause-button');
          if (playBtn) { playBtn.click(); return true; }
          return false;
        })()
      `);
      if (res) return { success: true };
    } catch (_) {}
  }

  // Fallback native media key
  const nativeRes = await sendNativeMediaKey(16);
  return { success: Boolean(nativeRes?.success) };
}

async function pausePlayback() {
  if (ytmusicWindow && !ytmusicWindow.isDestroyed()) {
    try {
      const res = await ytmusicWindow.webContents.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) {
            v.pause();
            return true;
          }
          const pauseBtn = document.querySelector('button[aria-label*="Pause" i]') || document.querySelector('#play-pause-button');
          if (pauseBtn) { pauseBtn.click(); return true; }
          return false;
        })()
      `);
      if (res) return { success: true };
    } catch (_) {}
  }
  return { success: false };
}

async function resumePlayback() {
  if (ytmusicWindow && !ytmusicWindow.isDestroyed()) {
    try {
      const res = await ytmusicWindow.webContents.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) {
            v.play();
            return true;
          }
          const playBtn = document.querySelector('button[aria-label*="Play" i]') || document.querySelector('#play-pause-button');
          if (playBtn) { playBtn.click(); return true; }
          return false;
        })()
      `);
      if (res) return { success: true };
    } catch (_) {}
  }
  return { success: false };
}

async function nextTrack() {
  if (ytmusicWindow && !ytmusicWindow.isDestroyed()) {
    try {
      await ytmusicWindow.webContents.executeJavaScript(`
        (() => {
          const nextBtn = document.querySelector('.next-button') || document.querySelector('ytmusic-player-bar .next-button') || document.querySelector('button[aria-label*="Next" i]');
          if (nextBtn) { nextBtn.click(); return; }
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', keyCode: 74, bubbles: true }));
        })()
      `);
      return { success: true };
    } catch (_) {}
  }

  const nativeRes = await sendNativeMediaKey(19);
  return { success: Boolean(nativeRes?.success) };
}

async function prevTrack() {
  if (ytmusicWindow && !ytmusicWindow.isDestroyed()) {
    try {
      await ytmusicWindow.webContents.executeJavaScript(`
        (() => {
          const prevBtn = document.querySelector('.previous-button') || document.querySelector('ytmusic-player-bar .previous-button') || document.querySelector('button[aria-label*="Previous" i]');
          if (prevBtn) { prevBtn.click(); return; }
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', keyCode: 75, bubbles: true }));
        })()
      `);
      return { success: true };
    } catch (_) {}
  }

  const nativeRes = await sendNativeMediaKey(20);
  return { success: Boolean(nativeRes?.success) };
}

async function seekTo(seconds) {
  if (ytmusicWindow && !ytmusicWindow.isDestroyed()) {
    try {
      return await ytmusicWindow.webContents.executeJavaScript(`
        (() => {
          const vid = document.querySelector('video');
          if (vid && Number.isFinite(${seconds})) {
            vid.currentTime = ${seconds};
            return true;
          }
          return false;
        })()
      `);
    } catch (_) {}
  }
  return false;
}

async function setVolume(volPercent) {
  if (ytmusicWindow && !ytmusicWindow.isDestroyed()) {
    try {
      return await ytmusicWindow.webContents.executeJavaScript(`
        (() => {
          const vid = document.querySelector('video');
          if (vid) {
            const vol = Math.max(0, Math.min(1, ${volPercent} / 100));
            vid.volume = vol;
            if (vol > 0) {
              vid.muted = false;
            }
            return true;
          }
          return false;
        })()
      `);
    } catch (_) {}
  }
  return false;
}

function toggleWindow() {
  if (ytmusicWindow && !ytmusicWindow.isDestroyed()) {
    if (ytmusicWindow.isVisible()) {
      ytmusicWindow.hide();
      return { success: true, shown: false };
    } else {
      ytmusicWindow.show();
      ytmusicWindow.focus();
      return { success: true, shown: true };
    }
  }
  return showMusicWindow();
}

module.exports = {
  DEFAULT_APP,
  FALLBACK_URL,
  launchYouTubeMusic,
  getNowPlaying,
  togglePlayback,
  pausePlayback,
  resumePlayback,
  nextTrack,
  prevTrack,
  seekTo,
  setVolume,
  toggleWindow,
  parseWindowTitle,
  parseYouTubeTitle,
};
