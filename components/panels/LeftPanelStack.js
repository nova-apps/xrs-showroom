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

  // ─── Drag gesture on the handle ───
  // Live-resizes the panel while the user drags; on release, snaps to the
  // nearest of COLLAPSED / COMPACT / TALL based on final height ratio.
  const dragRef = useRef({
    active: false,
    dragging: false,
    startY: 0,
    startH: 0,
    pointerId: null,
    suppressClick: false,
  });

  // Canvas blackout timer ref (shared between snap-state effect and drag handlers).
  // Adds .canvas-resizing to <html> to mask WebGL resize flicker.
  const _blackoutTimer = useRef(null);
  const blackoutCanvas = useCallback(({ hold = false } = {}) => {
    const root = document.documentElement;
    if (_blackoutTimer.current) clearTimeout(_blackoutTimer.current);
    root.classList.add('canvas-resizing');
    if (hold) {
      _blackoutTimer.current = null;
    } else {
      _blackoutTimer.current = setTimeout(() => {
        root.classList.remove('canvas-resizing');
        _blackoutTimer.current = null;
      }, 380); // panel transition (350ms) + small buffer
    }
  }, []);

  const onHandlePointerDown = useCallback((e) => {
    if (!isMobile) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      active: true,
      dragging: false,
      startY: e.clientY,
      startH: rect.height,
      pointerId: e.pointerId,
      suppressClick: false,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }, [isMobile]);

  const onHandlePointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const dy = e.clientY - drag.startY;
    const panel = panelRef.current;
    if (!panel) return;
    if (!drag.dragging && Math.abs(dy) > 6) {
      drag.dragging = true;
      panel.classList.add('panel-dragging');
      blackoutCanvas({ hold: true }); // mask WebGL flicker for the whole gesture
    }
    if (drag.dragging) {
      const newH = drag.startH - dy; // drag up = grow
      const max = window.innerHeight * 0.85;
      const h = Math.max(0, Math.min(max, newH));
      panel.style.maxHeight = `${h}px`;
    }
  }, []);

  const onHandlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    const panel = panelRef.current;
    if (!panel || !drag.dragging) return; // tap → let onClick handle it
    drag.suppressClick = true;
    panel.classList.remove('panel-dragging');
    panel.style.maxHeight = '';
    const rect = panel.getBoundingClientRect();
    const ratio = rect.height / window.innerHeight;
    let next;
    if (ratio < 0.18) next = SNAP.COLLAPSED;
    else if (ratio < 0.49) next = SNAP.COMPACT;
    else next = SNAP.TALL;
    setSnapState(next);
    if (next !== SNAP.COLLAPSED) setMobileTabChosen(true);
    // Ensure blackout is removed after the snap transition, even if snapState didn't change
    blackoutCanvas();
  }, [blackoutCanvas]);

  const onHandlePointerCancel = useCallback(() => {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    const panel = panelRef.current;
    if (panel && drag.dragging) {
      panel.classList.remove('panel-dragging');
      panel.style.maxHeight = '';
      blackoutCanvas();
    }
  }, [blackoutCanvas]);

  const onHandleClick = useCallback(() => {
    if (dragRef.current.suppressClick) {
      dragRef.current.suppressClick = false;
      return;
    }
    handleToggle();
  }, [handleToggle]);

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

  // Mask the WebGL resize flicker whenever the snap state changes.
  // (Drag-driven blackout is handled in the pointer handlers above.)
  useEffect(() => {
    if (!isMobile) return;
    blackoutCanvas();
    return () => {
      if (_blackoutTimer.current) clearTimeout(_blackoutTimer.current);
    };
  }, [isMobile, snapState, blackoutCanvas]);

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

  // Expose imperative controls to parent
  useImperativeHandle(ref, () => ({
    collapse: () => setSnapState(SNAP.COLLAPSED),
    // Switch to a tab and expand the panel (mobile bottom-sheet pops up).
    expand: (tabId) => {
      if (tabId) {
        setActiveTab(tabId);
        setMobileTabChosen(true);
      }
      setSnapState((prev) => (prev === SNAP.COLLAPSED ? SNAP.COMPACT : prev));
    },
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
          onClick={onHandleClick}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerCancel}
          aria-label={
            snapState === SNAP.COLLAPSED ? 'Expandir panel'
            : snapState === SNAP.COMPACT  ? 'Expandir más'
            : 'Contraer panel'
          }
        >
          <span className="mobile-panel-handle-bar" />
        </button>
      )}

      {/* ─── Mobile logo (reordered via CSS to sit below the tabs; hidden when expanded) ─── */}
      {isMobile && logoUrl && (
        <button
          type="button"
          className="sidebar-header-mobile"
          onClick={() => tabs[0]?.id && selectTab(tabs[0].id)}
          aria-label="Expandir panel"
        >
          <img src={logoUrl} alt={title || 'Logo'} className="sidebar-logo-img-mobile" />
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
