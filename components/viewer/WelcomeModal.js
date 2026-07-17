'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon';

/**
 * WelcomeModal — portada de bienvenida que aparece al iniciar la experiencia.
 * Ocupa la pantalla como pantalla de carga: se muestra apenas hay metadata de
 * la escena y revela su contenido de a poco (logo → título → texto → tips →
 * botón), para cubrir la descarga del GLB/splat que ocurre detrás.
 *
 * El botón "Comenzar" cierra el cartel en cualquier momento; la cortina del
 * viewer enmascara lo que reste cargar. Las instrucciones de navegación
 * difieren entre desktop (mouse) y mobile (touch).
 */
export default function WelcomeModal({
  projectName,
  logoUrl,
  description,
  isMobile = false,
  itemNoun = 'una unidad',
  showAr = false,
  closing = false,
  onStart,
  onExited,
}) {
  const [mounted, setMounted] = useState(false);
  // No revelamos los textos hasta que el logo esté cargado (si carga lento, el
  // contenido aparecía antes que el logo y quedaba raro). Sin logo → listo ya.
  const [logoReady, setLogoReady] = useState(!logoUrl);

  useEffect(() => { setMounted(true); }, []);

  // Fade-out: al apretar "Comenzar" (closing → true) el overlay se desvanece y,
  // terminada la transición, avisamos al padre para desmontarlo. La UI del viewer
  // hace fade-in en paralelo (ver page.js). Mantener sincronizado con el CSS.
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => onExited?.(), 1200);
    return () => clearTimeout(t);
  }, [closing, onExited]);

  useEffect(() => {
    if (!logoUrl) { setLogoReady(true); return; }
    let cancelled = false;
    const done = () => { if (!cancelled) setLogoReady(true); };
    const img = new Image();
    img.src = logoUrl;
    // Esperamos el decode (no sólo el load): así el bitmap ya está listo para
    // pintar y el logo aparece de una, sin quedar en blanco mientras se decodifica
    // (que hacía que el texto se viera antes que el logo). Si falla, no bloqueamos.
    if (img.decode) {
      img.decode().then(done, done);
    } else {
      img.onload = done;
      img.onerror = done;
      if (img.complete) done();
    }
    return () => { cancelled = true; };
  }, [logoUrl]);

  // Enter/Escape cierran el cartel igual que el botón.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.stopPropagation();
        onStart?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, onStart]);

  if (!mounted) return null;

  // Instrucciones según el dispositivo: en mobile los gestos son táctiles y hay
  // AR; en desktop se navega con mouse. La fila de selección usa el sustantivo
  // de la escena (unidad / lote).
  const tips = isMobile
    ? [
        { icon: 'refresh', text: 'Deslizá para girar' },
        { icon: 'search', text: 'Pellizcá para acercar o alejar' },
        { icon: 'cube', text: `Tocá ${itemNoun} para ver su detalle` },
        ...(showAr ? [{ icon: 'phone', text: 'Tocá «AR» para verlo en tu espacio' }] : []),
      ]
    : [
        { icon: 'refresh', text: 'Arrastrá con el mouse para girar alrededor del proyecto' },
        { icon: 'search', text: 'Usá la rueda del mouse para acercarte o alejarte' },
        { icon: 'cube', text: `Hacé clic en ${itemNoun} o en la lista para ver su detalle` },
      ];

  // Cada elemento entra escalonado: acumulamos el animation-delay y avanzamos
  // por un incremento variable. Los tips de la lista usan un paso más largo para
  // que aparezcan bien de a poco.
  let acc = 0.2;
  const at = (inc = 0.3) => {
    const d = acc;
    acc += inc;
    return { animationDelay: `${d.toFixed(2)}s` };
  };

  return createPortal(
    <div
      className={`welcome-overlay${closing ? ' welcome-overlay--closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={projectName ? `Bienvenida a ${projectName}` : 'Bienvenida'}
    >
      {!logoReady ? (
        <span className="welcome-spinner" aria-label="Cargando…" role="status" />
      ) : (
      <div className="welcome-modal">
        <div className="welcome-content">
          {logoUrl ? (
            <img src={logoUrl} alt={projectName || 'Logo'} decoding="sync" className="welcome-logo welcome-reveal" style={at()} />
          ) : (
            <h2 className="welcome-title welcome-reveal" style={at()}>
              {projectName || 'Bienvenido'}
            </h2>
          )}
          <p className="welcome-text welcome-reveal" style={at(0.5)}>
            {description || 'Recorré el proyecto en 3D, explorá los espacios y descubrí cada detalle a tu ritmo.'}
          </p>

          <ul className="welcome-tips">
            {tips.map((tip, i) => (
              <li key={i} className="welcome-tip welcome-reveal" style={at(0.55)}>
                <span className="welcome-tip-icon" aria-hidden="true"><Icon name={tip.icon} /></span>
                <span className="welcome-tip-text">{tip.text}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="welcome-btn welcome-reveal"
            style={at()}
            onClick={onStart}
            autoFocus
          >
            Comenzar
          </button>
        </div>
      </div>
      )}
    </div>,
    document.body,
  );
}
