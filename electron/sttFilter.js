/** Shared STT noise filter — used by all transcription tiers and mirrored in renderer. */
const SUBTITLE_HALLUCINATION_RE =
  /^(?:00?:\d\d|\d\d?|[\d:\s.,]+|\[.*?\]|\(.*?\)|thank you for watching.*|subtitles? by.*|please (like and )?subscribe.*|thanks for watching.*)$/i;

const VOCAL_FILLER_RE =
  /^(?:oh|ah|uh|um|hm|hmm|huh|mm|mmm|mhm|ooh|woah|whoa)[.!?]*$/i;

const ACK_ONLY_RE =
  /^(?:right|alright|all\s*right|ok|okay|okay\s+then|sure|thanks|thank\s+you|got\s+it|cool|great|perfect|nice|yeah|yep|yup|yes\s+sir|no\s+sir|mmhmm)[.!?]*$/i;

/**
 * @param {string} raw
 * @returns {string} Clean transcript or empty string if junk/silence.
 */
function filterSttText(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length < 2) return '';

  // Reject pure timestamp, bracketed tag, or YouTube end-card hallucination
  if (SUBTITLE_HALLUCINATION_RE.test(text)) return '';
  if (VOCAL_FILLER_RE.test(text)) return '';
  if (ACK_ONLY_RE.test(text)) return '';

  // Must contain at least one real letter/word character
  if (!/[a-zA-Z\u0600-\u06FF]/.test(text)) return '';

  // Strip punctuation to inspect core text
  const core = text.replace(/[^\w\s']/g, '').trim();
  if (!core) return '';

  // Reject single-letter static noise (e.g. "a", "s", "x")
  if (core.length < 2) return '';

  return text;
}

module.exports = { filterSttText, SUBTITLE_HALLUCINATION_RE };
