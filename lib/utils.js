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
      enablePMREM: false,           // PMREM cubemaps are very expensive on iOS
      enableEnvMap: false,
      enableSplats: false,          // SOG files are too heavy for iOS VRAM
      enableExtSplats: false,       // ExtSplats doubles VRAM for Gaussian Splats
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
      enablePMREM: false,
      enableEnvMap: false,
      enableSplats: false,
      enableExtSplats: false,
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
