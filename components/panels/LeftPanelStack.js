'use client';

/**
 * LeftPanelStack — full-height side panel anchored to the left edge.
 * Uses a tab bar (below the logo) to switch between content panels.
 * Default active tab is the first one in the `tabs` array.
 * On mobile: includes a drag-handle bar to toggle expanded height.
 * Exposes a ref with `.collapse()` to programmatically collapse the panel.
 */

import { useState, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';

const LeftPanelStack = forwardRef(function LeftPanelStack(
  { children, title, logoUrl, tabs = [], show = true },
  ref,
) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id || null);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const selectTab = useCallback((tabId) => {
    setActiveTab(tabId);
  }, []);

  // Detect mobile viewport
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    setIsMobile(mql.matches);
    const handler = (e) => {
      setIsMobile(e.matches);
      if (!e.matches) setMobileExpanded(false);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Expose collapse method to parent
  useImperativeHandle(ref, () => ({
    collapse: () => setMobileExpanded(false),
  }), []);

  const stackClass = [
    'left-panel-stack',
    show ? 'stack-entered' : 'stack-hidden',
    mobileExpanded ? 'stack-expanded' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={stackClass}>
      {/* ─── Mobile drag handle to expand/collapse ─── */}
      {isMobile && (
        <button
          className="mobile-panel-handle"
          onClick={() => setMobileExpanded((v) => !v)}
          aria-label={mobileExpanded ? 'Contraer panel' : 'Expandir panel'}
        >
          <span className="mobile-panel-handle-bar" />
        </button>
      )}

      {/* ─── Header with logo (hidden on mobile via CSS) ─── */}
      <div className="sidebar-header sidebar-header-desktop">
        <div className="sidebar-header-top">
          {logoUrl ? (
            <div className="sidebar-logo">
              <img src={logoUrl} alt={title || 'Logo'} className="sidebar-logo-img" />
            </div>
          ) : (
            <span className="sidebar-scene-label">{title || 'Proyecto'}</span>
          )}
        </div>
      </div>

      {/* ─── Tab bar ─── */}
      {tabs.length > 1 && (
        <div className="sidebar-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`sidebar-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => selectTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Tab content ─── */}
      <div className="sidebar-panels">
        {typeof children === 'function' ? children({ activeTab }) : children}
      </div>
    </div>
  );
});

export default LeftPanelStack;
