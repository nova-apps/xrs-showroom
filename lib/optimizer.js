/**
 * Runtime optimizer for textures, geometry, and memory management.
 * Ported from 3D-Web-Pipeline-Optimizer.
 */

import { detectGPU, getQualityProfile, formatBytes } from './utils';

const DEFAULT_CONFIG = {
  generateMipmaps: true,
  memoryBudgetMB: 512,
};

export class Optimizer {
  constructor(THREE) {
    this.THREE = THREE;
    this._textureMemoryEstimate = 0;
    this._geometryMemoryEstimate = 0;
    this._quality = getQualityProfile();
  }

  async optimize(model) {
    const start = performance.now();
    this.optimizeTextures(model);
    this.optimizeGeometry(model);
    this._estimateMemory(model);
    console.log(`[Optimizer] Done in ${(performance.now() - start).toFixed(0)}ms (quality: ${this._quality.name})`);
  }

  optimizeTextures(model) {
    const THREE = this.THREE;
    const gpu = detectGPU();
    const gpuMax = gpu.maxTexSize || 4096;
    const effectiveMax = Math.min(this._quality.maxTextureSize, gpuMax);
    let optimized = 0;
    const processed = new Set();

    model.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];

      for (const mat of mats) {
        const keys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];
        for (const key of keys) {
          const tex = mat[key];
          if (!tex || processed.has(tex.uuid)) continue;
          processed.add(tex.uuid);

          if (tex.image) {
            const w = tex.image.width || tex.image.naturalWidth || 0;
            const h = tex.image.height || tex.image.naturalHeight || 0;
            if (w > effectiveMax || h > effectiveMax) {
              this._clampTexture(tex, effectiveMax);
              optimized++;
            }
          }

          tex.generateMipmaps = DEFAULT_CONFIG.generateMipmaps;
          if (DEFAULT_CONFIG.generateMipmaps) {
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
          } else {
            tex.minFilter = THREE.LinearFilter;
          }
          tex.anisotropy = this._quality.anisotropy;
          tex.needsUpdate = true;
        }
      }
    });

    if (optimized > 0) {
      console.log(`[Optimizer] Clamped ${optimized} textures to ${effectiveMax}px`);
    }
  }

  optimizeGeometry(model) {
    let count = 0;
    model.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      count++;
      const geom = child.geometry;
      if (!geom.boundingBox) geom.computeBoundingBox();
      if (!geom.boundingSphere) geom.computeBoundingSphere();
      child.frustumCulled = true;
    });
    console.log(`[Optimizer] Geometry: ${count} meshes, bounds computed`);
  }

  /**
   * Resize all textures to a max size.
   */
  resizeTextures(model, maxSize) {
    let count = 0;
    const processed = new Set();
    model.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
          const tex = mat[key];
          if (!tex || processed.has(tex.uuid)) continue;
          processed.add(tex.uuid);
          if (tex.image) {
            const w = tex.image.width || tex.image.naturalWidth || 0;
            const h = tex.image.height || tex.image.naturalHeight || 0;
            if (w > maxSize || h > maxSize) {
              this._clampTexture(tex, maxSize);
              count++;
            }
          }
        }
      }
    });
    console.log(`[Optimizer] Resized ${count} textures to max ${maxSize}px`);
    return count;
  }

  /**
   * Resize non-power-of-two textures to nearest POT.
   */
  forcePOT(model) {
    const THREE = this.THREE;
    const nearestPOT = (v) => Math.pow(2, Math.round(Math.log2(v)));
    let count = 0;
    const processed = new Set();
    model.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
          const tex = mat[key];
          if (!tex || processed.has(tex.uuid) || !tex.image) continue;
          processed.add(tex.uuid);
          const w = tex.image.width || tex.image.naturalWidth || 0;
          const h = tex.image.height || tex.image.naturalHeight || 0;
          if (!w || !h) continue;
          const isPOT = (w & (w - 1)) === 0 && (h & (h - 1)) === 0;
          if (!isPOT) {
            const nw = nearestPOT(w);
            const nh = nearestPOT(h);
            let canvas;
            if (typeof OffscreenCanvas !== 'undefined') {
              canvas = new OffscreenCanvas(nw, nh);
            } else {
              canvas = document.createElement('canvas');
              canvas.width = nw;
              canvas.height = nh;
            }
            canvas.getContext('2d').drawImage(tex.image, 0, 0, nw, nh);
            tex.image = canvas;
            tex.needsUpdate = true;
            count++;
          }
        }
      }
    });
    console.log(`[Optimizer] Converted ${count} textures to POT`);
    return count;
  }

  /**
   * Remove duplicate/unused vertex attributes to reduce geometry memory.
   */
  stripGeometry(model) {
    let stripped = 0;
    model.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      const geom = child.geometry;
      // Remove unused attributes (uv2, color if not needed)
      for (const attr of ['uv2', 'color']) {
        if (geom.attributes[attr]) {
          const mat = Array.isArray(child.material) ? child.material[0] : child.material;
          const needsUV2 = attr === 'uv2' && mat?.aoMap;
          const needsColor = attr === 'color' && mat?.vertexColors;
          if (!needsUV2 && !needsColor) {
            geom.deleteAttribute(attr);
            stripped++;
          }
        }
      }
    });
    console.log(`[Optimizer] Stripped ${stripped} unused attributes`);
    return stripped;
  }

  _clampTexture(texture, maxSize) {
    const img = texture.image;
    if (!img) return;
    const w = img.width || img.naturalWidth;
    const h = img.height || img.naturalHeight;
    if (!w || !h) return;
    const ratio = Math.min(maxSize / w, maxSize / h, 1);
    if (ratio >= 1) return;
    const nw = Math.floor(w * ratio);
    const nh = Math.floor(h * ratio);

    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(nw, nh);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = nw;
      canvas.height = nh;
    }
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, nw, nh);
    texture.image = canvas;
    texture.needsUpdate = true;
  }

  _estimateMemory(model) {
    let texMem = 0, geomMem = 0;
    const processed = new Set();

    model.traverse((child) => {
      if (!child.isMesh) return;
      if (child.geometry) {
        for (const attr of Object.values(child.geometry.attributes)) {
          geomMem += attr.array.byteLength;
        }
        const idx = child.geometry.getIndex();
        if (idx) geomMem += idx.array.byteLength;
      }
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
            const tex = mat[key];
            if (tex?.image && !processed.has(tex.uuid)) {
              processed.add(tex.uuid);
              const w = tex.image.width || tex.image.naturalWidth || 0;
              const h = tex.image.height || tex.image.naturalHeight || 0;
              texMem += w * h * 4;
            }
          }
        }
      }
    });

    this._textureMemoryEstimate = texMem;
    this._geometryMemoryEstimate = geomMem;
    console.log(`[Optimizer] Memory: tex=${formatBytes(texMem)}, geo=${formatBytes(geomMem)}, total=${formatBytes(texMem + geomMem)}`);
  }
}
