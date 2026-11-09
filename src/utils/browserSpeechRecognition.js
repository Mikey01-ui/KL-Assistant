export function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Live mic transcript while MediaRecorder runs (Electron / Chromium fallback when cloud STT fails). */
export function createRecordingSpeechSession({ lang = 'en-US' } = {}) {
  const SR = getSpeechRecognitionCtor();
  if (!SR) return null;

  let transcript = '';
  let rec = null;

  try {
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.lang = lang;

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0]?.transcript || '';
        }
      }
    };

    rec.onerror = () => {};
    rec.start();
  } catch {
    return null;
  }

  return {
    getTranscript: () => transcript.trim(),
    stop() {
      if (!rec) return;
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.stop();
      } catch {}
      rec = null;
    },
  };
}
