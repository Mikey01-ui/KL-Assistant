import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const DEFAULT_POS = { x: 16, y: 80 };

const FloatingStats = React.memo(({ pollInterval = 5000, visible = true, ollamaStatus, modelName }) => {
  const [stats, setStats] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState(() => {
    try {
      const saved = localStorage.getItem('jarvis-stats-pos');
      return saved ? JSON.parse(saved) : DEFAULT_POS;
    } catch { return DEFAULT_POS; }
  });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const intervalRef = useRef(null);
  const visibleRef = useRef(true);

  const fetchStats = useCallback(async () => {
    if (!visibleRef.current) return;
    try {
      if (window.electronAPI?.getSystemStats) {
        const data = await window.electronAPI.getSystemStats();
        if (data) {
          setStats(prev => {
            if (!prev) return data;
            const unchanged =
              prev.cpu.usage === data.cpu.usage &&
              prev.memory.usage === data.memory.usage &&
              prev.gpu.usage === data.gpu.usage &&
              prev.gpu.temp === data.gpu.temp &&
              prev.disk.usage === data.disk.usage &&
              prev.network.download === data.network.download &&
              prev.network.upload === data.network.upload;
            return unchanged ? prev : data;
          });
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    const handleVis = () => { visibleRef.current = !document.hidden; };
    document.addEventListener('visibilitychange', handleVis);
    fetchStats();
    intervalRef.current = setInterval(fetchStats, pollInterval);
    return () => {
      document.removeEventListener('visibilitychange', handleVis);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [pollInterval, fetchStats]);

  // Drag handlers
  const onMouseDown = useCallback((e) => {
    if (e.target.tagName === 'BUTTON') return;
    setDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const newX = Math.max(0, Math.min(window.innerWidth - 200, e.clientX - dragOffset.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragOffset.current.y));
      setPosition({ x: newX, y: newY });
    };
    const onUp = () => {
      setDragging(false);
      try {
        localStorage.setItem('jarvis-stats-pos', JSON.stringify(position));
      } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, position]);

  if (!visible) return null;

  return (
    <div
      className="floating-stats"
      style={{ left: position.x, top: position.y }}
      onMouseDown={onMouseDown}
    >
      <div className="stats-compact">
        <div className="stat-pill">
          <span className="stat-pill-label">CPU</span>
          <span className="stat-pill-value">{stats?.cpu?.usage ?? '—'}%</span>
        </div>
        <div className="stat-pill">
          <span className="stat-pill-label">RAM</span>
          <span className="stat-pill-value">{stats?.memory?.usage ?? '—'}%</span>
        </div>
        <div className="stat-pill">
          <span className="stat-pill-label">GPU</span>
          <span className="stat-pill-value">{stats?.gpu?.usage ?? '—'}%</span>
        </div>
        <button
          className="stats-toggle-btn"
          onClick={(e) => { e.stopPropagation(); setExpanded(p => !p); }}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      {expanded && stats && (
        <div className="stats-expanded">
          <div className="stat-detail">
            <span className="stat-detail-label">CPU</span>
            <span className="stat-detail-value">{stats.cpu.usage}%</span>
            <span className="stat-detail-sub">{stats.cpu.cores} cores</span>
          </div>
          <div className="stat-detail">
            <span className="stat-detail-label">Memory</span>
            <span className="stat-detail-value">{stats.memory.usage}%</span>
            <span className="stat-detail-sub">{stats.memory.used} / {stats.memory.total}</span>
          </div>
          <div className="stat-detail">
            <span className="stat-detail-label">GPU</span>
            <span className="stat-detail-value">{stats.gpu.usage}%</span>
            <span className="stat-detail-sub">
              {stats.gpu.temp ? `${stats.gpu.temp}°C` : ''} 
              {stats.gpu.name ? ` · ${stats.gpu.name}` : ''}
            </span>
          </div>
          <div className="stat-detail">
            <span className="stat-detail-label">Disk</span>
            <span className="stat-detail-value">{stats.disk.usage}%</span>
            <span className="stat-detail-sub">{stats.disk.used} / {stats.disk.total}</span>
          </div>
          <div className="stat-detail">
            <span className="stat-detail-label">Network ↓</span>
            <span className="stat-detail-value">{stats.network.download}</span>
          </div>
          <div className="stat-detail">
            <span className="stat-detail-label">Network ↑</span>
            <span className="stat-detail-value">{stats.network.upload}</span>
          </div>
        </div>
      )}
    </div>
  );
});

export default FloatingStats;
