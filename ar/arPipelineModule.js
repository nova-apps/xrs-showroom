// Módulo de pipeline de cámara (8th Wall) para three.js, solo world-tracking (SLAM):
// reticle sobre el piso → tap coloca la maqueta anclada. Una vez colocada, se manipula
// con gestos: 1 dedo arrastra (mover), 2 dedos escalan (pinch) y rotan (giro).
//
// Usa el `three` de nuestro npm (la misma instancia que exponemos como window.THREE).
import * as THREE from 'three';
import { loadArModel } from './arModelLoader';

// Oro XRS (mismo hex que el branding del proyecto).
const BRAND = 0xab8869;
const MIN_SCALE = 0.2;
const MAX_SCALE = 6;
const PLACE_REF_DIST = 2; // distancia (m) a la que la escala inicial = 1 (tamaño normalizado)

export function arPipelineModule(cb = {}, opts = {}) {
  const modelUrl = opts.modelUrl;
  const XR8 = () => window.XR8;

  const raycaster = new THREE.Raycaster();
  const screenCenter = new THREE.Vector2(0, 0);
  const ndc = new THREE.Vector2();

  let sceneRef = null;
  let surface = null;
  let reticle = null;

  // Maqueta del usuario.
  let modelTemplate = null; // normalizada (centrada, base en y=0, escalada)
  let modelRoot = null;     // lo que se manipula (pos/rot/escala del usuario)
  let placed = false;
  let lastReticleActive = null;

  // Gestos.
  let pinch = null;
  let dragging = false;
  // Arrastre con 1 dedo por delta (no reposición absoluta): guardamos el punto de piso
  // y la posición del modelo al iniciar, y movemos el modelo por la diferencia.
  let dragHasBaseline = false;
  const dragStart = new THREE.Vector3();
  const dragModelStart = new THREE.Vector3();

  // ---- Construcción ----

  const makeReticle = () => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.16, 48),
      new THREE.MeshBasicMaterial({ color: BRAND, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotateX(-Math.PI / 2);
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.03, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    );
    dot.rotateX(-Math.PI / 2);
    g.add(ring, dot);
    g.visible = false;
    return g;
  };

  // ---- Escena ----

  const initXrScene = ({ scene, camera, renderer }) => {
    sceneRef = scene;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1.5, 4, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 1.4));

    surface = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.ShadowMaterial({ opacity: 0.4 })
    );
    surface.rotateX(-Math.PI / 2);
    surface.receiveShadow = true;
    scene.add(surface);

    reticle = makeReticle();
    scene.add(reticle);

    camera.position.set(0, 3, 0);

    // Cargar la maqueta de la escena (con el renderer del motor para KTX2).
    if (!modelUrl) { cb.onModelError?.(); return; }
    loadArModel(modelUrl, renderer)
      .then((m) => { modelTemplate = m; cb.onModelLoaded?.(); })
      .catch(() => cb.onModelError?.());
  };

  // ---- Colocación + manipulación ----

  const placeModel = () => {
    if (placed || !modelTemplate || !reticle || !reticle.visible || !sceneRef) return;
    const firstPlacement = !modelRoot;
    if (!modelRoot) {
      modelRoot = new THREE.Group();
      modelRoot.add(modelTemplate);
      sceneRef.add(modelRoot);
    }
    modelRoot.position.copy(reticle.position);
    // Tamaño inicial según distancia (solo en la primera colocación; al reposicionar se
    // respeta la escala/rotación que haya ajustado el usuario).
    const cam = XR8()?.Threejs?.xrScene?.()?.camera;
    if (firstPlacement && cam) {
      const dist = cam.position.distanceTo(modelRoot.position);
      modelRoot.scale.setScalar(THREE.MathUtils.clamp(dist / PLACE_REF_DIST, MIN_SCALE, MAX_SCALE));
    }
    placed = true;
    reticle.visible = false;
    cb.onReticle?.(false);
    cb.onPlaced?.(true);
  };

  // Reposicionar: vuelve al modo de colocación sin perder la maqueta. Reaparece el reticle
  // (onUpdate) y el próximo toque la reubica en el nuevo punto.
  const reposition = () => {
    if (!placed) return;
    placed = false;
    cb.onPlaced?.(false);
  };

  const touchDistAngle = (t) => {
    const dx = t[1].clientX - t[0].clientX;
    const dy = t[1].clientY - t[0].clientY;
    return { d: Math.hypot(dx, dy), a: Math.atan2(dy, dx) };
  };

  const beginGesture = (touches) => {
    if (!modelRoot) return;
    if (touches.length >= 2) {
      const { d, a } = touchDistAngle(touches);
      pinch = { d0: d || 1, a0: a, s0: modelRoot.scale.x, r0: modelRoot.rotation.y };
      dragging = false;
    } else if (touches.length === 1) {
      pinch = null;
      dragging = true;
      dragHasBaseline = false; // baseline se fija en el primer move válido (evita salto)
    } else {
      pinch = null;
      dragging = false;
    }
  };

  const touchToSurface = (t) => {
    const cam = XR8()?.Threejs?.xrScene?.()?.camera;
    if (!cam || !surface) return null;
    ndc.x = (t.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(t.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(ndc, cam);
    const hits = raycaster.intersectObject(surface);
    return hits.length ? hits[0].point.clone() : null;
  };

  // Arrastre relativo: la maqueta se mueve por la diferencia entre el punto de piso actual
  // y el inicial, sin teletransportarse a donde está el dedo.
  const moveToTouch = (t) => {
    if (!modelRoot) return;
    const p = touchToSurface(t);
    if (!p) return;
    if (!dragHasBaseline) {
      dragStart.copy(p);
      dragModelStart.copy(modelRoot.position);
      dragHasBaseline = true;
      return;
    }
    modelRoot.position.copy(dragModelStart).add(p).sub(dragStart);
  };

  const onTouchStart = (e) => {
    if (!placed) {
      placeModel(); // primer toque: colocar la maqueta en el reticle
      beginGesture(e.touches);
      return;
    }
    beginGesture(e.touches);
  };

  const onTouchMove = (e) => {
    e.preventDefault();
    if (!placed || !modelRoot) return;
    if (pinch && e.touches.length >= 2) {
      const { d, a } = touchDistAngle(e.touches);
      const s = THREE.MathUtils.clamp(pinch.s0 * (d / pinch.d0), MIN_SCALE, MAX_SCALE);
      modelRoot.scale.setScalar(s);
      modelRoot.rotation.y = pinch.r0 - (a - pinch.a0);
    } else if (dragging && e.touches.length === 1) {
      moveToTouch(e.touches[0]);
    }
  };

  const onTouchEnd = (e) => {
    beginGesture(e.touches); // recalcular baseline según los dedos que quedan (evita saltos)
  };

  // ---- Lifecycle ----

  return {
    name: 'xrs-ar',

    // Expuesto para que la UI (React) pueda disparar el modo de reposición.
    reposition,

    // 8th Wall reporta el estado de la cámara (requesting/hasVideo/failed/…). Lo reenviamos
    // a React para mostrar nuestro modal de permisos mientras se piden.
    onCameraStatusChange: ({ status }) => { cb.onCameraStatus?.(status); },

    onStart: ({ canvas }) => {
      const { scene, camera, renderer } = XR8().Threejs.xrScene();
      initXrScene({ scene, camera, renderer });

      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd);
      canvas.addEventListener('touchcancel', onTouchEnd);

      XR8().XrController.updateCameraProjectionMatrix({
        origin: camera.position,
        facing: camera.quaternion,
      });

      cb.onReady?.();
    },

    onUpdate: () => {
      if (!surface || !reticle) return;
      // Reticle sólo hasta colocar la maqueta.
      if (!placed) {
        const cam = XR8()?.Threejs?.xrScene?.()?.camera;
        if (cam) {
          raycaster.setFromCamera(screenCenter, cam);
          const hits = raycaster.intersectObject(surface);
          const active = hits.length > 0;
          if (active) reticle.position.copy(hits[0].point);
          reticle.visible = active;
          if (active !== lastReticleActive) {
            lastReticleActive = active;
            cb.onReticle?.(active);
          }
        }
      }
    },

    onException: (err) => {
      cb.onError?.(err instanceof Error ? err.message : 'Error del motor AR');
    },
  };
}
