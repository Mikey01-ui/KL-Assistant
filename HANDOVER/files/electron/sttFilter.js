/** Shared STT noise filter — used by all transcription tiers and mirrored in renderer. */
const STT_NOISE_RE =
  /^(?:00?:\d\d|\d\d?|[\d:\s.,]+|\[.*?\]|\(.*?\)|thank you for watching|subtitles? by.*)$/i;

/**
 * @param {string} raw
 * @returns {string} Clean transcript or empty string if junk/silence.
 */
function filterSttText(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length < 2) return '';
  if (STT_NOISE_RE.test(text)) return '';
  if (!/[a-zA-Z\u0600-\u06FF]/.test(text)) return '';
  return text;
}

module.exports = { filterSttText, STT_NOISE_RE };
