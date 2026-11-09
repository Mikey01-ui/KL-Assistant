const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // System stats
  getSystemStats: () => ipcRenderer.invoke('get-system-stats'),

  // Voice capabilities
  onVoiceText: (callback) => {
    const handler = (_event, text) => callback(text);
    ipcRenderer.on('voice-text', handler);
    return () => ipcRenderer.removeListener('voice-text', handler);
  },
  onVoiceStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('voice-status', handler);
    return () => ipcRenderer.removeListener('voice-status', handler);
  },
  voiceStart: () => ipcRenderer.invoke('voice-start'),
  voiceStop: () => ipcRenderer.invoke('voice-stop'),
  transcribeAudio: (audioBuffer, mimeType) => ipcRenderer.invoke('transcribe-audio', audioBuffer, mimeType),
  speakText: (text) => ipcRenderer.invoke('speak-text', text),
  stopSpeaking: () => ipcRenderer.send('stop-speaking'),

  // Memory system
  memoryBuildPrompt: (message) => ipcRenderer.invoke('memory-build-prompt', message),
  memorySaveTurn: (userMsg, aiResponse) => ipcRenderer.invoke('memory-save-turn', userMsg, aiResponse),
  memoryGetAll: () => ipcRenderer.invoke('memory-get-all'),
  memoryGetProfile: () => ipcRenderer.invoke('memory-get-profile'),
  memoryGetSessions: () => ipcRenderer.invoke('memory-get-sessions'),
  memoryCreateSession: () => ipcRenderer.invoke('memory-create-session'),
  memoryDelete: (id) => ipcRenderer.invoke('memory-delete', id),
  memorySearch: (query) => ipcRenderer.invoke('memory-search', query),
  checkLanguageCommand: (message) => ipcRenderer.invoke('check-language-command', message),
  getLanguageMode: () => ipcRenderer.invoke('get-language-mode'),
  setLanguageMode: (mode) => ipcRenderer.invoke('set-language-mode', mode),
  memorySummarizeSession: (messages) => ipcRenderer.invoke('memory-summarize-session', messages),

  // System context
  getSystemTime: () => ipcRenderer.invoke('get-system-time'),
  getLocation: () => ipcRenderer.invoke('get-location'),

  // Chat log persistence
  saveChatLog: (messages) => ipcRenderer.invoke('save-chat-log', messages),
  loadChatLog: () => ipcRenderer.invoke('load-chat-log'),
  clearChatLog: () => ipcRenderer.invoke('clear-chat-log'),
  getChatLogSize: () => ipcRenderer.invoke('get-chat-log-size'),

  // Volume control
  volumeUp: () => ipcRenderer.invoke('volume-up'),
  volumeDown: () => ipcRenderer.invoke('volume-down'),
  volumeMute: () => ipcRenderer.invoke('volume-mute'),
  setVolume: (level) => ipcRenderer.invoke('set-volume', level),

  // Google Calendar + Gmail
  googleGetStatus: () => ipcRenderer.invoke('google-get-status'),
  googleConnect: () => ipcRenderer.invoke('google-connect'),
  googleDisconnect: () => ipcRenderer.invoke('google-disconnect'),

  // PC Control — Tool Execution
  executeTool: (toolName, params) => ipcRenderer.invoke('execute-tool', toolName, params),

  // Weather API
  getWeather: (params) => ipcRenderer.invoke('get-weather', params),
  getCalendarEvents: (params) => ipcRenderer.invoke('get-calendar-events', params),

  tasksList: (opts) => ipcRenderer.invoke('tasks-list', opts),
  tasksAdd: (payload) => ipcRenderer.invoke('tasks-add', payload),
  tasksComplete: (id) => ipcRenderer.invoke('tasks-complete', id),
  tasksToggle: (id) => ipcRenderer.invoke('tasks-toggle', id),
  tasksDelete: (id) => ipcRenderer.invoke('tasks-delete', id),
  tasksDueReminders: () => ipcRenderer.invoke('tasks-due-reminders'),
  tasksClearReminder: (id) => ipcRenderer.invoke('tasks-clear-reminder', id),

  // Notes API
  notesList: (opts) => ipcRenderer.invoke('notes-list', opts),
  notesAdd: (payload) => ipcRenderer.invoke('notes-add', payload),
  notesSearch: (query) => ipcRenderer.invoke('notes-search', query),
  notesDelete: (id) => ipcRenderer.invoke('notes-delete', id),

  musicLaunch: (opts) => ipcRenderer.invoke('music-launch', opts || {}),
  musicNowPlaying: (opts) => ipcRenderer.invoke('music-now-playing', opts || {}),
  musicToggle: () => ipcRenderer.invoke('music-toggle'),
  musicPause: () => ipcRenderer.invoke('music-pause'),
  musicResume: () => ipcRenderer.invoke('music-resume'),
  musicNext: () => ipcRenderer.invoke('music-next'),
  musicPrev: () => ipcRenderer.invoke('music-prev'),
  musicSeek: (seconds) => ipcRenderer.invoke('music-seek', seconds),
  musicSetVolume: (vol) => ipcRenderer.invoke('music-set-volume', vol),
  musicToggleWindow: () => ipcRenderer.invoke('music-toggle-window'),

  // Choso Island notch bridge (opens calendar / tasks / music tab)
  chosoFocus: (tabOrOpts) => ipcRenderer.invoke('choso-focus', tabOrOpts),
  chosoClose: () => ipcRenderer.invoke('choso-close'),

  onWeatherUpdated: (callback) => {
    const sub = (_event, data) => callback(data);
    ipcRenderer.on('weather-updated', sub);
    return () => ipcRenderer.removeListener('weather-updated', sub);
  },

  // Blocker signals
  aiStarted: () => ipcRenderer.send('ai-started'),
  aiStopped: () => ipcRenderer.send('ai-stopped'),

  // Environment keys
  getEnvKeys: () => ipcRenderer.invoke('get-env-keys'),

  // UI snapshot
  captureSnapshot: () => ipcRenderer.invoke('capture-snapshot'),

  // Cross-Window Communication
  showMainWindow: () => ipcRenderer.send('show-main-window'),
  broadcastEvent: (channel, payload) => ipcRenderer.send('broadcast-event', { channel, payload }),
});

// Forward cross-window broadcast events directly into the browser window DOM event system
ipcRenderer.on('broadcast-event', (_event, { channel, payload }) => {
  if (channel) {
    window.dispatchEvent(new CustomEvent(channel, { detail: payload }));
  }
});
