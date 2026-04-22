'use client';

/**
 * RightPanelStack — collapsible sidebar on the right side.
 * Contains a scene header (current scene + switcher), config panels as
 * accordion sections (Assets, Orbit, Presets, Unidades config).
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSceneList } from '@/hooks/useSceneList';

export default function RightPanelStack({ sceneName, sceneId, children }) {
  const [activePanel, setActivePanel] = useState(null);
  const [visible, setVisible] = useState(true);
  const [showScenePicker, setShowScenePicker] = useState(false);
  const { scenes } = useSceneList();
  const router = useRouter();

  const toggle = useCallback((panelId) => {
    setActivePanel((prev) => (prev === panelId ? null : panelId));
  }, []);

  const handleSceneChange = useCallback((id) => {
    setShowScenePicker(false);
    if (id !== sceneId) {
      router.push(`/scenes/${id}`);
    }
  }, [sceneId, router]);

  return (
    <>
      {/* Toggle button — only shown when stack is hidden */}
      <button
        className={`right-panel-stack-toggle${visible ? ' toggle-visible' : ''}`}
        onClick={() => setVisible(true)}
        title="Mostrar ajustes"
      >
        ⚙
      </button>

      <div className={`right-panel-stack${visible ? '' : ' stack-hidden'}`}>
        {/* ─── Scene Header ─── */}
        <div className="sidebar-header">
          <div className="sidebar-header-top">
            <div className="sidebar-scene-name-row">
              <div
                className="sidebar-scene-name"
                onClick={() => setShowScenePicker(!showScenePicker)}
                title="Cambiar escena"
              >
                <span className="sidebar-scene-label">{sceneName || 'Sin nombre'}</span>
                <span className="sidebar-scene-chevron">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </div>
              <button
                className="sidebar-view-btn"
                onClick={(e) => { e.stopPropagation(); window.open(`/view/${sceneId}`, '_blank'); }}
                title="Ver resultado final"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            </div>
            <button
              className="sidebar-close-btn"
              onClick={() => setVisible(false)}
              title="Ocultar paneles"
            >
              ✕
            </button>
          </div>

          {/* Scene Picker Dropdown */}
          {showScenePicker && (
            <div className="sidebar-scene-picker">
              {scenes.map((s) => (
                <div
                  key={s.id}
                  className={`sidebar-scene-option${s.id === sceneId ? ' active' : ''}`}
                  onClick={() => handleSceneChange(s.id)}
                >
                  <span className="sidebar-scene-dot" />
                  {s.name}
                </div>
              ))}
              <div
                className="sidebar-scene-option sidebar-scene-home"
                onClick={() => router.push('/')}
              >
                ← Volver al inicio
              </div>
            </div>
          )}
        </div>

        {/* ─── Scrollable panel area ─── */}
        <div className="sidebar-panels">
          {typeof children === 'function' ? children({ activePanel, toggle }) : children}
        </div>
      </div>
    </>
  );
}
