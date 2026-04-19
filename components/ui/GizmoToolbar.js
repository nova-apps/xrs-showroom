'use client';

import { useState } from 'react';

const IconCursor = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    <path d="M13 13l6 6" />
  </svg>
);

const IconMove = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="5 9 2 12 5 15" />
    <polyline points="9 5 12 2 15 5" />
    <polyline points="15 19 12 22 9 19" />
    <polyline points="19 9 22 12 19 15" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="12" y1="2" x2="12" y2="22" />
  </svg>
);

const IconRotate = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

const IconScale = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

const MODES = [
  { id: 'select',    icon: IconCursor, title: 'Seleccionar',  gizmo: null },
  { id: 'translate', icon: IconMove,   title: 'Posición',     gizmo: 'translate' },
  { id: 'rotate',    icon: IconRotate, title: 'Rotación',     gizmo: 'rotate' },
  { id: 'scale',     icon: IconScale,  title: 'Escala',       gizmo: 'scale' },
];

export default function GizmoToolbar({ activeMode, onModeChange }) {
  return (
    <div className="gizmo-toolbar">
      {MODES.map((m) => {
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            className={`gizmo-btn ${activeMode === m.id ? 'active' : ''}`}
            onClick={() => onModeChange(m.id)}
            title={m.title}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
