// ============================================================
// Language Detection — Lightweight Roman Urdu vs English
// Word-boundary keyword matching, no external dependencies.
// ============================================================

// Common Roman Urdu words — broad list covering everyday Pakistani texting patterns.
// Each is matched at word boundaries, case-insensitive.
// Sources: common Pakistani chat/texting vocabulary, covering verbs, pronouns,
// particles, greetings, slang, and everyday expressions.
// Common Roman Urdu words — distinct and unambiguous words that do not collide with English.
const ROMAN_URDU_WORDS = [
  // Verbs / auxiliaries
  'hai', 'hain', 'hoga', 'hogi', 'honge',
  'tha', 'thi', 'thay',
  'kar', 'karo', 'karna', 'kro', 'kia', 'kiya', 'karain', 'karein',
  'raha', 'rahi', 'rahe', 'rha', 'rhi',
  'bolo', 'bata', 'batao', 'btao',
  'dena', 'dedo', 'lena', 'lelo',
  'jao', 'jana', 'aao', 'chalo', 'chalen',
  'suno', 'dekho', 'dikhao', 'samjhao',
  'chahiye', 'chahte', 'chaiye',
  'lagta', 'lagti', 'lagega',
  'milta', 'milti', 'milte',
  'pehchaan', 'ruko',

  // Pronouns / particles
  'mein', 'mujhe', 'mujh', 'mera', 'meri', 'mere',
  'tum', 'tumhe', 'tumhara', 'tumhari',
  'aap', 'apka', 'apko', 'apki', 'apna', 'apne',
  'uska', 'uski', 'unka', 'unki', 'iska', 'iski',
  'humara', 'humari', 'humare',
  'woh', 'yeh', 'uss', 'iss',

  // Negation / affirmation
  'nahi', 'nhi', 'mat',
  'haan', 'bilkul',

  // Question words
  'kya', 'kyun', 'kyon', 'kaise', 'kese',
  'kahan', 'kidhar', 'kab', 'kaun', 'konsa', 'kitna', 'kitne',

  // Common adjectives / adverbs
  'acha', 'achi', 'theek', 'thik', 'sahi', 'galat',
  'bara', 'bari', 'chota', 'choti',
  'pura', 'puri', 'pora', 'pori',
  'naya', 'nayi', 'purana', 'purani',
  'bura', 'buri',

  // Address / social
  'bhai', 'yaar', 'jaani', 'jigar', 'ustaad',
  'shukriya', 'shukria', 'mehrbani',
  'mubarak', 'alvida',

  // Common nouns / everyday words
  'sab', 'kuch', 'bohot', 'boht', 'bahut', 'zyada',
  'wala', 'wali', 'wale',
  'abhi', 'pehle', 'baad', 'dosra', 'dosri',
  'hamesha', 'kabhi', 'aksar',
  'lekin', 'magar',
  'aisa', 'aise', 'waisa', 'waise',
  'kaam', 'ghar', 'paisa', 'paise', 'waqt', 'pani', 'chai',
  'bas', 'sirf',
  'jugaar', 'chakkar', 'lafda', 'yara'
];

// Build regex matching word boundaries
const URDU_PATTERN = new RegExp(
  '\\b(' + ROMAN_URDU_WORDS.join('|') + ')\\b',
  'gi'
);

const MIN_URDU_HITS = 2;

/**
 * detectLanguage(message) → 'urdu' | 'english'
 *
 * Lightweight heuristic: counts how many distinct Roman Urdu keywords
 * appear in the message. If ≥ MIN_URDU_HITS → 'urdu', else 'english'.
 */
function detectLanguage(message) {
  if (!message || typeof message !== 'string') return 'english';

  const hits = message.match(URDU_PATTERN);
  if (hits && hits.length >= MIN_URDU_HITS) {
    return 'urdu';
  }
  return 'english';
}

module.exports = { detectLanguage };
