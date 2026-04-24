'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';

/**
 * PanoramaViewer — fullscreen interactive 360° panorama viewer.
 * Uses Three.js to render an equirectangular image mapped onto the
 * inside of a sphere. Supports mouse/touch drag to look around and
 * scroll/pinch to zoom.
 *
 * @param {string}   url      - URL of the equirectangular panorama image
 * @param {string}   unitId   - Unit identifier to display as label
 * @param {Function} onClose  - Callback to close the viewer
 */
export default function PanoramaViewer({ url, unitId, onClose }) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rafRef = useRef(null);
  const isDraggingRef = useRef(false);
  const prevMouseRef = useRef({ x: 0, y: 0 });
  const lonRef = useRef(0);
  const latRef = useRef(0);
  const fovRef = useRef(75);
  const velocityRef = useRef({ lon: 0, lat: 0 });
  const touchDistRef = useRef(0);

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { setMounted(true); }, []);

  // ─── Three.js setup ───
  useEffect(() => {
    if (!mounted || !containerRef.current || !url) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1100);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Sphere geometry (inside-out)
    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1); // Flip to render inside

    // Load texture
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
        setLoading(false);
      },
      undefined,
      (err) => {
        console.error('[PanoramaViewer] Texture load error:', err);
        setError('No se pudo cargar la imagen panorámica');
        setLoading(false);
      }
    );

    // Animation loop
    function animate() {
      rafRef.current = requestAnimationFrame(animate);

      // Apply inertia when not dragging
      if (!isDraggingRef.current) {
        lonRef.current += velocityRef.current.lon;
        latRef.current += velocityRef.current.lat;
        velocityRef.current.lon *= 0.95;
        velocityRef.current.lat *= 0.95;
      }

      // Clamp latitude
      latRef.current = Math.max(-85, Math.min(85, latRef.current));

      // Update camera
      const phi = THREE.MathUtils.degToRad(90 - latRef.current);
      const theta = THREE.MathUtils.degToRad(lonRef.current);
      camera.position.x = 0;
      camera.position.y = 0;
      camera.position.z = 0;
      const target = new THREE.Vector3(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
      );
      camera.lookAt(target);
      camera.fov = fovRef.current;
      camera.updateProjectionMatrix();

      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    function handleResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      renderer.dispose();
      geometry.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [mounted, url]);

  // ─── Mouse interaction ───
  const handlePointerDown = useCallback((e) => {
    isDraggingRef.current = true;
    prevMouseRef.current = { x: e.clientX, y: e.clientY };
    velocityRef.current = { lon: 0, lat: 0 };
  }, []);

  const handlePointerMove = useCallback((e) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - prevMouseRef.current.x;
    const dy = e.clientY - prevMouseRef.current.y;
    const moveLon = -dx * 0.15;
    const moveLat = dy * 0.15;
    lonRef.current += moveLon;
    latRef.current += moveLat;
    velocityRef.current = { lon: moveLon, lat: moveLat };
    prevMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // ─── Scroll zoom ───
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    fovRef.current = Math.max(30, Math.min(110, fovRef.current + e.deltaY * 0.05));
  }, []);

  // ─── Touch interaction ───
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      isDraggingRef.current = true;
      prevMouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      velocityRef.current = { lon: 0, lat: 0 };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchDistRef.current = Math.sqrt(dx * dx + dy * dy);
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    e.preventDefault();
    if (e.touches.length === 1 && isDraggingRef.current) {
      const dx = e.touches[0].clientX - prevMouseRef.current.x;
      const dy = e.touches[0].clientY - prevMouseRef.current.y;
      const moveLon = -dx * 0.2;
      const moveLat = dy * 0.2;
      lonRef.current += moveLon;
      latRef.current += moveLat;
      velocityRef.current = { lon: moveLon, lat: moveLat };
      prevMouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = touchDistRef.current - dist;
      fovRef.current = Math.max(30, Math.min(110, fovRef.current + delta * 0.1));
      touchDistRef.current = dist;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // ─── Overlay close: only if mousedown AND mouseup both on overlay bg ───
  const overlayMouseDownTarget = useRef(null);

  const handleOverlayMouseDown = useCallback((e) => {
    e.stopPropagation();
    overlayMouseDownTarget.current = e.target;
  }, []);

  const handleOverlayMouseUp = useCallback((e) => {
    e.stopPropagation();
    if (
      e.target === e.currentTarget &&
      overlayMouseDownTarget.current === e.currentTarget
    ) {
      onClose?.();
    }
    overlayMouseDownTarget.current = null;
  }, [onClose]);

  // ─── Keyboard: Escape to close ───
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="pano-overlay" onMouseDown={handleOverlayMouseDown} onMouseUp={handleOverlayMouseUp} onClick={(e) => e.stopPropagation()}>
      {/* Header bar */}
      <div className="pano-header">
        <div className="pano-label">
          <span className="pano-label-icon">🌐</span>
          <span className="pano-label-text">Unidad {unitId || '—'}</span>
        </div>
        <button className="pano-close" onClick={onClose} title="Cerrar (Esc)">✕</button>
      </div>

      {/* Canvas container */}
      <div
        className="pano-canvas"
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: isDraggingRef.current ? 'grabbing' : 'grab' }}
      />

      {/* Loading state */}
      {loading && (
        <div className="pano-loading">
          <div className="pano-spinner" />
          <span>Cargando panorama…</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="pano-loading">
          <span>❌ {error}</span>
        </div>
      )}

      {/* Hint */}
      {!loading && !error && (
        <div className="pano-hint">Arrastrá para explorar · Scroll para zoom</div>
      )}
    </div>,
    document.body
  );
}
