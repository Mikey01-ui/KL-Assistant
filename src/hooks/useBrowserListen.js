/**
 * Browser speech recognition — push-to-talk style.
 * Auto continuous listen caused glitches (restarts + echo). User taps MIC / orb to talk.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudioContext, stopMic } from '../audio/audioBus';

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function useBrowserListen({
  paused = false,
  onFinal,
  onStatus,
  lang = 'en-US',
} = {}) {
  const [status, setStatus] = useState('idle');
  const recRef = useRef(null);
  const activeRef = useRef(false);
  const pausedRef = useRef(paused);
  const onFinalRef = useRef(onFinal);
  const onStatusRef = useRef(onStatus);
  const lastSentRef = useRef('');
  const lastSentAtRef = useRef(0);

  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const setBoth = useCallback((s) => {
    setStatus(s);
    onStatusRef.current?.(s);
  }, []);

  const hardStop = useCallback(() => {
    activeRef.current = false;
    const rec = recRef.current;
    if (!rec) return;
    try { rec.onend = null; } catch {}
    try { rec.onresult = null; } catch {}
    try { rec.onerror = null; } catch {}
    try { rec.stop(); } catch {}
    try { rec.abort(); } catch {}
    recRef.current = null;
  }, []);

  const startListening = useCallback(() => {
    if (pausedRef.current) {
      setBoth('paused');
      return;
    }

    stopMic();
    try { getAudioContext().resume(); } catch {}

    const SR = getSpeechRecognition();
    if (!SR) {
      setBoth('unavailable');
      return;
    }

    // Always recreate for clean state (avoids Electron glitch loops)
    hardStop();

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.lang = lang;

    rec.onstart = () => setBoth('listening');
    rec.onspeechstart = () => setBoth('recording');

    rec.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) {
          text += event.results[i][0]?.transcript || '';
        }
      }
      text = text.trim();
      if (!text) return;

      const now = Date.now();
      if (text === lastSentRef.current && now - lastSentAtRef.current < 2000) return;
      lastSentRef.current = text;
      lastSentAtRef.current = now;
      onFinalRef.current?.(text);
    };

    rec.onerror = (event) => {
      activeRef.current = false;
      const err = event.error || 'error';
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setBoth('error_no_microphone');
        return;
      }
      if (err === 'aborted' || err === 'no-speech') {
        setBoth('idle');
        return;
      }
      setBoth(`error_${err}`);
    };

    rec.onend = () => {
      activeRef.current = false;
      recRef.current = null;
      setBoth('idle');
    };

    recRef.current = rec;
    activeRef.current = true;
    try {
      rec.start();
      setBoth('listening');
    } catch (e) {
      activeRef.current = false;
      recRef.current = null;
      setBoth('idle');
    }
  }, [hardStop, lang, setBoth]);

  useEffect(() => {
    if (paused && activeRef.current) {
      hardStop();
      setBoth('paused');
    }
  }, [paused, hardStop, setBoth]);

  useEffect(() => () => hardStop(), [hardStop]);

  return { status, start: startListening, stop: hardStop };
}
