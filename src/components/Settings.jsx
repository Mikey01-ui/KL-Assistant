import React, { useState, useEffect } from 'react';
import { GEMINI_MODELS } from '../providers/registry';

const COLOR_THEMES = [
  { id: 'gold', label: 'Gold (Default)', primary: '#F59E0B', secondary: '#D97706', dim: 'rgba(245, 158, 11, 0.25)' },
  { id: 'cyan', label: 'Cyan', primary: '#00D4FF', secondary: '#0066FF', dim: 'rgba(0, 212, 255, 0.25)' },
  { id: 'green', label: 'Emerald', primary: '#10B981', secondary: '#059669', dim: 'rgba(16, 185, 129, 0.25)' },
  { id: 'purple', label: 'Violet', primary: '#8B5CF6', secondary: '#7C3AED', dim: 'rgba(139, 92, 246, 0.25)' },
  { id: 'red', label: 'Amber Red', primary: '#EF4444', secondary: '#DC2626', dim: 'rgba(239, 68, 68, 0.25)' },
];

const FONT_OPTIONS = [
  { id: 'inter', label: 'Inter (Modern Sans)', value: "'Inter', sans-serif" },
  { id: 'jetbrains', label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { id: 'roboto-mono', label: 'Roboto Mono', value: "'Roboto Mono', monospace" },
  { id: 'fira-code', label: 'Fira Code', value: "'Fira Code', monospace" },
];

const POLL_OPTIONS = [
  { label: '3 seconds', value: 3000 },
  { label: '5 seconds (recommended)', value: 5000 },
  { label: '10 seconds (low usage)', value: 10000 },
];

const DEFAULT_SETTINGS = {
  colorTheme: 'gold',
  bodyFont: 'inter',
  animations: true,
  pollInterval: 5000,
  weatherLocation: 'Haarlem, Netherlands',
  musicAppName: 'YouTube Music',
  userName: '',
};

function loadSettings() {
  try {
    const saved = localStorage.getItem('jarvis-settings');
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_SETTINGS;
}

function saveSettings(settings) {
  try {
    localStorage.setItem('jarvis-settings', JSON.stringify(settings));
  } catch {}
}

function applyTheme(settings) {
  const theme = COLOR_THEMES.find(t => t.id === settings.colorTheme) || COLOR_THEMES[0];
  const font = FONT_OPTIONS.find(f => f.id === settings.bodyFont) || FONT_OPTIONS[0];
  const root = document.documentElement;

  root.style.setProperty('--j-accent', theme.primary);
  root.style.setProperty('--j-accent-hover', theme.secondary);
  root.style.setProperty('--j-accent-dim', theme.dim);
  root.style.setProperty('--j-border-accent', theme.dim);

  // Font
  document.body.style.fontFamily = font.value;

  // Animations
  if (!settings.animations) {
    document.body.classList.add('no-animations');
  } else {
    document.body.classList.remove('no-animations');
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    applyTheme(settings);
    saveSettings(settings);
  }, [settings]);

  return [settings, setSettings];
}

export default function Settings({ settings, onUpdate, onClose, providerConfig, onSwitchProvider }) {
  const handleColorChange = (themeId) => {
    onUpdate({ ...settings, colorTheme: themeId });
  };

  const handleFontChange = (e) => {
    onUpdate({ ...settings, bodyFont: e.target.value });
  };

  const handlePollChange = (e) => {
    onUpdate({ ...settings, pollInterval: parseInt(e.target.value) });
  };

  const toggleAnimations = () => {
    onUpdate({ ...settings, animations: !settings.animations });
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel">
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">Settings</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Color Theme */}
          <div className="settings-section">
            <div className="settings-section-title">Accent Color</div>
            <div className="color-swatches">
              {COLOR_THEMES.map(theme => (
                <div
                  key={theme.id}
                  className={`color-swatch ${settings.colorTheme === theme.id ? 'active' : ''}`}
                  style={{ backgroundColor: theme.primary }}
                  onClick={() => handleColorChange(theme.id)}
                  title={theme.label}
                />
              ))}
            </div>
          </div>

          {/* Font */}
          <div className="settings-section">
            <div className="settings-section-title">Interface Font</div>
            <select className="settings-select" value={settings.bodyFont} onChange={handleFontChange}>
              {FONT_OPTIONS.map(font => (
                <option key={font.id} value={font.id}>{font.label}</option>
              ))}
            </select>
          </div>

          {/* Poll Interval */}
          <div className="settings-section">
            <div className="settings-section-title">Stats Refresh Rate</div>
            <select className="settings-select" value={settings.pollInterval} onChange={handlePollChange}>
              {POLL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Animations Toggle */}
          <div className="settings-section">
            <div className="settings-section-title">Performance</div>
            <div className="settings-checkbox-row">
              <span className="settings-checkbox-label">UI Animations</span>
              <button
                className={`toggle-switch ${settings.animations ? 'active' : ''}`}
                onClick={toggleAnimations}
              />
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Your name (for greetings)</div>
            <input
              type="text"
              className="settings-input"
              value={settings.userName ?? ''}
              onChange={(e) => onUpdate({ ...settings, userName: e.target.value })}
              placeholder="e.g. Milton"
            />
            <div className="settings-help" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginTop: '4px' }}>
              Alfred uses this at startup. Leave blank to address you as Sir.
            </div>
          </div>

          {/* Weather Location */}
          <div className="settings-section">
            <div className="settings-section-title">Home Weather Location</div>
            <input
              type="text"
              className="settings-input"
              value={settings.weatherLocation ?? 'Haarlem, Netherlands'}
              onChange={(e) => onUpdate({ ...settings, weatherLocation: e.target.value })}
              placeholder="e.g. Haarlem, Netherlands"
            />
            <div className="settings-help" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginTop: '4px' }}>
              Default location for Alfred's weather reports and transparent HUD widget.
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Music (YouTube Music PWA)</div>
            <input
              type="text"
              className="settings-input"
              value={settings.musicAppName ?? 'YouTube Music'}
              onChange={(e) => onUpdate({ ...settings, musicAppName: e.target.value })}
              placeholder="YouTube Music"
            />
            <div className="settings-help" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginTop: '4px' }}>
              Exact macOS app name for your YouTube Music PWA (Applications).
            </div>
          </div>

          {/* AI Provider */}
          {providerConfig && onSwitchProvider && (
            <AIProviderSection config={providerConfig} onSwitch={onSwitchProvider} />
          )}

          {/* Google Calendar + Gmail */}
          <GoogleConnectSection />

          {/* Memory Section */}
          <MemorySection />
        </div>
      </div>
    </div>
  );
}

// ── AI Provider Settings Sub-component ──────────────────────────────
function AIProviderSection({ config, onSwitch }) {
  const [ollamaModels, setOllamaModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const fetchModels = React.useCallback(async () => {
    if (config.type !== 'ollama') return;
    setLoadingModels(true);
    setFetchError(null);
    try {
      const base = config.baseUrl || 'http://localhost:11434';
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const modelList = (data.models || []).map(m => m.name).filter(Boolean);
      if (modelList.length === 0) {
        setFetchError('No models found in Ollama');
        setOllamaModels([]);
      } else {
        setOllamaModels(modelList);
        setFetchError(null);
      }
    } catch (err) {
      console.warn('Ollama model fetch failed:', err.message);
      setFetchError('Ollama not detected');
    } finally {
      setLoadingModels(false);
    }
  }, [config.type, config.baseUrl]);

  useEffect(() => {
    if (config.type === 'ollama') {
      fetchModels();
    }
  }, [config.type, config.baseUrl, fetchModels]);

  const providerList = React.useMemo(() => {
    const defaultOllamaFallback = ['qwen2.5:3b', 'qwen3.5:4b', 'llama3.2:3b', 'mistral:7b', 'gemma2:9b', 'phi3:mini'];
    const activeOllamaModels = ollamaModels.length > 0 ? ollamaModels : defaultOllamaFallback;

    return [
      { id: 'groq', label: 'Groq (Ultra-Fast LPUs)', requiresApiKey: true, defaultBaseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'openai/gpt-oss-120b', models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'] },
      { id: 'gemini', label: 'Google Gemini', requiresApiKey: true, defaultBaseUrl: '', defaultModel: 'gemini-3.5-flash', models: GEMINI_MODELS },
      { id: 'ollama', label: 'Ollama (Local)', requiresApiKey: false, defaultBaseUrl: 'http://localhost:11434', defaultModel: activeOllamaModels[0] || 'qwen2.5:3b', models: activeOllamaModels },
      { id: 'openai', label: 'OpenAI / Compatible', requiresApiKey: true, defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o', 'deepseek-chat', 'llama-3.1-8b-instant'] },
      { id: 'anthropic', label: 'Anthropic Claude', requiresApiKey: true, defaultBaseUrl: '', defaultModel: 'claude-sonnet-4-20250514', models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'] },
    ];
  }, [ollamaModels]);

  const current = providerList.find(p => p.id === config.type) || providerList[0];

  const modelOptions = React.useMemo(() => {
    const list = [...current.models];
    if (config.model && !list.includes(config.model)) {
      list.unshift(config.model);
    }
    return list;
  }, [current.models, config.model]);

  const handleProviderChange = (e) => {
    const prov = providerList.find(p => p.id === e.target.value);
    if (prov) {
      onSwitch({
        type: prov.id,
        apiKey: config.type === prov.id ? config.apiKey : '',
        baseUrl: prov.defaultBaseUrl,
        model: prov.defaultModel,
      });
    }
  };

  const handleModelChange = (e) => {
    onSwitch({ ...config, model: e.target.value });
  };

  const handleApiKeyChange = (e) => {
    onSwitch({ ...config, apiKey: e.target.value });
  };

  const handleBaseUrlChange = (e) => {
    onSwitch({ ...config, baseUrl: e.target.value });
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">AI Provider</div>

      {/* Provider Dropdown */}
      <select className="settings-select" value={config.type} onChange={handleProviderChange}>
        {providerList.map(p => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>

      {/* Model Dropdown */}
      <div style={{ marginTop: '12px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '6px',
        }}>
          <span style={{ fontSize: '11px', color: 'var(--j-text-secondary)' }}>
            Model {config.type === 'ollama' && ollamaModels.length > 0 ? `(${ollamaModels.length} detected)` : ''}
          </span>
          {config.type === 'ollama' && (
            <button
              onClick={fetchModels}
              disabled={loadingModels}
              style={{
                background: 'transparent',
                border: '1px solid var(--j-border)',
                color: 'var(--j-accent)',
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: 'var(--j-radius-sm)',
                cursor: loadingModels ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                opacity: loadingModels ? 0.6 : 1,
              }}
              title="Refresh installed Ollama models"
            >
              <span>{loadingModels ? '⏳' : '⟳'}</span>
              <span>{loadingModels ? 'Scanning...' : 'Refresh'}</span>
            </button>
          )}
        </div>

        <select className="settings-select" value={config.model} onChange={handleModelChange}>
          {modelOptions.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        {/* Error message */}
        {config.type === 'ollama' && fetchError && (
          <div style={{
            marginTop: '6px',
            fontSize: '11px',
            color: 'var(--j-error)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            <span>⚠</span>
            <span>{fetchError} — check if Ollama is running on localhost:11434</span>
          </div>
        )}

        <div style={{ marginTop: '6px' }}>
          <input
            type="text"
            className="settings-select"
            placeholder="Or type custom model name..."
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={!current.models.includes(config.model) ? config.model : ''}
            onChange={(e) => { if (e.target.value) handleModelChange(e); }}
            onBlur={(e) => { if (e.target.value) handleModelChange(e); }}
          />
        </div>
      </div>

      {/* API Key */}
      {current.requiresApiKey && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '11px', color: 'var(--j-text-secondary)', marginBottom: '6px' }}>API Key</div>
          <input
            type="password"
            className="settings-select"
            placeholder="Enter API key..."
            value={config.apiKey || ''}
            onChange={handleApiKeyChange}
          />
        </div>
      )}

      {/* Custom Base URL */}
      {config.type === 'openai' && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '11px', color: 'var(--j-text-secondary)', marginBottom: '6px' }}>Base URL</div>
          <input
            type="text"
            className="settings-select"
            placeholder="https://api.openai.com/v1"
            value={config.baseUrl || ''}
            onChange={handleBaseUrlChange}
          />
          <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--j-text-tertiary)' }}>
            Works with: LM Studio, DeepSeek, Groq, Together AI
          </div>
        </div>
      )}
    </div>
  );
}

// ── Google Connect Sub-component ────────────────────────────────
function GoogleConnectSection() {
  const [status, setStatus] = React.useState({ connected: false, configured: false, email: null });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const refresh = React.useCallback(async () => {
    try {
      const s = await window.electronAPI?.googleGetStatus?.();
      if (s) setStatus(s);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI?.googleConnect?.();
      if (result?.error) setError(result.error);
      if (result) setStatus(result);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI?.googleDisconnect?.();
      if (result) setStatus(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">Google Workspace (Calendar, Gmail &amp; Tasks)</div>
      <div style={{ fontSize: '12px', color: 'var(--j-text-secondary)', marginBottom: '8px' }}>
        {status.connected
          ? `Connected${status.email ? ` as ${status.email}` : ''}`
          : status.configured
            ? 'Not connected — click Connect to authorize Calendar, Gmail, and Google Tasks.'
            : 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then Connect.'}
      </div>

      {status.connected && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <span style={{ fontSize: '10px', padding: '3px 7px', borderRadius: '4px', background: status.calendarPermission !== false ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)', color: status.calendarPermission !== false ? '#4ade80' : '#f87171', border: '1px solid rgba(255,255,255,0.08)' }}>
            Calendar {status.calendarPermission !== false ? '✓' : '✗'}
          </span>
          <span style={{ fontSize: '10px', padding: '3px 7px', borderRadius: '4px', background: status.gmailPermission !== false ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)', color: status.gmailPermission !== false ? '#4ade80' : '#f87171', border: '1px solid rgba(255,255,255,0.08)' }}>
            Gmail {status.gmailPermission !== false ? '✓' : '✗'}
          </span>
          <span style={{ fontSize: '10px', padding: '3px 7px', borderRadius: '4px', background: status.tasksPermission ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)', color: status.tasksPermission ? '#4ade80' : '#fbbf24', border: '1px solid rgba(255,255,255,0.08)' }}>
            Google Tasks / Reminders {status.tasksPermission ? '✓' : '⚠️ Missing'}
          </span>
        </div>
      )}

      {status.warning && (
        <div style={{ marginBottom: '10px', fontSize: '11px', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.3)', lineHeight: '1.4' }}>
          ⚠️ {status.warning}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {status.connected ? (
          <>
            <button
              onClick={handleConnect}
              disabled={busy}
              style={{
                background: 'var(--j-accent)',
                border: 'none',
                color: '#000',
                padding: '6px 12px',
                fontSize: '12px',
                borderRadius: 'var(--j-radius-sm)',
                cursor: busy ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              {busy ? 'Opening browser…' : 'Reconnect Google'}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={busy}
              style={{
                background: 'transparent',
                border: '1px solid var(--j-error)',
                color: 'var(--j-error)',
                padding: '6px 12px',
                fontSize: '12px',
                borderRadius: 'var(--j-radius-sm)',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? 'Working…' : 'Disconnect'}
            </button>
          </>
        ) : (
          <button
            onClick={handleConnect}
            disabled={busy || !status.configured}
            style={{
              background: 'var(--j-accent)',
              border: 'none',
              color: '#000',
              padding: '6px 12px',
              fontSize: '12px',
              borderRadius: 'var(--j-radius-sm)',
              cursor: busy || !status.configured ? 'not-allowed' : 'pointer',
              opacity: busy || !status.configured ? 0.6 : 1,
            }}
          >
            {busy ? 'Waiting for browser…' : 'Connect Google'}
          </button>
        )}
        <button
          onClick={refresh}
          disabled={busy}
          style={{
            background: 'transparent',
            border: '1px solid var(--j-border)',
            color: 'var(--j-accent)',
            padding: '6px 10px',
            fontSize: '11px',
            borderRadius: 'var(--j-radius-sm)',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>
      {error && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--j-error)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ── Memory Settings Sub-component ───────────────────────────────
function MemorySection() {
  const [chatLogSize, setChatLogSize] = React.useState('0');
  const [clearing, setClearing] = React.useState(false);

  React.useEffect(() => {
    window.electronAPI?.getChatLogSize?.().then(size => setChatLogSize(size || '0')).catch(() => {});
  }, []);

  const handleClear = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await window.electronAPI?.clearChatLog?.();
      setChatLogSize('0');
    } catch {}
    setTimeout(() => setClearing(false), 1000);
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">Chat Storage</div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '12px', color: 'var(--j-text-secondary)' }}>
          Chat Log: {chatLogSize} KB
        </span>
        <button
          onClick={handleClear}
          style={{
            background: 'transparent',
            border: '1px solid var(--j-error)',
            color: 'var(--j-error)',
            padding: '4px 10px',
            fontSize: '11px',
            borderRadius: 'var(--j-radius-sm)',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {clearing ? '✓ Cleared' : 'Clear Chat Log'}
        </button>
      </div>
    </div>
  );
}
