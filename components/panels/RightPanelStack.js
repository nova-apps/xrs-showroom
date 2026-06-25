'use client';

/**
 * RightPanelStack — drill-in sidebar on the right.
 *
 * Renders a list of section buttons. Clicking one opens the section in a
 * detail view that hides the others and shows a back arrow. All section
 * panels stay mounted (toggled via CSS) so transient form state survives
 * navigation between sections.
 *
 * The `sections` prop is the source of truth for the button list:
 *   [{ id, label, icon, hint?, badge? }]
 *
 * `children` is a render function that receives `{ activePanel, open }`:
 *   - `activePanel`: id of the currently-open section, or null on the menu.
 *   - `open(id)`: programmatic navigation, in case a panel wants to jump.
 *
 * Each rendered child should wrap its panel in a div with
 * `data-section="<id>"` so the stack can show only the active one.
 */

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RightPanelStack({ sceneName, sections = [], children, onActivePanelChange }) {
  const [activePanel, setActivePanel] = useState(null);
  const [visible, setVisible] = useState(true);
  const router = useRouter();

  // Notify the parent whenever the open section changes (e.g. to detach the
  // transform gizmo when leaving the Assets panel).
  useEffect(() => {
    onActivePanelChange?.(activePanel);
  }, [activePanel, onActivePanelChange]);

  const open = useCallback((id) => setActivePanel(id), []);
  const back = useCallback(() => setActivePanel(null), []);

  const activeSection = sections.find((s) => s.id === activePanel) || null;

  return (
    <>
      <button
        className={`right-panel-stack-toggle${visible ? ' toggle-visible' : ''}`}
        onClick={() => setVisible(true)}
        title="Mostrar ajustes"
      >
        ⚙
      </button>

      <div className={`right-panel-stack${visible ? '' : ' stack-hidden'}${activePanel ? ' rps-detail' : ' rps-menu'}`}>
        {/* ─── Scene Header ─── */}
        <div className="sidebar-header">
          <div className="sidebar-header-top">
            <span className="sidebar-scene-label" title={sceneName}>{sceneName || 'Sin nombre'}</span>
            <button
              className="sidebar-home-btn"
              onClick={() => router.push('/')}
              title="Volver al inicio"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9.5 12 3l9 6.5" />
                <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
                <path d="M9 20v-6h6v6" />
              </svg>
            </button>
            <button
              className="sidebar-close-btn"
              onClick={() => setVisible(false)}
              title="Ocultar paneles"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ─── Detail header: back button + section title ─── */}
        {activeSection && (
          <div className="rps-detail-header">
            <button className="rps-back-btn" onClick={back} title="Volver al menú">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <span>Volver</span>
            </button>
            <div className="rps-detail-title">
              {activeSection.icon && <span className="rps-detail-icon">{activeSection.icon}</span>}
              <span>{activeSection.label}</span>
            </div>
          </div>
        )}

        {/* ─── Section menu (button list) ─── */}
        {!activePanel && (
          <div className="rps-menu-list">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                className="rps-menu-item"
                onClick={() => open(s.id)}
              >
                {s.icon && <span className="rps-menu-item-icon">{s.icon}</span>}
                <span className="rps-menu-item-label">
                  <span>{s.label}</span>
                  {s.hint && <span className="rps-menu-item-hint">{s.hint}</span>}
                </span>
                {s.badge && <span className="rps-menu-item-badge">{s.badge}</span>}
                <span className="rps-menu-item-chevron">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ─── Mounted panel area (only active visible via CSS) ─── */}
        <div className="sidebar-panels">
          {typeof children === 'function' ? children({ activePanel, open }) : children}
        </div>
      </div>
    </>
  );
}
