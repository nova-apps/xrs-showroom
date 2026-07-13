'use client';

/**
 * Icon — a single monoline SVG icon set (VIS-3), replacing the OS-dependent
 * emojis that were used as functional iconography. Every glyph is a 24×24
 * stroke icon that inherits `currentColor` and the surrounding font size (1em),
 * so an icon sits on the same visual weight as its label and themes with the
 * text color automatically.
 *
 * Usage:
 *   <Icon name="search" />                 // inline, 1em, decorative
 *   <Icon name="close" aria-label="Cerrar" role="img" />
 *
 * Icon-only buttons should carry their own aria-label on the <button>; the icon
 * itself is aria-hidden unless an explicit aria-label is passed.
 */

const PATHS = {
  // magnifier
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></>,
  // horizontal sliders — filters
  filters: (
    <>
      <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0" />
      <circle cx="15" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17" r="2" />
    </>
  ),
  // globe — 360° panorama / recorrido
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3Z" />
    </>
  ),
  // framed image — floor-plan placeholder
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m21 16-5-5L5 20" />
    </>
  ),
  // stacked layers — generic empty state
  empty: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  // ruler — lotes / surface empty state
  ruler: (
    <>
      <path d="M3 15 15 3l6 6L9 21 3 15Z" />
      <path d="M7 11l1.5 1.5M10 8l1.5 1.5M13 5l1.5 1.5" />
    </>
  ),
  // close
  close: <path d="M6 6l12 12M18 6 6 18" />,
  // chevron down (accordion)
  chevronDown: <path d="m6 9 6 6 6-6" />,
  // expand — enter fullscreen (corner arrows pointing out)
  expand: <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />,
  // collapse — exit fullscreen (corner arrows pointing in)
  collapse: <path d="M3 8h3a2 2 0 0 0 2-2V3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3" />,
  // download — tray with a down arrow
  download: <><path d="M12 3v12" /><path d="m7 11 5 4 5-4" /><path d="M5 21h14" /></>,
  // upload — tray with an up arrow
  upload: <><path d="M12 21V9" /><path d="m7 13 5-4 5 4" /><path d="M5 3h14" /></>,
  // save — floppy disk
  save: <><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M8 3v5h7" /><path d="M8 21v-6h8v6" /></>,
  // refresh / replace — circular arrow
  refresh: <><path d="M20 11a8 8 0 1 0-1.8 6" /><path d="M20 4v6h-6" /></>,
  // copy / duplicate — two overlapping sheets
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  // trash — delete
  trash: <><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></>,
  // doc — file with a folded corner
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /></>,
  // phone — mobile device
  phone: <><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></>,
  // cube — 3D / AR
  cube: <><path d="M12 3 3 8v8l9 5 9-5V8Z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  // settings — gear
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,
  // map pin — calibration / location
  pin: (
    <>
      <path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
};

export default function Icon({ name, size, strokeWidth = 1.8, 'aria-label': ariaLabel, style, ...rest }) {
  const path = PATHS[name];
  if (!path) return null;
  const decorative = !ariaLabel;
  return (
    <svg
      width={size || '1em'}
      height={size || '1em'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Nudge inline SVGs off the text baseline so an icon sits centered next to
      // its label (harmless in flex containers, which ignore vertical-align).
      style={{ verticalAlign: '-0.125em', flexShrink: 0, ...style }}
      aria-hidden={decorative ? 'true' : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={ariaLabel}
      {...rest}
    >
      {path}
    </svg>
  );
}
