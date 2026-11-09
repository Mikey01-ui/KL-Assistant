import React, { useState, useEffect, useCallback } from 'react';
import { dismissOtherHudOverlays } from '../utils/overlayCoordinator';

/**
 * TimeCalendarWidget — holographic chronometer overlay (voice-triggered).
 * Calendar UI removed; schedule/date queries stay voice-only.
 */

export default function TimeCalendarWidget({
  now = new Date(),
  onCalendarModeChange,
  className = '',
}) {
  const [showTime, setShowTime] = useState(false);
  const [timeExiting, setTimeExiting] = useState(false);

  useEffect(() => {
    onCalendarModeChange?.(false);
  }, [onCalendarModeChange]);

  const rawHours = now.getHours();
  const ampm = rawHours >= 12 ? 'PM' : 'AM';
  const hours = String(rawHours % 12 || 12).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const weekday = now.toLocaleDateString([], { weekday: 'short' }).toUpperCase();
  const dateLine = now.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const closeTime = useCallback(() => {
    setTimeExiting(true);
    setTimeout(() => {
      setShowTime(false);
      setTimeExiting(false);
    }, 280);
  }, []);

  const revealTime = useCallback(() => {
    dismissOtherHudOverlays('time');
    setTimeExiting(false);
    setShowTime(true);
  }, []);

  useEffect(() => {
    const onDismiss = (e) => {
      const except = e.detail?.except;
      if (!except) return;
      if (except !== 'time' && showTime) closeTime();
    };
    window.addEventListener('jarvis:hud-dismiss', onDismiss);
    return () => window.removeEventListener('jarvis:hud-dismiss', onDismiss);
  }, [showTime, closeTime]);

  useEffect(() => {
    const onTimeQuery = () => revealTime();
    window.addEventListener('jarvis:time', onTimeQuery);
    return () => window.removeEventListener('jarvis:time', onTimeQuery);
  }, [revealTime]);

  // Auto-dismiss after TTS finishes (or fallback timeout)
  useEffect(() => {
    if (!showTime) return undefined;
    let holdTimer = null;
    const onTtsDone = () => {
      holdTimer = setTimeout(() => closeTime(), 3200);
    };
    window.addEventListener('jarvis:tts-finished', onTtsDone);
    const fallback = setTimeout(() => closeTime(), 14000);
    return () => {
      if (holdTimer) clearTimeout(holdTimer);
      clearTimeout(fallback);
      window.removeEventListener('jarvis:tts-finished', onTtsDone);
    };
  }, [showTime, closeTime]);

  if (!showTime) return <div className={`clean-time-widget-root ${className}`} />;

  return (
    <div className={`clean-time-widget-root ${className}`}>
      <div
        className={`clean-time-display ${timeExiting ? 'is-exiting' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="clean-time-inner">
          <div className="clean-time-rail" aria-hidden="true" />

          <div className="clean-time-body">
            <div className="clean-time-header">
              <span className="clean-time-eyebrow">
                <span className="clean-time-dot" />
                CHRONOMETER
              </span>
              <button
                type="button"
                className="clean-time-close"
                onClick={closeTime}
                aria-label="Close"
                title="Close"
              >
                ✕
              </button>
            </div>

            <div className="clean-time-clock" aria-live="polite">
              <span className="clean-time-hhmm">
                <span className="clean-time-h">{hours}</span>
                <span className="clean-time-colon">:</span>
                <span className="clean-time-m">{minutes}</span>
              </span>
              <div className="clean-time-meta">
                <span className="clean-time-ampm">{ampm}</span>
                <span className="clean-time-sec">{seconds}</span>
              </div>
            </div>

            <div className="clean-time-footer">
              <span className="clean-time-weekday">{weekday}</span>
              <span className="clean-time-sep" aria-hidden="true" />
              <span className="clean-time-date">{dateLine}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
