'use client';

import { useRef, useEffect, useState } from 'react';

const NETWORK_PROFILES = {
  normal: { label: 'Normal', icon: '🌐', bandwidth: null, latency: 0 },
  fast4g: { label: 'Fast 4G', icon: '📶', bandwidth: 1.5 * 1024 * 1024, latency: 150 },
  slow4g: { label: 'Slow 4G', icon: '📱', bandwidth: 187.5 * 1024, latency: 400 },
};

function formatTime(ms) {
  if (ms === null || ms === undefined) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCount(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * PerformancePanel — compact bottom-right widget.
 * Collapsed: shows FPS + triangles inline.
 * Expanded: full GPU stats, asset sizes, load times.
 */
export default function PerformancePanel({ scene, loadMetrics, viewerRef }) {
  const [fps, setFps] = useState(0);
  const [gpuInfo, setGpuInfo] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    let animId;
    lastTimeRef.current = performance.now();

    function loop() {
      frameCountRef.current++;
      const now = performance.now();
      const delta = now - lastTimeRef.current;

      if (delta >= 500) {
        const currentFps = Math.round((frameCountRef.current / delta) * 1000);
        setFps(currentFps);
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }

      animId = requestAnimationFrame(loop);
    }

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (viewerRef?.current?.getRendererInfo) {
        const info = viewerRef.current.getRendererInfo();
        if (info) setGpuInfo(info);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [viewerRef]);

  const assets = scene?.assets || {};
  const assetEntries = [];
  let totalBytes = 0;

  for (const [key, val] of Object.entries(assets)) {
    if (val?.size) {
      assetEntries.push({ type: key, name: val.fileName || key, size: val.size });
      totalBytes += val.size;
    }
  }

  const actualTime = loadMetrics?.totalTime ?? null;
  const assetCount = assetEntries.length || 1;

  const estimates = {};
  for (const [profileKey, profile] of Object.entries(NETWORK_PROFILES)) {
    if (profileKey === 'normal') {
      estimates[profileKey] = actualTime;
    } else if (totalBytes > 0) {
      const downloadTime = (totalBytes / profile.bandwidth) * 1000;
      const latencyOverhead = assetCount * profile.latency;
      estimates[profileKey] = Math.round(downloadTime + latencyOverhead);
    } else {
      estimates[profileKey] = null;
    }
  }

  const fpsColor = fps >= 50 ? 'var(--accent-green)' : fps >= 25 ? 'var(--accent-yellow)' : 'var(--accent-red)';

  return (
    <div className={`perf-compact ${expanded ? 'perf-expanded' : ''}`}>
      {/* Collapsed summary row — always visible */}
      <button className="perf-compact-header" onClick={() => setExpanded(!expanded)}>
        <span className="perf-compact-fps" style={{ color: fpsColor }}>{fps || '--'}</span>
        <span className="perf-compact-label">FPS</span>
        {gpuInfo && (
          <>
            <span className="perf-compact-sep" />
            <span className="perf-compact-stat">{formatCount(gpuInfo.render.triangles)}</span>
            <span className="perf-compact-label">tris</span>
            <span className="perf-compact-sep" />
            <span className="perf-compact-stat">{gpuInfo.render.calls}</span>
            <span className="perf-compact-label">draws</span>
          </>
        )}
        <span className={`perf-compact-chevron ${expanded ? 'open' : ''}`}>&#9660;</span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="perf-compact-body">
          {gpuInfo && (
            <div className="perf-section-compact">
              <div className="perf-section-title-compact">GPU {gpuInfo.qualityProfile ? `(${gpuInfo.qualityProfile})` : ''}</div>
              {gpuInfo.gpuName && <div className="perf-gpu-name-compact">{gpuInfo.gpuName}</div>}
              <div className="perf-stats-row">
                <span>{gpuInfo.memory.geometries} geo</span>
                <span>{gpuInfo.memory.textures} tex</span>
                <span>{gpuInfo.render.calls} calls</span>
                <span>{formatCount(gpuInfo.render.triangles)} tris</span>
              </div>
            </div>
          )}

          {assetEntries.length > 0 && (
            <div className="perf-section-compact">
              <div className="perf-section-title-compact">Assets ({formatBytes(totalBytes)})</div>
              {assetEntries.map((a) => (
                <div key={a.type} className="perf-asset-row-compact">
                  <span>{a.type.toUpperCase()}</span>
                  <span>{formatBytes(a.size)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="perf-section-compact">
            <div className="perf-section-title-compact">Carga</div>
            {Object.entries(NETWORK_PROFILES).map(([key, profile]) => (
              <div key={key} className="perf-asset-row-compact">
                <span>{profile.icon} {profile.label}</span>
                <span className={key === 'normal' && actualTime ? 'perf-measured' : ''}>{formatTime(estimates[key])}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
