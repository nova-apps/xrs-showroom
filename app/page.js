'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSceneList } from '@/hooks/useSceneList';
import { createScene, deleteScene, renameScene } from '@/lib/scenes';
import { deleteSceneAssets } from '@/lib/storage';
import versionData from '../version.json';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

const TYPE_META = {
  edificio: { label: 'Edificio', icon: '🏢' },
  terreno: { label: 'Terreno', icon: '🌳' },
};

function formatDate(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function formatRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'hace segundos';
  const min = Math.round(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const days = Math.round(hr / 24);
  if (days < 30) return `hace ${days} d`;
  return formatDate(ts);
}

function isPublished(scene) {
  return Boolean(scene?.publishedAt || scene?.published);
}

function productionUrl(scene) {
  if (typeof window === 'undefined') return '';
  if (scene.customDomain) return `https://${scene.customDomain}`;
  return `${window.location.origin}/view/${scene.id}`;
}

export default function HomePage() {
  const { scenes, loading, error } = useSceneList();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all | edificio | terreno
  const [statusFilter, setStatusFilter] = useState('all'); // all | published | draft

  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('edificio');
  const [creating, setCreating] = useState(false);

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef(null);
  const createInputRef = useRef(null);

  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (showCreate && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [showCreate]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (showCreate) setShowCreate(false);
        else if (selectedId) setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCreate, selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scenes.filter((s) => {
      if (typeFilter !== 'all' && (s.type || 'edificio') !== typeFilter) return false;
      if (statusFilter === 'published' && !isPublished(s)) return false;
      if (statusFilter === 'draft' && isPublished(s)) return false;
      if (q) {
        const haystack = `${s.name || ''} ${s.customDomain || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [scenes, search, typeFilter, statusFilter]);

  const selected = useMemo(
    () => scenes.find((s) => s.id === selectedId) || null,
    [scenes, selectedId]
  );

  const counts = useMemo(() => {
    const total = scenes.length;
    const edificio = scenes.filter((s) => (s.type || 'edificio') === 'edificio').length;
    const terreno = scenes.filter((s) => s.type === 'terreno').length;
    const published = scenes.filter(isPublished).length;
    return { total, edificio, terreno, published, draft: total - published };
  }, [scenes]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const id = await createScene(name, newType);
      setNewName('');
      setNewType('edificio');
      setShowCreate(false);
      router.push(`/scenes/${id}`);
    } catch (err) {
      console.error('Failed to create scene:', err);
    }
    setCreating(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    try {
      await deleteSceneAssets(id);
      await deleteScene(id);
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      console.error('Failed to delete scene:', err);
    }
    setDeleteTarget(null);
  };

  const startRename = () => {
    if (!selected) return;
    setRenameValue(selected.name || '');
    setRenaming(true);
  };

  const commitRename = async () => {
    const trimmed = renameValue.trim();
    if (trimmed && selected && trimmed !== selected.name) {
      try {
        await renameScene(selected.id, trimmed);
      } catch (err) {
        console.error('Failed to rename scene:', err);
      }
    }
    setRenaming(false);
  };

  return (
    <div className="library-root">
      <header className="library-topbar">
        <div className="library-brand">
          <span className="library-brand-logo">XRS</span>
          <div>
            <h1>Showroom</h1>
            <p>{counts.total} {counts.total === 1 ? 'escena' : 'escenas'}</p>
          </div>
        </div>

        <div className="library-search">
          <span className="library-search-icon">🔍</span>
          <input
            type="text"
            placeholder="Buscar por nombre o dominio…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="library-search-clear"
              onClick={() => setSearch('')}
              title="Limpiar"
            >
              ✕
            </button>
          )}
        </div>

        <button
          className="btn btn-primary library-create-btn"
          onClick={() => setShowCreate(true)}
        >
          <span className="library-create-plus">+</span> Nueva escena
        </button>
      </header>

      <div className="library-filters">
        <div className="library-filter-group">
          <span className="library-filter-label">Tipo</span>
          <div className="library-segmented">
            <button
              className={typeFilter === 'all' ? 'active' : ''}
              onClick={() => setTypeFilter('all')}
            >
              Todos <span className="library-pill">{counts.total}</span>
            </button>
            <button
              className={typeFilter === 'edificio' ? 'active' : ''}
              onClick={() => setTypeFilter('edificio')}
            >
              🏢 Edificio <span className="library-pill">{counts.edificio}</span>
            </button>
            <button
              className={typeFilter === 'terreno' ? 'active' : ''}
              onClick={() => setTypeFilter('terreno')}
            >
              🌳 Terreno <span className="library-pill">{counts.terreno}</span>
            </button>
          </div>
        </div>

        <div className="library-filter-group">
          <span className="library-filter-label">Estado</span>
          <div className="library-segmented">
            <button
              className={statusFilter === 'all' ? 'active' : ''}
              onClick={() => setStatusFilter('all')}
            >
              Todos
            </button>
            <button
              className={statusFilter === 'published' ? 'active' : ''}
              onClick={() => setStatusFilter('published')}
            >
              Publicadas <span className="library-pill">{counts.published}</span>
            </button>
            <button
              className={statusFilter === 'draft' ? 'active' : ''}
              onClick={() => setStatusFilter('draft')}
            >
              Borrador <span className="library-pill">{counts.draft}</span>
            </button>
          </div>
        </div>
      </div>

      <main className="library-main">
        {error ? (
          <div className="library-empty">
            <div className="library-empty-icon">⚠️</div>
            <p style={{ color: '#ff6b6b' }}>
              Error al cargar escenas:<br />
              <code style={{ fontSize: '0.85em' }}>
                {error.code || error.name || 'Error'}: {error.message}
              </code>
            </p>
          </div>
        ) : loading ? (
          <div className="library-empty">
            <p>Cargando escenas…</p>
          </div>
        ) : scenes.length === 0 ? (
          <div className="library-empty">
            <div className="library-empty-icon">🎬</div>
            <p>
              No hay escenas todavía.<br />
              Creá la primera para comenzar.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => setShowCreate(true)}
              style={{ marginTop: 16 }}
            >
              + Nueva escena
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="library-empty">
            <div className="library-empty-icon">🔍</div>
            <p>
              Sin resultados para los filtros actuales.
            </p>
            <button
              className="btn"
              onClick={() => {
                setSearch('');
                setTypeFilter('all');
                setStatusFilter('all');
              }}
              style={{ marginTop: 12 }}
            >
              Limpiar filtros
            </button>
          </div>
        ) : (
          <div className="library-grid">
            {filtered.map((scene) => {
              const type = scene.type || 'edificio';
              const meta = TYPE_META[type] || TYPE_META.edificio;
              const published = isPublished(scene);
              const active = selectedId === scene.id;
              return (
                <button
                  key={scene.id}
                  className={`library-card${active ? ' is-active' : ''}`}
                  onClick={() => setSelectedId(scene.id)}
                >
                  <div className={`library-card-thumb library-card-thumb-${type}`}>
                    {scene.panelLogoUrl ? (
                      <img
                        src={scene.panelLogoUrl}
                        alt=""
                        className="library-card-logo"
                      />
                    ) : (
                      <span className="library-card-icon">{meta.icon}</span>
                    )}
                    <span className={`library-card-badge library-card-badge-${published ? 'live' : 'draft'}`}>
                      {published ? '● Publicada' : '○ Borrador'}
                    </span>
                  </div>
                  <div className="library-card-body">
                    <h3 className="library-card-name">{scene.name || 'Sin nombre'}</h3>
                    <div className="library-card-meta">
                      <span className="library-card-type">{meta.label}</span>
                      <span className="library-card-dot">·</span>
                      <span className="library-card-updated">
                        {formatRelative(scene.updatedAt || scene.createdAt)}
                      </span>
                    </div>
                    {scene.customDomain && (
                      <div className="library-card-domain" title={scene.customDomain}>
                        🌐 {scene.customDomain}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      <span className="version-badge">v{versionData.version}</span>

      {/* Side panel */}
      {selected && (
        <>
          <div
            className="library-panel-overlay"
            onClick={() => {
              if (!renaming) setSelectedId(null);
            }}
          />
          <aside className="library-panel" onClick={(e) => e.stopPropagation()}>
            <div className="library-panel-header">
              <div className="library-panel-header-left">
                <span className="library-panel-type-icon">
                  {(TYPE_META[selected.type || 'edificio'] || TYPE_META.edificio).icon}
                </span>
                {renaming ? (
                  <input
                    ref={renameRef}
                    className="library-panel-rename-input"
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setRenaming(false);
                      }
                    }}
                  />
                ) : (
                  <h2 className="library-panel-title" onDoubleClick={startRename}>
                    {selected.name || 'Sin nombre'}
                  </h2>
                )}
              </div>
              <button
                className="library-panel-close"
                onClick={() => setSelectedId(null)}
                title="Cerrar"
              >
                ✕
              </button>
            </div>

            <div className="library-panel-scroll">
              <div className="library-panel-hero">
                {selected.panelLogoUrl ? (
                  <img
                    src={selected.panelLogoUrl}
                    alt=""
                    className="library-panel-hero-img"
                  />
                ) : (
                  <span className="library-panel-hero-icon">
                    {(TYPE_META[selected.type || 'edificio'] || TYPE_META.edificio).icon}
                  </span>
                )}
                <span
                  className={`library-card-badge library-card-badge-${
                    isPublished(selected) ? 'live' : 'draft'
                  }`}
                >
                  {isPublished(selected) ? '● Publicada' : '○ Borrador'}
                </span>
              </div>

              <div className="library-panel-section">
                <div className="library-panel-row">
                  <span className="library-panel-label">Tipo</span>
                  <span className="library-panel-value">
                    {(TYPE_META[selected.type || 'edificio'] || TYPE_META.edificio).label}
                  </span>
                </div>
                <div className="library-panel-row">
                  <span className="library-panel-label">Última edición</span>
                  <span className="library-panel-value">
                    {formatDate(selected.updatedAt || selected.createdAt)}
                  </span>
                </div>
                <div className="library-panel-row">
                  <span className="library-panel-label">Creada</span>
                  <span className="library-panel-value">{formatDate(selected.createdAt)}</span>
                </div>
                {selected.publishedAt && (
                  <div className="library-panel-row">
                    <span className="library-panel-label">Publicada</span>
                    <span className="library-panel-value">{formatDate(selected.publishedAt)}</span>
                  </div>
                )}
                {selected.customDomain && (
                  <div className="library-panel-row">
                    <span className="library-panel-label">Dominio</span>
                    <a
                      className="library-panel-link"
                      href={`https://${selected.customDomain}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {selected.customDomain}
                    </a>
                  </div>
                )}
              </div>

              <div className="library-panel-actions">
                <button
                  className="library-panel-btn library-panel-btn-primary"
                  onClick={() => router.push(`/scenes/${selected.id}`)}
                >
                  <span>✏️</span> Abrir editor
                </button>
                <button
                  className="library-panel-btn library-panel-btn-secondary"
                  onClick={() => {
                    const url = productionUrl(selected);
                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                  disabled={!isPublished(selected)}
                  title={!isPublished(selected) ? 'Aún no publicada' : 'Ver en producción'}
                >
                  <span>🌐</span> Ver en producción
                </button>
                <button
                  className="library-panel-btn library-panel-btn-ghost"
                  onClick={() => {
                    const url = productionUrl(selected);
                    if (url) {
                      navigator.clipboard?.writeText(url).catch(() => {});
                    }
                  }}
                >
                  <span>🔗</span> Copiar link
                </button>
              </div>

              <div className="library-panel-section library-panel-section-secondary">
                <button className="library-panel-link-btn" onClick={startRename}>
                  Renombrar
                </button>
                <button
                  className="library-panel-link-btn library-panel-link-btn-danger"
                  onClick={() => setDeleteTarget(selected)}
                >
                  Eliminar escena
                </button>
              </div>
            </div>
          </aside>
        </>
      )}

      {/* Create modal */}
      {showCreate && (
        <div
          className="dialog-overlay"
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            className="library-create-modal animate-fade"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Nueva escena</h3>
            <p className="library-create-hint">
              Elegí un nombre y un tipo. El tipo no se puede cambiar después.
            </p>
            <input
              ref={createInputRef}
              type="text"
              placeholder="Nombre de la escena…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                else if (e.key === 'Escape' && !creating) setShowCreate(false);
              }}
              disabled={creating}
              className="library-create-input"
            />
            <div className="create-scene-type" role="radiogroup" aria-label="Tipo de escena">
              <button
                type="button"
                role="radio"
                aria-checked={newType === 'edificio'}
                className={`scene-type-option${newType === 'edificio' ? ' active' : ''}`}
                onClick={() => setNewType('edificio')}
                disabled={creating}
              >
                🏢 Edificio
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={newType === 'terreno'}
                className={`scene-type-option${newType === 'terreno' ? ' active' : ''}`}
                onClick={() => setNewType('terreno')}
                disabled={creating}
              >
                🌳 Terreno
              </button>
            </div>
            <div className="library-create-actions">
              <button
                className="btn"
                onClick={() => setShowCreate(false)}
                disabled={creating}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
              >
                {creating ? 'Creando…' : 'Crear escena'}
              </button>
            </div>
          </div>
        </div>
      )}

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
