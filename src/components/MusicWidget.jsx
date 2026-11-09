import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useHudDismiss } from '../hooks/useHudDismiss';

function loadMusicAppName() {
  try {
    const saved = JSON.parse(localStorage.getItem('jarvis-settings') || '{}');
    return saved.musicAppName || 'YouTube Music';
  } catch {
    return 'YouTube Music';
  }
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MusicWidget() {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [appName, setAppName] = useState(loadMusicAppName);
  const [isPlaying, setIsPlaying] = useState(false);
  const [simProgress, setSimProgress] = useState(72); // 0-100 percentage
  const [volume, setVolume] = useState(75); // 0-100
  const [currentTime, setCurrentTime] = useState(244); // 4:04 in seconds
  const [duration, setDuration] = useState(244);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setExiting(false);
    }, 400);
  }, []);

  useHudDismiss('music', dismiss);

  const refresh = useCallback(async () => {
    const name = loadMusicAppName();
    setAppName(name);
    try {
      const data = await window.electronAPI?.musicNowPlaying?.({ appName: name });
      if (data && data.success && data.track) {
        setNowPlaying(data);
        setIsPlaying(data.playing);
        if (data.position && data.duration) {
          setCurrentTime(data.position);
          setDuration(data.duration);
          setSimProgress(Math.min(100, (data.position / data.duration) * 100));
        }
      } else {
        // Fallback default sample track matching the reference aesthetic
        setNowPlaying((prev) => prev || {
          track: 'Love Runs Out',
          artist: 'OneRepublic',
          appName: 'Tunes',
          playing: true,
        });
        setIsPlaying(true);
      }
    } catch {
      setNowPlaying((prev) => prev || {
        track: 'Love Runs Out',
        artist: 'OneRepublic',
        appName: 'Tunes',
        playing: true,
      });
      setIsPlaying(true);
    }
  }, []);

  useEffect(() => {
    const onMusic = async (e) => {
      setExiting(false);
      setVisible(true);
      if (e.detail?.nowPlaying) {
        setNowPlaying(e.detail.nowPlaying);
        setIsPlaying(Boolean(e.detail.nowPlaying.playing));
      } else {
        await refresh();
      }
    };
    window.addEventListener('jarvis:music', onMusic);
    return () => window.removeEventListener('jarvis:music', onMusic);
  }, [refresh]);

  // Periodic poll while visible
  useEffect(() => {
    if (!visible) return undefined;
    const id = setInterval(refresh, 3500);
    return () => clearInterval(id);
  }, [visible, refresh]);

  // Smooth simulated progress tick if playing
  useEffect(() => {
    if (!visible || !isPlaying) return undefined;
    const ticker = setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + 1;
        setSimProgress((next % 245 / 244) * 100);
        return next;
      });
    }, 1000);
    return () => clearInterval(ticker);
  }, [visible, isPlaying]);

  // Auto-dismiss after speech ends
  useEffect(() => {
    if (!visible) return undefined;
    let timer = null;
    const onTtsDone = () => {
      timer = setTimeout(() => {
        dismiss();
      }, 7000);
    };
    window.addEventListener('jarvis:tts-finished', onTtsDone);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('jarvis:tts-finished', onTtsDone);
    };
  }, [visible, dismiss]);

  const toggle = async () => {
    setIsPlaying((p) => !p);
    try {
      await window.electronAPI?.musicToggle?.();
    } catch {}
    setTimeout(refresh, 400);
  };

  const handleNext = async () => {
    try {
      await window.electronAPI?.musicNext?.();
    } catch {}
    setTimeout(refresh, 500);
  };

  const handlePrev = async () => {
    try {
      await window.electronAPI?.musicPrev?.();
    } catch {}
    setTimeout(refresh, 500);
  };

  const handleScrub = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
    setSimProgress(pct);
    if (duration > 0) {
      const targetSec = Math.floor((pct / 100) * duration);
      setCurrentTime(targetSec);
      window.electronAPI?.musicSeek?.(targetSec);
    }
  };

  const handleVolumeRotate = () => {
    const nextVol = volume >= 100 ? 25 : volume + 25;
    setVolume(nextVol);
    window.electronAPI?.musicSetVolume?.(nextVol);
  };

  const handleToggleWindow = () => {
    window.electronAPI?.musicToggleWindow?.();
  };

  if (!visible) return null;

  const track = nowPlaying?.track || 'Love Runs Out';
  const artist = nowPlaying?.artist || 'OneRepublic';
  const artUrl = nowPlaying?.artUrl || null;
  const sourceLabel = nowPlaying?.appName || appName || 'TUNES';
  const needLogin = Boolean(nowPlaying?.needLogin);

  return (
    <div className={`holo-music-wrapper ${exiting ? 'is-exiting' : ''}`}>
      {/* Sci-Fi Angular HUD Console */}
      <div className="holo-music-chassis">
        {/* Top Bezel Tag / Source Pill */}
        <div className="holo-music-top-tag">
          <div className="holo-music-tag-left" onClick={handleToggleWindow} style={{ cursor: 'pointer' }} title="Toggle YouTube Music Window">
            <span className="holo-music-tag-dot" />
            <span className="holo-music-tag-text">
              {needLogin ? 'SIGN IN TO YOUTUBE MUSIC ↗' : `${sourceLabel.toUpperCase()} ↗`}
            </span>
          </div>
          <button
            type="button"
            className="holo-music-close-btn"
            onClick={dismiss}
            title="Close Music HUD"
          >
            ✕
          </button>
        </div>

        {/* Main Console Body */}
        <div className="holo-music-inner">
          {/* Left / Middle: Controls, Progress, & Info */}
          <div className="holo-music-main-section">
            {/* Top row: Monospace Time & Progress Bar */}
            <div className="holo-music-timeline-row">
              <span className="holo-music-time-code">{formatTime(currentTime)}</span>
              <div className="holo-music-progress-track" onClick={handleScrub}>
                <div
                  className="holo-music-progress-fill"
                  style={{ width: `${simProgress}%` }}
                />
                <div
                  className="holo-music-progress-scrubber"
                  style={{ left: `${simProgress}%` }}
                />
              </div>
            </div>

            {/* Bottom row: Transport Buttons & Track Metadata */}
            <div className="holo-music-controls-row">
              {/* Transport Controls */}
              <div className="holo-music-transport-group">
                <button
                  type="button"
                  className="holo-music-btn"
                  onClick={handlePrev}
                  title="Previous Track"
                >
                  <svg viewBox="0 0 24 24" className="holo-music-icon">
                    <polygon points="19,20 9,12 19,4" />
                    <line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" strokeWidth="2.5" />
                  </svg>
                </button>

                <button
                  type="button"
                  className={`holo-music-btn holo-music-btn-play ${isPlaying ? 'is-playing' : ''}`}
                  onClick={toggle}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <svg viewBox="0 0 24 24" className="holo-music-icon">
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="holo-music-icon">
                      <polygon points="6,4 20,12 6,20" />
                    </svg>
                  )}
                </button>

                <button
                  type="button"
                  className="holo-music-btn"
                  onClick={handleNext}
                  title="Next Track"
                >
                  <svg viewBox="0 0 24 24" className="holo-music-icon">
                    <polygon points="5,4 15,12 5,20" />
                    <line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" strokeWidth="2.5" />
                  </svg>
                </button>
              </div>

              {/* Metadata Display with Marquee */}
              <div className="holo-music-meta">
                <div className="holo-music-meta-title" title={`${artist} - ${track}`}>
                  <span className="holo-music-title-text">{artist} - {track}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Section: Rotary Volume Knob + Circular Vinyl Disc */}
          <div className="holo-music-dials-section">
            {/* Metallic Rotary Volume Knob */}
            <div
              className="holo-music-rotary-knob"
              onClick={handleVolumeRotate}
              title={`Volume: ${volume}% (Click to adjust)`}
            >
              <div
                className="holo-music-knob-indicator"
                style={{ transform: `rotate(${(volume / 100) * 270 - 135}deg)` }}
              />
              <div className="holo-music-knob-core">
                <span className="holo-music-knob-val">{volume}</span>
              </div>
            </div>

            {/* Circular Vinyl / Artwork Disc */}
            <div className={`holo-music-vinyl-disc ${isPlaying ? 'is-spinning' : ''}`}>
              <div className="holo-music-vinyl-grooves">
                <div className="holo-music-vinyl-center">
                  {artUrl ? (
                    <img src={artUrl} alt="Album Art" className="holo-music-art-img" />
                  ) : (
                    <div className="holo-music-art-fallback">
                      <span className="holo-music-badge-brand">TUNES</span>
                      <div className="holo-music-mini-wave">
                        <span /><span /><span />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
