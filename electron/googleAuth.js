/**
 * Google OAuth for Calendar + Gmail.
 * Tokens are encrypted with Electron safeStorage and kept in the main process only.
 */
const { safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

function loadEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach((line) => {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) return;
      out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    });
  } catch (_) {}
  return out;
}

function getScopes() {
  const env = { ...loadEnvFile(), ...process.env };
  const enableGmail = env.ENABLE_GMAIL === 'true' || process.env.ENABLE_GMAIL === 'true';
  return [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/tasks',
    ...(enableGmail
      ? [
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.send',
        ]
      : []),
  ];
}

let oauth2Client = null;
let cachedTokens = null;
let appRef = null;

function getCredentials() {
  const env = { ...loadEnvFile(), ...process.env };
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  return { clientId, clientSecret };
}

function tokenPath() {
  return path.join(appRef.getPath('userData'), 'jarvis', 'google_tokens.bin');
}

function ensureJarvisDir() {
  const dir = path.join(appRef.getPath('userData'), 'jarvis');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function init(app) {
  appRef = app;
  ensureJarvisDir();
  cachedTokens = loadTokens();
}

function getOAuthClient() {
  const { google } = require('googleapis');
  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
  }
  // Redirect URI is set per auth session (loopback)
  oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  if (cachedTokens) {
    oauth2Client.setCredentials(cachedTokens);
  }
  return oauth2Client;
}

function loadTokens() {
  try {
    const p = tokenPath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p);
    if (safeStorage.isEncryptionAvailable()) {
      const json = safeStorage.decryptString(raw);
      return JSON.parse(json);
    }
    return JSON.parse(raw.toString('utf-8'));
  } catch (e) {
    console.error('[GoogleAuth] Failed to load tokens:', e.message);
    return null;
  }
}

function saveTokens(tokens) {
  ensureJarvisDir();
  cachedTokens = tokens;
  const json = JSON.stringify(tokens);
  const p = tokenPath();
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(p, safeStorage.encryptString(json));
  } else {
    fs.writeFileSync(p, json, 'utf-8');
  }
  if (oauth2Client) oauth2Client.setCredentials(tokens);
}

function clearTokens() {
  cachedTokens = null;
  try {
    const p = tokenPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
  if (oauth2Client) oauth2Client.setCredentials({});
}

function isConnected() {
  return !!(cachedTokens && (cachedTokens.refresh_token || cachedTokens.access_token));
}

async function getStatus() {
  const { clientId, clientSecret } = getCredentials();
  const configured = !!(clientId && clientSecret);
  if (!isConnected()) {
    return { connected: false, configured, email: null };
  }
  try {
    const auth = getOAuthClient();
    const { google } = require('googleapis');
    const oauth2 = google.oauth2({ version: 'v2', auth });
    const me = await oauth2.userinfo.get();
    const hasCal = Boolean(
      cachedTokens?.scope &&
      (cachedTokens.scope.includes('calendar') || cachedTokens.scope.includes('https://www.googleapis.com/auth/calendar'))
    );
    const hasGmail = Boolean(
      cachedTokens?.scope &&
      (cachedTokens.scope.includes('gmail') || cachedTokens.scope.includes('https://www.googleapis.com/auth/gmail'))
    );
    const hasTasks = Boolean(
      cachedTokens?.scope &&
      (cachedTokens.scope.includes('tasks') || cachedTokens.scope.includes('https://www.googleapis.com/auth/tasks'))
    );
    let warning = null;
    if (!hasCal) {
      warning = 'Calendar permission was not granted during Google sign-in. Please click Reconnect Google and check the Calendar box.';
    } else if (!hasGmail) {
      warning = 'Gmail permission was not granted. Please click Reconnect Google and check the Gmail permission box to enable email features.';
    } else if (!hasTasks) {
      warning = 'Google Tasks permission is not yet authorized on your Google account. Please click Reconnect Google below to grant Tasks permission and sync reminders to your phone.';
    }
    return {
      connected: true,
      configured,
      email: me.data.email || null,
      calendarPermission: hasCal,
      gmailPermission: hasGmail,
      tasksPermission: hasTasks,
      warning,
    };
  } catch (e) {
    return { connected: true, configured, email: null, calendarPermission: false, gmailPermission: false, tasksPermission: false, warning: e.message };
  }
}

let activeAuthSession = null;

function cancelConnect() {
  if (activeAuthSession) {
    try {
      if (activeAuthSession.timeoutId) clearTimeout(activeAuthSession.timeoutId);
      if (activeAuthSession.server) activeAuthSession.server.close();
    } catch (_) {}
    activeAuthSession = null;
  }
}

/**
 * Start loopback OAuth and open the browser. Resolves when tokens are saved.
 */
async function connect() {
  cancelConnect();

  const { clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) {
    throw new Error('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env first (Google Cloud OAuth Desktop client).');
  }

  const { google } = require('googleapis');

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      try { server.close(); } catch (_) {}
      activeAuthSession = null;
      if (err) reject(err);
      else resolve(result);
    };

    let client = null;

    const server = http.createServer(async (req, res) => {
      try {
        const port = server.address()?.port;
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        if (url.pathname !== '/oauth2callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const err = url.searchParams.get('error');
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Authorization failed</h1><p>You can close this window.</p>');
          finish(new Error(err));
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400);
          res.end('Missing code');
          return;
        }
        const { tokens: tok } = await client.getToken(code);
        console.log('[GoogleAuth] Granted scopes:', tok.scope || '(none)');
        const hasCal = Boolean(
          tok.scope &&
          (tok.scope.includes('calendar') || tok.scope.includes('https://www.googleapis.com/auth/calendar'))
        );
        const hasGmail = Boolean(
          tok.scope &&
          (tok.scope.includes('gmail') || tok.scope.includes('https://www.googleapis.com/auth/gmail'))
        );
        const hasTasks = Boolean(
          tok.scope &&
          (tok.scope.includes('tasks') || tok.scope.includes('https://www.googleapis.com/auth/tasks'))
        );
        res.writeHead(200, { 'Content-Type': 'text/html' });
        const perms = [];
        if (hasCal) perms.push('Calendar');
        if (hasGmail) perms.push('Gmail');
        if (hasTasks) perms.push('Google Tasks');
        if (perms.length > 0) {
          res.end(`<h1>Alfred connected to Google</h1><p>${perms.join(', ')} access successfully granted. You can close this window and return to Alfred.</p>`);
        } else {
          console.warn('[GoogleAuth] WARNING: User connected Google but unchecked permissions!');
          res.end('<h1>Google Connected (Notice)</h1><p>You connected your Google account, but permissions were not fully selected. You may close this window and return to Alfred.</p>');
        }

        if (!tok.refresh_token && cachedTokens?.refresh_token) {
          tok.refresh_token = cachedTokens.refresh_token;
        }
        saveTokens(tok);
        oauth2Client = client;
        oauth2Client.setCredentials(tok);
        const status = await getStatus();
        finish(null, status);
      } catch (e) {
        try {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error</h1><p>${e.message}</p>`);
        } catch (_) {}
        finish(e);
      }
    });

    // Listen on port 0 eliminates port race conditions entirely
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: getScopes(),
      });

      timeoutId = setTimeout(() => {
        finish(new Error('Google sign-in timed out (2 minutes)'));
      }, 120000);

      activeAuthSession = { server, timeoutId };
      shell.openExternal(authUrl).catch(finish);
    });

    server.on('error', finish);
  });
}

function disconnect() {
  cancelConnect();
  clearTokens();
  return { connected: false, configured: !!getCredentials().clientId, email: null };
}

let tokenListenerAttached = false;

/**
 * Return an authenticated googleapis OAuth2 client (refreshes as needed).
 */
async function getAuthClient() {
  if (!isConnected()) {
    throw new Error('Google account not connected. Open Settings and click Connect Google.');
  }
  const client = getOAuthClient();
  if (!tokenListenerAttached) {
    client.on('tokens', (tokens) => {
      const merged = { ...cachedTokens, ...tokens };
      saveTokens(merged);
    });
    tokenListenerAttached = true;
  }
  // Force refresh if expired
  if (cachedTokens.expiry_date && cachedTokens.expiry_date < Date.now() + 60_000) {
    const { credentials } = await client.refreshAccessToken();
    saveTokens({ ...cachedTokens, ...credentials });
  }
  return client;
}

module.exports = {
  init,
  connect,
  disconnect,
  getStatus,
  isConnected,
  getAuthClient,
  getCredentials,
  getScopes,
};
