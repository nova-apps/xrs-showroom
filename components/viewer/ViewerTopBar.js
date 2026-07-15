'use client';

/**
 * ViewerTopBar — floating top bar for the mobile viewer shell.
 *
 * Sits over the 3D canvas (not inside the bottom-sheet) with:
 *   - Left:  BrandChip — bronze square with the project's initial (or its logo)
 *            plus the project name.
 *   - Right: the "AR" button (bronze solid) that launches the AR experience.
 *            Only rendered when the scene actually has a model to view.
 *
 * Mobile-only: the parent renders it just for small viewports (desktop keeps
 * the project logo inside the side panel).
 */
export default function ViewerTopBar({ projectName = '', logoUrl = '', showAr = false, onAr }) {
  const initial = (projectName || 'X').trim().charAt(0).toUpperCase() || 'X';

  return (
    <div className="viewer-topbar" role="banner">
      {/* ─── Brand chip (glass pill) ─── */}
      <div className="viewer-topbar-brand">
        {logoUrl ? (
          <img src={logoUrl} alt={projectName || 'Logo'} className="viewer-topbar-logo" />
        ) : (
          <>
            <span className="viewer-topbar-mark" aria-hidden="true">{initial}</span>
            {projectName && <span className="viewer-topbar-name">{projectName}</span>}
          </>
        )}
      </div>

      {/* ─── AR button (bronze solid pill) ─── */}
      {showAr && (
        <button
          type="button"
          className="viewer-topbar-ar"
          onClick={onAr}
          aria-label="Ver en AR"
          title="Ver en realidad aumentada"
        >
          <svg
            width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          >
            {/* esquinas tipo visor AR */}
            <path d="M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" />
            {/* cubo 3D */}
            <path d="M12 8.2l3.2 1.8v3.6L12 15.4l-3.2-1.8V10z" />
            <path d="M12 8.2v0M12 11.8l3.2-1.8M12 11.8v3.6M12 11.8L8.8 10" />
          </svg>
          AR
        </button>
      )}
    </div>
  );
}
