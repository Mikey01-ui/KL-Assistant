import React, { useCallback, useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useHudDismiss } from '../hooks/useHudDismiss';

/**
 * SystemMonitorWidget — 3D Holographic Projected System Diagnostics
 * Features:
 *  - 3D Pedestal with rotating glowing cyber rings and emitter lens
 *  - Real spinning 3D PC model loaded from /models/pc_gamer_animation.glb with built-in fan/RGB animations
 *  - Conical volumetric holographic projection beam
 *  - Floating holographic screen displaying live UpTime, CPU, RAM, Storage & Network
 */

export default function SystemMonitorWidget({ pollInterval = 4000 }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [stats, setStats] = useState(null);

  const mountRef = useRef(null);
  const threeRef = useRef(null);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setExiting(false);
    }, 400);
  }, []);

  useHudDismiss('system', dismiss);

  useEffect(() => {
    const onSystem = (e) => {
      setExiting(false);
      setVisible(true);
      if (e?.detail?.stats) setStats(e.detail.stats);
      setTimeout(() => {
        window.electronAPI?.captureSnapshot?.();
      }, 900);
    };
    window.addEventListener('jarvis:system', onSystem);
    return () => window.removeEventListener('jarvis:system', onSystem);
  }, []);

  // Poll system stats while visible
  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const data = await window.electronAPI?.getSystemStats?.();
        if (alive && data) setStats(data);
      } catch {}
    };
    tick();
    const id = setInterval(tick, pollInterval);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [visible, pollInterval]);

  // Auto-dismiss after speech ends
  useEffect(() => {
    if (!visible) return undefined;
    let timer = null;
    const onTtsDone = () => {
      timer = setTimeout(() => {
        dismiss();
      }, 7000);
    };
    window.addEventListener('jarvis:tts-finished', onTtsDone);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('jarvis:tts-finished', onTtsDone);
    };
  }, [visible, dismiss]);

  // --- Three.js 3D Projector Scene ---
  useEffect(() => {
    if (!visible || !mountRef.current) return;

    const container = mountRef.current;
    const width = 210;
    const height = 230;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(0, 0.2, 3.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    // Balanced realistic studio lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(2.5, 3.5, 3.0);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xf1f5f9, 1.2);
    fillLight.position.set(-2.5, 1.5, 2.0);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.0);
    rimLight.position.set(-1.0, 2.0, -2.5);
    scene.add(rimLight);

    // Turntable Rig for Model
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    let mixer = null;
    let animId = null;
    let isDisposed = false;

    // Load 3D PC Model
    const loader = new GLTFLoader();
    loader.load(
      '/models/pc_gamer_animation.glb',
      (gltf) => {
        if (isDisposed) return;
        const pcModel = gltf.scene;

        // Auto-scale & center bounding box
        const box = new THREE.Box3().setFromObject(pcModel);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const targetScale = 1.55 / maxDim;
        pcModel.scale.setScalar(targetScale);
        pcModel.position.x = -center.x * targetScale;
        pcModel.position.y = -center.y * targetScale;
        pcModel.position.z = -center.z * targetScale;

        // Preserve authentic PBR materials; only make side glass panel transparent
        pcModel.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            const name = (child.name || '').toLowerCase();
            const matName = (child.material?.name || '').toLowerCase();
            const isGlass = name.includes('glass') || name.includes('panel') || name.includes('window') ||
                            matName.includes('glass') || matName.includes('window') || child.material?.transparent;

            if (isGlass && child.material) {
              child.material = child.material.clone();
              child.material.transparent = true;
              child.material.opacity = 0.22;
              child.material.roughness = 0.05;
              child.material.metalness = 0.1;
              child.material.depthWrite = false;
            }
          }
        });

        // Initialize Animation Mixer for fan/RGB animations
        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(pcModel);
          gltf.animations.forEach((clip) => {
            const action = mixer.clipAction(clip);
            action.play();
          });
        }

        modelGroup.add(pcModel);
      },
      undefined,
      (err) => {
        console.warn('Failed to load pc_gamer_animation.glb, fallback geometry active:', err);
        // Fallback procedural mini PC chassis
        const chassisGeo = new THREE.BoxGeometry(0.8, 1.0, 0.4);
        const chassisMat = new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          metalness: 0.9,
          roughness: 0.2,
          wireframe: true,
        });
        const fallbackMesh = new THREE.Mesh(chassisGeo, chassisMat);
        fallbackMesh.position.y = 0.5;
        modelGroup.add(fallbackMesh);
      }
    );

    // Animation Loop
    let lastTime = performance.now();
    const animate = (currentTime) => {
      animId = requestAnimationFrame(animate);
      const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      if (mixer) mixer.update(delta);

      // Smooth continuous turntable spin
      modelGroup.rotation.y += 0.007;

      renderer.render(scene, camera);
    };
    animId = requestAnimationFrame(animate);

    threeRef.current = {
      destroy: () => {
        isDisposed = true;
        if (animId) cancelAnimationFrame(animId);
        if (mixer) {
          mixer.stopAllAction();
          mixer = null;
        }
        scene.traverse((obj) => {
          if (obj.isMesh) {
            obj.geometry?.dispose?.();
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => {
                m.map?.dispose?.();
                m.dispose?.();
              });
            } else if (obj.material) {
              obj.material.map?.dispose?.();
              obj.material.dispose?.();
            }
          }
        });
        renderer.dispose();
        if (container && container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      },
    };

    return () => {
      threeRef.current?.destroy?.();
    };
  }, [visible]);

  if (!visible) return null;

  // Format stats
  const cpuPct = Math.round(Number(stats?.cpu?.usage) || 0);
  const memPct = Math.round(Number(stats?.memory?.usage) || 0);
  const memUsed = stats?.memory?.used || '0.0';
  const memTotal = stats?.memory?.total || '0.0';

  const diskPct = Math.round(Number(stats?.disk?.usage) || 0);
  const diskUsed = stats?.disk?.used || '0';
  const diskTotal = stats?.disk?.total || '0';

  const uptime = stats?.uptime || '0d 0h 0m';
  const downSpeed = stats?.network?.download ?? '0.0';
  const upSpeed = stats?.network?.upload ?? '0.0';

  const formatSpeed = (val) => {
    const n = parseFloat(val) || 0;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} MB/s`;
    return `${Math.round(n)} KB/s`;
  };

  return (
    <div
      className={`holo-sys-wrapper ${exiting ? 'is-exiting' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 3D Model Stage (Left) */}
      <div className="holo-sys-3d-stage">
        <div ref={mountRef} className="holo-sys-canvas-mount" />
      </div>

      {/* Clean Stats Panel (Right) */}
      <div className="holo-sys-projected-card">
        {/* Close Button */}
        <button
          type="button"
          className="holo-sys-close"
          onClick={dismiss}
          title="Dismiss System Monitor"
        >
          ✕
        </button>

        {/* Top Header: UpTime */}
        <div className="holo-sys-uptime-row">
          <span className="holo-sys-label">UpTime:</span>
          <span className="holo-sys-val">{uptime}</span>
        </div>

        {/* Grid: CPU & RAM */}
        <div className="holo-sys-metrics-grid">
          {/* CPU Column */}
          <div className="holo-sys-metric-col">
            <span className="holo-sys-label">CPU Usage</span>
            <span className="holo-sys-big-val">{cpuPct}%</span>
            <div className="holo-sys-minitrack">
              <div className="holo-sys-minifill" style={{ width: `${cpuPct}%` }} />
            </div>
          </div>

          {/* RAM Column */}
          <div className="holo-sys-metric-col">
            <span className="holo-sys-label">RAM</span>
            <span className="holo-sys-big-val">{memPct}%</span>
            <div className="holo-sys-minitrack">
              <div className="holo-sys-minifill" style={{ width: `${memPct}%` }} />
            </div>
            <span className="holo-sys-subdetail">{memUsed} G / {memTotal} G</span>
          </div>
        </div>

        {/* Storage / Disk Row */}
        <div className="holo-sys-disk-row">
          <div className="holo-sys-disk-meta">
            <span className="holo-sys-label">Storage (APFS)</span>
            <span className="holo-sys-val">{diskPct}%</span>
          </div>
          <div className="holo-sys-minitrack">
            <div className="holo-sys-minifill disk" style={{ width: `${diskPct}%` }} />
          </div>
          <div className="holo-sys-disk-sub">
            <span>{diskUsed} GB</span>
            <span className="holo-sys-sep">/</span>
            <span>{diskTotal} GB</span>
          </div>
        </div>

        {/* Network Throughput */}
        <div className="holo-sys-net-row">
          <span>▼ {formatSpeed(downSpeed)}</span>
          <span>▲ {formatSpeed(upSpeed)}</span>
        </div>
      </div>
    </div>
  );
}
