'use client';

import { useState, useCallback } from 'react';

/**
 * LazyImage — drop-in <img> replacement with skeleton shimmer loading state.
 *
 * Props:
 *   src       — image URL
 *   alt       — alt text
 *   className — CSS class(es) for the <img> element
 *   wrapperClassName — CSS class(es) for the outer wrapper <div>
 *   style     — inline styles applied to the wrapper (useful for fixed sizes)
 *   imgStyle  — inline styles applied to the <img>
 *   ...rest   — any other props forwarded to <img> (e.g. loading, decoding)
 *
 * The wrapper always fills 100% of its parent; the skeleton and the image
 * share the same box so the layout never shifts.
 */
export default function LazyImage({
  src,
  alt = '',
  className = '',
  wrapperClassName = '',
  style,
  imgStyle,
  ...rest
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => {
    setLoaded(true);   // stop shimmer
    setErrored(true);
  }, []);

  return (
    <div
      className={`lazy-img-wrapper${loaded ? ' lazy-img-loaded' : ' lazy-img-loading'}${wrapperClassName ? ` ${wrapperClassName}` : ''}`}
      style={style}
    >
      {/* Shimmer skeleton — visible while loading */}
      {!loaded && <div className="lazy-img-skeleton" aria-hidden="true" />}

      {/* Error state */}
      {errored ? (
        <div className="lazy-img-error" aria-label={`Error cargando ${alt}`}>
          <span>⚠</span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className={`lazy-img${loaded ? ' lazy-img-visible' : ''}${className ? ` ${className}` : ''}`}
          style={imgStyle}
          onLoad={handleLoad}
          onError={handleError}
          loading="lazy"
          decoding="async"
          {...rest}
        />
      )}
    </div>
  );
}
