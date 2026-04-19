'use client';

/**
 * PresetsPanel — CRUD for material presets.
 * Each preset has a name and a set of material properties.
 */

import { useState, useCallback } from 'react';
import FloatingPanel from './FloatingPanel';
import { usePresets } from '@/hooks/usePresets';
import { createPreset, updatePreset, deletePreset } from '@/lib/presets';

const DEFAULT_PROPERTIES = {
  color: 'cccccc',
  opacity: 1,
  metalness: 0,
  roughness: 0.5,
  transparent: false,
};

const BUILT_IN_TEMPLATES = [
  { name: 'Hormigón', properties: { color: 'a0a0a0', metalness: 0, roughness: 0.9, opacity: 1, transparent: false } },
  { name: 'Vidrio', properties: { color: 'ffffff', metalness: 0.1, roughness: 0.05, opacity: 0.15, transparent: true, depthWrite: false } },
  { name: 'Acero', properties: { color: 'c8c8c8', metalness: 0.95, roughness: 0.15, opacity: 1, transparent: false } },
  { name: 'Césped', properties: { color: '4a8c3f', metalness: 0, roughness: 0.95, opacity: 1, transparent: false } },
  { name: 'Madera', properties: { color: '8b6914', metalness: 0, roughness: 0.7, opacity: 1, transparent: false } },
  { name: 'Ladrillo', properties: { color: '9b4a2c', metalness: 0, roughness: 0.85, opacity: 1, transparent: false } },
  { name: 'Agua', properties: { color: '3388cc', metalness: 0.1, roughness: 0.1, opacity: 0.6, transparent: true, depthWrite: false } },
  { name: 'Mármol', properties: { color: 'f0ebe0', metalness: 0.05, roughness: 0.25, opacity: 1, transparent: false } },
];

function PresetEditor({ preset, onSave, onCancel }) {
  const [name, setName] = useState(preset?.name || '');
  const [props, setProps] = useState(preset?.properties || { ...DEFAULT_PROPERTIES });

  const updateProp = (key, value) => {
    setProps((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="preset-editor">
      <div className="preset-editor-field">
        <label>Nombre</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Hormigón" />
      </div>
      <div className="preset-editor-field">
        <label>Color</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="color" value={`#${props.color || 'cccccc'}`} onChange={(e) => updateProp('color', e.target.value.replace('#', ''))} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{props.color}</span>
        </div>
      </div>
      <div className="preset-editor-field">
        <label>Metalness</label>
        <input type="range" min={0} max={1} step={0.01} value={props.metalness ?? 0} onChange={(e) => updateProp('metalness', parseFloat(e.target.value))} />
        <span className="preset-editor-value">{(props.metalness ?? 0).toFixed(2)}</span>
      </div>
      <div className="preset-editor-field">
        <label>Roughness</label>
        <input type="range" min={0} max={1} step={0.01} value={props.roughness ?? 0.5} onChange={(e) => updateProp('roughness', parseFloat(e.target.value))} />
        <span className="preset-editor-value">{(props.roughness ?? 0.5).toFixed(2)}</span>
      </div>
      <div className="preset-editor-field">
        <label>Opacidad</label>
        <input type="range" min={0} max={1} step={0.01} value={props.opacity ?? 1} onChange={(e) => updateProp('opacity', parseFloat(e.target.value))} />
        <span className="preset-editor-value">{(props.opacity ?? 1).toFixed(2)}</span>
      </div>
      <div className="preset-editor-field">
        <label>Transparente</label>
        <label className="mat-toggle">
          <input type="checkbox" checked={!!props.transparent} onChange={(e) => updateProp('transparent', e.target.checked)} />
          <span className="mat-toggle-slider" />
        </label>
      </div>
      <div className="preset-editor-actions">
        <button className="btn btn-sm btn-primary" onClick={() => onSave({ name: name.trim(), properties: props })} disabled={!name.trim()}>
          Guardar
        </button>
        <button className="btn btn-sm" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

export default function PresetsPanel({ collapsed, onToggle }) {
  const { presets, loading } = usePresets();
  const [editing, setEditing] = useState(null); // null | 'new' | preset id
  const [editingPreset, setEditingPreset] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const handleCreate = useCallback(() => {
    setEditing('new');
    setEditingPreset(null);
  }, []);

  const handleEdit = useCallback((preset) => {
    setEditing(preset.id);
    setEditingPreset(preset);
  }, []);

  const handleSave = useCallback(async (data) => {
    try {
      if (editing === 'new') {
        await createPreset(data);
      } else {
        await updatePreset(editing, data);
      }
    } catch (err) {
      console.error('Failed to save preset:', err);
    }
    setEditing(null);
    setEditingPreset(null);
  }, [editing]);

  const handleDelete = useCallback(async (id) => {
    try {
      await deletePreset(id);
    } catch (err) {
      console.error('Failed to delete preset:', err);
    }
    setConfirmDelete(null);
  }, []);

  const handleAddTemplate = useCallback(async (template) => {
    try {
      await createPreset(template);
    } catch (err) {
      console.error('Failed to add template:', err);
    }
  }, []);

  const title = `Presets${presets.length > 0 ? ` (${presets.length})` : ''}`;

  return (
    <FloatingPanel title={title} icon="🧪" position="" collapsed={collapsed} onToggle={onToggle}>
      {editing ? (
        <PresetEditor
          preset={editingPreset}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setEditingPreset(null); }}
        />
      ) : (
        <div className="presets-panel-body">
          {/* Preset List */}
          {presets.length === 0 && !loading ? (
            <div className="empty-state" style={{ padding: '8px 0' }}>
              <p>Sin presets. Agregá uno o usá las plantillas.</p>
            </div>
          ) : (
            <div className="presets-list">
              {presets.map((p) => (
                <div key={p.id} className="preset-item">
                  <span
                    className="preset-color-dot"
                    style={{ background: `#${p.properties?.color || 'ccc'}` }}
                  />
                  <span className="preset-name">{p.name}</span>
                  <button className="preset-action-btn" onClick={() => handleEdit(p)} title="Editar">✏️</button>
                  {confirmDelete === p.id ? (
                    <>
                      <button className="preset-action-btn preset-delete-confirm" onClick={() => handleDelete(p.id)}>✓</button>
                      <button className="preset-action-btn" onClick={() => setConfirmDelete(null)}>✕</button>
                    </>
                  ) : (
                    <button className="preset-action-btn" onClick={() => setConfirmDelete(p.id)} title="Eliminar">🗑️</button>
                  )}
                </div>
              ))}
            </div>
          )}

          <button className="btn btn-sm btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={handleCreate}>
            + Nuevo preset
          </button>

          {/* Built-in templates */}
          {presets.length === 0 && (
            <div className="presets-templates">
              <div className="presets-templates-title">Plantillas rápidas</div>
              <div className="presets-templates-grid">
                {BUILT_IN_TEMPLATES.map((t) => (
                  <button
                    key={t.name}
                    className="preset-template-btn"
                    onClick={() => handleAddTemplate(t)}
                  >
                    <span className="preset-color-dot" style={{ background: `#${t.properties.color}` }} />
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </FloatingPanel>
  );
}
