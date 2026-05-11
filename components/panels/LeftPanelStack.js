'use client';

/**
 * LeftPanelStack — full-height side panel anchored to the left edge.
 * Uses a tab bar (below the logo) to switch between content panels.
 * On mobile: starts collapsed (only tabs visible, none selected).
 * Tapping a tab expands content (compact first, then tall on second tap).
 * Tapping outside or the active tab collapses.
 * Content is always rendered (CSS-hidden when collapsed) so modals survive collapse.
 * Exposes a ref with `.collapse()` to programmatically collapse the panel.
 *
 * Sets --mobile-panel-h on :root so the 3D canvas can always fill the
 * remaining vertical space above the panel.
 */

import { useState, useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from 'react';

// Snap heights available on mobile (CSS class → description)
// 'collapsed'  → only the drag handle + tab bar visible
// 'compact'    → 32 vh  (default first expansion)
// 'tall'       → 62 vh  (second tap on handle)
const SNAP = { COLLAPSED: 'collapsed', COMPACT: 'compact', TALL: 'tall' };

const LeftPanelStack = forwardRef(function LeftPanelStack(
  { children, title, logoUrl, tabs = [], show = true, onSelectTab },
  ref,
) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id || null);
  // 'collapsed' | 'compact' | 'tall'
  const [snapState, setSnapState] = useState(SNAP.COLLAPSED);
  const [isMobile, setIsMobile] = useState(false);
  // On mobile, no tab is visually selected until the user taps one
  const [mobileTabChosen, setMobileTabChosen] = useState(false);
  const panelRef = useRef(null);

  const mobileExpanded = snapState !== SNAP.COLLAPSED;

  // On mobile, tapping a tab toggles expanded/collapsed (compact snap)
  const selectTab = useCallback((tabId) => {
    if (isMobile) {
      if (snapState !== SNAP.COLLAPSED && activeTab === tabId) {
        // Tapping the active tab → collapse
        setSnapState(SNAP.COLLAPSED);
      } else {
        // Tapping a (different) tab → switch + compact expand
        setActiveTab(tabId);
        setSnapState(SNAP.COMPACT);
        setMobileTabChosen(true);
        onSelectTab?.(tabId, { isMobile: true });
      }
    } else {
      setActiveTab(tabId);
      onSelectTab?.(tabId, { isMobile: false });
    }
  }, [isMobile, snapState, activeTab, onSelectTab]);

  // Tapping the drag handle cycles: collapsed → compact → tall → collapsed
  const handleToggle = useCallback(() => {
    setSnapState((prev) => {
      if (prev === SNAP.COLLAPSED) return SNAP.COMPACT;
      if (prev === SNAP.COMPACT)   return SNAP.TALL;
      return SNAP.COLLAPSED;
    });
    setMobileTabChosen(true);
  }, []);

  // Detect mobile viewport
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    setIsMobile(mql.matches);
    const handler = (e) => {
      setIsMobile(e.matches);
      if (!e.matches) setSnapState(SNAP.COLLAPSED);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Track real panel height and expose as --mobile-panel-h CSS variable
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const update = () => {
      const h = isMobile ? el.getBoundingClientRect().height : 0;
      document.documentElement.style.setProperty('--mobile-panel-h', `${h}px`);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty('--mobile-panel-h', '0px');
    };
  }, [isMobile]);

  // Canvas blackout: mask the WebGL resize flicker during panel snap transitions.
  // Adds .canvas-resizing to <html> so the overlay fades in fast (50ms),
  // then removes it after the panel CSS transition completes (350ms) so it fades out.
  const _blackoutTimer = useRef(null);
  useEffect(() => {
    if (!isMobile) return;
    const root = document.documentElement;

    // Cancel any in-flight removal
    if (_blackoutTimer.current) clearTimeout(_blackoutTimer.current);

    root.classList.add('canvas-resizing');
    _blackoutTimer.current = setTimeout(() => {
      root.classList.remove('canvas-resizing');
      _blackoutTimer.current = null;
    }, 380); // panel transition (350ms) + small buffer

    return () => {
      if (_blackoutTimer.current) clearTimeout(_blackoutTimer.current);
    };
  }, [isMobile, snapState]); // fires every time the snap changes

  // Click-outside to collapse on mobile
  useEffect(() => {
    if (!isMobile || snapState === SNAP.COLLAPSED) return;

    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        // Ignore clicks on portaled drawers/modals (they live outside the panel DOM)
        if (e.target.closest('.unit-drawer, .amenity-detail-modal, .panorama-viewer')) return;
        setSnapState(SNAP.COLLAPSED);
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
  }, [isMobile, snapState]);

  // Expose collapse method to parent
  useImperativeHandle(ref, () => ({
    collapse: () => setSnapState(SNAP.COLLAPSED),
  }), []);

  // Determine if a tab should look "active" — on mobile, only after user explicitly chose one
  const isTabActive = (tabId) => {
    if (isMobile && !mobileTabChosen) return false;
    return activeTab === tabId;
  };

  const stackClass = [
    'left-panel-stack',
    show ? 'stack-entered' : 'stack-hidden',
    snapState === SNAP.COMPACT ? 'stack-expanded stack-compact' : '',
    snapState === SNAP.TALL    ? 'stack-expanded stack-tall' : '',
    isMobile && snapState === SNAP.COLLAPSED ? 'stack-tabs-only' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={stackClass} ref={panelRef}>
      {/* ─── Mobile drag handle to expand/collapse ─── */}
      {isMobile && (
        <button
          className="mobile-panel-handle"
          onClick={handleToggle}
          aria-label={
            snapState === SNAP.COLLAPSED ? 'Expandir panel'
            : snapState === SNAP.COMPACT  ? 'Expandir más'
            : 'Contraer panel'
          }
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
