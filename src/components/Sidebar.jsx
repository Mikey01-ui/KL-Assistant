import React, { useState, useEffect, useCallback } from 'react';

const Sidebar = React.memo(({ isOpen, onToggle, onNewChat, onLogEvent }) => {
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const data = await window.electronAPI?.memoryGetSessions?.(20);
      if (data) setSessions(data);
    } catch {}
    setLoadingSessions(false);
  }, []);

  useEffect(() => {
    if (isOpen) fetchSessions();
  }, [isOpen, fetchSessions]);

  const handleQuickAction = async (toolName, params, label) => {
    onLogEvent?.(`cmd::${label}`);
    try {
      const result = await window.electronAPI.executeTool(toolName, params);
      if (!result.success) console.warn(`${toolName} failed:`, result.error);
    } catch (e) {
      console.error(`${toolName} error:`, e);
    }
  };

  return (
    <aside className={`sidebar ${isOpen ? '' : 'collapsed'}`}>
      {/* Header */}
      <div className="sidebar-header">
        <button
          className="btn-new-chat"
          onClick={onNewChat}
          title="Start a new chat"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Session List */}
      <div className="sidebar-content">
        <div style={{ 
          fontSize: '11px', 
          fontWeight: 600, 
          color: 'var(--j-text-tertiary)', 
          textTransform: 'uppercase', 
          letterSpacing: '0.06em',
          padding: '8px 12px 6px',
        }}>
          Recent Sessions
        </div>

        <div className="session-list">
          {sessions.length === 0 && !loadingSessions && (
            <div style={{ 
              padding: '16px 12px', 
              fontSize: '12px', 
              color: 'var(--j-text-tertiary)',
              textAlign: 'center',
            }}>
              No previous sessions
            </div>
          )}
          {sessions.filter(s => s.summary).slice(0, 15).map((session) => (
            <button
              key={session.id}
              className={`session-item ${session.isActive ? 'active' : ''}`}
            >
              <div className="session-item-title">
                {session.summary 
                  ? session.summary.substring(0, 50) + (session.summary.length > 50 ? '…' : '')
                  : `Session ${session.id}`
                }
              </div>
              <div className="session-item-meta">
                {session.day_of_week} {session.date} · {session.time}
              </div>
            </button>
          ))}
        </div>

        {/* Quick Actions */}
        <div style={{ 
          fontSize: '11px', 
          fontWeight: 600, 
          color: 'var(--j-text-tertiary)', 
          textTransform: 'uppercase', 
          letterSpacing: '0.06em',
          padding: '16px 12px 6px',
        }}>
          Quick Actions
        </div>
        <div className="sidebar-actions" style={{ padding: '4px 12px' }}>
          <button
            className="sidebar-action-btn"
            title="Open App"
            onClick={() => {
              const name = prompt('App name to open:');
              if (name) handleQuickAction('open_app', { app_name: name }, 'open_app');
            }}
          >
            ⊞
          </button>
          <button
            className="sidebar-action-btn"
            title="Web Search"
            onClick={() => {
              const query = prompt('Search query:');
              if (query) handleQuickAction('web_search', { query }, 'web_search');
            }}
          >
            🔍
          </button>
          <button
            className="sidebar-action-btn"
            title="Screenshot"
            onClick={() => handleQuickAction('take_screenshot', {}, 'screenshot')}
          >
            📸
          </button>
          <button
            className="sidebar-action-btn"
            title="File Manager"
            onClick={() => handleQuickAction('open_folder', {}, 'file_manager')}
          >
            📁
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <div style={{ 
          fontSize: '11px', 
          color: 'var(--j-text-tertiary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 600, letterSpacing: '0.1em' }}>ALFRED</span>
          <span style={{ fontSize: '10px' }}>v1.0</span>
        </div>
      </div>
    </aside>
  );
});

export default Sidebar;
