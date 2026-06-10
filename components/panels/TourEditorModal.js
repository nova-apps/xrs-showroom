'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { storage } from '@/lib/firebase';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { normalizeTour, emptyNode, isHotspotCalibrated } from '@/lib/tour';
import TourViewer from './TourViewer';

/**
 * TourEditorModal — per-amenity editor for the 360° tour.
 *
 * Workflow:
 *   1. Upload the floor plan (optional — a grid stands in if absent).
 *   2. Upload equirectangular images → one node each.
 *   3. Drag each node's pin to its real spot on the floor plan.
 *   4. "Conectar" mode: click two pins to toggle a (bidirectional) link.
 *   5. Preview → inside the viewer, calibrate each node's orientation by
 *      centering the view on a connected neighbor ("el centro apunta hacia").
 *
 * The floor plan is the TOUR's own image (tour.plano) — not the amenity's
 * `plano`, which is a cover photo, not a plan.
 *
 * Saving hands the tour object back to AmenitiesModal (which persists it as
 * part of the amenity row). Images of deleted nodes are queued through
 * `onQueueDelete` so AmenitiesModal flushes them after a successful save,
 * with its published-snapshot protection.
 *
 * @param {object}   amenity       - the amenity row being edited
 * @param {string}   sceneId
 * @param {Function} onSave        - (tour|null) persist into the row
 * @param {Function} onClose
 * @param {Function} onQueueDelete - (url) queue a Storage delete for save-time
 */
export default function TourEditorModal({ amenity, sceneId, onSave, onClose, onQueueDelete }) {
  const initial = useMemo(() => normalizeTour(amenity?.tour), [amenity]);
  const [nodes, setNodes] = useState(() => (initial ? { ...initial.nodes } : {}));
  const [plano, setPlano] = useState(() => initial?.plano || '');
  const [startNode, setStartNode] = useState(() => initial?.startNode || null);
  const [selectedId, setSelectedId] = useState(() => initial?.startNode || null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState(null); // origin pin while connecting
  const [cursorPos, setCursorPos] = useState(null);     // rubber-band end while connecting
  const [uploading, setUploading] = useState(null); // { progress, name } | null
  const [previewOpen, setPreviewOpen] = useState(false);
  // Mutations still flip this (it marks the working tour dirty); the value
  // itself is no longer read — autosave reacts to `workingTour` directly.
  const [, setHasChanges] = useState(false);
  const [mounted, setMounted] = useState(false);

  const planRef = useRef(null);
  const dragRef = useRef(null); // { id, moved } while dragging a pin
  const idCounter = useRef(0);

  useEffect(() => { setMounted(true); }, []);

  const nodeList = Object.values(nodes);

  // Working tour object — fed live to the preview viewer so recalibration
  // updates hotspots without reopening.
  const workingTour = useMemo(() => {
    const ids = Object.keys(nodes);
    if (!ids.length && !plano) return null;
    return { startNode: startNode || ids[0] || null, plano, nodes };
  }, [nodes, startNode, plano]);

  // Calibration coverage across every arrow (each link is one arrow, calibrated
  // independently). `pending` drives the "flechas sin calibrar" warning.
  const calib = useMemo(() => {
    let total = 0;
    let done = 0;
    const perNode = {};
    for (const n of Object.values(nodes)) {
      let nd = 0;
      for (const t of n.links) {
        total += 1;
        if (isHotspotCalibrated(n, t)) { done += 1; nd += 1; }
      }
      perNode[n.id] = { total: n.links.length, done: nd };
    }
    return { total, done, pending: total - done, perNode };
  }, [nodes]);

  const mutateNode = useCallback((id, patch) => {
    setNodes((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
    setHasChanges(true);
  }, []);

  // ─── Uploads ───
  // Panoramas keep 8192px: at FOV 75° only ~1/5 of the image width is on
  // screen at a time, so 4096 meant a ~3x upscale on desktop (visibly
  // pixelated). Devices whose GPU caps textures below 8192 still work —
  // three.js downsizes oversized textures to MAX_TEXTURE_SIZE automatically.
  // The floor plan is fine at 2048px.
  const PANO_MAX_W = 8192;
  const PLAN_MAX_W = 2048;

  const compressTo = useCallback(async (file, maxW) => {
    if (!file.type?.startsWith('image/')) return { blob: file, name: file.name };
    const bitmap = await createImageBitmap(file);
    console.log(`[TourEditor] ${file.name}: ${bitmap.width}x${bitmap.height}, ${(file.size / 1024 / 1024).toFixed(1)}MB`);

    // Already within budget? Keep the original bytes — re-encoding an
    // already-compressed camera JPEG through canvas only adds artifacts.
    if (bitmap.width <= maxW && file.size <= 12_000_000) {
      bitmap.close?.();
      return { blob: file, name: file.name };
    }

    const scale = Math.min(1, maxW / bitmap.width);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high'; // big downscales look mushy with the default
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!blob) return { blob: file, name: file.name };
    return { blob, name: `${file.name.replace(/\.[^.]+$/, '')}.webp` };
  }, []);

  /** Compress → upload to the amenity Storage folder → resolve URL. */
  const uploadImage = useCallback(async (file, maxW) => {
    let blob = file;
    let name = file.name;
    try {
      const compressed = await compressTo(file, maxW);
      blob = compressed.blob;
      name = compressed.name;
    } catch (err) {
      console.warn('[TourEditor] Compression failed, uploading original:', err);
    }

    const path = `scenes/${sceneId}/amenities/${Date.now()}_${name}`;
    const task = uploadBytesResumable(storageRef(storage, path), blob, {
      contentType: blob.type || file.type,
      cacheControl: 'public, max-age=2592000, immutable',
    });
    return await new Promise((resolve, reject) => {
      task.on(
        'state_changed',
        (snap) => setUploading({
          progress: Math.round((snap.bytesTransferred / snap.totalBytes) * 100),
          name: file.name,
        }),
        reject,
        async () => {
          try { resolve(await getDownloadURL(task.snapshot.ref)); }
          catch (err) { reject(err); }
        }
      );
    });
  }, [sceneId, compressTo]);

  const handleUpload = useCallback(async (fileList) => {
    if (!sceneId || !fileList?.length) return;
    const files = Array.from(fileList);
    for (const file of files) {
      setUploading({ progress: 0, name: file.name });
      try {
        const url = await uploadImage(file, PANO_MAX_W);
        const id = `n_${Date.now().toString(36)}_${idCounter.current++}`;
        const node = {
          ...emptyNode(id),
          nombre: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(),
          url,
          // Stagger fresh pins so they don't stack on top of each other.
          position: {
            x: 0.3 + (idCounter.current % 4) * 0.12,
            y: 0.3 + (Math.floor(idCounter.current / 4) % 4) * 0.12,
          },
        };
        setNodes((prev) => ({ ...prev, [id]: node }));
        setStartNode((prev) => prev || id);
        setSelectedId(id);
        setHasChanges(true);
      } catch (err) {
        console.error('[TourEditor] Upload error:', err);
        window.alert(`Error subiendo ${file.name}. Revisá la consola.`);
      }
    }
    setUploading(null);
  }, [sceneId, uploadImage]);

  // Replace one node's 360° image while keeping everything else — position,
  // links, northOffset calibration and name all stay. Only `url` changes; the
  // old image is queued for deletion (flushed at save, with the published-
  // snapshot guard in AmenitiesModal).
  const handleReplaceImage = useCallback(async (id, file) => {
    if (!sceneId || !file) return;
    const node = nodes[id];
    if (!node) return;
    setUploading({ progress: 0, name: file.name });
    try {
      const url = await uploadImage(file, PANO_MAX_W);
      if (node.url && node.url !== url) onQueueDelete?.(node.url);
      mutateNode(id, { url });
      setSelectedId(id);
    } catch (err) {
      console.error('[TourEditor] Replace image error:', err);
      window.alert('Error reemplazando la imagen. Revisá la consola.');
    }
    setUploading(null);
  }, [sceneId, uploadImage, nodes, onQueueDelete, mutateNode]);

  // ─── Floor plan upload / replace / remove ───
  const handlePlanoUpload = useCallback(async (file) => {
    if (!sceneId || !file) return;
    setUploading({ progress: 0, name: file.name });
    try {
      const url = await uploadImage(file, PLAN_MAX_W);
      if (plano) onQueueDelete?.(plano); // replaced — queue the old one
      setPlano(url);
      setHasChanges(true);
    } catch (err) {
      console.error('[TourEditor] Plan upload error:', err);
      window.alert(`Error subiendo el plano. Revisá la consola.`);
    }
    setUploading(null);
  }, [sceneId, uploadImage, plano, onQueueDelete]);

  const handlePlanoRemove = useCallback(() => {
    if (!plano) return;
    if (!window.confirm('¿Quitar el plano? Las posiciones de los pins se conservan.')) return;
    onQueueDelete?.(plano);
    setPlano('');
    setHasChanges(true);
  }, [plano, onQueueDelete]);

  // ─── Node operations ───
  const removeNode = useCallback((id) => {
    const node = nodes[id];
    if (!node) return;
    if (!window.confirm(`¿Eliminar la posición "${node.nombre || id}"?`)) return;
    if (node.url) onQueueDelete?.(node.url);
    setNodes((prev) => {
      const next = {};
      for (const [nid, n] of Object.entries(prev)) {
        if (nid === id) continue;
        next[nid] = { ...n, links: n.links.filter((t) => t !== id) };
      }
      return next;
    });
    setStartNode((prev) => (prev === id ? null : prev));
    setSelectedId((prev) => (prev === id ? null : prev));
    setHasChanges(true);
  }, [nodes, onQueueDelete]);

  const toggleLink = useCallback((a, b) => {
    if (a === b) return;
    setNodes((prev) => {
      const na = prev[a];
      const nb = prev[b];
      if (!na || !nb) return prev;
      const linked = na.links.includes(b);
      return {
        ...prev,
        [a]: { ...na, links: linked ? na.links.filter((t) => t !== b) : [...na.links, b] },
        [b]: { ...nb, links: linked ? nb.links.filter((t) => t !== a) : [...nb.links, a] },
      };
    });
    setHasChanges(true);
  }, []);

  // ─── Pin interaction: click = select/connect, drag = reposition ───
  const posFromEvent = useCallback((e) => {
    const rect = planRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }, []);

  const handlePinPointerDown = useCallback((e, id) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { id, moved: false };
  }, []);

  const handlePlanPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (drag) {
      const pos = posFromEvent(e);
      if (!pos) return;
      drag.moved = true;
      mutateNode(drag.id, { position: pos });
      return;
    }
    // Rubber band: while picking the connection's destination, the dashed
    // line follows the cursor from the origin pin.
    if (connectMode && connectFrom) {
      setCursorPos(posFromEvent(e));
    }
  }, [posFromEvent, mutateNode, connectMode, connectFrom]);

  const handlePlanPointerUp = useCallback((e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) {
      // Click on empty plan area — cancel a half-made connection.
      if (connectMode && connectFrom && e.target === e.currentTarget) {
        setConnectFrom(null);
        setCursorPos(null);
      }
      return;
    }
    if (drag.moved) return;
    // It was a click on a pin, not a drag.
    if (connectMode) {
      if (!connectFrom) {
        setConnectFrom(drag.id);
        setSelectedId(drag.id);
      } else if (connectFrom !== drag.id) {
        toggleLink(connectFrom, drag.id);
        setConnectFrom(null);
        setCursorPos(null);
      } else {
        setConnectFrom(null);
        setCursorPos(null);
      }
    } else {
      setSelectedId(drag.id);
    }
  }, [connectMode, connectFrom, toggleLink]);

  const toggleConnectMode = useCallback(() => {
    setConnectMode((v) => !v);
    setConnectFrom(null);
    setCursorPos(null);
  }, []);

  // ─── Auto-save ───
  // Every change applies to the parent automatically (debounced), which
  // persists it to the draft — no manual "Aplicar"/"Guardar" step. `saved`
  // drives the little status pill in the header.
  const [saved, setSaved] = useState(true);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const workingTourRef = useRef(workingTour);
  workingTourRef.current = workingTour;
  const didMountRef = useRef(false);

  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    setSaved(false);
    const id = setTimeout(() => {
      onSaveRef.current?.(normalizeTour(workingTourRef.current));
      setHasChanges(false);
      setSaved(true);
    }, 400);
    return () => clearTimeout(id);
  }, [workingTour]);

  const handleClose = useCallback(() => {
    // Flush the latest immediately in case a debounced apply is still pending.
    onSaveRef.current?.(normalizeTour(workingTourRef.current));
    onClose?.();
  }, [onClose]);

  // Per-arrow calibration: store the explicit longitude for the (nodeId →
  // targetId) arrow, merging into the node's hotspots map.
  const handleCalibrate = useCallback((nodeId, targetId, lon) => {
    setNodes((prev) => {
      const node = prev[nodeId];
      if (!node) return prev;
      return {
        ...prev,
        [nodeId]: { ...node, hotspots: { ...(node.hotspots || {}), [targetId]: lon } },
      };
    });
    setHasChanges(true);
  }, []);

  if (!mounted) return null;

  // Connection segments for the plan overlay (drawn once per pair).
  const segments = [];
  for (const n of nodeList) {
    for (const t of n.links) {
      if (n.id < t && nodes[t]) segments.push([n, nodes[t]]);
    }
  }

  return createPortal(
    <div className="ucm-overlay" onClick={handleClose}>
      <div className="ucm-modal tour-editor-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ucm-header">
          <div className="ucm-header-left">
            <h2 className="ucm-title">🌐 Recorrido 360° — {amenity?.nombre || 'Amenity'}</h2>
            <span className="ucm-count">
              {nodeList.length} {nodeList.length === 1 ? 'posición' : 'posiciones'}
            </span>
            {calib.total > 0 && (
              calib.pending > 0 ? (
                <span
                  className="tour-calib-badge is-pending"
                  title="Abrí «Vista previa / Calibrar» y orientá cada flecha pendiente"
                >
                  ⚠ {calib.pending} {calib.pending === 1 ? 'flecha sin calibrar' : 'flechas sin calibrar'}
                </span>
              ) : (
                <span className="tour-calib-badge is-done" title="Todas las flechas están calibradas">
                  ✓ Flechas calibradas
                </span>
              )
            )}
          </div>
          <div className="ucm-header-right">
            <label className="ucm-csv-btn tour-upload-btn" title="Subir imágenes equirectangulares (una por posición)">
              {uploading
                ? `⏳ ${uploading.progress}%`
                : '➕ Subir imágenes 360°'}
              <input
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                disabled={uploading !== null}
                onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }}
              />
            </label>
            <button
              className={`ucm-csv-btn${connectMode ? ' tour-connect-active' : ''}`}
              onClick={toggleConnectMode}
              disabled={nodeList.length < 2}
              title="Conectar o desconectar posiciones entre sí"
            >
              {connectMode ? '🔗 Conectando…' : '🔗 Conectar posiciones'}
            </button>
            <button
              className="ucm-csv-btn"
              onClick={() => setPreviewOpen(true)}
              disabled={nodeList.length === 0}
              title="Recorrer y calibrar la orientación de cada posición"
            >
              👁 Vista previa / Calibrar
            </button>
            <span className="tour-autosave" title="Los cambios se guardan automáticamente">
              {saved ? '✓ Guardado' : '⏳ Guardando…'}
            </span>
            <button className="ucm-close-btn" onClick={handleClose} title="Cerrar">✕</button>
          </div>
        </div>

        <div className="ucm-hint">
          Subí el plano y las imágenes 360°, arrastrá cada pin a su lugar y usá «Conectar
          posiciones» (clic en origen, clic en destino) para armar el recorrido. Después
          calibrá la orientación desde la vista previa.
          {!plano && ' Sin plano, los pins se acomodan sobre una grilla.'}
        </div>

        {/* Body: node list + plan editor */}
        <div className="tour-editor-body">
          {/* Node list */}
          <div className="tour-node-list">
            {nodeList.length === 0 && (
              <div className="tour-node-empty">
                Sin posiciones todavía.<br />Subí una o más imágenes 360°.
              </div>
            )}
            {nodeList.map((n) => (
              <div
                key={n.id}
                className={`tour-node-item${n.id === selectedId ? ' is-selected' : ''}`}
                onClick={() => setSelectedId(n.id)}
              >
                <img src={n.url} alt="" className="tour-node-thumb" />
                <div className="tour-node-info">
                  <input
                    className="ucm-input"
                    type="text"
                    value={n.nombre}
                    placeholder="Nombre de la posición"
                    onChange={(e) => mutateNode(n.id, { nombre: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="tour-node-meta">
                    <span>{n.links.length} {n.links.length === 1 ? 'conexión' : 'conexiones'}</span>
                    {n.links.length > 0 && (
                      <span
                        className={`tour-node-calib${calib.perNode[n.id]?.done < n.links.length ? ' is-pending' : ' is-done'}`}
                        title="Flechas calibradas en esta posición"
                      >
                        {calib.perNode[n.id]?.done < n.links.length ? '⚠' : '✓'}{' '}
                        {calib.perNode[n.id]?.done ?? 0}/{n.links.length} calibradas
                      </span>
                    )}
                  </div>
                </div>
                <div className="tour-node-actions">
                  <button
                    className={`tour-node-btn${startNode === n.id ? ' tour-start-active' : ''}`}
                    title={startNode === n.id ? 'Posición inicial' : 'Marcar como posición inicial'}
                    onClick={(e) => { e.stopPropagation(); setStartNode(n.id); setHasChanges(true); }}
                  >
                    {startNode === n.id ? '★' : '☆'}
                  </button>
                  <label
                    className="tour-node-btn"
                    title="Reemplazar la imagen 360° (mantiene posición y conexiones)"
                    onClick={(e) => e.stopPropagation()}
                  >
                    🔄
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      disabled={uploading !== null}
                      onChange={(e) => { handleReplaceImage(n.id, e.target.files?.[0]); e.target.value = ''; }}
                    />
                  </label>
                  <button
                    className="tour-node-btn tour-node-btn-delete"
                    title="Eliminar posición"
                    onClick={(e) => { e.stopPropagation(); removeNode(n.id); }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Plan editor */}
          <div
            className={[
              'tour-plan',
              plano ? '' : 'tour-plan-grid',
              connectMode ? 'is-connecting' : '',
            ].filter(Boolean).join(' ')}
            ref={planRef}
            onPointerMove={handlePlanPointerMove}
            onPointerUp={handlePlanPointerUp}
            onPointerLeave={handlePlanPointerUp}
          >
            {plano && <img src={plano} alt="Plano" className="tour-plan-img" draggable={false} />}

            {/* Floor-plan controls — over the grid when empty, corner chips when set */}
            {!plano ? (
              <label className="tour-plan-upload-cta">
                {uploading ? `⏳ ${uploading.progress}%` : '📐 Subir plano'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  disabled={uploading !== null}
                  onChange={(e) => { handlePlanoUpload(e.target.files?.[0]); e.target.value = ''; }}
                />
              </label>
            ) : (
              <div className="tour-plan-controls">
                <label className="tour-plan-ctrl-btn" title="Reemplazar el plano">
                  🔄 Cambiar plano
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    disabled={uploading !== null}
                    onChange={(e) => { handlePlanoUpload(e.target.files?.[0]); e.target.value = ''; }}
                  />
                </label>
                <button
                  className="tour-plan-ctrl-btn tour-plan-ctrl-danger"
                  onClick={handlePlanoRemove}
                  disabled={uploading !== null}
                  title="Quitar el plano"
                >✕ Quitar</button>
              </div>
            )}

            {/* Connection lines */}
            <svg className="tour-plan-links" viewBox="0 0 100 100" preserveAspectRatio="none">
              {segments.map(([a, b]) => (
                <g key={`${a.id}-${b.id}`} className={connectMode ? 'is-deletable' : ''}>
                  <line
                    className="tour-link-visible"
                    x1={a.position.x * 100} y1={a.position.y * 100}
                    x2={b.position.x * 100} y2={b.position.y * 100}
                  />
                  {/* Fat invisible twin: easy click target to delete the link */}
                  {connectMode && (
                    <line
                      className="tour-link-hit"
                      x1={a.position.x * 100} y1={a.position.y * 100}
                      x2={b.position.x * 100} y2={b.position.y * 100}
                      onClick={() => toggleLink(a.id, b.id)}
                    >
                      <title>Eliminar conexión</title>
                    </line>
                  )}
                </g>
              ))}
              {/* Rubber band from the origin pin to the cursor */}
              {connectMode && connectFrom && nodes[connectFrom] && cursorPos && (
                <line
                  className="tour-link-rubber"
                  x1={nodes[connectFrom].position.x * 100} y1={nodes[connectFrom].position.y * 100}
                  x2={cursorPos.x * 100} y2={cursorPos.y * 100}
                />
              )}
            </svg>

            {/* Step-by-step guidance while connecting */}
            {connectMode && (
              <div className="tour-plan-status">
                {connectFrom
                  ? '2 de 2 — Clic en la posición de DESTINO (o en el plano para cancelar)'
                  : '1 de 2 — Clic en la posición de ORIGEN · Clic en una línea para borrarla'}
              </div>
            )}

            {/* Pins */}
            {nodeList.map((n) => (
              <div
                key={n.id}
                className={[
                  'tour-plan-pin',
                  n.id === selectedId ? 'is-selected' : '',
                  startNode === n.id ? 'is-start' : '',
                  connectMode && n.id === connectFrom ? 'is-connect-origin' : '',
                  connectMode && connectFrom && n.id !== connectFrom ? 'is-connectable' : '',
                ].filter(Boolean).join(' ')}
                style={{ left: `${n.position.x * 100}%`, top: `${n.position.y * 100}%` }}
                title={n.nombre || n.id}
                onPointerDown={(e) => handlePinPointerDown(e, n.id)}
              >
                <span className="tour-plan-pin-label">{n.nombre || '·'}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Preview / calibration — feeds the live working tour so calibration
          updates apply immediately. */}
      {previewOpen && workingTour && nodeList.length > 0 && (
        <TourViewer
          tour={workingTour}
          amenityName={amenity?.nombre}
          initialNodeId={selectedId || undefined}
          calibrationEnabled
          onCalibrate={handleCalibrate}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>,
    document.body
  );
}
