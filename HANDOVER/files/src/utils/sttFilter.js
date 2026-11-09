/** Mirror of electron/sttFilter.js — keep regex in sync. */
const STT_NOISE_RE =
  /^(?:00?:\d\d|\d\d?|[\d:\s.,]+|\[.*?\]|\(.*?\)|thank you for watching|subtitles? by.*)$/i;

export function isSttNoise(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned || cleaned.length < 2) return true;
  if (STT_NOISE_RE.test(cleaned)) return true;
  if (!/[a-zA-Z\u0600-\u06FF]/.test(cleaned)) return true;
  return false;
}
