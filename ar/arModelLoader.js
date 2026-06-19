// Carga de la maqueta para AR (GLB + opcionalmente el splat gaussiano SOG), desde las URLs
// de la escena en Firebase Storage. Replica los decoders del Viewer3D principal (Draco +
// MeshOpt + KTX2) y, si la escena tiene SOG, lo carga con Spark y lo alinea al GLB usando
// los transforms relativos de la escena, de modo que ambos se colocan como una sola pieza.
// El conjunto se centra en x/z, apoya su base en y=0 y se escala a un tamaño "de mesa".
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Mismos paths que components/viewer/Viewer3D.js (mantener en sync).
const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
const KTX2_PATH = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/';

const TARGET_SIZE = 1.5; // metros aprox. para la dimensión mayor al colocar (escalable con pinch)
const DEG2RAD = Math.PI / 180;

async function buildLoader(renderer) {
  const loader = new GLTFLoader();

  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  draco.setDecoderConfig({ type: 'wasm' });
  loader.setDRACOLoader(draco);

  loader.setMeshoptDecoder(MeshoptDecoder);

  // KTX2 necesita el renderer para detectar soporte de formatos comprimidos.
  if (renderer) {
    const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
    const ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath(KTX2_PATH);
    ktx2.detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  }

  return loader;
}

// Construye la matriz de un transform de escena ({ position, rotation(°), scale }).
function composeMatrix(t) {
  const m = new THREE.Matrix4();
  if (!t) return m;
  const p = t.position || {};
  const r = t.rotation || {};
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler((r.x ?? 0) * DEG2RAD, (r.y ?? 0) * DEG2RAD, (r.z ?? 0) * DEG2RAD)
  );
  const s = t.scale;
  const sv = (typeof s === 'object' && s !== null)
    ? new THREE.Vector3(s.x ?? 1, s.y ?? 1, s.z ?? 1)
    : new THREE.Vector3().setScalar(typeof s === 'number' ? s : 1);
  m.compose(new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0), q, sv);
  return m;
}

// Centra el GLB en x/z y apoya su base en y=0, luego escala el contenedor a TARGET_SIZE.
// El bounding box se mide SOLO sobre el GLB (las bounds del splat son poco confiables),
// y el anchor —que contiene GLB + splat— se reposiciona en bloque para que el splat
// conserve su alineación relativa.
function normalizeAnchor(anchor, glb) {
  glb.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const box = new THREE.Box3().setFromObject(glb);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  anchor.position.set(-center.x, -box.min.y, -center.z);
  const holder = new THREE.Group();
  holder.add(anchor);
  holder.scale.setScalar(TARGET_SIZE / maxDim);
  return holder;
}

function loadGltf(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => reject(err instanceof Error ? err : new Error('Error cargando el modelo 3D')),
    );
  });
}

/**
 * Carga el splat SOG con Spark y lo devuelve como SplatMesh. Crea (una sola vez) el
 * SparkRenderer requerido por Spark 2.0 y lo agrega a la escena AR. El splat se renderiza
 * recién cuando termina de descargar (onLoad interno de Spark).
 * @param {string} url URL del .sog
 * @param {THREE.WebGLRenderer} renderer renderer del motor 8th Wall
 * @param {THREE.Scene} scene escena three.js del motor (para el SparkRenderer)
 */
export async function loadArSplat(url, renderer, scene) {
  const spark = await import('@sparkjsdev/spark');
  const { SparkRenderer, SplatMesh } = spark;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) throw new Error('Se recibió HTML en lugar de SOG');
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // SOG es un contenedor ZIP: validar magic bytes (PK\x03\x04).
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('Archivo SOG inválido (no es un contenedor ZIP)');
  }

  // El SparkRenderer debe vivir en la escena (requisito de Spark 2.0). Uno solo por escena.
  if (scene && !scene.userData.__sparkRenderer) {
    const sparkR = new SparkRenderer({ renderer });
    scene.add(sparkR);
    scene.userData.__sparkRenderer = sparkR;
  }

  // extSplats OFF en AR: duplica VRAM, demasiado pesado para mobile (igual criterio que el
  // quality profile mobile del Viewer3D principal).
  return new SplatMesh({
    fileBytes: buffer,
    fileName: 'splat.sog',
    lod: true,
    extSplats: false,
  });
}

/**
 * Carga y normaliza la maqueta para AR. Devuelve un Object3D listo para colocar, que
 * contiene el GLB y —si la escena tiene SOG— el splat gaussiano alineado al GLB.
 * @param {object} args
 * @param {string} args.modelUrl URL del GLB.
 * @param {string} [args.sogUrl] URL del splat SOG (opcional).
 * @param {object} [args.transforms] scene.transforms { glb, sog } para alinear ambos.
 * @param {THREE.WebGLRenderer} [args.renderer] renderer del motor (KTX2 + Spark).
 * @param {THREE.Scene} [args.scene] escena del motor (para el SparkRenderer).
 */
export async function loadArModel({ modelUrl, sogUrl, transforms, renderer, scene }) {
  if (!modelUrl) throw new Error('Falta la URL del modelo');

  const anchor = new THREE.Group();

  // ── GLB ── se deja en su orientación nativa (raw); el anchor se normaliza por su bbox.
  const loader = await buildLoader(renderer);
  const glb = await loadGltf(loader, modelUrl);
  anchor.add(glb);

  // ── SOG (opcional) ── posicionado relativo al GLB usando los transforms de la escena:
  // rel = M_glb⁻¹ · M_sog. Así queda alineado al GLB tal como en la escena, sin alterar la
  // orientación con la que el GLB ya se mostraba en AR. Si falla, seguimos solo con el GLB.
  if (sogUrl) {
    try {
      const splat = await loadArSplat(sogUrl, renderer, scene);
      const rel = new THREE.Matrix4()
        .copy(composeMatrix(transforms?.glb))
        .invert()
        .multiply(composeMatrix(transforms?.sog));
      rel.decompose(splat.position, splat.quaternion, splat.scale);
      splat.userData.__isArSplat = true; // marca para liberarlo en el teardown
      anchor.add(splat);
    } catch (err) {
      console.warn('[AR] No se pudo cargar el splat SOG, se muestra solo el GLB:', err);
    }
  }

  return normalizeAnchor(anchor, glb);
}
