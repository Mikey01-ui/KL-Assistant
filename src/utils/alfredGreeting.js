export function timeOfDayGreeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Spoken line when user asks for the date (matches get-system-time IPC). */
export function formatDateSpeech(timeData) {
  if (!timeData?.date) return 'I could not read the date just now, Sir.';
  return `Today is ${timeData.date}, Sir.`;
}

/** Spoken line when user asks for the time. */
export function formatTimeSpeech(timeData) {
  if (!timeData?.time) return 'I could not read the time just now, Sir.';
  let clean = timeData.time.replace(/:\d{2}(?=[ \u202f]?[AP]M)/i, '').trim();
  clean = clean.replace(/:00(?=[ \u202f]?[AP]M)/i, '');
  return `The time is ${clean}, Sir.`;
}

/**
 * Startup intro: Smart Adaptive Continuity greeting.
 * Greets with time of day and natural butler continuity phrasings.
 * @param {{ userName?: string, timeData?: { date?: string, time?: string, timestamp?: number }, hasHistory?: boolean }} opts
 */
export function buildStartupGreeting({ userName = '', timeData = null, hasHistory = false } = {}) {
  const now = timeData?.timestamp ? new Date(timeData.timestamp) : new Date();
  const tod = timeOfDayGreeting(now);
  const name = String(userName || '').trim();
  const addressee = name || 'Sir';

  const continuityPhrasings = [
    `${tod}, ${addressee}. Shall we continue where we were working, or is there something new on your mind?`,
    `${tod}, ${addressee}. Ready to pick up where we left off, or how may I assist you today?`,
    `${tod}, ${addressee}. All systems standing by. Shall we resume our previous work?`,
  ];

  const freshPhrasings = [
    `${tod}, ${addressee}. All systems online and at your service. How may I assist you today?`,
    `${tod}, ${addressee}. Standing by for your instructions. How may I be of service?`,
    `${tod}, ${addressee}. All systems are fully operational. Ready whenever you are.`,
  ];

  const pool = hasHistory ? continuityPhrasings : freshPhrasings;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return picked;
}

