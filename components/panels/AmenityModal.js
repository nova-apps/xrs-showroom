'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { tourHasNodes } from '@/lib/tour';
import TourViewer from './TourViewer';

/**
 * Build the ordered, de-duplicated image list for an amenity.
 * Backward compatible: amenities that only have `plano` (single image) yield
 * a one-element gallery and render exactly as before. Newer amenities add a
 * `imagenes` array (gallery) which is appended after the cover.
 */
export function amenityGallery(amenity) {
  if (!amenity) return [];
  const extra = Array.isArray(amenity.imagenes)
    ? amenity.imagenes
    : amenity.imagenes
      ? Object.values(amenity.imagenes)
      : [];
  const all = [amenity.plano, ...extra].filter(Boolean);
  return [...new Set(all)]; // de-dupe while preserving order
}

/**
 * AmenityModal — modal showing amenity details.
 * Layout: name on top, image (or gallery carousel) below, description last.
 */
export default function AmenityModal({ amenity, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [tourReady, setTourReady] = useState(false);

  const gallery = useMemo(() => amenityGallery(amenity), [amenity]);
  const hasMultiple = gallery.length > 1;
  const hasTour = useMemo(() => tourHasNodes(amenity?.tour), [amenity]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset to the first image whenever the amenity changes.
  useEffect(() => {
    setIndex(0);
    setImgLoaded(false);
    setTourReady(false);
  }, [amenity]);

  const go = useCallback((delta) => {
    setImgLoaded(false);
    setIndex((i) => {
      const n = gallery.length;
      if (n === 0) return 0;
      return (i + delta + n) % n;
    });
  }, [gallery.length]);

  // Keyboard while the modal is open. Escape closes — unless the embedded tour
  // is in native fullscreen, in which case the first Escape exits fullscreen.
  // Arrow keys page the gallery; the 360° tour has no gallery to page, and it
  // owns its own pointer-driven navigation.
  useEffect(() => {
    if (!amenity) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement || document.webkitFullscreenElement) return;
        onClose?.();
        return;
      }
      if (hasTour) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [amenity, hasTour, go, onClose]);

  if (!amenity || !mounted) return null;

  const currentSrc = gallery[Math.min(index, gallery.length - 1)] || null;
  // key={currentSrc} remounts the Image on every slide change, so a fresh
  // onLoad always fires — imgLoaded just needs to reset alongside it.

  return createPortal(
    <div className="unidad-modal-overlay" onClick={onClose}>
      <div
        className={`unidad-modal amenity-modal${hasTour ? ' amenity-modal-tour' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button className="unidad-modal-close" onClick={onClose} title="Cerrar">
          ✕
        </button>

        {/* Name + description */}
        <div className="amenity-modal-header">
          <h2 className="unidad-modal-title">{amenity.nombre || 'Amenity'}</h2>
          {amenity.descripcion && (
            <p className="amenity-modal-desc">{amenity.descripcion}</p>
          )}
        </div>

        {/* 360° tour takes over the media area when present — loaded inline,
            with its own button to expand to fullscreen. Otherwise: gallery. */}
        {hasTour ? (
          <div className="amenity-modal-image amenity-tour-embed">
            <TourViewer
              // Remount per amenity. TourViewer's WebGL setup runs once on mount
              // ([mounted] dep) and only fires onReady from there, so reusing the
              // instance for a different tour left it stuck on "Cargando…" forever
              // (onReady never re-fired, currentId kept the old tour's node).
              key={[amenity.nombre, amenity.tour?.startNode].filter(Boolean).join('|') || 'tour'}
              tour={amenity.tour}
              amenityName={amenity.nombre}
              embedded
              onReady={() => setTourReady(true)}
            />
            {!tourReady && (
              <div className="amenity-tour-loading">
                <div className="pano-spinner" />
                <span>Cargando recorrido 360°…</span>
              </div>
            )}
          </div>
        ) : (
        <div className="amenity-modal-image amenity-gallery">
          {currentSrc ? (
            <>
              <Image
                key={currentSrc}
                src={currentSrc}
                alt={amenity.nombre || 'Imagen'}
                width={1600}
                height={1200}
                sizes="(max-width: 768px) 96vw, 800px"
                quality={90}
                loading="lazy"
                className={`amenity-modal-img${imgLoaded ? ' is-loaded' : ''}`}
                onLoad={() => setImgLoaded(true)}
              />

              {/* Skeleton shimmer while the slide loads */}
              {!imgLoaded && <div className="amenity-gallery-skeleton" />}

              {hasMultiple && (
                <>
                  <button
                    className="amenity-gallery-arrow amenity-gallery-prev"
                    onClick={() => go(-1)}
                    title="Anterior"
                    aria-label="Imagen anterior"
                  >
                    ‹
                  </button>
                  <button
                    className="amenity-gallery-arrow amenity-gallery-next"
                    onClick={() => go(1)}
                    title="Siguiente"
                    aria-label="Imagen siguiente"
                  >
                    ›
                  </button>

                  <div className="amenity-gallery-counter">
                    {index + 1} / {gallery.length}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="unidad-modal-plan-empty">
              <span>🏔</span>
              <p>Sin imagen disponible</p>
            </div>
          )}
        </div>
        )}
      </div>
    </div>,
    document.body
  );
}
