'use client';

import { useState, useEffect } from 'react';

/**
 * A single collapsible asset section (inner accordion).
 * Optionally shows an enable/disable (power) toggle in the header. A disabled
 * asset is not loaded into the scene at all (no download, no GPU, no colliders).
 */
export function AssetAccordion({ title, icon, open, onToggle, children, enabled, onToggleEnabled, selected, tris }) {
  return (
    <div className={`asset-accordion ${open ? 'open' : ''} ${selected ? 'selected' : ''} ${enabled === false ? 'disabled-asset' : ''}`}>
      <div className="asset-accordion-header">
        <span className="asset-accordion-title" onClick={onToggle}>
          <span className="asset-accordion-icon">{icon}</span>
          {title}
          {tris > 0 && <span className="asset-tris-badge">{(tris / 1000).toFixed(0)}K tris</span>}
        </span>
        <span className="asset-accordion-actions">
          {onToggleEnabled && (
            <button
              className={`asset-eye-btn ${enabled === false ? 'hidden-asset' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleEnabled(!enabled); }}
              title={enabled === false ? 'Habilitar (cargar en la escena)' : 'Deshabilitar (no cargar)'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                <line x1="12" y1="2" x2="12" y2="12" />
              </svg>
            </button>
          )}
          <span className="asset-accordion-chevron" onClick={onToggle}>▼</span>
        </span>
      </div>
      {open && <div className="asset-accordion-body">{children}</div>}
    </div>
  );
}

/**
 * Inner sub-accordion for collapsible sections within an asset.
 *
 * Two modes:
 *   - Uncontrolled (default): manages its own open state, seeded by
 *     `defaultOpen`. Use when each sub-accordion is independent.
 *   - Controlled: pass `open` + `onToggle` and the parent decides which one
 *     is open. Use this to get exclusive (radio-style) behavior across a
 *     group of siblings.
 */
export function SubAccordion({ title, icon, defaultOpen = false, open: controlledOpen, onToggle, children }) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  useEffect(() => { setInternalOpen(defaultOpen); }, [defaultOpen]);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const handleClick = () => {
    if (isControlled) {
      onToggle?.();
    } else {
      setInternalOpen((v) => !v);
    }
  };

  return (
    <div className={`sub-accordion ${open ? 'open' : ''}`}>
      <div className="sub-accordion-header" onClick={handleClick}>
        <span className="sub-accordion-title">
          {icon && <span className="sub-accordion-icon">{icon}</span>}
          {title}
        </span>
        <span className="sub-accordion-chevron">▼</span>
      </div>
      {open && <div className="sub-accordion-body">{children}</div>}
    </div>
  );
}
