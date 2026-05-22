'use client';

import { useState, useCallback, useMemo } from 'react';
import FloatingPanel from './FloatingPanel';
import ConfirmDialog from '../ui/ConfirmDialog';

/**
 * PublishPanel — accordion section that replaces the old floating Publish
 * button. Shows publish status, last publish / edit timestamps, the list of
 * unpublished changes, and exposes the publish + discard actions inline.
 */
function formatDateTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/**
 * Order-stable JSON serialization so deep-equality comparisons between draft
 * fields and the published snapshot don't get tripped up by key ordering
 * differences coming back from Firebase.
 */
function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Human-friendly labels for each publishable field. Sub-fields under `assets`
 * and `transforms` get split out so the list reads as discrete changes.
 */
const FIELD_LABELS = {
  name: 'Nombre',
  type: 'Tipo de escena',
  panelLogoUrl: 'Logo del panel',
  whatsappNumber: 'WhatsApp',
  customDomain: 'Dominio personalizado',
  orbit: 'Cámara y órbita',
  materials: 'Materiales',
  unidades: 'Unidades',
  amenities: 'Amenities',
  barrios: 'Barrios',
  lotes: 'Lotes',
  panoramaSettings: 'Panorámicas',
  lighting: 'Iluminación',
  tint: 'Tinte',
  saturation: 'Saturación',
  bgBlur: 'Blur de fondo',
  glbSettings: 'Ajustes del modelo',
  splatSettings: 'Ajustes del splat',
  collidersVisible: 'Visibilidad de colliders',
};

const ASSET_LABELS = {
  glb: 'Modelo 3D (GLB)',
  sog: 'Gaussian Splat',
  skybox: 'Cielo (skybox)',
  floor: 'Piso',
  colliders: 'Colliders',
  modelHdri: 'HDRI del modelo',
};

const TRANSFORM_LABELS = {
  glb: 'Transformación del modelo',
  sog: 'Transformación del splat',
  skybox: 'Posición del cielo',
  floor: 'Posición del piso',
  colliders: 'Transformación de colliders',
  mask: 'Máscara de fondo',
};

function diffPublished(scene) {
  if (!scene) return [];
  const published = scene.published || {};
  const changes = [];

  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    if (stableStringify(scene[field]) !== stableStringify(published[field])) {
      changes.push(label);
    }
  }

  // Split assets and transforms by sub-key for a more useful list.
  const draftAssets = scene.assets || {};
  const pubAssets = published.assets || {};
  for (const [key, label] of Object.entries(ASSET_LABELS)) {
    if (stableStringify(draftAssets[key]) !== stableStringify(pubAssets[key])) {
      changes.push(label);
    }
  }

  const draftTransforms = scene.transforms || {};
  const pubTransforms = published.transforms || {};
  for (const [key, label] of Object.entries(TRANSFORM_LABELS)) {
    if (stableStringify(draftTransforms[key]) !== stableStringify(pubTransforms[key])) {
      changes.push(label);
    }
  }

  return changes;
}

export default function PublishPanel({ scene, sceneId, onPublish, onDiscard, collapsed, onToggle }) {
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const publishedAt = scene?.publishedAt ?? 0;
  const updatedAt = scene?.updatedAt ?? 0;
  const neverPublished = !scene?.published;
  const isDirty = neverPublished || updatedAt > publishedAt;
  const canDiscard = !neverPublished && isDirty;

  // Only diff against the published snapshot — when nothing has been
  // published yet there's nothing meaningful to enumerate.
  const pendingChanges = useMemo(
    () => (neverPublished ? [] : diffPublished(scene)),
    [scene, neverPublished],
  );

  const status = neverPublished
    ? { label: 'Sin publicar', tone: 'pending' }
    : isDirty
      ? { label: 'Cambios sin publicar', tone: 'dirty' }
      : { label: 'Publicada', tone: 'live' };

  const handlePublish = useCallback(async () => {
    if (publishing || !onPublish) return;
    setPublishing(true);
    try {
      await onPublish();
      setJustPublished(true);
      setTimeout(() => setJustPublished(false), 1800);
    } catch (err) {
      console.error('[Publish] failed:', err);
    }
    setPublishing(false);
  }, [onPublish, publishing]);

  const handleDiscard = useCallback(async () => {
    setConfirmDiscard(false);
    if (discarding || !onDiscard) return;
    setDiscarding(true);
    try {
      await onDiscard();
    } catch (err) {
      console.error('[Discard] failed:', err);
    }
    setDiscarding(false);
  }, [onDiscard, discarding]);

  const publishLabel = publishing
    ? 'Publicando…'
    : justPublished
      ? 'Publicado ✓'
      : neverPublished
        ? 'Publicar por primera vez'
        : isDirty
          ? 'Publicar cambios'
          : 'Sin cambios para publicar';

  return (
    <FloatingPanel
      title="Publicación"
      icon="🚀"
      position=""
      collapsed={collapsed}
      onToggle={onToggle}
      headerExtra={<span className={`publish-status-dot publish-status-${status.tone}`} title={status.label} />}
    >
      <div className="publish-panel">
        <div className={`publish-status-badge publish-status-${status.tone}`}>
          <span className="publish-status-dot" />
          <span>{status.label}</span>
        </div>

        <div className="publish-meta">
          <div className="publish-meta-row">
            <span className="publish-meta-label">Última publicación</span>
            <span className="publish-meta-value">{formatDateTime(publishedAt)}</span>
          </div>
          <div className="publish-meta-row">
            <span className="publish-meta-label">Última edición</span>
            <span className="publish-meta-value">{formatDateTime(updatedAt)}</span>
          </div>
        </div>

        {!neverPublished && isDirty && pendingChanges.length > 0 && (
          <div className="publish-changes">
            <div className="publish-changes-title">
              Cambios sin publicar
              <span className="publish-changes-count">{pendingChanges.length}</span>
            </div>
            <ul className="publish-changes-list">
              {pendingChanges.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          className={`publish-panel-btn publish-panel-btn-primary${justPublished ? ' is-success' : ''}`}
          disabled={publishing || (!isDirty && !justPublished)}
          onClick={handlePublish}
        >
          {publishLabel}
        </button>

        <button
          type="button"
          className="publish-panel-btn publish-panel-btn-danger"
          disabled={!canDiscard || publishing || discarding}
          onClick={() => setConfirmDiscard(true)}
          title={canDiscard ? 'Volver al estado publicado' : 'No hay cambios para descartar'}
        >
          {discarding ? 'Descartando…' : 'Descartar cambios'}
        </button>

        <button
          type="button"
          className="publish-panel-btn publish-panel-btn-ghost"
          disabled={neverPublished || !sceneId}
          onClick={() => sceneId && window.open(`/view/${sceneId}`, '_blank', 'noopener,noreferrer')}
          title={neverPublished ? 'Aún no hay versión publicada' : 'Abrir la vista pública en otra pestaña'}
        >
          🌐 Abrir versión publicada
        </button>

        <p className="publish-panel-hint">
          {neverPublished
            ? 'Publicá la escena para que /view/ la muestre.'
            : isDirty
              ? 'La versión en /view/ es la última publicada. Los cambios actuales no son visibles hasta publicar.'
              : 'La versión en /view/ coincide con esta escena.'}
        </p>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="Descartar cambios"
          message="Los cambios sin publicar se van a perder y la escena vuelve al estado publicado. Esta acción no se puede deshacer."
          confirmLabel="Descartar"
          onConfirm={handleDiscard}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </FloatingPanel>
  );
}
