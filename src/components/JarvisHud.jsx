import React, { useEffect, useMemo, useState, useCallback } from 'react';
import ArcReactor from './ArcReactor';
import WeatherWidget from './WeatherWidget';
import TimeCalendarWidget from './TimeCalendarWidget';
import SystemMonitorWidget from './SystemMonitorWidget';
import TasksWidget from './TasksWidget';
import CameraVisionPanel from './CameraVisionPanel';
import ErrorBoundary from './ErrorBoundary';
import { readSettingsWeatherLocation, resolveWeatherLocation } from '../utils/weatherLocation';
import { VISION_EVENTS } from '../utils/visionSession';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function useStats(pollInterval) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (!window.electronAPI?.getSystemStats) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const data = await window.electronAPI.getSystemStats();
        if (alive && data) setStats(data);
      } catch {}
    };
    tick();
    const id = setInterval(tick, pollInterval);
    return () => { alive = false; clearInterval(id); };
  }, [pollInterval]);
  return stats;
}

function StatBar({ label, value, suffix = '%' }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="hud-stat">
      <div className="hud-stat-row">
        <span>{label}</span>
        <span className="hud-stat-value">{value == null ? '--' : `${pct}${suffix}`}</span>
      </div>
      <div className="hud-stat-track">
        <div className="hud-stat-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const STATE_LABELS = {
  idle: 'STANDBY',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  executing: 'EXECUTING',
  speaking: 'SPEAKING',
  offline: 'OFFLINE',
};

function plain(text = '') {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function JarvisHud({
  state,
  detail,
  messages,
  streamingContent,
  logs,
  pollInterval,
  providerLabel,
  isMuted,
  onToggleMute,
  onOpenSettings,
  onOpenMemory,
  onNewChat,
  onSend,
  onStop,
  isBusy,
  onTapMic,
}) {
  const now = useClock();
  const stats = useStats(pollInterval);
  const [input, setInput] = useState('');
  const [showFullHud, setShowFullHud] = useState(false);
  const [weather, setWeather] = useState(null);
  const [showWeather, setShowWeather] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [orbCornerMode, setOrbCornerMode] = useState(false);
  const [visionActive, setVisionActive] = useState(false);

  // Camera vision: tuck orb bottom-left while the optical feed is open.
  useEffect(() => {
    const onMode = (e) => {
      const active = Boolean(e.detail?.active);
      setVisionActive(active);
      if (active) setOrbCornerMode(true);
      else setOrbCornerMode(false);
    };
    const onOpen = () => {
      setVisionActive(true);
      setOrbCornerMode(true);
    };
    const onClose = () => {
      setVisionActive(false);
      setOrbCornerMode(false);
    };
    window.addEventListener('jarvis:vision-mode', onMode);
    window.addEventListener(VISION_EVENTS.OPEN, onOpen);
    window.addEventListener(VISION_EVENTS.CLOSE, onClose);
    return () => {
      window.removeEventListener('jarvis:vision-mode', onMode);
      window.removeEventListener(VISION_EVENTS.OPEN, onOpen);
      window.removeEventListener(VISION_EVENTS.CLOSE, onClose);
    };
  }, []);

  // Subscribe to live weather updates from tool executions and IPC
  useEffect(() => {
    const unsub = window.electronAPI?.onWeatherUpdated?.((data) => {
      if (data) {
        setWeather(data);
        setShowWeather(true);
      }
    });

    const handleCustomWeather = (e) => {
      if (e.detail) {
        setWeather(e.detail);
        setShowWeather(true);
      }
    };
    window.addEventListener('jarvis:weather', handleCustomWeather);

    // Initial weather preload for cache without showing UI until asked
    const home = readSettingsWeatherLocation();
    window.electronAPI?.getWeather?.({ location: home }).then((res) => {
      if (res?.success && res.weatherData) {
        setWeather(res.weatherData);
      }
    }).catch(() => {});

    const onHudFocus = (e) => {
      const kind = e.detail?.kind;
      if (kind && kind !== 'weather') {
        setShowWeather(false);
      }
    };
    window.addEventListener('jarvis:hud-focus', onHudFocus);

    return () => {
      unsub?.();
      window.removeEventListener('jarvis:weather', handleCustomWeather);
      window.removeEventListener('jarvis:hud-focus', onHudFocus);
    };
  }, []);

  const handleRefreshWeather = useCallback(async () => {
    setWeatherLoading(true);
    try {
      const loc = weather?.location || resolveWeatherLocation('');
      const res = await window.electronAPI?.getWeather?.({ location: loc });
      if (res?.success && res.weatherData) {
        setWeather(res.weatherData);
      }
    } catch (_) {} finally {
      setWeatherLoading(false);
    }
  }, [weather?.location]);

  const { lastUser, lastJarvis } = useMemo(() => {
    const visible = messages.filter((m) => m.role !== 'system');
    const user = [...visible].reverse().find((m) => m.role === 'user');
    const jarvis = [...visible].reverse().find((m) => m.role === 'assistant');
    return { lastUser: user?.content, lastJarvis: jarvis?.content };
  }, [messages]);

  const jarvisLine = plain(streamingContent || lastJarvis || '');

  const submit = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;
    onSend(text);
    setInput('');
  };

  return (
    <div className={`hud-root hud-state-${state} ${showFullHud ? '' : 'hud-orb-only'}`}>
      <div className="hud-bg" />

      <header className="hud-topbar">
        <div className="hud-brand">
          <span className="hud-brand-mark">◆</span> WAYNE ENTERPRISES <span className="hud-dim">// ALFRED MK I</span>
        </div>
        <div className="hud-actions">
          <button onClick={() => setShowFullHud((v) => !v)} title="Toggle HUD Panels">{showFullHud ? 'ORB ONLY' : 'HUD'}</button>
          <button onClick={onTapMic} title="Start listening" disabled={isBusy}>MIC</button>
          <button onClick={onNewChat} title="New session">NEW</button>
          <button onClick={onToggleMute} title={isMuted ? 'Unmute voice' : 'Mute voice'}>{isMuted ? 'MUTED' : 'VOICE'}</button>
          <button onClick={() => setShowWeather((v) => !v)} title="Toggle Weather Display">{showWeather ? 'WEATHER ●' : 'WEATHER'}</button>
          <button onClick={onOpenMemory} title="Memory">MEM</button>
          <button onClick={onOpenSettings} title="Settings">SYS</button>
          <span className="hud-window">
            <button onClick={() => window.electronAPI?.minimize()} title="Minimize">–</button>
            <button onClick={() => window.electronAPI?.maximize()} title="Maximize">□</button>
            <button onClick={() => window.electronAPI?.close()} title="Close">×</button>
          </span>
        </div>
      </header>

      {showWeather && weather && (
        <WeatherWidget
          weather={weather}
          onClose={() => setShowWeather(false)}
          onRefresh={handleRefreshWeather}
          isLoading={weatherLoading}
        />
      )}

      <ErrorBoundary name="CameraVisionPanel">
        <CameraVisionPanel />
      </ErrorBoundary>

      {/* Transparent HUD Time & Interactive Calendar Widget */}
      <ErrorBoundary name="TimeCalendarWidget">
        <TimeCalendarWidget
          now={now}
          onCalendarModeChange={(v) => {
            if (!visionActive) setOrbCornerMode(v);
          }}
        />
      </ErrorBoundary>
      <ErrorBoundary name="SystemMonitorWidget">
        <SystemMonitorWidget pollInterval={pollInterval} />
      </ErrorBoundary>
      <ErrorBoundary name="TasksWidget">
        <TasksWidget />
      </ErrorBoundary>

      {showFullHud && (
        <aside className="hud-panel hud-panel-left">
          <div className="hud-panel-title">LOCAL TIME</div>
          <div className="hud-clock">
            {String(now.getHours() % 12 || 12).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
            <span className="hud-clock-sec">{String(now.getSeconds()).padStart(2, '0')}</span>
            <span style={{ fontSize: '0.42em', marginLeft: '6px', opacity: 0.85, letterSpacing: '1px' }}>
              {now.getHours() >= 12 ? 'PM' : 'AM'}
            </span>
          </div>
          <div className="hud-date">
            {now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}
          </div>

          <div className="hud-panel-title hud-mt">SYSTEM DIAGNOSTICS</div>
          <StatBar label="CPU" value={stats?.cpu?.usage} />
          <StatBar label="MEMORY" value={stats?.memory?.usage} />
          <StatBar label="STORAGE" value={stats?.disk?.usage} />
          <div className="hud-net">
            <span>▼ {stats?.network?.download ?? '0.0'} MB/s</span>
            <span>▲ {stats?.network?.upload ?? '0.0'} MB/s</span>
          </div>

          <div className="hud-panel-title hud-mt">UPLINK</div>
          <div className="hud-kv"><span>AI CORE</span><span>{providerLabel}</span></div>
        </aside>
      )}

      {showFullHud && (
        <aside className="hud-panel hud-panel-right">
          <div className="hud-panel-title">ACTIVITY LOG</div>
          <div className="hud-log">
            {logs.slice(-14).map((l, i) => (
              <div key={i} className={`hud-log-line hud-log-${l.type}`}>
                <span className="hud-log-type">{l.type.toUpperCase()}</span> {l.message}
              </div>
            ))}
            {logs.length === 0 && <div className="hud-log-line hud-dim">Awaiting input…</div>}
          </div>
        </aside>
      )}

      <main className="hud-center">
        <button
          type="button"
          className={`hud-reactor-hit ${orbCornerMode || visionActive ? 'is-corner-mode' : ''}`}
          onClick={onTapMic}
          disabled={isBusy}
        >
          <ArcReactor state={state} cornerMode={orbCornerMode || visionActive} />
        </button>
      </main>

      {showFullHud && (
        <form className="hud-console" onSubmit={submit}>
          <span className="hud-prompt">›</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Speak, or type a command…"
            disabled={isBusy}
          />
          {isBusy && <button type="button" onClick={onStop} className="hud-console-stop">ABORT</button>}
        </form>
      )}
    </div>
  );
}
