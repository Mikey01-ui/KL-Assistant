/**
 * SentenceChunker — Splits streaming token deltas into natural sentences
 * for low-latency, real-time Text-To-Speech while LLM generation is in progress.
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'eg', 'ie', 'approx'
]);

export class SentenceChunker {
  constructor(onSentence) {
    this.onSentence = onSentence;
    this.buffer = '';
  }

  push(textDelta) {
    this.buffer += textDelta;

    // Mask completed tool invocations before splitting sentences
    let sanitized = this.buffer.replace(/<<<TOOL:[\s\S]*?>>>/g, '');
    if (sanitized.includes('<<<TOOL:')) {
      // In-progress tool call; wait for closing tag
      return;
    }

    // Sentence boundary: punctuation followed by space or newline
    const sentenceEndRegex = /([.!?\n])\s+/g;
    let lastIndex = 0;
    let match;

    while ((match = sentenceEndRegex.exec(sanitized)) !== null) {
      const candidate = sanitized.slice(lastIndex, match.index + 1).trim();
      const lastWord = candidate.split(/\s+/).pop()?.replace(/[^a-zA-Z]/g, '').toLowerCase() || '';

      // Skip abbreviations or decimal numbers (e.g. 3.14)
      if (ABBREVIATIONS.has(lastWord) || (match.index > 0 && /\d/.test(sanitized[match.index - 1]) && /\d/.test(sanitized[match.index + 1] || ''))) {
        continue;
      }

      if (candidate.length > 2) {
        this.emitCleanSentence(candidate);
        lastIndex = match.index + match[0].length;
      }
    }

    this.buffer = sanitized.slice(lastIndex);
  }

  flush() {
    let remaining = this.buffer
      .replace(/<<<TOOL:[\s\S]*?>>>/g, '')
      .replace(/<<<TOOL:[\s\S]*$/g, '')
      .trim();

    if (remaining.length > 0) {
      this.emitCleanSentence(remaining);
    }
    this.buffer = '';
  }

  reset() {
    this.buffer = '';
  }

  emitCleanSentence(sentence) {
    const clean = sentence
      .replace(/[*_#>`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean && clean !== 'Executing...') {
      this.onSentence(clean);
    }
  }
}
