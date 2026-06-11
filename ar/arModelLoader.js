// Carga del GLB de la maqueta para AR, desde una URL (la de la escena en Firebase Storage).
// Replica los decoders que usa el Viewer3D principal: Draco + MeshOpt + KTX2, porque las
// maquetas de xrs-showroom pueden venir comprimidas con cualquiera de los tres.
// Centra el modelo en x/z, apoya la base en y=0 y lo escala a un tamaño "de mesa" para AR.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Mismos paths que components/viewer/Viewer3D.js (mantener en sync).
const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
const KTX2_PATH = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/';

const TARGET_SIZE = 1.5; // metros aprox. para la dimensión mayor al colocar (escalable con pinch)

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

function normalize(root) {
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  // Centrar en x/z y apoyar la base en y=0, antes de escalar el contenedor.
  root.position.set(-center.x, -box.min.y, -center.z);
  const holder = new THREE.Group();
  holder.add(root);
  holder.scale.setScalar(TARGET_SIZE / maxDim);
  return holder;
}

/**
 * Carga y normaliza el GLB de la maqueta. Resuelve con un Object3D listo para colocar.
 * @param {string} url URL del GLB.
 * @param {THREE.WebGLRenderer} [renderer] renderer del motor (para KTX2).
 */
export async function loadArModel(url, renderer) {
  const loader = await buildLoader(renderer);
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(normalize(gltf.scene)),
      undefined,
      (err) => reject(err instanceof Error ? err : new Error('Error cargando el modelo 3D')),
    );
  });
}
