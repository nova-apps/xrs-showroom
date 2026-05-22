'use client';

import { useState, useEffect } from 'react';

/**
 * A single collapsible asset section (inner accordion).
 * Optionally shows a visibility eye toggle in the header.
 */
export function AssetAccordion({ title, icon, open, onToggle, children, visible, onVisibilityToggle, selected, tris }) {
  return (
    <div className={`asset-accordion ${open ? 'open' : ''} ${selected ? 'selected' : ''}`}>
      <div className="asset-accordion-header">
        <span className="asset-accordion-title" onClick={onToggle}>
          <span className="asset-accordion-icon">{icon}</span>
          {title}
          {tris > 0 && <span className="asset-tris-badge">{(tris / 1000).toFixed(0)}K tris</span>}
        </span>
        <span className="asset-accordion-actions">
          {onVisibilityToggle && (
            <button
              className={`asset-eye-btn ${visible === false ? 'hidden-asset' : ''}`}
              onClick={(e) => { e.stopPropagation(); onVisibilityToggle(!visible); }}
              title={visible === false ? 'Mostrar' : 'Ocultar'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {visible === false ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
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
