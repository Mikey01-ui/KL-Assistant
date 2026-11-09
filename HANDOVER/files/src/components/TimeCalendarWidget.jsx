import React, { useState, useMemo, useEffect, useCallback } from 'react';

/**
 * TimeCalendarWidget — Pure Transparent HUD Digital Clock & Interactive Holographic Calendar
 * Behaviors:
 *  - "What's the time?": Shows only the digital time at the top-right, holds, then auto-exits.
 *  - "What's the date?": Triggers the orb flight to the bottom-left, then reveals the pure transparent
 *    center/right calendar animation (no box/background, glowing typography, pulsating dot of the day),
 *    and smoothly animates back to center once speech is done!
 */

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
];

export default function TimeCalendarWidget({
  now = new Date(),
  onCalendarModeChange,
  className = '',
}) {
  const [viewDate, setViewDate] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => now.getDate());

  // Display states
  const [showTime, setShowTime] = useState(false);
  const [timeExiting, setTimeExiting] = useState(false);

  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarExiting, setCalendarExiting] = useState(false);

  // Time format
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const currentYear = viewDate.getFullYear();
  const currentMonth = viewDate.getMonth();

  const isCurrentMonthView =
    now.getFullYear() === currentYear && now.getMonth() === currentMonth;

  // Calendar days generation (Monday-first)
  const calendarCells = useMemo(() => {
    const firstDayIndex = (new Date(currentYear, currentMonth, 1).getDay() + 6) % 7;
    const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();
    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();

    const cells = [];

    // Previous month filler days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      cells.push({
        day: prevMonthDays - i,
        isOtherMonth: true,
        key: `prev-${prevMonthDays - i}`,
      });
    }

    // Current month days
    for (let d = 1; d <= totalDays; d++) {
      const isToday = isCurrentMonthView && d === now.getDate();
      cells.push({
        day: d,
        isToday,
        isSelected: isCurrentMonthView && d === selectedDay,
        isOtherMonth: false,
        key: `curr-${d}`,
      });
    }

    // Next month filler
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let n = 1; n <= remaining; n++) {
        cells.push({
          day: n,
          isOtherMonth: true,
          key: `next-${n}`,
        });
      }
    }

    return cells;
  }, [currentYear, currentMonth, isCurrentMonthView, now, selectedDay]);

  const handlePrevMonth = (e) => {
    e.stopPropagation();
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = (e) => {
    e.stopPropagation();
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleResetToday = (e) => {
    e.stopPropagation();
    setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDay(now.getDate());
  };

  // Close calendar with smooth exit and notify orb to fly back to center
  const closeCalendar = useCallback(() => {
    setCalendarExiting(true);
    setTimeout(() => {
      setShowCalendar(false);
      setCalendarExiting(false);
      onCalendarModeChange?.(false);
    }, 500);
  }, [onCalendarModeChange]);

  // Close time display with smooth exit
  const closeTime = useCallback(() => {
    setTimeExiting(true);
    setTimeout(() => {
      setShowTime(false);
      setTimeExiting(false);
    }, 450);
  }, []);

  // Listen for 'jarvis:time' event
  useEffect(() => {
    let hideTimer = null;
    const onTimeQuery = () => {
      setTimeExiting(false);
      setShowTime(true);
    };

    window.addEventListener('jarvis:time', onTimeQuery);
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      window.removeEventListener('jarvis:time', onTimeQuery);
    };
  }, []);

  // Listen for 'jarvis:date' event (Orb animates to bottom left, then calendar unfolds)
  useEffect(() => {
    let revealTimer = null;
    const onDateQuery = () => {
      // Step 1: Tell parent to animate orb to bottom left
      onCalendarModeChange?.(true);
      setCalendarExiting(false);

      // Step 2: Once orb has animated to the corner (750ms transition), reveal the calendar
      revealTimer = setTimeout(() => {
        setShowCalendar(true);
      }, 700);
    };

    window.addEventListener('jarvis:date', onDateQuery);
    return () => {
      if (revealTimer) clearTimeout(revealTimer);
      window.removeEventListener('jarvis:date', onDateQuery);
    };
  }, [onCalendarModeChange]);

  // Listen for 'jarvis:tts-finished' to auto-dismiss either time or calendar
  useEffect(() => {
    let timer = null;
    const onTtsDone = () => {
      timer = setTimeout(() => {
        if (showCalendar) {
          closeCalendar();
        }
        if (showTime) {
          closeTime();
        }
      }, 3500);
    };

    window.addEventListener('jarvis:tts-finished', onTtsDone);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('jarvis:tts-finished', onTtsDone);
    };
  }, [showCalendar, showTime, closeCalendar, closeTime]);

  return (
    <>
      {/* --- TIME-ONLY DISPLAY (Top-Right, Only when asked) --- */}
      {showTime && (
        <div className={`time-only-widget ${timeExiting ? 'is-exiting' : ''} ${className}`}>
          <div className="time-digits-container">
            <span className="time-digit-hour">{hours}</span>
            <span className="time-colon">:</span>
            <span className="time-digit-min">{minutes}</span>
            <span className="time-digit-sec">{seconds}</span>
          </div>
          <div className="time-sub-label">LOCAL SYSTEM TIME</div>
        </div>
      )}

      {/* --- HOLOGRAPHIC CALENDAR (Revealed when orb moves to bottom-left) --- */}
      {showCalendar && (
        <div
          className={`holo-calendar-stage ${calendarExiting ? 'is-exiting' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with Month, Year, and Nav */}
          <div className="holo-cal-header">
            <div className="holo-cal-title-group">
              <span className="holo-cal-month" onClick={handleResetToday} title="Click to go to today">
                {MONTH_NAMES[currentMonth]}
              </span>
              <span className="holo-cal-year">{currentYear}</span>
            </div>

            <div className="holo-cal-controls">
              <button
                type="button"
                className="holo-cal-btn"
                onClick={handlePrevMonth}
                title="Previous Month"
              >
                ‹
              </button>
              <button
                type="button"
                className="holo-cal-btn"
                onClick={handleNextMonth}
                title="Next Month"
              >
                ›
              </button>
              <button
                type="button"
                className="holo-cal-btn holo-cal-close-btn"
                onClick={closeCalendar}
                title="Close Calendar"
              >
                ×
              </button>
            </div>
          </div>

          {/* Days of Week Header */}
          <div className="holo-cal-weekdays">
            {DAYS.map((d) => (
              <span key={d} className="holo-cal-weekday-label">
                {d}
              </span>
            ))}
          </div>

          {/* Holographic Date Grid (Pure Transparent, No Background) */}
          <div className="holo-cal-grid">
            {calendarCells.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`holo-cal-cell ${c.isOtherMonth ? 'is-other-month' : ''} ${
                  c.isToday ? 'is-today' : ''
                } ${c.isSelected ? 'is-selected' : ''}`}
                onClick={() => !c.isOtherMonth && setSelectedDay(c.day)}
              >
                <span className="holo-cal-num">{c.day}</span>
                {c.isToday && <span className="holo-today-dot" />}
              </button>
            ))}
          </div>

          {/* Selected Date Tactical Readout */}
          <div className="holo-cal-readout">
            <span className="holo-cal-tag">DATE //</span>
            <span className="holo-cal-full">
              {now.toLocaleDateString([], { weekday: 'long' }).toUpperCase()}, {MONTH_NAMES[currentMonth]} {selectedDay}, {currentYear}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
