'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import FloatingPanel from './FloatingPanel';
import ConfirmDialog from '../ui/ConfirmDialog';
import { subscribeSceneVersions } from '@/lib/scenes';
import { diffSnapshots } from '@/lib/sceneDiff';

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

export default function PublishPanel({ scene, sceneId, onPublish, onDiscard, onRestoreVersion, collapsed, onToggle }) {
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [versions, setVersions] = useState([]);
  const [confirmRestore, setConfirmRestore] = useState(null); // version object
  const [restoringId, setRestoringId] = useState(null);
  const [expandedVersion, setExpandedVersion] = useState(null); // version id
  const [versionsOpen, setVersionsOpen] = useState(false);

  // Subscribe to the published version history (lightweight metadata list).
  useEffect(() => {
    if (!sceneId) return undefined;
    const unsubscribe = subscribeSceneVersions(sceneId, setVersions);
    return () => unsubscribe();
  }, [sceneId]);

  const publishedAt = scene?.publishedAt ?? 0;
  const updatedAt = scene?.updatedAt ?? 0;
  const neverPublished = !scene?.published;
  const isDirty = neverPublished || updatedAt > publishedAt;
  const canDiscard = !neverPublished && isDirty;

  // Only diff against the published snapshot — when nothing has been
  // published yet there's nothing meaningful to enumerate.
  const pendingChanges = useMemo(
    () => (neverPublished ? [] : diffSnapshots(scene, scene.published)),
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

  const handleRestore = useCallback(async () => {
    const version = confirmRestore;
    setConfirmRestore(null);
    if (!version || restoringId || !onRestoreVersion) return;
    setRestoringId(version.id);
    try {
      await onRestoreVersion(version.id);
    } catch (err) {
      console.error('[Restore] failed:', err);
    }
    setRestoringId(null);
  }, [confirmRestore, restoringId, onRestoreVersion]);

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

        {versions.length > 0 && (
          <div className={`publish-versions${versionsOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="publish-versions-title"
              aria-expanded={versionsOpen}
              onClick={() => setVersionsOpen((o) => !o)}
            >
              <span className={`publish-version-chevron${versionsOpen ? ' is-open' : ''}`}>▸</span>
              Versiones publicadas
              <span className="publish-changes-count">{versions.length}</span>
            </button>
            {versionsOpen && (<>
            <ul className="publish-versions-list">
              {versions.map((v, i) => {
                const isOpen = expandedVersion === v.id;
                return (
                  <li key={v.id} className={`publish-version-card${isOpen ? ' is-open' : ''}`}>
                    <button
                      type="button"
                      className="publish-version-header"
                      aria-expanded={isOpen}
                      onClick={() => setExpandedVersion(isOpen ? null : v.id)}
                    >
                      <span className={`publish-version-chevron${isOpen ? ' is-open' : ''}`}>▸</span>
                      <span className="publish-version-date">{formatDateTime(v.publishedAt)}</span>
                      {i === 0 && <span className="publish-version-live">En vivo</span>}
                      {v.changes.length > 0 && (
                        <span className="publish-changes-count">{v.changes.length}</span>
                      )}
                    </button>

                    {isOpen && (
                      <div className="publish-version-body">
                        {v.changes.length > 0 ? (
                          <ul className="publish-changes-list">
                            {v.changes.map((label, idx) => (
                              <li key={`${label}-${idx}`}>{label}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="publish-version-empty">Sin cambios registrados.</p>
                        )}
                        <button
                          type="button"
                          className="publish-version-restore"
                          disabled={!!restoringId || publishing || discarding}
                          onClick={() => setConfirmRestore(v)}
                          title="Cargar esta versión en el editor para revisarla"
                        >
                          {restoringId === v.id ? 'Restaurando…' : 'Restaurar esta versión'}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="publish-versions-hint">
              Restaurar carga la versión en el editor. La vista pública no cambia
              hasta que publiques de nuevo.
            </p>
            </>)}
          </div>
        )}

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

      {confirmRestore && (
        <ConfirmDialog
          title="Restaurar versión"
          message={`Se va a cargar la versión del ${formatDateTime(confirmRestore.publishedAt)} en el editor, reemplazando los cambios actuales sin publicar. La vista pública no cambia hasta que publiques de nuevo.`}
          confirmLabel="Restaurar"
          onConfirm={handleRestore}
          onCancel={() => setConfirmRestore(null)}
        />
      )}
    </FloatingPanel>
  );
}
