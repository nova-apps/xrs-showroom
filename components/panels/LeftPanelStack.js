'use client';

/**
 * LeftPanelStack — a collapsible sidebar on the left side.
 * Starts hidden and animates in when `show` prop becomes true (e.g. after loading screen).
 */

import { useState, useCallback, useEffect } from 'react';

export default function LeftPanelStack({ children, title, show = true }) {
  const [activePanel, setActivePanel] = useState('unidadesList');
  const [visible, setVisible] = useState(false);

  // Animate in when `show` becomes true
  useEffect(() => {
    if (show) {
      // Small delay so the loading screen fully fades before panel appears
      const timer = setTimeout(() => setVisible(true), 200);
      return () => clearTimeout(timer);
    }
  }, [show]);

  const toggle = useCallback((panelId) => {
    setActivePanel((prev) => (prev === panelId ? null : panelId));
  }, []);

  return (
    <>
      {/* Toggle button — only shown when stack is hidden */}
      <button
        className={`panel-stack-toggle${visible ? ' toggle-visible' : ''}${!show ? ' toggle-hidden' : ''}`}
        onClick={() => setVisible(true)}
        title="Mostrar panel"
      >
        📋
      </button>

      <div className={`left-panel-stack${visible ? ' stack-entered' : ' stack-hidden'}`}>
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
