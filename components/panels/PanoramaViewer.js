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
 * @param {string}        url        - URL of the equirectangular panorama image
 * @param {string}        unitId     - Unit identifier to display as label
 * @param {number}        initialLon - Initial longitude in degrees (0 = center
 *   of the equirectangular image). Used to start the camera pointed at the
 *   unit's compass orientation (computed by the caller). Also serves as the
 *   anchor for the yaw clamp range.
 * @param {number|null}   yawMin     - Horizontal rotation min, in degrees
 *   RELATIVE to initialLon. e.g. yawMin=-45 means the camera can rotate up to
 *   45° left of the opening heading. null = no clamp.
 * @param {number|null}   yawMax     - Horizontal rotation max, in degrees
 *   relative to initialLon. null = no clamp.
 * @param {number}        pitchMin   - Vertical rotation min (degrees, default -85).
 * @param {number}        pitchMax   - Vertical rotation max (degrees, default 85).
 * @param {Function}      onClose    - Callback to close the viewer
 * @param {boolean}       inline     - If true, renders inline (no portal, no
 *   overlay, no header, no ESC handler). The container positions itself like
 *   the 3D viewer canvas — fixed, behind UI panels. Used by the /panoramas
 *   route where the panorama IS the main view, not a modal.
 */
export default function PanoramaViewer({
  url,
  unitId,
  initialLon = 0,
  yawMin = null,
  yawMax = null,
  pitchMin = -85,
  pitchMax = 85,
  onClose,
  inline = false,
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rafRef = useRef(null);
  const isDraggingRef = useRef(false);
  const prevMouseRef = useRef({ x: 0, y: 0 });
  const lonRef = useRef(initialLon);
  const latRef = useRef(0);
  const fovRef = useRef(75);
  const velocityRef = useRef({ lon: 0, lat: 0 });
  const touchDistRef = useRef(0);

  // Anchor for the yaw clamp — captured at mount and never updated, so that
  // changing northOffset live (from the editor) doesn't shift the clamp
  // window out from under the user while they're panning.
  const initialLonRef = useRef(initialLon);

  // Mirror clamp props in refs so the animation loop (effect-scoped closure)
  // picks up live setting changes from the editor without re-initializing.
  const yawMinRef = useRef(yawMin);
  const yawMaxRef = useRef(yawMax);
  const pitchMinRef = useRef(pitchMin);
  const pitchMaxRef = useRef(pitchMax);
  yawMinRef.current = yawMin;
  yawMaxRef.current = yawMax;
  pitchMinRef.current = pitchMin;
  pitchMaxRef.current = pitchMax;

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

      // Yaw clamp (optional) — clamps are RELATIVE to the opening heading
      // (initialLonRef), so yawMin=-45 / yawMax=+45 means ±45° around wherever
      // the camera started. Wrap (lon - initialLon) to [-180, 180] before
      // clamping so the math works across the ±180 seam. Kill horizontal
      // velocity if we hit an edge so inertia doesn't fight it.
      const ymin = yawMinRef.current;
      const ymax = yawMaxRef.current;
      if (ymin != null && ymax != null) {
        const initLon = initialLonRef.current;
        const rel = ((lonRef.current - initLon + 180) % 360 + 360) % 360 - 180;
        const clampedRel = Math.max(ymin, Math.min(ymax, rel));
        if (clampedRel !== rel) velocityRef.current.lon = 0;
        lonRef.current = initLon + clampedRel;
      }

      // Pitch clamp (always on; defaults are ±85).
      const pmin = pitchMinRef.current ?? -85;
      const pmax = pitchMaxRef.current ?? 85;
      const prevLat = latRef.current;
      latRef.current = Math.max(pmin, Math.min(pmax, latRef.current));
      if (latRef.current !== prevLat) velocityRef.current.lat = 0;

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

    // Resize handler — tracks window resize AND container resize. The latter
    // matters in inline mode, where the side panel can collapse/expand and
    // change the canvas area without firing a window resize event.
    function handleResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
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
  // Only wired up in modal mode — inline panoramas have no close action.
  useEffect(() => {
    if (inline) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, inline]);

  if (!mounted) return null;

  // Inner content — the canvas + loading/error states. Shared by both modes.
  const canvasArea = (
    <>
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

      {loading && (
        <div className="pano-loading">
          <div className="pano-spinner" />
          <span>Cargando panorama…</span>
        </div>
      )}

      {error && (
        <div className="pano-loading">
          <span>❌ {error}</span>
        </div>
      )}

      {!loading && !error && (
        <div className="pano-hint">Arrastrá para explorar · Scroll para zoom</div>
      )}
    </>
  );

  // Inline mode — no portal, no overlay chrome, no header/close.
  // The container sits at z-index 0 (matching .viewer-canvas-container) so
  // side panels render on top of it.
  if (inline) {
    return <div className="pano-inline-container">{canvasArea}</div>;
  }

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

      {canvasArea}
    </div>,
    document.body
  );
}
