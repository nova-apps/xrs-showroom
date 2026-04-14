'use client';

/**
 * RightPanelStack — a single floating container on the right side
 * that holds Assets, Orbit, and Transform panels as accordion sections.
 * Only one section can be expanded at a time; clicking another collapses the active one.
 * All start collapsed by default.
 */

import { useState, useCallback } from 'react';

const PANEL_IDS = ['assets', 'orbit'];

export default function RightPanelStack({ children }) {
  // null = all collapsed, string = which panel is open
  const [activePanel, setActivePanel] = useState(null);

  const toggle = useCallback((panelId) => {
    setActivePanel((prev) => (prev === panelId ? null : panelId));
  }, []);

  return (
    <div className="right-panel-stack">
      {typeof children === 'function' ? children({ activePanel, toggle }) : children}
    </div>
  );
}
