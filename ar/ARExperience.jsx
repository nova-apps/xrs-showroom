'use client';

// Overlay cliente que monta la experiencia AR markerless (world-tracking SLAM) sobre la
// maqueta de la escena. Toda interacción con el motor/cámara ocurre en el navegador.
//
// Props:
//   - modelUrl:   URL del GLB a colocar en AR (de la escena).
//   - sogUrl:     URL del splat gaussiano SOG (opcional) a mostrar junto al GLB.
//   - transforms: scene.transforms { glb, sog } para alinear el splat al GLB.
//   - logoUrl:    logo del proyecto a mostrar en el overlay (reemplaza el branding genérico).
//   - onClose:    callback al cerrar el overlay (desmonta y frena la cámara).
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadEngine } from './engineLoader';
import { arPipelineModule } from './arPipelineModule';

const GOLD = '#ab8869';

export default function ARExperience({ modelUrl, sogUrl, transforms, logoUrl, onClose }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const startedRef = useRef(false);
  const arModRef = useRef(null);
  const colorMgmtPrevRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | running | error
  const [errorMsg, setErrorMsg] = useState('');
  const [reticleActive, setReticleActive] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [hintsHidden, setHintsHidden] = useState(false);
  const [showCredits, setShowCredits] = useState(false);

  // Long-press (~600 ms) sobre el HUD revela la atribución del motor (requisito de licencia).
  const pressTimer = useRef(null);
  const startPress = useCallback(() => {
    pressTimer.current = window.setTimeout(() => setShowCredits(true), 600);
  }, []);
  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  // Precargar el motor al montar: así al tocar "Iniciar" el pedido de cámara/sensores ocurre
  // dentro del gesto del usuario y el motor se saltea su prompt intermedio.
  useEffect(() => { loadEngine().catch(() => {}); }, []);

  // Las indicaciones se desvanecen ~5 s después de colocar la maqueta.
  useEffect(() => {
    if (!placed) return;
    const t = window.setTimeout(() => setHintsHidden(true), 5000);
    return () => clearTimeout(t);
  }, [placed]);

  // Teardown completo del motor: frena la cámara, limpia el pipeline, libera los tracks,
  // recupera el canvas que FullWindowCanvas reparentó al <body> y restaura ColorManagement.
  const stopEngine = useCallback(() => {
    if (startedRef.current && window.XR8) {
      try { window.XR8.stop(); } catch { /* noop */ }
      try { window.XR8.clearCameraPipelineModules(); } catch { /* noop */ }
      startedRef.current = false;
    }
    // Liberar la cámara: frenar los tracks de cualquier MediaStream activo.
    try {
      document.querySelectorAll('video').forEach((v) => {
        const s = v.srcObject;
        if (s && typeof s.getTracks === 'function') s.getTracks().forEach((t) => t.stop());
      });
    } catch { /* noop */ }
    // FullWindowCanvas cuelga el canvas del <body>; devolverlo a nuestro root para que el
    // unmount de React lo remueva (si no, el feed de cámara queda tapando al Viewer3D).
    const c = canvasRef.current;
    const root = rootRef.current;
    if (c && root && c.parentNode && c.parentNode !== root) {
      try { root.appendChild(c); } catch { /* noop */ }
    }
    // Restaurar el pipeline de color del Viewer3D principal (el motor lo necesita en false).
    if (colorMgmtPrevRef.current !== null) {
      THREE.ColorManagement.enabled = colorMgmtPrevRef.current;
      colorMgmtPrevRef.current = null;
    }
  }, []);

  // Limpieza al desmontar.
  useEffect(() => stopEngine, [stopEngine]);

  const start = useCallback(async () => {
    if (startedRef.current) return;
    setErrorMsg('');
    setStatus('loading');
    try {
      await loadEngine();
      const XR8 = window.XR8;
      const XRExtras = window.XRExtras;
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas no disponible');

      // El motor espera el pipeline de color clásico. Guardar el valor actual para restaurarlo
      // al cerrar (el Viewer3D principal usa SRGB color management).
      if (colorMgmtPrevRef.current === null) {
        colorMgmtPrevRef.current = THREE.ColorManagement.enabled;
      }
      THREE.ColorManagement.enabled = false;

      // Solo world-tracking (sin image targets).
      XR8.XrController.configure({ disableWorldTracking: false });

      const arMod = arPipelineModule({
        onModelLoaded: () => setModelLoaded(true),
        onModelError: () => setModelError(true),
        onReticle: setReticleActive,
        onPlaced: setPlaced,
      }, { modelUrl, sogUrl, transforms });
      arModRef.current = arMod;

      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(),      // dibuja el feed de cámara
        XR8.Threejs.pipelineModule(),                // crea la escena three.js AR
        XR8.XrController.pipelineModule(),           // habilita SLAM
        XRExtras.FullWindowCanvas.pipelineModule(),  // ajusta el canvas a la ventana
        XRExtras.Loading.pipelineModule(),           // loading + permisos de cámara/movimiento
        XRExtras.RuntimeError.pipelineModule(),      // pantalla de error de runtime
        arMod,
      ]);

      startedRef.current = true;
      XR8.run({ canvas });
      setStatus('running');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Error desconocido al iniciar AR');
      setStatus('error');
    }
  }, [modelUrl, sogUrl, transforms]);

  const handleClose = useCallback(() => {
    stopEngine();
    onClose?.();
  }, [stopEngine, onClose]);

  return (
    <div ref={rootRef} style={S.root}>
      {/* Canvas del motor: debe existir en el DOM antes de iniciar la cámara (capa de fondo). */}
      <canvas id="camerafeed" ref={canvasRef} style={S.canvas} />

      {/* Botón cerrar (siempre visible). */}
      <button className="xrs-ar-btn" onClick={handleClose} style={S.closeBtn} aria-label="Cerrar AR">✕</button>

      {/* HUD durante la sesión (no bloquea los toques del canvas). */}
      {status === 'running' && (
        <div style={S.hud}>
          <div style={S.hudTop}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                draggable={false}
                onPointerDown={startPress}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                style={S.hudLogo}
              />
            ) : (
              // Sin logo del proyecto: zona invisible que conserva el long-press para
              // revelar la atribución legal del motor (requisito de licencia).
              <span
                onPointerDown={startPress}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                style={S.hudCreditsHotspot}
                aria-hidden="true"
              />
            )}
          </div>

          <div style={S.hudBottom}>
            <div style={{ ...S.hudHints, opacity: hintsHidden ? 0 : 1 }}>
              {modelError ? (
                <Chip>No se pudo cargar la maqueta 3D</Chip>
              ) : placed ? (
                <Chip>1 dedo: mover · 2 dedos: escalar y rotar</Chip>
              ) : !modelLoaded ? (
                <Chip>Cargando maqueta 3D…</Chip>
              ) : reticleActive ? (
                <Chip>Tocá la pantalla para colocar la maqueta</Chip>
              ) : (
                <Chip>Movés el teléfono apuntando al piso…</Chip>
              )}
            </div>
            {placed && (
              <button
                className="xrs-ar-btn"
                onClick={() => { arModRef.current?.reposition(); setHintsHidden(false); }}
                style={S.repositionBtn}
              >
                Reposicionar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Overlay de carga. */}
      {status === 'loading' && (
        <div style={S.loading}>
          <div className="xrs-ar-spinner" />
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>Iniciando experiencia AR…</p>
        </div>
      )}

      {/* Pantalla de inicio (idle / error). */}
      {(status === 'idle' || status === 'error') && (
        <div style={S.landing}>
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" draggable={false} style={S.landingLogo} />
          )}
          <p style={S.landingText}>
            Realidad aumentada: colocá la maqueta en tu espacio y manipulala con los dedos.
          </p>

          {status === 'error' && <p style={S.errorBox}>{errorMsg}</p>}

          <button className="xrs-ar-btn" onClick={start} style={S.primaryBtn}>
            {status === 'error' ? 'Reintentar' : 'Iniciar experiencia AR'}
          </button>

          <p style={S.landingNote}>
            Requiere permiso de cámara y sensores de movimiento. Funciona mejor en un teléfono.
          </p>
        </div>
      )}

      {/* Atribución legal mínima del motor (requisito de licencia). */}
      {showCredits && (
        <div style={S.creditsWrap}>
          <div style={S.creditsCard}>
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" draggable={false} style={S.creditsLogo} />
            )}
            <p style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6, color: 'rgba(255,255,255,0.6)' }}>
              Motor de tracking AR © 2026 Niantic Spatial, Inc.
            </p>
            <button className="xrs-ar-btn" onClick={() => setShowCredits(false)} style={{ ...S.primaryBtn, marginTop: 20, padding: '8px 24px', fontSize: 14 }}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ children }) {
  return <span style={S.chip}>{children}</span>;
}

const S = {
  root: { position: 'fixed', inset: 0, zIndex: 1000, overflow: 'hidden', color: '#fff' },
  canvas: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  closeBtn: {
    position: 'absolute', top: 12, right: 12, zIndex: 30,
    width: 40, height: 40, borderRadius: 9999,
    background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 18,
    backdropFilter: 'blur(8px)',
  },
  hud: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 16, pointerEvents: 'none' },
  hudTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start' },
  hudCreditsHotspot: { pointerEvents: 'auto', display: 'block', width: 44, height: 44 },
  hudLogo: { pointerEvents: 'auto', userSelect: 'none', height: 22, width: 'auto', objectFit: 'contain', opacity: 0.9, filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.9))', WebkitTouchCallout: 'none' },
  hudBottom: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' },
  hudHints: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center', transition: 'opacity 0.7s' },
  repositionBtn: { pointerEvents: 'auto', borderRadius: 9999, background: 'rgba(0,0,0,0.55)', color: '#fff', padding: '10px 22px', fontSize: 14, fontWeight: 600, backdropFilter: 'blur(8px)', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' },
  chip: { borderRadius: 9999, background: 'rgba(0,0,0,0.5)', padding: '8px 16px', fontSize: 14, backdropFilter: 'blur(8px)' },
  loading: { position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#000' },
  landing: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center', background: 'linear-gradient(to bottom, #09090b, rgba(36,26,16,0.6), #000)' },
  landingLogo: { maxHeight: 64, maxWidth: 220, width: 'auto', objectFit: 'contain', marginBottom: 4 },
  landingText: { marginTop: 12, maxWidth: 360, fontSize: 14, color: 'rgba(255,255,255,0.7)' },
  errorBox: { marginTop: 16, maxWidth: 360, borderRadius: 8, background: 'rgba(239,68,68,0.15)', padding: '8px 16px', fontSize: 14, color: '#fca5a5' },
  primaryBtn: { marginTop: 32, borderRadius: 9999, background: GOLD, padding: '12px 32px', fontSize: 16, fontWeight: 600, color: '#18120b', boxShadow: '0 8px 24px rgba(171,136,105,0.3)' },
  landingNote: { marginTop: 24, maxWidth: 280, fontSize: 11, lineHeight: 1.6, color: 'rgba(255,255,255,0.4)' },
  creditsWrap: { position: 'absolute', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px', background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' },
  creditsCard: { maxWidth: 360, borderRadius: 16, background: '#18181b', padding: 24, textAlign: 'center' },
  creditsLogo: { maxHeight: 40, maxWidth: 180, width: 'auto', objectFit: 'contain' },
};
