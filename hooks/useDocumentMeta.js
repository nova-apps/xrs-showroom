'use client';

import { useEffect } from 'react';

const FAVICON_SIZE = 128;
const FAVICON_PADDING = 0.08;

function buildSquareFavicon(sourceUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = FAVICON_SIZE;
        canvas.height = FAVICON_SIZE;
        const ctx = canvas.getContext('2d');
        const available = FAVICON_SIZE * (1 - FAVICON_PADDING * 2);
        const scale = Math.min(available / img.width, available / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const dx = (FAVICON_SIZE - drawW) / 2;
        const dy = (FAVICON_SIZE - drawH) / 2;
        ctx.drawImage(img, dx, dy, drawW, drawH);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load logo for favicon'));
    img.src = sourceUrl;
  });
}

/**
 * Set document.title and <link rel="icon"> from client-side state.
 * The icon is letterboxed into a square canvas so landscape logos render cleanly
 * as a favicon. Falls back to the raw URL if the canvas conversion fails
 * (e.g. cross-origin tainting).
 */
export function useDocumentMeta(title, iconUrl) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);

  useEffect(() => {
    if (!iconUrl) return;

    let link = document.querySelector("link[rel~='icon']");
    let created = false;
    let previousHref = null;

    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
      created = true;
    } else {
      previousHref = link.getAttribute('href');
    }

    let cancelled = false;
    buildSquareFavicon(iconUrl)
      .then((dataUrl) => {
        if (!cancelled) link.setAttribute('href', dataUrl);
      })
      .catch(() => {
        if (!cancelled) link.setAttribute('href', iconUrl);
      });

    return () => {
      cancelled = true;
      if (created) {
        link.remove();
      } else if (previousHref !== null) {
        link.setAttribute('href', previousHref);
      } else {
        link.removeAttribute('href');
      }
    };
  }, [iconUrl]);
}
