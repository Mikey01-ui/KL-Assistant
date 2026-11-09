/** Mirror of electron/sttFilter.js — keep regex in sync. */
const SUBTITLE_HALLUCINATION_RE =
  /^(?:00?:\d\d|\d\d?|[\d:\s.,]+|\[.*?\]|\(.*?\)|thank you for watching.*|subtitles? by.*|please (like and )?subscribe.*|thanks for watching.*)$/i;

const VOCAL_FILLER_RE =
  /^(?:oh|ah|uh|um|hm|hmm|huh|mm|mmm|mhm|ooh|woah|whoa)[.!?]*$/i;

/** Brief acknowledgements — not real commands (often TTS echo / courtesy). */
const ACK_ONLY_RE =
  /^(?:right|alright|all\s*right|ok|okay|okay\s+then|sure|thanks|thank\s+you|got\s+it|cool|great|perfect|nice|yeah|yep|yup|yes\s+sir|no\s+sir|mmhmm)[.!?]*$/i;

export function isSttNoise(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned || cleaned.length < 2) return true;
  if (SUBTITLE_HALLUCINATION_RE.test(cleaned)) return true;
  if (VOCAL_FILLER_RE.test(cleaned)) return true;
  if (ACK_ONLY_RE.test(cleaned)) return true;
  if (!/[a-zA-Z\u0600-\u06FF]/.test(cleaned)) return true;
  const core = cleaned.replace(/[^\w\s']/g, '').trim();
  if (!core || core.length < 2) return true;
  return false;
}

/** Reject mic pickup of Alfred's last spoken line (echo). */
export function isEchoOfLastSpoken(transcript, lastSpoken = '') {
  const t = String(transcript || '').toLowerCase().replace(/[^\w\s']/g, '').trim();
  const last = String(lastSpoken || '').toLowerCase().replace(/[^\w\s']/g, '').trim();
  if (!t || !last) return false;

  const tw = t.split(/\s+/).filter(Boolean);
  const lw = last.split(/\s+/).filter(Boolean);

  // Exact match of speech
  if (t === last) return true;

  // Short commands (< 3 words) are never treated as echoes of long bot speech —
  // except when they clearly repeat confirmation phrasing ("playing …").
  if (tw.length < 3) {
    if (/\bplaying\b/.test(t) && last.includes(t)) return true;
    return false;
  }

  // Substantial transcript that is a contiguous subphrase of lastSpoken
  if (tw.length >= 3 && last.includes(t)) return true;

  // Overlap: most user words appear in Alfred's last line (TTS echo of confirmations)
  if (tw.length >= 3 && lw.length >= 3) {
    const lastSet = new Set(lw);
    const overlap = tw.filter((w) => lastSet.has(w) && w.length > 2).length;
    if (overlap / tw.length >= 0.7) return true;
  }

  return false;
}

