'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import FloatingPanel from '@/components/panels/FloatingPanel';

/**
 * Network profiles for estimated load time calculations.
 * Bandwidth in bytes/sec, latency in ms (per-request overhead).
 */
const NETWORK_PROFILES = {
  normal: { label: 'Normal', icon: '🌐', bandwidth: null, latency: 0 },
  fast4g: { label: 'Fast 4G', icon: '📶', bandwidth: 1.5 * 1024 * 1024, latency: 150 },   // ~12 Mbps → 1.5 MB/s
  slow4g: { label: 'Slow 4G', icon: '📱', bandwidth: 187.5 * 1024, latency: 400 },          // ~1.5 Mbps → 187.5 KB/s
};

/**
 * Format seconds into a readable string.
 */
function formatTime(ms) {
  if (ms === null || ms === undefined) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format bytes into human-readable size.
 */
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format large numbers with k/M suffixes.
 */
function formatCount(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * PerformancePanel — floating panel at bottom-right showing:
 * - Live FPS
 * - GPU / VRAM info (geometries, textures, draw calls, triangles)
 * - Actual load time (measured)
 * - Estimated load times for Fast 4G & Slow 4G (based on total asset sizes)
 */
export default function PerformancePanel({ scene, loadMetrics, viewerRef }) {
  const [fps, setFps] = useState(0);
  const [gpuInfo, setGpuInfo] = useState(null);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(0);

  // FPS loop
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

  // Poll renderer info every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (viewerRef?.current?.getRendererInfo) {
        const info = viewerRef.current.getRendererInfo();
        if (info) setGpuInfo(info);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [viewerRef]);

  // Calculate total asset size from scene data
  const assets = scene?.assets || {};
  const assetEntries = [];
  let totalBytes = 0;

  for (const [key, val] of Object.entries(assets)) {
    if (val?.size) {
      assetEntries.push({ type: key, name: val.fileName || key, size: val.size });
      totalBytes += val.size;
    }
  }

  // Actual measured load time
  const actualTime = loadMetrics?.totalTime ?? null;

  // Estimate download times for each profile
  const assetCount = assetEntries.length || 1;

  const estimates = {};
  for (const [profileKey, profile] of Object.entries(NETWORK_PROFILES)) {
    if (profileKey === 'normal') {
      estimates[profileKey] = actualTime;
    } else if (totalBytes > 0) {
      const downloadTime = (totalBytes / profile.bandwidth) * 1000; // ms
      const latencyOverhead = assetCount * profile.latency;
      estimates[profileKey] = Math.round(downloadTime + latencyOverhead);
    } else {
      estimates[profileKey] = null;
    }
  }

  const fpsColor = fps >= 50 ? 'var(--accent-green)' : fps >= 25 ? 'var(--accent-yellow)' : 'var(--accent-red)';

  return (
    <FloatingPanel
      title="Performance"
      icon="⚡"
      position="panel-bottom-right"
      defaultCollapsed={true}
    >
      <div className="perf-panel">
        {/* ─── FPS ─── */}
        <div className="perf-fps-row">
          <span className="perf-fps-value" style={{ color: fpsColor }}>
            {fps || '--'}
          </span>
          <span className="perf-fps-label">FPS</span>
        </div>

        <div className="section-divider" />

        {/* ─── GPU / VRAM ─── */}
        <div className="perf-section">
          <div className="perf-section-title">🖥️ GPU {gpuInfo?.qualityProfile ? `(${gpuInfo.qualityProfile})` : ''}</div>
          {gpuInfo ? (
            <>
              {gpuInfo.gpuName && (
                <div className="perf-gpu-name">{gpuInfo.gpuName}</div>
              )}
              <div className="perf-gpu-grid">
                <div className="perf-gpu-stat">
                  <span className="perf-gpu-stat-value">{gpuInfo.memory.geometries}</span>
                  <span className="perf-gpu-stat-label">Geometries</span>
                </div>
                <div className="perf-gpu-stat">
                  <span className="perf-gpu-stat-value">{gpuInfo.memory.textures}</span>
                  <span className="perf-gpu-stat-label">Textures</span>
                </div>
                <div className="perf-gpu-stat">
                  <span className="perf-gpu-stat-value">{gpuInfo.render.calls}</span>
                  <span className="perf-gpu-stat-label">Draw calls</span>
                </div>
                <div className="perf-gpu-stat">
                  <span className="perf-gpu-stat-value">{formatCount(gpuInfo.render.triangles)}</span>
                  <span className="perf-gpu-stat-label">Triangles</span>
                </div>
              </div>
            </>
          ) : (
            <div className="perf-empty">Esperando renderer…</div>
          )}
        </div>

        <div className="section-divider" />

        {/* ─── Asset Sizes ─── */}
        <div className="perf-section">
          <div className="perf-section-title">📦 Assets ({formatBytes(totalBytes)})</div>
          {assetEntries.length === 0 ? (
            <div className="perf-empty">Sin assets cargados</div>
          ) : (
            assetEntries.map((a) => (
              <div key={a.type} className="perf-asset-row">
                <span className="perf-asset-type">{a.type.toUpperCase()}</span>
                <span className="perf-asset-size">{formatBytes(a.size)}</span>
              </div>
            ))
          )}
        </div>

        <div className="section-divider" />

        {/* ─── Load Times ─── */}
        <div className="perf-section">
          <div className="perf-section-title">⏱️ Tiempos de carga (sin caché)</div>
          {Object.entries(NETWORK_PROFILES).map(([key, profile]) => (
            <div key={key} className="perf-time-row">
              <span className="perf-time-icon">{profile.icon}</span>
              <span className="perf-time-label">{profile.label}</span>
              <span className={`perf-time-value ${key === 'normal' && actualTime ? 'measured' : ''}`}>
                {formatTime(estimates[key])}
              </span>
            </div>
          ))}
        </div>
      </div>
    </FloatingPanel>
  );
}
