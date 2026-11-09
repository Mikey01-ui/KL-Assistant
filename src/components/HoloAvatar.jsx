import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * HoloAvatar — Authentic 3D Holographic Human Figure
 * Anchored to the bottom of the HUD, standing in full height with natural
 * proportions, clean margin so no limbs get cut off, with an animated
 * holographic floor ring emitter.
 */

export default function HoloAvatar({ weather, className = '' }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Generous canvas width & height so rotating arms and head never clip
    const width = 360;
    const height = 560;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    // Camera positioned with enough distance and slightly elevated
    camera.position.set(0, 0.05, 3.8);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // 2. Holographic Cinematic Lighting
    const ambientLight = new THREE.AmbientLight(0x00f0ff, 1.8);
    scene.add(ambientLight);

    const cyanPointLight = new THREE.PointLight(0x00f0ff, 3.2, 10);
    cyanPointLight.position.set(0, 1.2, 2.0);
    scene.add(cyanPointLight);

    const tealRimLight = new THREE.PointLight(0x01a79c, 2.8, 10);
    tealRimLight.position.set(0, -1.0, -1.5);
    scene.add(tealRimLight);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // 3. Holographic Floor Projection Ring Emitter
    const floorEmitter = new THREE.Group();
    // Position floor ring just below feet
    floorEmitter.position.y = -1.25;

    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.5,
      wireframe: true,
    });
    const ringGeo1 = new THREE.RingGeometry(0.38, 0.60, 32);
    const ringMesh1 = new THREE.Mesh(ringGeo1, ringMat1);
    ringMesh1.rotation.x = -Math.PI / 2;
    floorEmitter.add(ringMesh1);

    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0x01a79c,
      transparent: true,
      opacity: 0.8,
      wireframe: true,
    });
    const ringGeo2 = new THREE.RingGeometry(0.20, 0.35, 24);
    const ringMesh2 = new THREE.Mesh(ringGeo2, ringMat2);
    ringMesh2.rotation.x = -Math.PI / 2;
    floorEmitter.add(ringMesh2);

    rootGroup.add(floorEmitter);

    // 4. Load the 3D Holographic Model
    const loader = new GLTFLoader();

    loader.load(
      '/models/holographic_module.glb',
      (gltf) => {
        const model = gltf.scene;
        let humanMesh = null;

        // Isolate the human body (Object_5 / Object_3) and hide solid floor box
        model.traverse((child) => {
          if (child.isMesh) {
            if (child.name === 'Object_5') {
              humanMesh = child;
              child.visible = true;

              if (child.material) {
                child.material.transparent = true;
                child.material.depthWrite = false;
                child.material.blending = THREE.AdditiveBlending;
                if (child.material.emissive) {
                  child.material.emissive.setHex(0x00f0ff);
                  child.material.emissiveIntensity = 2.4;
                }
              }
            } else {
              // Hide solid floor blocks completely
              child.visible = false;
            }
          }
        });

        // Compute bounds specifically for the human body
        const targetObj = humanMesh || model;
        const box = new THREE.Box3().setFromObject(targetObj);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // Scale to comfortably fit within 2.3 units so arms never touch canvas edges
        const scale = 2.3 / (size.y || 1);
        model.scale.setScalar(scale);

        // Center human so feet rest on emitter at -1.25 and head is around +1.05
        model.position.x = -center.x * scale;
        model.position.y = -center.y * scale - 0.10;
        model.position.z = -center.z * scale;

        rootGroup.add(model);
      },
      undefined,
      (err) => {
        console.error('Error loading 3D holographic human:', err);
      }
    );

    // 5. Animation Loop
    let animId;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Smooth elegant 3D turntable spin of the human body
      rootGroup.rotation.y = elapsedTime * 0.4;

      // Rotating projector rings
      ringMesh1.rotation.z = elapsedTime * 0.25;
      ringMesh2.rotation.z = -elapsedTime * 0.45;

      // Subtle breathing levitation float
      rootGroup.position.y = Math.sin(elapsedTime * 1.6) * 0.02;

      // Subtle atmospheric holographic pulse
      cyanPointLight.intensity = 2.8 + Math.sin(elapsedTime * 3.5) * 0.5;

      renderer.render(scene, camera);
    };

    animate();

    // Cleanup on unmount
    return () => {
      cancelAnimationFrame(animId);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div className={`holo-figure-container ${className}`}>
      <div className="holo-avatar-stage" ref={mountRef} />
    </div>
  );
}
