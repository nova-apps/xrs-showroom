'use client';

import { useState, useCallback } from 'react';
import FloatingPanel from './FloatingPanel';
import ConfirmDialog from '../ui/ConfirmDialog';

/**
 * PublishPanel — accordion section that replaces the old floating Publish
 * button. Shows publish status, last publish / edit timestamps, and exposes
 * the publish + discard actions inline.
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
