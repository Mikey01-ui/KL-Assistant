/**
 * Detect questions that need the webcam (sight), not just conversation.
 */

const VISION_PATTERNS = [
  /\bhow many fingers\b/i,
  /\bwhat(?:'s| is) (?:this|that|on my|in (?:my|front)|in front of)\b/i,
  /\bwhat am i (?:holding|wearing|doing|showing|looking)\b/i,
  /\bwhat (?:do|am) i (?:have|wearing|holding)\b/i,
  /\bwhat do i have (?:on|in)\b/i,
  /\bwhat(?:'s| is) on my (?:face|head|hand|desk)\b/i,
  /\b(?:on|covering) my (?:face|head)\b/i,
  /\bhow do i look\b/i,
  /\bhow (?:do|does) (?:this|these|my|the)\b.*\b(?:look|fit|suit|match)\b/i,
  /\b(?:do|does) (?:this|these|my)\b.*\b(?:look|fit|suit|match)\b/i,
  /\b(?:glasses|outfit|shirt|jacket|hat|hoodie|dress|clothes|cloth|cap|mask)\b.*\b(?:look|fit|suit|on me|wearing)\b/i,
  /\b(?:look|fit|suit|wearing)\b.*\b(?:glasses|outfit|shirt|jacket|hat|hoodie|dress|clothes|cap)\b/i,
  /\bcan you (?:see|look|tell)\b.*\b(?:me|this|what|how|my)\b/i,
  /\b(?:look at|take a look at|check out)\b.*\b(?:me|this|my|what)\b/i,
  /\bwhat (?:color|colour) (?:is|are)\b/i,
  /\bread (?:this|the|what's on)\b/i,
  /\bdescribe what you see\b/i,
  /\bwhat do you see\b/i,
  /\buse (?:the |my )?camera\b/i,
  /\bopen (?:the |my )?camera\b/i,
  /\bhold(?:ing)? up\b/i,
  /\btake a (?:picture|photo|look)\b/i,
];

const NEGATIVE = [
  /\bcalendar\b/i,
  /\bschedule\b/i,
  /\bweather\b/i,
  /\bplay\b.*\bmusic\b/i,
  /\bremind(?:er| me)?\b/i,
];

export function parseVisionIntent(text) {
  const msg = String(text || '').trim();
  if (!msg || msg.length < 4) return false;
  if (NEGATIVE.some((re) => re.test(msg))) {
    if (!/\b(?:camera|what do you see|how many fingers|how do i look|on my face|on my head)\b/i.test(msg)) {
      return false;
    }
  }
  return VISION_PATTERNS.some((re) => re.test(msg));
}
