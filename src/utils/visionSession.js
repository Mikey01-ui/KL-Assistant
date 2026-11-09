/**
 * Bridge between useAI (asks for a frame) and CameraVisionPanel (owns the webcam).
 */

const OPEN = 'jarvis:vision-open';
const CLOSE = 'jarvis:vision-close';
const FRAME = 'jarvis:vision-frame';
const ERROR = 'jarvis:vision-error';
const READY = 'jarvis:vision-ready';

export function openVisionPanel(detail = {}) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail }));
}

export function closeVisionPanel(detail = { keepAlive: true }) {
  window.dispatchEvent(new CustomEvent(CLOSE, { detail }));
}

/**
 * Open/reuse the camera panel and wait for one JPEG frame.
 * Does not use the chat AbortSignal — overlapping STT must not kill capture.
 */
export function captureVisionFrame({ settleMs = 280, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener(FRAME, onFrame);
      window.removeEventListener(ERROR, onError);
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      clearTimeout(timer);
      fn(value);
    };

    const onFrame = (e) => {
      const { base64, mimeType } = e.detail || {};
      if (!base64) {
        finish(reject, new Error('Empty camera frame'));
        return;
      }
      finish(resolve, { base64, mimeType: mimeType || 'image/jpeg' });
    };

    const onError = (e) => {
      finish(reject, new Error(e.detail?.message || 'Camera failed'));
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('Camera timed out'));
    }, timeoutMs);

    window.addEventListener(FRAME, onFrame);
    window.addEventListener(ERROR, onError);
    openVisionPanel({ settleMs, keepAlive: true });
  });
}

export const VISION_EVENTS = { OPEN, CLOSE, FRAME, ERROR, READY };
