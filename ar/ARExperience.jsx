'use client';

// Overlay cliente que monta la experiencia AR markerless (world-tracking SLAM) sobre la
// maqueta de la escena. Toda interacción con el motor/cámara ocurre en el navegador.
//
// Props:
//   - modelUrl: URL del GLB a colocar en AR (de la escena).
//   - onClose:  callback al cerrar el overlay (desmonta y frena la cámara).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { loadEngine } from './engineLoader';
import { arPipelineModule } from './arPipelineModule';

const GOLD = '#ab8869';

export default function ARExperience({ modelUrl, onClose }) {
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
  const [permStatus, setPermStatus] = useState(null);
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

  // Limpieza al desmontar: frenar la cámara, limpiar el pipeline y restaurar ColorManagement.
  useEffect(() => {
    return () => {
      if (startedRef.current && window.XR8) {
        try { window.XR8.stop(); } catch { /* noop */ }
        try { window.XR8.clearCameraPipelineModules(); } catch { /* noop */ }
        startedRef.current = false;
      }
      // Restaurar el pipeline de color del Viewer3D principal (el motor lo necesita en false).
      if (colorMgmtPrevRef.current !== null) {
        THREE.ColorManagement.enabled = colorMgmtPrevRef.current;
        colorMgmtPrevRef.current = null;
      }
    };
  }, []);

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
        onCameraStatus: setPermStatus,
      }, { modelUrl });
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
  }, [modelUrl]);

  const handleClose = useCallback(() => {
    if (startedRef.current && window.XR8) {
      try { window.XR8.stop(); } catch { /* noop */ }
      try { window.XR8.clearCameraPipelineModules(); } catch { /* noop */ }
      startedRef.current = false;
    }
    onClose?.();
  }, [onClose]);

  return (
    <div style={S.root}>
      {/* Canvas del motor: debe existir en el DOM antes de iniciar la cámara (capa de fondo). */}
      <canvas id="camerafeed" ref={canvasRef} style={S.canvas} />

      {/* Botón cerrar (siempre visible). */}
      <button className="xrs-ar-btn" onClick={handleClose} style={S.closeBtn} aria-label="Cerrar AR">✕</button>

      {/* HUD durante la sesión (no bloquea los toques del canvas). */}
      {status === 'running' && (
        <div style={S.hud}>
          <div style={S.hudTop}>
            <span
              onPointerDown={startPress}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onPointerCancel={cancelPress}
              style={S.hudBrand}
            >
              XRS
            </span>
            {placed && (
              <button
                className="xrs-ar-btn"
                onClick={() => { arModRef.current?.reposition(); setHintsHidden(false); }}
                style={S.chipBtn}
              >
                Reposicionar
              </button>
            )}
          </div>

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
          <span style={S.landingBrand}>XRS</span>
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
            <span style={{ ...S.landingBrand, fontSize: 22 }}>XRS</span>
            <p style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6, color: 'rgba(255,255,255,0.6)' }}>
              Motor de tracking AR © 2026 Niantic Spatial, Inc.
            </p>
            <button className="xrs-ar-btn" onClick={() => setShowCredits(false)} style={{ ...S.primaryBtn, marginTop: 20, padding: '8px 24px', fontSize: 14 }}>
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Modal de permisos mientras el motor pide cámara/sensores. Vía portal a <body>. */}
      {permStatus === 'requesting' && typeof document !== 'undefined' && createPortal(
        <div style={S.permWrap}>
          <div style={S.permCard}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Aceptá los permisos para continuar</p>
            <p style={{ marginTop: 4, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
              Necesitamos acceso a la cámara y a los sensores de movimiento.
            </p>
          </div>
        </div>,
        document.body,
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
  hudTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  hudBrand: { pointerEvents: 'auto', userSelect: 'none', fontWeight: 700, letterSpacing: 2, color: GOLD, textShadow: '0 1px 4px rgba(0,0,0,0.9)' },
  chipBtn: { pointerEvents: 'auto', borderRadius: 9999, background: 'rgba(0,0,0,0.4)', color: '#fff', padding: '4px 12px', fontSize: 12, backdropFilter: 'blur(8px)' },
  hudHints: { marginBottom: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center', transition: 'opacity 0.7s' },
  chip: { borderRadius: 9999, background: 'rgba(0,0,0,0.5)', padding: '8px 16px', fontSize: 14, backdropFilter: 'blur(8px)' },
  loading: { position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#000' },
  landing: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center', background: 'linear-gradient(to bottom, #09090b, rgba(36,26,16,0.6), #000)' },
  landingBrand: { fontSize: 40, fontWeight: 800, letterSpacing: 4, color: GOLD },
  landingText: { marginTop: 12, maxWidth: 360, fontSize: 14, color: 'rgba(255,255,255,0.7)' },
  errorBox: { marginTop: 16, maxWidth: 360, borderRadius: 8, background: 'rgba(239,68,68,0.15)', padding: '8px 16px', fontSize: 14, color: '#fca5a5' },
  primaryBtn: { marginTop: 32, borderRadius: 9999, background: GOLD, padding: '12px 32px', fontSize: 16, fontWeight: 600, color: '#18120b', boxShadow: '0 8px 24px rgba(171,136,105,0.3)' },
  landingNote: { marginTop: 24, maxWidth: 280, fontSize: 11, lineHeight: 1.6, color: 'rgba(255,255,255,0.4)' },
  creditsWrap: { position: 'absolute', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px', background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' },
  creditsCard: { maxWidth: 360, borderRadius: 16, background: '#18181b', padding: 24, textAlign: 'center' },
  permWrap: { position: 'fixed', insetInline: 0, top: 0, zIndex: 2147483647, display: 'flex', justifyContent: 'center', padding: 16, pointerEvents: 'none' },
  permCard: { pointerEvents: 'auto', maxWidth: 360, borderRadius: 16, background: 'rgba(24,24,27,0.95)', padding: '16px 20px', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' },
};
