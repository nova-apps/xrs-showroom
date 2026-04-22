'use client';

/**
 * LeftPanelStack — a collapsible sidebar on the left side.
 * Now only contains the units listing panel.
 */

import { useState, useCallback } from 'react';

export default function LeftPanelStack({ children, title }) {
  const [activePanel, setActivePanel] = useState('unidadesList'); // Start expanded
  const [visible, setVisible] = useState(true);

  const toggle = useCallback((panelId) => {
    setActivePanel((prev) => (prev === panelId ? null : panelId));
  }, []);

  return (
    <>
      {/* Toggle button — only shown when stack is hidden */}
      <button
        className={`panel-stack-toggle${visible ? ' toggle-visible' : ''}`}
        onClick={() => setVisible(true)}
        title="Mostrar panel"
      >
        📋
      </button>

      <div className={`left-panel-stack${visible ? '' : ' stack-hidden'}`}>
        {/* ─── Header ─── */}
        <div className="sidebar-header">
          <div className="sidebar-header-top">
            <span className="sidebar-scene-label">{title || 'Proyecto'}</span>
            <button
              className="sidebar-close-btn"
              onClick={() => setVisible(false)}
              title="Ocultar paneles"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ─── Scrollable panel area ─── */}
        <div className="sidebar-panels">
          {typeof children === 'function' ? children({ activePanel, toggle }) : children}
        </div>
      </div>
    </>
  );
}
