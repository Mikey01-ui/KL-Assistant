import React, { useState, useEffect, useCallback } from 'react';

function WeatherIcon({ type, className = '' }) {
  switch (type) {
    case 'fog':
      return (
        <svg viewBox="0 0 48 48" className={`weather-svg weather-svg-fog ${className}`} aria-label="Fog">
          <path
            d="M 14 23 A 9 9 0 0 1 34 23"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          <line x1="12" y1="28" x2="36" y2="28" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" className="fog-bar b1" />
          <line x1="15" y1="34" x2="33" y2="34" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" className="fog-bar b2" />
        </svg>
      );
    case 'rain':
      return (
        <svg viewBox="0 0 48 48" className={`weather-svg weather-svg-rain ${className}`} aria-label="Rain">
          <path
            d="M16 25 h16 a7 7 0 0 0 1-13.8 A10 10 0 0 0 15 14.5 A6 6 0 0 0 16 25 z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <line x1="19" y1="30" x2="16" y2="37" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="rain-drop rd1" />
          <line x1="26" y1="30" x2="23" y2="37" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="rain-drop rd2" />
          <line x1="33" y1="30" x2="30" y2="37" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="rain-drop rd3" />
        </svg>
      );
    case 'thunder':
      return (
        <svg viewBox="0 0 48 48" className={`weather-svg weather-svg-thunder ${className}`} aria-label="Thunderstorm">
          <path
            d="M16 23 h16 a7 7 0 0 0 1-13.8 A10 10 0 0 0 15 13 A6 6 0 0 0 16 23 z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <polygon points="25,25 20,33 25,33 22,41 29,31 24,31" fill="currentColor" className="thunder-bolt" />
        </svg>
      );
    case 'snow':
      return (
        <svg viewBox="0 0 48 48" className={`weather-svg weather-svg-snow ${className}`} aria-label="Snow">
          <path
            d="M16 25 h16 a7 7 0 0 0 1-13.8 A10 10 0 0 0 15 14.5 A6 6 0 0 0 16 25 z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <circle cx="18" cy="33" r="1.8" fill="currentColor" className="snow-flake sf1" />
          <circle cx="25" cy="36" r="1.8" fill="currentColor" className="snow-flake sf2" />
          <circle cx="32" cy="33" r="1.8" fill="currentColor" className="snow-flake sf3" />
        </svg>
      );
    case 'partly-cloudy':
      return (
        <svg viewBox="0 0 48 48" className={`weather-svg weather-svg-partly ${className}`} aria-label="Partly Cloudy">
          <circle cx="28" cy="18" r="7" fill="none" stroke="currentColor" strokeWidth="2.6" className="sun-spin" />
          <path
            d="M14 31 h18 a6.5 6.5 0 0 0 0.8-12.8 A9.5 9.5 0 0 0 13.5 21 A5.5 5.5 0 0 0 14 31 z"
            fill="rgba(2, 13, 23, 0.7)"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'cloudy':
      return (
        <svg viewBox="0 0 48 48" className={`weather-svg weather-svg-cloudy ${className}`} aria-label="Cloudy">
          <path
            d="M15 32 h18 a7.5 7.5 0 0 0 1.2-14.8 A10.5 10.5 0 0 0 13.5 20.5 A6.5 6.5 0 0 0 15 32 z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'sunny':
    default:
      return (
        <svg viewBox="0 0 48 48" className={`weather-svg weather-svg-sunny ${className}`} aria-label="Sunny">
          <circle cx="24" cy="24" r="8" fill="none" stroke="currentColor" strokeWidth="3" />
          <g className="sun-rays" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="24" y1="8" x2="24" y2="12" />
            <line x1="24" y1="36" x2="24" y2="40" />
            <line x1="8" y1="24" x2="12" y2="24" />
            <line x1="36" y1="24" x2="40" y2="24" />
            <line x1="12.7" y1="12.7" x2="15.5" y2="15.5" />
            <line x1="32.5" y1="32.5" x2="35.3" y2="35.3" />
            <line x1="12.7" y1="35.3" x2="15.5" y2="32.5" />
            <line x1="32.5" y1="15.5" x2="35.3" y2="12.7" />
          </g>
        </svg>
      );
  }
}

function useTypewriter(targetText = '', speed = 35, startDelay = 0) {
  const [displayed, setDisplayed] = useState('');
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    let timeoutId;
    let intervalId;
    setDisplayed('');
    setIsDone(false);

    timeoutId = setTimeout(() => {
      let index = 0;
      intervalId = setInterval(() => {
        index += 1;
        setDisplayed(targetText.slice(0, index));
        if (index >= targetText.length) {
          clearInterval(intervalId);
          setIsDone(true);
        }
      }, speed);
    }, startDelay);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [targetText, speed, startDelay]);

  return { displayed, isDone };
}

export default function WeatherWidget({
  weather,
  onClose,
  onRefresh,
  isLoading = false,
  className = '',
}) {
  const [useFahrenheit, setUseFahrenheit] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  if (!weather) return null;

  const currentTemp = useFahrenheit
    ? (weather.temperatureF ?? Math.round((weather.temperature * 9) / 5 + 32))
    : weather.temperature;

  const highTemp = useFahrenheit
    ? Math.round((weather.high * 9) / 5 + 32)
    : weather.high;

  const lowTemp = useFahrenheit
    ? Math.round((weather.low * 9) / 5 + 32)
    : weather.low;

  const tempStr = `${currentTemp}°`;
  const locationStr = weather.location || 'Local Area';
  const conditionStr = weather.condition || 'Clear';
  const rangeStr = `↑${highTemp}° / ↓${lowTemp}°`;

  // Staggered typewriter effects
  const typeTemp = useTypewriter(tempStr, 50, 0);
  const typeCond = useTypewriter(conditionStr, 35, 100);
  const typeLoc = useTypewriter(locationStr, 30, 180);
  const typeRange = useTypewriter(rangeStr, 25, 260);

  const handleClose = useCallback((e) => {
    e?.stopPropagation?.();
    setIsExiting(true);
    setTimeout(() => {
      onClose?.();
    }, 450);
  }, [onClose]);

  // Auto-dismiss animation when speech is done (with gentle delay) or fallback
  useEffect(() => {
    let timer = null;
    const onTtsDone = () => {
      // Hold for 3.5 seconds so user can absorb the numbers, then animate out
      timer = setTimeout(() => {
        handleClose();
      }, 3500);
    };

    window.addEventListener('jarvis:tts-finished', onTtsDone);
    // Fallback maximum screen time: 14s
    const fallbackTimer = setTimeout(() => {
      handleClose();
    }, 14000);

    return () => {
      if (timer) clearTimeout(timer);
      clearTimeout(fallbackTimer);
      window.removeEventListener('jarvis:tts-finished', onTtsDone);
    };
  }, [handleClose]);

  return (
    <div
      className={`weather-widget-container ${isExiting ? 'is-exiting' : ''} ${isLoading ? 'is-loading' : ''} ${className}`}
      onClick={() => setShowDetails((v) => !v)}
    >
      <div className="weather-widget-inner">
        {/* Left Section: Minimalist Icon */}
        <div className="weather-icon-box">
          <WeatherIcon type={weather.icon || 'fog'} />
        </div>

        {/* Center-Left Section: Temp + Location (Typewritten) */}
        <div className="weather-main-info">
          <div className="weather-temp-row">
            <span
              className="weather-temp-val"
              onClick={(e) => {
                e.stopPropagation();
                setUseFahrenheit((v) => !v);
              }}
              title="Click to toggle °C / °F"
            >
              {typeTemp.displayed}
              {!typeTemp.isDone && <span className="typewriter-cursor">|</span>}
            </span>
          </div>
          <div className="weather-location-row">
            <span className="weather-pin">📍</span>
            <span className="weather-location-name">
              {typeLoc.displayed}
              {!typeLoc.isDone && <span className="typewriter-cursor">|</span>}
            </span>
          </div>
        </div>

        {/* Right Section: Condition + High / Low (Typewritten) */}
        <div className="weather-metrics">
          <div className="weather-condition">
            {typeCond.displayed}
            {!typeCond.isDone && <span className="typewriter-cursor">|</span>}
          </div>
          <div className="weather-range">
            {typeRange.displayed}
            {!typeRange.isDone && <span className="typewriter-cursor">|</span>}
          </div>
        </div>

        {/* Quick controls on hover */}
        <div className="weather-actions" onClick={(e) => e.stopPropagation()}>
          {onRefresh && (
            <button
              type="button"
              className="weather-action-btn"
              onClick={onRefresh}
              title="Refresh weather"
              disabled={isLoading}
            >
              ↻
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="weather-action-btn weather-close-btn"
              onClick={handleClose}
              title="Close"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
