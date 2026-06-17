'use client';

import { useEffect, useRef } from 'react';
import { normalizeTour } from '@/lib/tour';

/**
 * Warm the browser HTTP cache with each amenity tour's FIRST panorama (its
 * start node) — plus the tour's floor-plan minimap — once the 3D scene is ready
 * and the main thread is idle.
 *
 * Why this works cheaply: these images are served `Cache-Control: immutable`
 * for 30 days, so a plain `fetch()` primes the disk cache. When the user later
 * opens the amenity, TourViewer's `THREE.TextureLoader` (a CORS <img> request)
 * hits that cached entry and paints instantly. We only download the COMPRESSED
 * bytes here — no decode, no GPU upload, no VRAM — so the cost is just ~2-5 MB
 * per tour of background bandwidth, deferred to idle time after the heavy 3D
 * load has finished.
 *
 * Scope is deliberately the start node only (not every node): it's the first
 * image the user sees, and prefetching whole tours would be tens of MB.
 * TourViewer already preloads neighbor nodes once a tour is actually open.
 */

// Skip on metered / very slow connections so we never burn cellular data.
function connectionAllowsPrefetch() {
  if (typeof navigator === 'undefined') return false;
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return true; // unknown → allow
  if (c.saveData) return false;
  if (c.effectiveType && ['slow-2g', '2g'].includes(c.effectiveType)) return false;
  return true;
}

export function useAmenityTourPrefetch(scene, enabled) {
  // URLs we've already attempted, so RTDB scene updates don't re-trigger fetches.
  const attemptedRef = useRef(new Set());

  useEffect(() => {
    if (!enabled || !scene) return;
    if (typeof window === 'undefined') return;
    if (!connectionAllowsPrefetch()) return;

    const items = scene?.amenities?.items || [];
    const urls = [];
    for (const a of items) {
      if (!a?.tour) continue;
      const t = normalizeTour(a.tour);
      const startUrl = t?.startNode ? t.nodes?.[t.startNode]?.url : null;
      for (const url of [startUrl, t?.plano]) {
        if (url && !attemptedRef.current.has(url)) {
          attemptedRef.current.add(url);
          urls.push(url);
        }
      }
    }
    if (!urls.length) return;

    const controller = new AbortController();
    let cancelled = false;

    // Sequential, low-priority — never burst the network alongside the 3D load.
    const run = async () => {
      for (const url of urls) {
        if (cancelled) break;
        try {
          const res = await fetch(url, {
            signal: controller.signal,
            mode: 'cors',
            credentials: 'omit',
            priority: 'low',
            cache: 'force-cache',
          });
          // Drain the body so the response fully lands in the disk cache.
          await res.arrayBuffer();
        } catch {
          // Aborted, offline, or CORS hiccup — harmless. TourViewer will load
          // it normally when the amenity is opened.
        }
      }
    };

    let idleId = null;
    const ric = window.requestIdleCallback;
    if (ric) idleId = ric(run, { timeout: 3000 });
    else idleId = window.setTimeout(run, 1200);

    return () => {
      cancelled = true;
      controller.abort();
      if (idleId != null) {
        if (ric) window.cancelIdleCallback?.(idleId);
        else window.clearTimeout(idleId);
      }
    };
  }, [scene, enabled]);
}
