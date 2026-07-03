'use client';

import Icon from './Icon';

/**
 * CloseButton — the single close control across the app (CON-1). Replaces the
 * four divergent "✕" buttons (unit-drawer-close, unidad-modal-close, pano-close,
 * sidebar-close-btn) with one consistent shape, size and hover.
 *
 * Props:
 *   - onClick
 *   - label   : accessible name (default "Cerrar"); also the default title.
 *   - title   : tooltip override (e.g. "Cerrar (Esc)").
 *   - size    : 'md' (40px, default) | 'sm' (32px, dense contexts).
 *   - overlay : true when the button sits over media/canvas (white + blur) so
 *               it reads over any scene, e.g. panorama / tour.
 */
export default function CloseButton({
  onClick,
  label = 'Cerrar',
  title,
  size = 'md',
  overlay = false,
  className = '',
  ...rest
}) {
  const cls = [
    'close-btn',
    size === 'sm' && 'close-btn-sm',
    overlay && 'close-btn-overlay',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      title={title || label}
      aria-label={label}
      {...rest}
    >
      <Icon name="close" />
    </button>
  );
}
