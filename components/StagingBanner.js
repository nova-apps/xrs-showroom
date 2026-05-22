'use client';

import { useEffect, useState, useMemo } from 'react';
import versionData from '@/version.json';

/**
 * Floating pill shown ONLY on the staging host. Collapsed by default at the
 * top-center of the viewport. Clicking it expands a panel below with the
 * scrollable CHANGELOG.md.
 */

const STAGING_HOST_HINTS = ['-staging.web.app', '-staging.firebaseapp.com'];

function isStagingHost() {
  if (typeof window === 'undefined') return false;
  const host = window.location.host.toLowerCase();
  return STAGING_HOST_HINTS.some((hint) => host.includes(hint));
}

/**
 * Render CHANGELOG.md text into lightweight React. We don't need a full
 * markdown parser — the file follows a strict structure (## version,
 * ### section, - item, ---). This keeps the bundle small.
 */
function renderChangelog(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const out = [];
  let listBuf = null;

  const flushList = () => {
    if (listBuf && listBuf.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="changelog-list">
          {listBuf.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      );
    }
    listBuf = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { flushList(); continue; }
    if (trimmed.startsWith('---')) { flushList(); out.push(<hr key={`hr-${i}`} className="changelog-hr" />); continue; }
    if (trimmed.startsWith('## ')) {
      flushList();
      out.push(<h3 key={`h-${i}`} className="changelog-version">{trimmed.replace(/^##\s*/, '')}</h3>);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushList();
      out.push(<h4 key={`h-${i}`} className="changelog-section">{trimmed.replace(/^###\s*/, '')}</h4>);
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flushList();
      // Skip top-level "Registro de cambios" heading (redundant with our title).
      continue;
    }
    if (trimmed.startsWith('- ')) {
      if (!listBuf) listBuf = [];
      listBuf.push(trimmed.replace(/^-\s*/, ''));
      continue;
    }
    // Plain paragraph (e.g. the intro line).
    flushList();
    out.push(<p key={`p-${i}`} className="changelog-p">{trimmed}</p>);
  }
  flushList();
  return out;
}

export default function StagingBanner() {
  const [mounted, setMounted] = useState(false);
  const [isStaging, setIsStaging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [changelog, setChangelog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setMounted(true);
    setIsStaging(isStagingHost());
  }, []);

  // Lazy-fetch the changelog the first time the user opens the panel.
  useEffect(() => {
    if (!expanded || changelog !== null || loading) return;
    setLoading(true);
    fetch('/api/changelog')
      .then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((text) => { setChangelog(text); setLoading(false); })
      .catch((err) => { setError(err.message || 'No se pudo cargar'); setLoading(false); });
  }, [expanded, changelog, loading]);

  const rendered = useMemo(() => renderChangelog(changelog), [changelog]);

  if (!mounted || !isStaging) return null;

  return (
    <div className={`staging-banner${expanded ? ' staging-banner-open' : ''}`}>
      <button
        type="button"
        className="staging-banner-pill-btn"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Cerrar changelog' : 'Abrir changelog'}
      >
        <span className="staging-banner-pill">STAGING</span>
        <span className="staging-banner-version">v{versionData.version}</span>
        <span className={`staging-banner-chevron${expanded ? ' open' : ''}`}>▾</span>
      </button>

      {expanded && (
        <div className="staging-banner-panel">
          <div className="staging-banner-panel-head">
            <div>
              <div className="staging-banner-panel-title">Changelog</div>
              <div className="staging-banner-meta">
                Build {versionData.buildDate} · {versionData.commitHash}
              </div>
            </div>
            <button
              type="button"
              className="staging-banner-close"
              onClick={() => setExpanded(false)}
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          <div className="staging-banner-scroll">
            {loading && <div className="staging-banner-empty">Cargando…</div>}
            {error && !loading && <div className="staging-banner-empty">Error: {error}</div>}
            {!loading && !error && rendered}
          </div>
          <div className="staging-banner-foot">
            Versión de staging — no compartir con clientes.
          </div>
        </div>
      )}
    </div>
  );
}
