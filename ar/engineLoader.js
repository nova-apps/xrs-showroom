// Carga del motor de tracking AR (8th Wall) y exposición de nuestro `three` como global
// para que el motor lo use al crear la escena.
//
// Se cargan desde CDN (jsDelivr). La atribución de copyright del motor viaja dentro del
// binario; el branding visible "powered by 8th Wall" se oculta por CSS (ver globals.css),
// sin tocar la orquestación de permisos de cámara/sensores (la hace el módulo Loading).
import * as THREE from 'three';

const ENGINE_SOURCES = {
  xr: 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js',
  xrextras: 'https://cdn.jsdelivr.net/npm/@8thwall/xrextras@1/dist/xrextras.js',
};

const LOAD_TIMEOUT_MS = 20000;

function injectScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), { once: true });
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.crossOrigin = 'anonymous';
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.addEventListener('load', () => { el.dataset.loaded = 'true'; resolve(); }, { once: true });
    el.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), { once: true });
    document.head.appendChild(el);
  });
}

let enginePromise = null;

/**
 * Carga el motor una sola vez. Resuelve cuando `window.XR8` y `window.XRExtras` están
 * disponibles. Debe llamarse desde el navegador, nunca en SSR.
 */
export function loadEngine() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('loadEngine solo puede correr en el navegador'));
  }
  if (window.XR8 && window.XRExtras) return Promise.resolve();
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    // El motor lee el THREE global: exponer nuestro npm three ANTES de inicializarlo.
    window.THREE = THREE;

    const xr8Ready = new Promise((resolve) => {
      if (window.XR8) return resolve();
      window.addEventListener('xrloaded', () => resolve(), { once: true });
    });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout cargando el motor AR (revisá la conexión).')), LOAD_TIMEOUT_MS)
    );

    await Promise.race([
      Promise.all([
        injectScript(ENGINE_SOURCES.xrextras),
        injectScript(ENGINE_SOURCES.xr, { async: 'true', 'data-preload-chunks': 'slam' }),
      ]).then(() => xr8Ready),
      timeout,
    ]);
  })();

  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}
