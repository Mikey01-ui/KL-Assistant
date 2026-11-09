import React, { useState, useEffect, useCallback } from 'react';

const LANG_MODES = [
  { key: 'auto', label: 'AUTO', title: 'Auto-detect language' },
  { key: 'english', label: 'EN', title: 'English only' },
  { key: 'urdu', label: 'UR', title: 'Roman Urdu only' },
];

const Header = React.memo(({
  onToggleSidebar,
  onNewChat,
  onOpenSettings,
  onOpenMemory,
  ollamaStatus = 'connecting',
  isDarkTheme,
  onToggleTheme,
  isMuted,
  onToggleMute,
  showStats,
  onToggleStats,
}) => {
  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = () => window.electronAPI?.maximize();
  const handleClose = () => window.electronAPI?.close();

  const [langMode, setLangMode] = useState('auto');

  useEffect(() => {
    window.electronAPI?.getLanguageMode?.().then((mode) => {
      if (mode) setLangMode(mode);
    }).catch(() => {});
  }, []);

  const cycleLangMode = useCallback(() => {
    const currentIndex = LANG_MODES.findIndex(m => m.key === langMode);
    const nextIndex = (currentIndex + 1) % LANG_MODES.length;
    const nextMode = LANG_MODES[nextIndex].key;
    setLangMode(nextMode);
    window.electronAPI?.setLanguageMode?.(nextMode).catch(() => {});
  }, [langMode]);

  const currentLangInfo = LANG_MODES.find(m => m.key === langMode) || LANG_MODES[0];

  const statusLabel = {
    online: 'Online',
    offline: 'Offline',
    connecting: 'Connecting',
    'no-model': 'No Model',
  }[ollamaStatus] || 'Unknown';

  const statusClass = ollamaStatus === 'online' ? 'online' :
                      ollamaStatus === 'offline' ? 'offline' :
                      ollamaStatus === 'no-model' ? 'offline' : 'connecting';

  return (
    <header className="app-header">
      <div className="header-left">
        {/* Sidebar toggle */}
        <button className="header-icon-btn" title="Toggle sidebar" onClick={onToggleSidebar}>
          ☰
        </button>

        {/* New Chat */}
        <button className="header-icon-btn" title="New chat" onClick={onNewChat}>
          +
        </button>
      </div>

      <div className="header-right">
        {/* Model status */}
        <div className="status-indicator">
          <span className={`status-dot ${statusClass}`} />
          <span>{statusLabel}</span>
        </div>

        {/* Language toggle */}
        <button
          className="lang-toggle"
          onClick={cycleLangMode}
          title={`Language: ${currentLangInfo.title} — click to cycle`}
        >
          {currentLangInfo.label}
        </button>

        {/* Stats toggle */}
        <button
          className="header-icon-btn"
          title={showStats ? 'Hide stats' : 'Show stats'}
          onClick={onToggleStats}
          style={showStats ? { color: 'var(--j-accent)' } : {}}
        >
          📊
        </button>

        {/* Mute */}
        <button className="header-icon-btn" title={isMuted ? 'Unmute' : 'Mute'} onClick={onToggleMute}>
          {isMuted ? '🔇' : '🔊'}
        </button>

        {/* Memory */}
        <button className="header-icon-btn" title="Memory" onClick={onOpenMemory}>
          🧠
        </button>

        {/* Theme */}
        <button className="header-icon-btn" title="Toggle theme" onClick={onToggleTheme}>
          {isDarkTheme ? '☀' : '☾'}
        </button>

        {/* Settings */}
        <button className="header-icon-btn" title="Settings" onClick={onOpenSettings}>
          ⚙
        </button>

        {/* Window controls */}
        <div style={{ width: 1, height: 20, background: 'var(--j-border)', margin: '0 4px' }} />
        <button className="header-icon-btn" title="Minimize" onClick={handleMinimize}>─</button>
        <button className="header-icon-btn" title="Maximize" onClick={handleMaximize}>□</button>
        <button className="header-icon-btn close" title="Close" onClick={handleClose}>✕</button>
      </div>
    </header>
  );
});

export default Header;
