'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSceneList } from '@/hooks/useSceneList';
import { createScene, deleteScene, renameScene } from '@/lib/scenes';
import { deleteSceneAssets } from '@/lib/storage';
import FloatingPanel from './FloatingPanel';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

export default function SceneListPanel({ currentSceneId, position = 'panel-left' }) {
  const { scenes, loading } = useSceneList();
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('edificio');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef(null);
  const router = useRouter();

  // Focus the input when entering edit mode
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;

    setCreating(true);
    try {
      const id = await createScene(name, newType);
      setNewName('');
      setNewType('edificio');
      router.push(`/scenes/${id}`);
    } catch (err) {
      console.error('Failed to create scene:', err);
    }
    setCreating(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSceneAssets(deleteTarget.id);
      await deleteScene(deleteTarget.id);
      if (currentSceneId === deleteTarget.id) {
        router.push('/');
      }
    } catch (err) {
      console.error('Failed to delete scene:', err);
    }
    setDeleteTarget(null);
  };

  const startRename = (scene, e) => {
    e.stopPropagation();
    setEditingId(scene.id);
    setEditingName(scene.name);
  };

  const commitRename = async () => {
    const trimmed = editingName.trim();
    if (trimmed && editingId) {
      try {
        await renameScene(editingId, trimmed);
      } catch (err) {
        console.error('Failed to rename scene:', err);
      }
    }
    setEditingId(null);
    setEditingName('');
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleCreate();
  };

  return (
    <>
      <FloatingPanel title="Escenas" icon="📋" position={position} defaultCollapsed={true}>
        {loading ? (
          <div className="empty-state">
            <p>Cargando…</p>
          </div>
        ) : scenes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎬</div>
            <p>No hay escenas.<br />Creá la primera.</p>
          </div>
        ) : (
          <div className="scene-list">
            {scenes.map((scene) => (
              <div
                key={scene.id}
                className={`scene-item ${scene.id === currentSceneId ? 'active' : ''}`}
                onClick={() => editingId !== scene.id && router.push(`/scenes/${scene.id}`)}
              >
                <span className="scene-dot" />
                {editingId === scene.id ? (
                  <input
                    ref={editInputRef}
                    className="scene-rename-input"
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="scene-name"
                    onDoubleClick={(e) => startRename(scene, e)}
                    title="Doble clic para renombrar"
                  >
                    {scene.name}
                  </span>
                )}
                <button
                  className="scene-rename-btn"
                  title="Renombrar"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editingId === scene.id) {
                      commitRename();
                    } else {
                      startRename(scene, e);
                    }
                  }}
                >
                  ✏️
                </button>
                <button
                  className="scene-view"
                  title="Ver escena"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(`/view/${scene.id}`, '_blank');
                  }}
                >
                  👁
                </button>
                <button
                  className="scene-delete"
                  title="Eliminar"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(scene);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="create-scene-row">
          <input
            type="text"
            placeholder="Nombre de escena…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={creating}
          />
          <button
            className="btn btn-primary btn-icon"
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            title="Crear escena"
          >
            +
          </button>
        </div>

        <div className="create-scene-type" role="radiogroup" aria-label="Tipo de escena">
          <button
            type="button"
            role="radio"
            aria-checked={newType === 'edificio'}
            className={`scene-type-option${newType === 'edificio' ? ' active' : ''}`}
            onClick={() => setNewType('edificio')}
            disabled={creating}
          >
            Edificio
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={newType === 'terreno'}
            className={`scene-type-option${newType === 'terreno' ? ' active' : ''}`}
            onClick={() => setNewType('terreno')}
            disabled={creating}
          >
            Terreno
          </button>
        </div>
      </FloatingPanel>

      {deleteTarget && (
        <ConfirmDialog
          title="Eliminar escena"
          message={`¿Estás seguro de eliminar "${deleteTarget.name}"? Se borrarán todos los archivos asociados.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
