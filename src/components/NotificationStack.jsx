import React, { useEffect, useState, useCallback } from 'react';

const MAX_VISIBLE = 3;
const MAX_HISTORY = 20;
const AUTO_DISMISS_MS = 5000;

export default function NotificationStack() {
  const [toasts, setToasts] = useState([]);
  const [history, setHistory] = useState([]);
  const [expanded, setExpanded] = useState(false);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const onNotify = (e) => {
      const { message, level = 'info' } = e.detail || {};
      if (!message) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item = { id, message, level, at: Date.now() };
      setToasts((prev) => [...prev, item].slice(-MAX_VISIBLE));
      setHistory((prev) => [item, ...prev].slice(0, MAX_HISTORY));
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    };
    window.addEventListener('jarvis:notify', onNotify);
    return () => window.removeEventListener('jarvis:notify', onNotify);
  }, [dismiss]);

  if (!toasts.length && !expanded) return null;

  return (
    <div className="hud-notify-root">
      <div className="hud-notify-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`hud-notify-toast hud-notify-${t.level}`}>
            <span className="hud-notify-msg">{t.message}</span>
            <button type="button" className="hud-notify-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
      {history.length > 0 && (
        <button type="button" className="hud-notify-history-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'HIDE LOG' : 'NOTIFY LOG'}
        </button>
      )}
      {expanded && (
        <div className="hud-notify-history">
          {history.map((h) => (
            <div key={h.id} className="hud-notify-history-line">
              {h.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
