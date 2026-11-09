import React, { useEffect, useMemo, useRef } from 'react';
import { bus } from '../audio/audioBus';

const toRad = (deg) => ((deg - 90) * Math.PI) / 180;

function arcPath(r, startDeg, endDeg) {
  const x1 = r * Math.cos(toRad(startDeg));
  const y1 = r * Math.sin(toRad(startDeg));
  const x2 = r * Math.cos(toRad(endDeg));
  const y2 = r * Math.sin(toRad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function segments(r, fromDeg, toDeg, count, gapDeg) {
  const span = (toDeg - fromDeg) / count;
  return Array.from({ length: count }, (_, i) => {
    const a0 = fromDeg + i * span;
    return arcPath(r, a0, a0 + span - gapDeg);
  });
}

function ticks(count, rInner, rOuter, majorEvery, majorExtra) {
  return Array.from({ length: count }, (_, i) => {
    const a = toRad((360 / count) * i);
    const outer = i % majorEvery === 0 ? rOuter + majorExtra : rOuter;
    return {
      x1: rInner * Math.cos(a), y1: rInner * Math.sin(a),
      x2: outer * Math.cos(a), y2: outer * Math.sin(a),
      major: i % majorEvery === 0,
    };
  });
}

// Mic RMS above this counts as the user talking.
const MIC_GATE = 0.035;

const PALETTES = {
  jarvis: ['rgba(53,214,255,0.9)', 'rgba(159,240,255,0.8)', 'rgba(255,255,255,0.85)', 'rgba(255,176,32,0.55)'],
  user: ['rgba(125,255,176,0.9)', 'rgba(200,255,225,0.8)', 'rgba(255,255,255,0.85)', 'rgba(53,214,255,0.5)'],
  idle: ['rgba(53,214,255,0.7)', 'rgba(159,240,255,0.5)', 'rgba(255,255,255,0.4)', 'rgba(53,214,255,0.35)'],
};

function rms(analyser, buf) {
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

// The wave canvas extends past the reactor so rings can ripple outside it.
const CANVAS_SPAN = 700;
const RING_POINTS = 80;

function drawFrame(canvas, t, mode, level, freq) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const s = W / CANVAS_SPAN;
  const cx = W / 2;
  const cy = W / 2;
  const palette = PALETTES[mode];

  g.clearRect(0, 0, W, W);
  if (level <= 0.01) return; // Skip all calculation when idle

  g.globalCompositeOperation = 'lighter';
  const base = 246 * s;
  const layers = 3;

  for (let k = 0; k < layers; k++) {
    const harmonics = [5 + k * 2, 9 + k * 3];
    const dir = k % 2 ? -1 : 1;
    const speed = 1.6 * (1 + k * 0.35);

    g.strokeStyle = palette[k];
    g.lineWidth = (k === 0 ? 2 : 1.3) * s;
    g.beginPath();

    for (let i = 0; i <= RING_POINTS; i++) {
      const a = (i / RING_POINTS) * Math.PI * 2;
      const mirror = i <= RING_POINTS / 2 ? i : RING_POINTS - i;
      const bin = 2 + Math.floor(Math.pow(mirror / (RING_POINTS / 2), 1.3) * 70) + k * 4;
      const v = freq ? freq[bin] / 255 : 0;
      const ripple =
        0.5 + 0.5 * Math.sin(a * harmonics[0] + t * speed * dir + k) *
        (0.6 + 0.4 * Math.sin(a * harmonics[1] - t * speed * 0.7));
      const d = level * (10 + v * 46) * ripple * s + level * v * 12 * s;
      const r = base + k * 4 * s + d;
      const x = cx + Math.cos(a - Math.PI / 2) * r;
      const y = cy + Math.sin(a - Math.PI / 2) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.stroke();
  }

  g.globalCompositeOperation = 'source-over';
}

/**
 * Animated arc-reactor orb. Draws voice waves from the shared audio bus:
 * Jarvis's speech when TTS plays, otherwise the user's mic above a noise gate.
 */
function ArcReactorComponent({ state = 'idle', cornerMode = false, className = '' }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);

  const geo = useMemo(() => ({
    band: segments(178, -40, 230, 54, 1.2),
    bandInner: segments(150, 200, 330, 18, 2),
    outerTicks: ticks(180, 214, 222, 10, 8),
    innerTicks: ticks(72, 128, 134, 6, 5),
    orange: arcPath(196, 250, 300),
    orangeInner: arcPath(160, 100, 130),
    dots: [-18, -9, 0, 9, 18].map((d) => {
      const a = toRad(d);
      return { x: 196 * Math.cos(a), y: 196 * Math.sin(a) };
    }),
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return undefined;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(root.clientWidth * (CANVAS_SPAN / 500) * dpr);
      canvas.height = canvas.width;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);

    const timeBuf = new Uint8Array(1024);
    const freqBuf = new Uint8Array(512);
    let raf;
    let smooth = 0;
    let lastMode = '';

    const loop = (now) => {
      const t = now / 1000;
      let mode = 'idle';
      let target = 0;
      let freq = null;

      if (bus.ttsActive && bus.tts) {
        mode = 'jarvis';
        target = Math.min(1, rms(bus.tts, timeBuf) * 4);
        bus.tts.getByteFrequencyData(freqBuf);
        freq = freqBuf;
      } else if (bus.mic) {
        const micLevel = rms(bus.mic, timeBuf);
        if (micLevel > MIC_GATE) {
          mode = 'user';
          target = Math.min(1, (micLevel - MIC_GATE) * 6);
          bus.mic.getByteFrequencyData(freqBuf);
          freq = freqBuf;
        }
      }

      smooth += (target - smooth) * (target > smooth ? 0.35 : 0.08);
      if (mode !== lastMode) {
        root.dataset.voice = mode;
        lastMode = mode;
      }
      drawFrame(canvas, t, smooth > 0.02 ? mode : 'idle', smooth, freq);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`reactor reactor--${state} ${cornerMode ? 'is-corner-mode' : ''} ${className}`}
      data-voice="idle"
    >
      <svg className="reactor-svg" viewBox="-250 -250 500 500" aria-hidden="true">
        <defs>
          <radialGradient id="reactorCore" r="50%">
            <stop offset="0%" stopColor="#bff6ff" stopOpacity="0.55" />
            <stop offset="40%" stopColor="#35d6ff" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#021019" stopOpacity="0" />
          </radialGradient>
          <filter id="reactorGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g filter="url(#reactorGlow)">
          <g className="ring ring-outer">
            <circle r="238" className="stroke-thin" strokeDasharray="2 6" />
            <circle r="230" className="stroke-faint" />
            <path d={arcPath(238, 20, 80)} className="stroke-bright" strokeWidth="3" />
            <path d={arcPath(238, 200, 240)} className="stroke-bright" strokeWidth="3" />
          </g>

          <g className="ring ring-ticks">
            {geo.outerTicks.map((t, i) => (
              <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                className={t.major ? 'tick tick-major' : 'tick'} />
            ))}
          </g>

          <g className="ring ring-orange">
            <path d={geo.orange} className="stroke-orange" strokeWidth="4" strokeLinecap="round" />
            {geo.dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r="3" className="fill-orange" />)}
          </g>

          <g className="ring ring-band">
            {geo.band.map((d, i) => (
              <path key={i} d={d} className="band-seg" strokeWidth="30"
                style={{ animationDelay: `${(i % 9) * 0.12}s` }} />
            ))}
          </g>

          <g className="ring ring-band-inner">
            {geo.bandInner.map((d, i) => <path key={i} d={d} className="band-seg-inner" strokeWidth="8" />)}
            <path d={geo.orangeInner} className="stroke-orange" strokeWidth="3" />
          </g>

          <g className="ring ring-inner">
            <circle r="138" className="stroke-bright" strokeWidth="1.5" />
            {geo.innerTicks.map((t, i) => (
              <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                className={t.major ? 'tick tick-major' : 'tick'} />
            ))}
          </g>

          <g className="ring ring-core-dash">
            <circle r="116" className="stroke-thin" strokeDasharray="14 8" />
          </g>

          <circle r="104" className="core-disc" />
          <circle r="104" fill="url(#reactorCore)" className="core-glow" />
          <circle r="104" className="stroke-bright core-edge" strokeWidth="2" />

          {/* Center KL Brand Mark */}
          <g className="core-brand" pointerEvents="none">
            <text
              x="0"
              y="0"
              textAnchor="middle"
              dominantBaseline="central"
              className="core-brand-text"
            >
              <tspan className="core-brand-k">K</tspan>
              <tspan className="core-brand-l" dx="6">L</tspan>
            </text>
          </g>
        </g>
      </svg>

      <canvas ref={canvasRef} className="reactor-waves" />
    </div>
  );
}

export default React.memo(ArcReactorComponent);
