import React, { useState, useEffect, useCallback } from 'react';

const TABS = ['Profile', 'Memories', 'Sessions'];

export default function MemoryPanel({ onClose }) {
  const [activeTab, setActiveTab] = useState(0);
  const [profile, setProfile] = useState({});
  const [observations, setObservations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prof, obs, sess] = await Promise.all([
        window.electronAPI?.memoryGetProfile?.(),
        window.electronAPI?.memoryGetAll?.(),
        window.electronAPI?.memoryGetSessions?.(),
      ]);
      setProfile(prof || {});
      setObservations(obs || []);
      setSessions(sess || []);
    } catch (err) {
      console.error('Failed to load memory data:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const results = await window.electronAPI?.memorySearch?.(searchQuery);
      setSearchResults(results || []);
    } catch (err) {
      console.error('Memory search failed:', err);
      setSearchResults([]);
    }
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) handleSearch();
      else setSearchResults(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch]);

  const handleDeleteObs = async (id) => {
    try {
      await window.electronAPI?.memoryDelete?.(id);
      setObservations(prev => prev.filter(o => o.id !== id));
      if (searchResults) {
        setSearchResults(prev => prev.filter(o => o.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete observation:', err);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel" style={{ maxWidth: 640 }}>
        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title">Memory Core</div>
            {!loading && (
              <div style={{ fontSize: '11px', color: 'var(--j-text-tertiary)', marginTop: '2px' }}>
                {Object.keys(profile).length} facts · {observations.length} memories · {sessions.length} sessions
              </div>
            )}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          gap: '4px',
          padding: '12px 20px 0',
          borderBottom: '1px solid var(--j-border)',
        }}>
          {TABS.map((tab, idx) => (
            <button
              key={tab}
              onClick={() => setActiveTab(idx)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${activeTab === idx ? 'var(--j-accent)' : 'transparent'}`,
                color: activeTab === idx ? 'var(--j-text)' : 'var(--j-text-secondary)',
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: activeTab === idx ? 600 : 400,
                cursor: 'pointer',
                fontFamily: 'var(--j-font)',
                transition: 'all var(--j-transition)',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {/* Search bar on Memories tab */}
          {activeTab === 1 && (
            <div style={{ marginBottom: '16px' }}>
              <input
                type="text"
                className="memory-input"
                placeholder="Search memories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {loading ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--j-text-tertiary)' }}>
              Loading memory data…
            </div>
          ) : (
            <>
              {/* Tab 0: Profile */}
              {activeTab === 0 && (
                <div>
                  {Object.keys(profile).length === 0 ? (
                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--j-text-tertiary)' }}>
                      No profile data yet. Tell ALFRED your name or preferences during chat.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {Object.entries(profile).map(([key, value]) => (
                        <div
                          key={key}
                          style={{
                            padding: '10px 14px',
                            borderRadius: 'var(--j-radius-sm)',
                            background: 'var(--j-surface)',
                            border: '1px solid var(--j-border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--j-text-secondary)', textTransform: 'capitalize' }}>
                            {key.replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontSize: '13px', color: 'var(--j-text)' }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 1: Memories */}
              {activeTab === 1 && (
                <div>
                  {(searchResults !== null ? searchResults : observations).length === 0 ? (
                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--j-text-tertiary)' }}>
                      {searchResults !== null ? 'No matching memories found.' : 'No memories recorded yet.'}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {(searchResults !== null ? searchResults : observations).map((obs) => (
                        <div
                          key={obs.id}
                          style={{
                            padding: '12px 14px',
                            borderRadius: 'var(--j-radius-sm)',
                            background: 'var(--j-surface)',
                            border: '1px solid var(--j-border)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: 'var(--j-accent-dim)',
                              color: 'var(--j-accent)',
                            }}>
                              {obs.type?.replace(/_/g, ' ')}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '11px', color: 'var(--j-text-tertiary)' }}>
                                {obs.date} {obs.time}
                              </span>
                              <button
                                onClick={() => handleDeleteObs(obs.id)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--j-text-tertiary)',
                                  cursor: 'pointer',
                                  fontSize: '12px',
                                }}
                                title="Delete"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--j-text)', lineHeight: 1.5 }}>
                            {obs.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Sessions */}
              {activeTab === 2 && (
                <div>
                  {sessions.length === 0 ? (
                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--j-text-tertiary)' }}>
                      No sessions recorded yet.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {sessions.map((sess) => (
                        <div
                          key={sess.id}
                          style={{
                            padding: '12px 14px',
                            borderRadius: 'var(--j-radius-sm)',
                            background: 'var(--j-surface)',
                            border: '1px solid var(--j-border)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--j-text)' }}>
                              {sess.day_of_week} {sess.date}
                            </span>
                            <span style={{ fontSize: '11px', color: 'var(--j-text-tertiary)' }}>
                              {sess.time} · {sess.message_count || 0} msgs
                            </span>
                          </div>
                          <div style={{ fontSize: '13px', color: sess.summary ? 'var(--j-text-secondary)' : 'var(--j-text-tertiary)' }}>
                            {sess.summary || (sess.isActive ? 'Session in progress…' : 'Empty session')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
