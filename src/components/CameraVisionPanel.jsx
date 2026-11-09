import React, { useCallback, useEffect, useRef, useState } from 'react';
import { VISION_EVENTS } from '../utils/visionSession';

const KEEP_ALIVE_MS = 45000;

/**
 * Webcam preview for Alfred vision.
 * Keeps the stream warm briefly so follow-up asks are fast.
 * Video element stays mounted so getUserMedia can attach reliably.
 */
export default function CameraVisionPanel() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const pendingSettle = useRef(null);
  const captureSent = useRef(false);
  const keepAliveTimer = useRef(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | starting | live | error
  const [error, setError] = useState('');

  const clearKeepAlive = () => {
    if (keepAliveTimer.current) {
      clearTimeout(keepAliveTimer.current);
      keepAliveTimer.current = null;
    }
  };

  const stopStream = useCallback(() => {
    clearKeepAlive();
    if (pendingSettle.current) {
      clearTimeout(pendingSettle.current);
      pendingSettle.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    if (w < 2 || h < 2) return null;
    const maxW = 640;
    const scale = w > maxW ? maxW / w : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    return {
      base64: dataUrl.replace(/^data:image\/jpeg;base64,/, ''),
      mimeType: 'image/jpeg',
    };
  }, []);

  const emitFrameSoon = useCallback(
    (settleMs) => {
      if (pendingSettle.current) clearTimeout(pendingSettle.current);
      captureSent.current = false;
      pendingSettle.current = setTimeout(() => {
        pendingSettle.current = null;
        if (captureSent.current) return;
        const tryCapture = (attemptsLeft) => {
          const frame = captureFrame();
          if (frame) {
            captureSent.current = true;
            window.dispatchEvent(new CustomEvent(VISION_EVENTS.FRAME, { detail: frame }));
            return;
          }
          if (attemptsLeft <= 0) {
            window.dispatchEvent(
              new CustomEvent(VISION_EVENTS.ERROR, {
                detail: { message: 'Could not capture camera frame' },
              })
            );
            return;
          }
          pendingSettle.current = setTimeout(() => tryCapture(attemptsLeft - 1), 120);
        };
        tryCapture(8);
      }, Math.max(80, settleMs));
    },
    [captureFrame]
  );

  const ensureStream = useCallback(async () => {
    clearKeepAlive();
    const existing = streamRef.current;
    if (existing && existing.getVideoTracks().some((t) => t.readyState === 'live')) {
      const video = videoRef.current;
      if (video && video.srcObject !== existing) {
        video.srcObject = existing;
        await video.play().catch(() => {});
      }
      setStatus('live');
      return existing;
    }

    setStatus('starting');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 960 },
        height: { ideal: 540 },
      },
    });
    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      await video.play().catch(() => {});
    }
    setStatus('live');
    return stream;
  }, []);

  useEffect(() => {
    const onOpen = async (e) => {
      const settleMs = e.detail?.settleMs ?? 280;
      setError('');
      setVisible(true);
      window.dispatchEvent(new CustomEvent('jarvis:vision-mode', { detail: { active: true } }));
      try {
        // Wait one frame so the (possibly just-shown) <video> is mounted.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await ensureStream();
        window.dispatchEvent(new CustomEvent(VISION_EVENTS.READY));
        emitFrameSoon(settleMs);
      } catch (err) {
        const message =
          err?.name === 'NotAllowedError'
            ? 'Camera permission denied'
            : err?.message || 'Camera unavailable';
        setError(message);
        setStatus('error');
        window.dispatchEvent(new CustomEvent(VISION_EVENTS.ERROR, { detail: { message } }));
      }
    };

    const onClose = (e) => {
      const keepAlive = e.detail?.keepAlive !== false;
      setVisible(false);
      window.dispatchEvent(new CustomEvent('jarvis:vision-mode', { detail: { active: false } }));
      if (pendingSettle.current) {
        clearTimeout(pendingSettle.current);
        pendingSettle.current = null;
      }
      if (!keepAlive) {
        stopStream();
        setStatus('idle');
        return;
      }
      // Keep hardware warm for quick follow-ups.
      clearKeepAlive();
      keepAliveTimer.current = setTimeout(() => {
        stopStream();
        setStatus('idle');
      }, KEEP_ALIVE_MS);
    };

    window.addEventListener(VISION_EVENTS.OPEN, onOpen);
    window.addEventListener(VISION_EVENTS.CLOSE, onClose);
    return () => {
      window.removeEventListener(VISION_EVENTS.OPEN, onOpen);
      window.removeEventListener(VISION_EVENTS.CLOSE, onClose);
      stopStream();
    };
  }, [emitFrameSoon, ensureStream, stopStream]);

  return (
    <div
      className={`vision-panel${visible ? ' is-visible' : ''}`}
      role="dialog"
      aria-label="Alfred camera"
      aria-hidden={!visible}
      style={{ display: visible ? undefined : 'none' }}
    >
      <div className="vision-panel-chrome">
        <span className="vision-panel-title">OPTICAL FEED</span>
        <span className={`vision-panel-status vision-panel-status--${status}`}>
          {status === 'live' ? 'LIVE' : status === 'starting' ? 'ACQUIRING…' : status === 'error' ? 'FAULT' : ''}
        </span>
        <button
          type="button"
          className="vision-panel-close"
          title="Close camera"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent(VISION_EVENTS.CLOSE, { detail: { keepAlive: false } })
            );
          }}
        >
          ×
        </button>
      </div>
      <div className="vision-panel-stage">
        <video ref={videoRef} className="vision-panel-video" playsInline muted autoPlay />
        {status === 'starting' && <div className="vision-panel-overlay">Engaging camera…</div>}
        {status === 'error' && (
          <div className="vision-panel-overlay vision-panel-overlay--error">{error}</div>
        )}
        <div className="vision-panel-reticle" aria-hidden />
      </div>
      <div className="vision-panel-caption">Analyzing Sir’s view…</div>
    </div>
  );
}
