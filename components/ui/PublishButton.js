'use client';

import { useState, useCallback } from 'react';
import ConfirmDialog from './ConfirmDialog';

/**
 * Floating button(s) for publish / discard.
 *  - Publish snapshots scene.* into scene.published so /view/ updates.
 *  - Discard reverts scene.* back to scene.published so the editor matches
 *    the live version. Only shown when there is a published snapshot AND
 *    the draft has unsaved changes.
 */
export default function PublishButton({ scene, onPublish, onDiscard }) {
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const publishedAt = scene?.publishedAt ?? 0;
  const updatedAt = scene?.updatedAt ?? 0;
  const neverPublished = !scene?.published;
  const isDirty = neverPublished || updatedAt > publishedAt;
  const canDiscard = !neverPublished && isDirty;

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
        ? 'Publicar'
        : isDirty
          ? 'Publicar cambios'
          : 'Publicado';

  const publishClasses = [
    'publish-button',
    isDirty ? 'publish-button-dirty' : 'publish-button-clean',
    publishing ? 'publish-button-loading' : '',
    justPublished ? 'publish-button-success' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      {canDiscard && (
        <button
          type="button"
          className="discard-button"
          disabled={discarding || publishing}
          onClick={() => setConfirmDiscard(true)}
          title="Volver al estado publicado y perder los cambios actuales"
        >
          {discarding ? 'Descartando…' : 'Descartar'}
        </button>
      )}
      <button
        type="button"
        className={publishClasses}
        disabled={publishing || (!isDirty && !justPublished)}
        onClick={handlePublish}
        title={
          neverPublished
            ? 'Publicar por primera vez para que /view/ muestre la escena'
            : isDirty
              ? 'Hay cambios sin publicar. /view/ sigue mostrando la versión anterior.'
              : 'No hay cambios para publicar'
        }
      >
        <span className="publish-button-dot" aria-hidden="true" />
        {publishLabel}
      </button>

      {confirmDiscard && (
        <ConfirmDialog
          title="Descartar cambios"
          message="Los cambios sin publicar se van a perder y la escena vuelve al estado publicado. Esta acción no se puede deshacer."
          confirmLabel="Descartar"
          onConfirm={handleDiscard}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </>
  );
}
