/**
 * Shared audio graph: Mic & TTS analysers for the ArcReactor orb.
 */

let ctx = null;
let activeTtsSource = null;

export const bus = {
  mic: null,
  tts: null,
  ttsActive: false,
  micError: null,
  micStream: null,
  micSourceNode: null,
};

export function getAudioContext() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();
  }
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

function makeAnalyser(audioCtx) {
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  return analyser;
}

export async function startMic() {
  if (bus.mic && bus.micStream?.active) {
    return { stream: bus.micStream, analyser: bus.mic };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const audioCtx = getAudioContext();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    const analyser = makeAnalyser(audioCtx);
    const sourceNode = audioCtx.createMediaStreamSource(stream);
    sourceNode.connect(analyser);

    bus.mic = analyser;
    bus.micStream = stream;
    bus.micSourceNode = sourceNode;
    bus.micError = null;

    return { stream, analyser };
  } catch (err) {
    bus.micError = err.message || String(err);
    stopMic();
    throw err;
  }
}

export function stopMic() {
  try {
    bus.micSourceNode?.disconnect();
  } catch {}
  try {
    bus.micStream?.getTracks?.().forEach((t) => t.stop());
  } catch {}
  bus.micSourceNode = null;
  bus.micStream = null;
  bus.mic = null;
}

/**
 * Returns an analyser wired to destination.
 */
export function getTtsAnalyser() {
  if (!bus.tts) {
    const audioCtx = getAudioContext();
    bus.tts = makeAnalyser(audioCtx);
    bus.tts.connect(audioCtx.destination);
  }
  return bus.tts;
}

/**
 * Plays raw TTS audio buffer (WAV or MP3) through Web Audio.
 * Decodes directly in engine without leaking HTMLMediaElement nodes.
 */
let activeTtsCallback = null;

export async function playTtsBuffer(arrayBuffer, onEnded) {
  stopTtsAudio();

  const audioCtx = getAudioContext();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  try {
    // decodeAudioData consumes the buffer, so pass a clone
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const source = audioCtx.createBufferSource();
    source.buffer = decoded;

    const analyser = getTtsAnalyser();
    source.connect(analyser);

    activeTtsSource = source;
    activeTtsCallback = onEnded;
    bus.ttsActive = true;

    source.onended = () => {
      const cb = activeTtsCallback;
      activeTtsSource = null;
      activeTtsCallback = null;
      bus.ttsActive = false;
      cb?.();
    };

    source.start(0);
    return source;
  } catch (err) {
    console.error('[audioBus] decode/play failed:', err);
    bus.ttsActive = false;
    activeTtsSource = null;
    activeTtsCallback = null;
    onEnded?.();
    return null;
  }
}

export function stopTtsAudio() {
  const cb = activeTtsCallback;
  const s = activeTtsSource;
  activeTtsSource = null;
  activeTtsCallback = null;
  bus.ttsActive = false;
  if (s) {
    try {
      s.onended = null;
      s.stop();
      s.disconnect();
    } catch {}
  }
  cb?.();
}

if (typeof window !== 'undefined') {
  const resume = () => {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
}
