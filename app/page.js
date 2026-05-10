'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSceneList } from '@/hooks/useSceneList';
import { createScene, deleteScene, renameScene } from '@/lib/scenes';
import { deleteSceneAssets } from '@/lib/storage';
import versionData from '../version.json';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

export default function HomePage() {
  const { scenes, loading, error } = useSceneList();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef(null);
  const router = useRouter();

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
      const id = await createScene(name);
      setNewName('');
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

  return (
    <div className="home-container">
      <div className="home-card animate-fade">
        <div className="home-header">
          <h1>XRS Showroom</h1>
          <p>Gestión de escenas 3D</p>
        </div>

        <div className="panel-body">
          {error ? (
            <div className="empty-state">
              <div className="empty-icon">⚠️</div>
              <p style={{ color: '#ff6b6b' }}>
                Error al cargar escenas:<br />
                <code style={{ fontSize: '0.85em', wordBreak: 'break-word' }}>
                  {error.code || error.name || 'Error'}: {error.message}
                </code>
              </p>
            </div>
          ) : loading ? (
            <div className="empty-state">
              <p>Cargando escenas…</p>
            </div>
          ) : scenes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🎬</div>
              <p>No hay escenas todavía.<br />Creá la primera para comenzar.</p>
            </div>
          ) : (
            <div className="scene-list">
              {scenes.map((scene) => (
                <div
                  key={scene.id}
                  className="scene-item"
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
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          <div className="create-scene-row">
            <input
              type="text"
              placeholder="Nombre de escena…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
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
        </div>
      </div>

      <span className="version-badge">v{versionData.version}</span>

      {deleteTarget && (
        <ConfirmDialog
          title="Eliminar escena"
          message={`¿Estás seguro de eliminar "${deleteTarget.name}"? Se borrarán todos los archivos asociados.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

