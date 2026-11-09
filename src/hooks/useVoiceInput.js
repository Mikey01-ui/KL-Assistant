import { useCallback, useEffect, useRef, useState } from 'react';
import { startMic, stopMic, bus } from '../audio/audioBus';

/**
 * useVoiceInput — Autonomous hands-free voice engine with real-time Voice Activity Detection (VAD).
 * Continuously monitors ambient mic level, detects user speech, records automatically,
 * detects end-of-phrase silence, and dispatches to Gemini/Groq STT without clicking.
 */
export function useVoiceInput({
  paused = false,
  autoListen = true,
  onFinal,
  onStatus,
  onBargeIn,
} = {}) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'listening' | 'recording' | 'transcribing' | 'paused'
  const isListeningRef = useRef(false);
  const isRecordingRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const silenceTimerRef = useRef(null);
  const speechStartRef = useRef(0);
  const vadIntervalRef = useRef(null);
  const streamRef = useRef(null);

  const onFinalRef = useRef(onFinal);
  const onStatusRef = useRef(onStatus);
  const onBargeInRef = useRef(onBargeIn);
  const pausedRef = useRef(paused);
  const transcribeInFlightRef = useRef(false);
  const pendingRecordingRef = useRef(null);

  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);
  useEffect(() => { onBargeInRef.current = onBargeIn; }, [onBargeIn]);

  const updateStatus = useCallback((s) => {
    setStatus(s);
    onStatusRef.current?.(s);
  }, []);

  useEffect(() => {
    pausedRef.current = paused;
    if (paused && isListeningRef.current) {
      updateStatus('paused');
    } else if (!paused && isListeningRef.current) {
      updateStatus('listening');
    }
  }, [paused, updateStatus]);

  // Process and transcribe a recorded speech segment
  const processRecording = useCallback(async (chunks, mimeType) => {
    if (!chunks || chunks.length === 0) {
      if (isListeningRef.current) updateStatus('listening');
      return;
    }

    if (transcribeInFlightRef.current) {
      pendingRecordingRef.current = { chunks, mimeType };
      if (isListeningRef.current && !pausedRef.current) updateStatus('listening');
      return;
    }

    updateStatus('transcribing');
    transcribeInFlightRef.current = true;
    try {
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      const arrayBuffer = await blob.arrayBuffer();

      // Only transcribe if audio payload is sufficient (> 2KB)
      if (arrayBuffer.byteLength > 2000 && window.electronAPI?.transcribeAudio) {
        const ipcText = await window.electronAPI.transcribeAudio(arrayBuffer, blob.type).catch(() => '');
        const cleanText = String(ipcText || '').trim();
        if (cleanText && cleanText.length >= 2) {
          onFinalRef.current?.(cleanText);
        }
      }
    } catch (err) {
      console.warn('[Voice VAD] Transcription error:', err?.message || err);
    } finally {
      transcribeInFlightRef.current = false;
      const pending = pendingRecordingRef.current;
      pendingRecordingRef.current = null;
      if (pending?.chunks?.length) {
        queueMicrotask(() => processRecording(pending.chunks, pending.mimeType));
      }
      if (pausedRef.current) {
        updateStatus('paused');
      } else if (isListeningRef.current) {
        updateStatus('listening');
      } else {
        updateStatus('idle');
      }
    }
  }, [updateStatus]);

  // Start active recording segment upon detecting voice
  const startRecordingSegment = useCallback(() => {
    if (isRecordingRef.current || !streamRef.current || pausedRef.current) return;

    try {
      audioChunksRef.current = [];
      const stream = streamRef.current;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const chunks = [...audioChunksRef.current];
        audioChunksRef.current = [];
        const type = recorder.mimeType;
        mediaRecorderRef.current = null;
        isRecordingRef.current = false;
        processRecording(chunks, type);
      };

      recorder.start(100);
      isRecordingRef.current = true;
      speechStartRef.current = Date.now();
      updateStatus('recording');

    } catch (e) {
      console.error('[Voice VAD] Failed to start recorder:', e);
      isRecordingRef.current = false;
    }
  }, [processRecording, updateStatus]);

  // Stop recording segment upon silence detection
  const finishRecordingSegment = useCallback(() => {
    if (!isRecordingRef.current) return;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (e) {
        console.warn('[Voice VAD] Stop error:', e);
      }
    } else {
      isRecordingRef.current = false;
    }
  }, []);

  // Cancel transient noise recording without transcription
  const cancelRecordingSegment = useCallback(() => {
    if (!isRecordingRef.current) return;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    audioChunksRef.current = [];
    isRecordingRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.onstop = null;
        recorder.stop();
      } catch (_) {}
    }
    mediaRecorderRef.current = null;
    if (isListeningRef.current && !pausedRef.current) {
      updateStatus('listening');
    } else {
      updateStatus('idle');
    }
  }, [updateStatus]);

  // Continuous VAD loop inspecting real-time mic energy
  const startVadLoop = useCallback((analyser) => {
    if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);

    const timeBuf = new Uint8Array(analyser.fftSize || 1024);
    let noiseFloor = 0.010;
    const SPEECH_THRESHOLD = 0.030;
    const MIN_SPEECH_DURATION = 350; // ms
    const SILENCE_TIMEOUT = 950; // ms of silence to conclude sentence (allows natural pauses)

    vadIntervalRef.current = setInterval(() => {
      analyser.getByteTimeDomainData(timeBuf);
      let sum = 0;
      for (let i = 0; i < timeBuf.length; i++) {
        const norm = (timeBuf[i] - 128) / 128;
        sum += norm * norm;
      }
      const rms = Math.sqrt(sum / timeBuf.length);

      // Adaptive noise floor tracking
      if (rms < SPEECH_THRESHOLD) {
        noiseFloor = noiseFloor * 0.95 + rms * 0.05;
      }
      const currentGate = Math.max(SPEECH_THRESHOLD, noiseFloor * 1.8);

      // Intentional voice near mic triggers barge-in without laptop speaker self-echo
      const BARGE_IN_THRESHOLD = 0.16;
      if (rms > currentGate) {
        if (pausedRef.current) {
          if (rms > BARGE_IN_THRESHOLD) {
            onBargeInRef.current?.();
            pausedRef.current = false;
            startRecordingSegment();
          }
          return;
        }
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }

        if (!isRecordingRef.current) {
          startRecordingSegment();
        }
      } else {
        // Ambient silence
        if (isRecordingRef.current) {
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              const speechDuration = Date.now() - speechStartRef.current;
              if (speechDuration >= MIN_SPEECH_DURATION) {
                finishRecordingSegment();
              } else {
                cancelRecordingSegment();
              }
            }, SILENCE_TIMEOUT);
          }
        }
      }
    }, 40);
  }, [cancelRecordingSegment, finishRecordingSegment, startRecordingSegment]);

  // Main listener starter
  const start = useCallback(async () => {
    if (isListeningRef.current && streamRef.current) return;

    try {
      const { stream, analyser } = await startMic();
      streamRef.current = stream;
      isListeningRef.current = true;
      updateStatus('listening');
      startVadLoop(analyser);
    } catch (err) {
      console.error('[Voice VAD] Mic open failed:', err);
      isListeningRef.current = false;
      updateStatus(err.name === 'NotAllowedError' ? 'error_no_microphone' : 'idle');
    }
  }, [startVadLoop, updateStatus]);

  const stop = useCallback(() => {
    isListeningRef.current = false;
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
    isRecordingRef.current = false;
    stopMic();
    streamRef.current = null;
    updateStatus('idle');
  }, [updateStatus]);

  // Automatically start listening on mount if autoListen is enabled
  useEffect(() => {
    if (autoListen) {
      start();
    }
    return () => {
      stop();
    };
  }, [autoListen, start, stop]);

  // When paused state changes (e.g. AI is speaking), pause VAD
  useEffect(() => {
    if (paused) {
      if (isRecordingRef.current) {
        finishRecordingSegment();
      }
    }
  }, [paused, finishRecordingSegment]);

  return {
    status,
    start,
    stop,
    isListening: isListeningRef.current,
    isRecording: isRecordingRef.current,
  };
}
