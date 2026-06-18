/**
 * GPU capability detection, SIMD detection, and utility helpers.
 * Ported from 3D-Web-Pipeline-Optimizer.
 */

/* ───── GPU / WebGL Capabilities ───── */

let _gpuInfo = null;

export function detectGPU() {
  if (_gpuInfo) return _gpuInfo;
  if (typeof document === 'undefined') {
    _gpuInfo = { renderer: 'ssr', vendor: 'ssr', tier: 'mid', webgl2: false, maxTexSize: 2048 };
    return _gpuInfo;
  }

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

  if (!gl) {
    _gpuInfo = { renderer: 'unknown', vendor: 'unknown', tier: 'low', webgl2: false, maxTexSize: 2048 };
    return _gpuInfo;
  }

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'unknown';
  const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const webgl2 = !!canvas.getContext('webgl2');

  const lowerRenderer = renderer.toLowerCase();
  let tier = 'mid';
  if (/apple|intel|mesa|swiftshader|llvmpipe/.test(lowerRenderer)) tier = 'low';
  if (/nvidia|radeon rx|geforce rtx|radeon pro/i.test(lowerRenderer)) tier = 'high';

  _gpuInfo = { renderer, vendor, tier, webgl2, maxTexSize };
  console.log(`[GPU] ${renderer} (${vendor}), tier=${tier}, webgl2=${webgl2}, maxTex=${maxTexSize}`);
  return _gpuInfo;
}

/* ───── Device Detection ───── */

let _deviceInfo = null;

export function detectDevice() {
  if (_deviceInfo) return _deviceInfo;
  if (typeof navigator === 'undefined') {
    _deviceInfo = { isMobile: false, isIOS: false, isSafari: false, isAndroid: false, deviceMemory: null };
    return _deviceInfo;
  }

  const ua = navigator.userAgent || '';

  // iOS: iPhone, iPad, iPod — also iPad on iOS 13+ uses Mac UA with touch
  const isIOS = /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid || /Mobile|webOS|BlackBerry|Opera Mini/i.test(ua);

  // Safari detection (including iOS Chrome/Firefox which are all WebKit)
  const isSafari = /Safari/i.test(ua) && !/Chrome/i.test(ua);
  const isIOSBrowser = isIOS; // All iOS browsers use WebKit

  // navigator.deviceMemory (Chrome only, GB) — not available on Safari/iOS
  const deviceMemory = navigator.deviceMemory || null;

  _deviceInfo = { isMobile, isIOS, isIOSBrowser, isSafari, isAndroid, deviceMemory };
  console.log(`[Device] mobile=${isMobile}, iOS=${isIOS}, safari=${isSafari}, memory=${deviceMemory || '?'}GB`);
  return _deviceInfo;
}

/* ───── Quality Profile ───── */

/**
 * Returns rendering quality settings based on GPU and device capabilities.
 * Profiles:
 *   - 'ultra'  : Desktop high-end GPU
 *   - 'high'   : Desktop mid GPU
 *   - 'medium' : Mobile high-end (iPhone 14 Pro, etc)
 *   - 'low'    : Mobile low-end / old devices
 */
export function getQualityProfile() {
  const gpu = detectGPU();
  const device = detectDevice();

  let profile;

  if (device.isIOS) {
    // iOS is memory-constrained — always use medium or low
    profile = {
      name: 'medium',
      pixelRatio: 1.0,
      maxTextureSize: 1024,
      skyboxSegments: [32, 16],    // [width, height] segments
      enablePMREM: true,
      enableEnvMap: true,
      enableSplats: true,           // SOG enabled at lowest quality for proximity splats
      enableExtSplats: false,       // ExtSplats OFF — doubles VRAM, too heavy for iOS
      anisotropy: 4,
      frustumCulling: true,
      cameraFar: 5000,              // Reduced far plane to save depth buffer memory
    };
  } else if (device.isMobile) {
    // Android mobile — slightly more flexible than iOS but still constrained
    profile = {
      name: 'medium',
      pixelRatio: 1.0,
      maxTextureSize: 1024,
      skyboxSegments: [32, 16],
      enablePMREM: true,
      enableEnvMap: true,
      enableSplats: true,           // SOG enabled at lowest quality for proximity splats
      enableExtSplats: false,       // ExtSplats OFF — doubles VRAM, too heavy for Android
      anisotropy: 4,
      frustumCulling: true,
      cameraFar: 5000,
    };
  } else if (gpu.tier === 'high') {
    profile = {
      name: 'ultra',
      pixelRatio: Math.min(window.devicePixelRatio, 2.0),
      maxTextureSize: 4096,
      skyboxSegments: [64, 32],
      enablePMREM: true,
      enableEnvMap: true,
      enableSplats: true,
      enableExtSplats: true,
      anisotropy: 16,
      frustumCulling: true,
      cameraFar: 50000,
    };
  } else {
    // Desktop mid/low GPU
    profile = {
      name: 'high',
      pixelRatio: Math.min(window.devicePixelRatio, 1.5),
      maxTextureSize: 2048,
      skyboxSegments: [64, 32],
      enablePMREM: true,
      enableEnvMap: true,
      enableSplats: true,
      enableExtSplats: true,
      anisotropy: 8,
      frustumCulling: true,
      cameraFar: 50000,
    };
  }

  console.log(`[Quality] Profile: ${profile.name} (pixelRatio=${profile.pixelRatio}, maxTex=${profile.maxTextureSize}, PMREM=${profile.enablePMREM})`);
  return profile;
}

/* ───── SIMD Detection ───── */

let _simdSupported = null;

export function detectSIMD() {
  if (_simdSupported !== null) return _simdSupported;

  try {
    _simdSupported = WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
      3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
    ]));
  } catch {
    _simdSupported = false;
  }

  return _simdSupported;
}

/* ───── Texture Blur ───── */

export function blurTexture(THREE, texture, blurAmount = 3) {
  const image = texture.image;
  if (!image) return texture;

  const canvas = document.createElement('canvas');
  canvas.width = image.width || image.naturalWidth || 512;
  canvas.height = image.height || image.naturalHeight || 512;
  const ctx = canvas.getContext('2d');
  ctx.filter = `blur(${blurAmount}px)`;
  const margin = blurAmount * 2;
  ctx.drawImage(image, -margin, -margin, canvas.width + margin * 2, canvas.height + margin * 2);

  const blurred = new THREE.CanvasTexture(canvas);
  blurred.colorSpace = texture.colorSpace;
  blurred.wrapS = texture.wrapS;
  blurred.wrapT = texture.wrapT;
  return blurred;
}

/* ───── Alpha Dilation (edge padding) ───── */

/**
 * Dilate the RGB of an alpha texture into its transparent regions to kill the
 * white halo that bilinear filtering / mipmaps pull from undefined transparent
 * texels. The alpha channel is left untouched — only the color under alpha=0
 * is filled with the nearest opaque color, spread `iterations` pixels outward.
 *
 * Mutates the texture in place (replaces .image with a canvas, flags
 * needsUpdate) so all params (colorSpace, wrap, flipY, filters, anisotropy,
 * generateMipmaps) are preserved. Mips regenerate from the dilated source.
 *
 * @returns {{ ok: boolean, reason?: string, filled?: number, canvas?: HTMLCanvasElement }}
 */
export function dilateTextureAlpha(texture, iterations = 4) {
  if (!texture) return { ok: false, reason: 'sin textura' };
  // Compressed (KTX2/Basis) textures hold GPU blocks, not drawable pixels.
  if (texture.isCompressedTexture) return { ok: false, reason: 'textura comprimida (KTX2) — no editable en el browser' };

  const image = texture.image;
  const w = image?.width || image?.naturalWidth || 0;
  const h = image?.height || image?.naturalHeight || 0;
  if (!w || !h) return { ok: false, reason: 'imagen no disponible' };

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let imgData;
  try {
    ctx.drawImage(image, 0, 0, w, h);
    imgData = ctx.getImageData(0, 0, w, h);
  } catch {
    return { ok: false, reason: 'canvas tainted (cross-origin)' };
  }

  const data = imgData.data; // RGBA, Uint8ClampedArray
  const n = w * h;
  const known = new Uint8Array(n);
  let transparent = 0;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] > 0) known[i] = 1;
    else transparent++;
  }
  if (transparent === 0) return { ok: false, reason: 'sin alpha — nada que dilatar' };

  // Grow the known region one ring per pass. Newly-filled pixels become
  // sources only on the next pass, so color spreads exactly `iterations` px.
  let filled = 0;
  for (let pass = 0; pass < iterations; pass++) {
    const newly = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (known[p]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const q = (ny * w + nx) * 4;
            if (known[ny * w + nx]) { r += data[q]; g += data[q + 1]; b += data[q + 2]; c++; }
          }
        }
        if (c > 0) {
          const o = p * 4;
          data[o] = Math.round(r / c);
          data[o + 1] = Math.round(g / c);
          data[o + 2] = Math.round(b / c);
          // alpha (data[o + 3]) stays as-is — we only paint color.
          newly.push(p);
        }
      }
    }
    if (newly.length === 0) break;
    for (const p of newly) known[p] = 1;
    filled += newly.length;
  }

  ctx.putImageData(imgData, 0, 0);
  texture.image = canvas;
  texture.needsUpdate = true;
  return { ok: true, filled, canvas };
}

/* ───── Byte Formatting ───── */

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

export function formatMs(ms) {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
