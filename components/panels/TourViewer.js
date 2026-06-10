'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { normalizeTour, hotspotLon, arrivalLon, northOffsetFromLon } from '@/lib/tour';

/**
 * TourViewer — fullscreen multi-node 360° tour (Matterport-style).
 *
 * Renders the current node's equirectangular image on an inside-out sphere
 * (same approach as PanoramaViewer) and adds:
 *   - HOTSPOTS: clickable sprites toward each linked node, placed at the
 *     longitude derived from the floor-plan positions (lib/tour hotspotLon).
 *   - CROSSFADE: a second sphere fades in the destination image.
 *   - ORIENTATION CONTINUITY: arriving at a node keeps the world heading the
 *     camera had (lib/tour arrivalLon).
 *   - MINIMAP: the floor plan with one pin per node; click to jump.
 *   - PRELOAD: neighbor textures load in the background after each arrival.
 *
 * @param {object}   tour        - amenity.tour (raw RTDB shape; normalized here).
 *   Its `plano` field (the tour's floor plan) backs the minimap, if present.
 * @param {string}   amenityName - shown in the header
 * @param {Function} onClose     - close the viewer
 * @param {string}   initialNodeId - node to open with (default: tour.startNode)
 * @param {boolean}  calibrationEnabled - editor-only. Shows the "point at
 *   neighbor" control used to solve each node's northOffset.
 * @param {Function} onCalibrate - (nodeId, northOffsetDeg) when the operator
 *   calibrates. The caller persists it into the tour being edited.
 * @param {boolean}  embedded - render inline inside a container (e.g. the
 *   amenity modal) instead of as a fullscreen portal. In this mode the close
 *   button is swapped for an "expand" button that uses the native Fullscreen
 *   API on the viewer's own element.
 */
export default function TourViewer({
  tour,
  amenityName,
  onClose,
  initialNodeId,
  calibrationEnabled = false,
  onCalibrate,
  embedded = false,
}) {
  const normalized = useMemo(() => normalizeTour(tour), [tour]);
  const [currentId, setCurrentId] = useState(() =>
    normalized?.nodes?.[initialNodeId] ? initialNodeId : normalized?.startNode
  );

  const rootRef = useRef(null);      // viewer wrapper — target of requestFullscreen
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const baseMeshRef = useRef(null);   // always shows the CURRENT node
  const fadeMeshRef = useRef(null);   // incoming node during a transition
  const hotspotGroupRef = useRef(null);
  const rafRef = useRef(null);

  const isDraggingRef = useRef(false);
  const prevMouseRef = useRef({ x: 0, y: 0 });
  const downPosRef = useRef(null);    // pointerdown pos, to tell click from drag
  const lonRef = useRef(0);
  const latRef = useRef(0);
  const fovRef = useRef(75);
  const velocityRef = useRef({ lon: 0, lat: 0 });
  const touchDistRef = useRef(0);

  // Live tour + current node, readable from effect-scoped closures (the
  // editor recalibrates the tour prop while the viewer is open).
  const tourRef = useRef(normalized);
  tourRef.current = normalized;
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  // Crossfade state, driven by the animation loop.
  const transitionRef = useRef(null); // { start, dur, targetId } | null
  const navigatingRef = useRef(false);

  // url → THREE.Texture | Promise<THREE.Texture>. Shared by preload + navigate.
  const textureCacheRef = useRef(new Map());

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [calibTarget, setCalibTarget] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // True while a click-to-navigate is waiting on a texture that wasn't
  // preloaded yet — drives the spinner so the click never feels dead.
  const [navLoading, setNavLoading] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // ─── Native fullscreen (embedded mode) ───
  // Promote just the viewer element to the browser's top layer — no portal
  // remount, so the WebGL context and texture cache survive the toggle. The
  // ResizeObserver below already resizes the canvas when the box changes.
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      setIsFullscreen(fsEl === rootRef.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);
  const fullscreenSupported =
    mounted &&
    typeof document !== 'undefined' &&
    (document.fullscreenEnabled || document.webkitFullscreenEnabled);

  const currentNode = normalized?.nodes?.[currentId] || null;

  // ─── Texture cache ───
  const loadTexture = useCallback((url) => {
    const cache = textureCacheRef.current;
    const hit = cache.get(url);
    if (hit) return Promise.resolve(hit);
    const promise = new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = 'anonymous';
      loader.load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          // Anisotropic filtering — without it the texture smears at grazing
          // angles on the sphere (floor/ceiling look pixelated/blurry).
          const maxAniso = rendererRef.current?.capabilities.getMaxAnisotropy?.() || 8;
          texture.anisotropy = maxAniso;
          cache.set(url, texture);
          resolve(texture);
        },
        undefined,
        reject
      );
    });
    cache.set(url, promise);
    return promise;
  }, []);

  // ─── Hotspot arrows ───
  // Street-View-style: a flat chevron lying on the floor, rotated to point
  // toward the destination, plus a small billboard label floating above it.
  // userData.targetId on both drives navigation.
  const disposeHotspots = useCallback(() => {
    const group = hotspotGroupRef.current;
    if (!group) return;
    sceneRef.current?.remove(group);
    group.traverse((obj) => {
      obj.material?.map?.dispose?.();
      obj.material?.dispose?.();
      obj.geometry?.dispose?.();
    });
    hotspotGroupRef.current = null;
  }, []);

  const buildHotspots = useCallback(() => {
    const scene = sceneRef.current;
    const t = tourRef.current;
    const node = t?.nodes?.[currentIdRef.current];
    if (!scene || !node) return;

    disposeHotspots();

    const group = new THREE.Group();
    const ARROW_DIST = 130; // horizontal distance from the camera
    const ARROW_Y = -70;    // floor height (the camera sits at eye level, y=0)
    const maxAniso = rendererRef.current?.capabilities.getMaxAnisotropy?.() || 8;

    for (const targetId of node.links) {
      const target = t.nodes[targetId];
      if (!target) continue;

      const lon = hotspotLon(node, target);
      const theta = THREE.MathUtils.degToRad(lon);

      // Chevron texture — drawn pointing "up" in canvas space, which after
      // laying the plane flat becomes "away from the camera".
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      // Translucent disc base — on the floor it reads as an oval button,
      // exactly like Street View's navigation pads.
      ctx.beginPath();
      ctx.arc(128, 128, 112, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.stroke();
      // Single chevron pointing toward the destination
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(62, 162);
      ctx.lineTo(128, 92);
      ctx.lineTo(194, 162);
      ctx.lineWidth = 38;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.stroke();

      const arrowTex = new THREE.CanvasTexture(canvas);
      arrowTex.colorSpace = THREE.SRGBColorSpace;
      arrowTex.anisotropy = maxAniso; // viewed at a grazing angle on the floor
      const arrow = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshBasicMaterial({
          map: arrowTex,
          transparent: true,
          depthTest: false,
          side: THREE.DoubleSide,
        })
      );
      // Lay the plane flat on the floor (X), then spin it (Y) so canvas-up
      // points along the travel direction (cos θ, 0, sin θ).
      arrow.rotation.order = 'YXZ';
      arrow.rotation.x = -Math.PI / 2;
      arrow.rotation.y = -theta - Math.PI / 2;
      arrow.position.set(ARROW_DIST * Math.cos(theta), ARROW_Y, ARROW_DIST * Math.sin(theta));
      arrow.renderOrder = 2;
      arrow.userData.targetId = targetId;
      group.add(arrow);
    }
    scene.add(group);
    hotspotGroupRef.current = group;
  }, [disposeHotspots]);

  // ─── Navigation ───
  const navigate = useCallback(async (targetId) => {
    const t = tourRef.current;
    const from = t?.nodes?.[currentIdRef.current];
    const to = t?.nodes?.[targetId];
    if (!to || navigatingRef.current || targetId === currentIdRef.current) return;
    navigatingRef.current = true;

    // Spinner only when the target isn't already decoded (preloaded neighbor).
    // Cached → instant jump, no flicker; not cached → immediate feedback.
    const ready = textureCacheRef.current.get(to.url) instanceof THREE.Texture;
    if (!ready) setNavLoading(true);

    try {
      const texture = await loadTexture(to.url);
      setNavLoading(false);
      const fadeMesh = fadeMeshRef.current;
      if (!fadeMesh) return; // unmounted while loading

      // Keep the world heading across the jump.
      lonRef.current = arrivalLon(from, to, lonRef.current);
      velocityRef.current = { lon: 0, lat: 0 };

      fadeMesh.material.map = texture;
      fadeMesh.material.opacity = 0;
      fadeMesh.material.needsUpdate = true;
      fadeMesh.visible = true;
      transitionRef.current = { start: performance.now(), dur: 450, targetId };
      setCurrentId(targetId);
    } catch (err) {
      console.error('[TourViewer] Failed to load node image:', err);
      setNavLoading(false);
      navigatingRef.current = false;
    }
  }, [loadTexture]);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // ─── Three.js setup (once) ───
  useEffect(() => {
    if (!mounted || !containerRef.current || !currentNode?.url) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1100);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);

    const baseMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    baseMesh.visible = false;
    scene.add(baseMesh);
    baseMeshRef.current = baseMesh;

    // Incoming sphere, slightly smaller so it always renders inside/in front.
    const fadeGeometry = new THREE.SphereGeometry(490, 60, 40);
    fadeGeometry.scale(-1, 1, 1);
    const fadeMesh = new THREE.Mesh(
      fadeGeometry,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })
    );
    fadeMesh.visible = false;
    fadeMesh.renderOrder = 1;
    scene.add(fadeMesh);
    fadeMeshRef.current = fadeMesh;

    // First node: face the first link if any (so a hotspot greets the user).
    const t = tourRef.current;
    const node = t.nodes[currentIdRef.current];
    const firstLink = node.links[0] ? t.nodes[node.links[0]] : null;
    lonRef.current = firstLink ? hotspotLon(node, firstLink) : (node.northOffset || 0);

    loadTexture(node.url)
      .then((texture) => {
        baseMesh.material.map = texture;
        baseMesh.material.needsUpdate = true;
        baseMesh.visible = true;
        setLoading(false);
        buildHotspots();
      })
      .catch((err) => {
        console.error('[TourViewer] Texture load error:', err);
        setError('No se pudo cargar la imagen panorámica');
        setLoading(false);
      });

    function animate() {
      rafRef.current = requestAnimationFrame(animate);

      if (!isDraggingRef.current) {
        lonRef.current += velocityRef.current.lon;
        latRef.current += velocityRef.current.lat;
        velocityRef.current.lon *= 0.95;
        velocityRef.current.lat *= 0.95;
      }

      latRef.current = Math.max(-85, Math.min(85, latRef.current));

      // Crossfade — ease the incoming sphere in, then promote it to base.
      const tr = transitionRef.current;
      if (tr) {
        const p = Math.min(1, (performance.now() - tr.start) / tr.dur);
        const eased = p * (2 - p); // easeOutQuad
        fadeMesh.material.opacity = eased;
        if (p >= 1) {
          baseMesh.material.map = fadeMesh.material.map;
          baseMesh.material.needsUpdate = true;
          fadeMesh.visible = false;
          fadeMesh.material.opacity = 0;
          transitionRef.current = null;
          navigatingRef.current = false;
        }
      }

      const phi = THREE.MathUtils.degToRad(90 - latRef.current);
      const theta = THREE.MathUtils.degToRad(lonRef.current);
      camera.position.set(0, 0, 0);
      camera.lookAt(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
      );
      camera.fov = fovRef.current;
      camera.updateProjectionMatrix();

      renderer.render(scene, camera);
    }
    animate();

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

    const cache = textureCacheRef.current;
    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (hotspotGroupRef.current) {
        hotspotGroupRef.current.traverse((obj) => {
          obj.material?.map?.dispose?.();
          obj.material?.dispose?.();
          obj.geometry?.dispose?.();
        });
        hotspotGroupRef.current = null;
      }
      for (const tex of cache.values()) {
        if (tex instanceof THREE.Texture) tex.dispose();
      }
      cache.clear();
      renderer.dispose();
      geometry.dispose();
      fadeGeometry.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
    // Setup runs once per mount; node changes swap textures in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Rebuild hotspots when the node changes or the tour is edited live
  // (recalibration moves hotspot longitudes), and preload neighbor images.
  useEffect(() => {
    if (loading || !currentNode) return;
    buildHotspots();
    for (const targetId of currentNode.links) {
      const url = normalized?.nodes?.[targetId]?.url;
      if (url) loadTexture(url).catch(() => {});
    }
  }, [loading, currentNode, normalized, buildHotspots, loadTexture]);

  // ─── Hotspot picking ───
  const raycastHotspot = useCallback((clientX, clientY) => {
    const container = containerRef.current;
    const camera = cameraRef.current;
    const group = hotspotGroupRef.current;
    if (!container || !camera || !group) return null;
    const rect = container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(group.children, false);
    return hits[0]?.object?.userData?.targetId || null;
  }, []);

  // ─── Pointer interaction (drag-to-look + click-to-jump) ───
  const handlePointerDown = useCallback((e) => {
    isDraggingRef.current = true;
    prevMouseRef.current = { x: e.clientX, y: e.clientY };
    downPosRef.current = { x: e.clientX, y: e.clientY };
    velocityRef.current = { lon: 0, lat: 0 };
  }, []);

  const handlePointerMove = useCallback((e) => {
    if (!isDraggingRef.current) {
      // Hover feedback over hotspots.
      const hit = raycastHotspot(e.clientX, e.clientY);
      if (containerRef.current) {
        containerRef.current.style.cursor = hit ? 'pointer' : 'grab';
      }
      return;
    }
    const dx = e.clientX - prevMouseRef.current.x;
    const dy = e.clientY - prevMouseRef.current.y;
    const moveLon = -dx * 0.15;
    const moveLat = dy * 0.15;
    lonRef.current += moveLon;
    latRef.current += moveLat;
    velocityRef.current = { lon: moveLon, lat: moveLat };
    prevMouseRef.current = { x: e.clientX, y: e.clientY };
  }, [raycastHotspot]);

  const handlePointerUp = useCallback((e) => {
    isDraggingRef.current = false;
    const down = downPosRef.current;
    downPosRef.current = null;
    if (!down) return;
    // A "click" is a press that barely moved.
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 6) {
      const targetId = raycastHotspot(e.clientX, e.clientY);
      if (targetId) navigateRef.current(targetId);
    }
  }, [raycastHotspot]);

  const handlePointerLeave = useCallback(() => {
    isDraggingRef.current = false;
    downPosRef.current = null;
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    fovRef.current = Math.max(30, Math.min(110, fovRef.current + e.deltaY * 0.05));
  }, []);

  // ─── Touch interaction ───
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      isDraggingRef.current = true;
      const t0 = e.touches[0];
      prevMouseRef.current = { x: t0.clientX, y: t0.clientY };
      downPosRef.current = { x: t0.clientX, y: t0.clientY };
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

  const handleTouchEnd = useCallback((e) => {
    isDraggingRef.current = false;
    const down = downPosRef.current;
    downPosRef.current = null;
    const touch = e.changedTouches?.[0];
    if (!down || !touch) return;
    const moved = Math.hypot(touch.clientX - down.x, touch.clientY - down.y);
    if (moved < 10) {
      const targetId = raycastHotspot(touch.clientX, touch.clientY);
      if (targetId) navigateRef.current(targetId);
    }
  }, [raycastHotspot]);

  // ─── Calibration (editor only) ───
  const savedFlashTimer = useRef(null);
  const handleCalibrate = useCallback(() => {
    const t = tourRef.current;
    const node = t?.nodes?.[currentIdRef.current];
    const target = t?.nodes?.[calibTarget];
    if (!node || !target) return;
    onCalibrate?.(node.id, northOffsetFromLon(lonRef.current, node, target));
    setSavedFlash(true);
    if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
    savedFlashTimer.current = setTimeout(() => setSavedFlash(false), 1600);
  }, [calibTarget, onCalibrate]);
  useEffect(() => () => { if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current); }, []);

  // Default the calibration target to the first link of the current node.
  useEffect(() => {
    if (!calibrationEnabled || !currentNode) return;
    setCalibTarget((prev) =>
      currentNode.links.includes(prev) ? prev : (currentNode.links[0] || '')
    );
  }, [calibrationEnabled, currentNode]);

  // ─── Escape to close ───
  // Embedded: the host modal owns Escape, and exiting fullscreen is native —
  // so we stay out of the way entirely.
  useEffect(() => {
    if (embedded) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, embedded]);

  if (!mounted || !normalized || !currentNode) return null;

  const nodeList = Object.values(normalized.nodes);
  const calibOptions = currentNode.links
    .map((id) => normalized.nodes[id])
    .filter(Boolean);

  const content = (
    <div
      ref={rootRef}
      className={embedded ? 'pano-overlay pano-embedded' : 'pano-overlay'}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="pano-header">
        <div className="pano-label">
          <span className="pano-label-icon">🌐</span>
          <span className="pano-label-text">
            {amenityName || 'Recorrido'}
            {currentNode.nombre ? ` · ${currentNode.nombre}` : ''}
          </span>
        </div>
        {embedded ? (
          fullscreenSupported && (
            <button
              className="pano-close"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            >
              {isFullscreen ? '⤡' : '⤢'}
            </button>
          )
        ) : (
          <button className="pano-close" onClick={onClose} title="Cerrar (Esc)">✕</button>
        )}
      </div>

      {/* Canvas */}
      <div
        className="pano-canvas"
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: 'grab' }}
      />

      {loading && (
        <div className="pano-loading">
          <div className="pano-spinner" />
          <span>Cargando recorrido…</span>
        </div>
      )}

      {error && (
        <div className="pano-loading">
          <span>❌ {error}</span>
        </div>
      )}

      {/* Per-navigation spinner — shows only when the destination image
          wasn't preloaded yet, so a click never feels unresponsive. */}
      {navLoading && (
        <div className="pano-nav-loading" aria-live="polite">
          <div className="pano-spinner" />
        </div>
      )}

      {!loading && !error && (
        <div className="pano-hint">
          Arrastrá para mirar · Tocá las flechas para moverte
        </div>
      )}

      {/* Minimap — the tour's floor plan with node pins */}
      {normalized.plano && nodeList.length > 0 && !loading && (
        <div className="tour-minimap">
          <img src={normalized.plano} alt="Plano" className="tour-minimap-img" draggable={false} />
          {nodeList.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`tour-minimap-pin${n.id === currentId ? ' is-current' : ''}`}
              style={{ left: `${n.position.x * 100}%`, top: `${n.position.y * 100}%` }}
              title={n.nombre || 'Posición'}
              onClick={() => navigate(n.id)}
            />
          ))}
        </div>
      )}

      {/* Calibration (editor only): aim the crosshair at a neighbor and save.
          One reference per node orients every arrow in it. */}
      {calibrationEnabled && !loading && !error && (
        <>
          {/* Crosshair marking the exact center of the view */}
          <div className="tour-crosshair" aria-hidden="true" />

          <div className="tour-calibrate">
            {calibOptions.length > 0 ? (
              <>
                <div className="tour-calibrate-title">
                  Calibrar orientación de «{currentNode.nombre || 'esta posición'}»
                </div>
                <div className="tour-calibrate-steps">
                  Elegí una posición vecina y arrastrá la vista hasta que la cruz
                  del centro quede mirando hacia donde está ese lugar en la foto.
                </div>
                <div className="tour-calibrate-row">
                  <span className="tour-calibrate-label">La cruz mira hacia:</span>
                  <select
                    className="tour-calibrate-select"
                    value={calibTarget}
                    onChange={(e) => setCalibTarget(e.target.value)}
                  >
                    {calibOptions.map((n) => (
                      <option key={n.id} value={n.id}>{n.nombre || n.id}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`pano-calibrate-btn${savedFlash ? ' is-saved' : ''}`}
                    onClick={handleCalibrate}
                  >
                    {savedFlash ? '✓ Guardado — flechas actualizadas' : '✓ Confirmar'}
                  </button>
                </div>
              </>
            ) : (
              <span className="tour-calibrate-empty">
                Conectá esta posición con otra para poder calibrarla
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );

  // Embedded: render inline in the host (the modal). Fullscreen: render as a
  // top-level portal so it sits above everything.
  return embedded ? content : createPortal(content, document.body);
}
