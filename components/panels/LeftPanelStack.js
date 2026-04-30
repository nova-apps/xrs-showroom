'use client';

/**
 * LeftPanelStack — full-height side panel anchored to the left edge.
 * Uses a tab bar (below the logo) to switch between content panels.
 * On mobile: starts collapsed (only tabs visible, none selected).
 * Tapping a tab expands content. Tapping outside or the active tab collapses.
 * Content is always rendered (CSS-hidden when collapsed) so modals survive collapse.
 * Exposes a ref with `.collapse()` to programmatically collapse the panel.
 */

import { useState, useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from 'react';

const LeftPanelStack = forwardRef(function LeftPanelStack(
  { children, title, logoUrl, tabs = [], show = true },
  ref,
) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id || null);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // On mobile, no tab is visually selected until the user taps one
  const [mobileTabChosen, setMobileTabChosen] = useState(false);
  const panelRef = useRef(null);

  // On mobile, tapping a tab toggles expanded/collapsed
  const selectTab = useCallback((tabId) => {
    if (isMobile) {
      if (mobileExpanded && activeTab === tabId) {
        // Tapping the active tab → collapse
        setMobileExpanded(false);
      } else {
        // Tapping a (different) tab → switch + expand
        setActiveTab(tabId);
        setMobileExpanded(true);
        setMobileTabChosen(true);
      }
    } else {
      setActiveTab(tabId);
    }
  }, [isMobile, mobileExpanded, activeTab]);

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

  // Click-outside to collapse on mobile
  useEffect(() => {
    if (!isMobile || !mobileExpanded) return;

    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        // Ignore clicks on portaled drawers/modals (they live outside the panel DOM)
        if (e.target.closest('.unit-drawer, .amenity-detail-modal, .panorama-viewer')) return;
        setMobileExpanded(false);
      }
    };

    // Use a short delay so the expanding tap doesn't immediately trigger collapse
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleClickOutside);
    }, 200);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [isMobile, mobileExpanded]);

  // Expose collapse method to parent
  useImperativeHandle(ref, () => ({
    collapse: () => setMobileExpanded(false),
  }), []);

  // Determine if a tab should look "active" — on mobile, only after user explicitly chose one
  const isTabActive = (tabId) => {
    if (isMobile && !mobileTabChosen) return false;
    return activeTab === tabId;
  };

  const stackClass = [
    'left-panel-stack',
    show ? 'stack-entered' : 'stack-hidden',
    mobileExpanded ? 'stack-expanded' : '',
    isMobile && !mobileExpanded ? 'stack-tabs-only' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={stackClass} ref={panelRef}>
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
              className={`sidebar-tab${isTabActive(tab.id) ? ' active' : ''}`}
              onClick={() => selectTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Tab content — always rendered, hidden via CSS media query when collapsed ─── */}
      <div className="sidebar-panels">
        {typeof children === 'function' ? children({ activeTab }) : children}
      </div>
    </div>
  );
});

export default LeftPanelStack;
