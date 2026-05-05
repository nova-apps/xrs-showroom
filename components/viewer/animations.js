/**
 * Viewer3D Animation State Machines
 *
 * Pure functions that operate on the stateRef object.
 * Each animation follows a state-machine pattern:
 *   idle → animating → complete → idle
 */

const DEG2RAD = Math.PI / 180;

/* ─── Easing functions ─── */
export const EASING_FNS = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeOutBack: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

/* ─── Pitch Snap Animation ─── */
/**
 * State machine that animates the camera to a top-down view when the user
 * reaches pitchMax, and animates back to pitchMax when they try to tilt down.
 *
 * States:
 *   idle     → Normal operation; watching for polar angle to reach minPolarAngle
 *   to_top   → Animating polar angle toward 0 (top-down / pitch 90°)
 *   at_top   → At top-down view; user can pan/zoom; watching for downward tilt
 *   to_limit → Animating polar angle back to the original minPolarAngle
 *   cooldown → Waiting until user moves away from the limit to re-enable snap
 */
export function handlePitchSnap(s) {
  const { controls, camera, THREE, pitchSnap: snap, pendingOrbit: orbit } = s;
  if (!controls || !camera || !THREE) return;

  // Feature is gated behind the orbit setting
  const enabled = orbit?.pitchSnapEnabled === true;

  // If disabled mid-animation, reset cleanly
  if (!enabled && snap.state !== 'idle') {
    if (snap.state === 'to_top' || snap.state === 'to_limit') {
      controls.enableRotate = true;
      controls.enablePan = true;
    }
    if (snap.originalMinPolar) {
      controls.minPolarAngle = snap.originalMinPolar;
    }
    snap.state = 'idle';
    return;
  }
  if (!enabled) return;

  // Target polar angle from settings (90° → phi 0, 45° → phi π/4, etc.)
  const snapTargetDeg = orbit?.pitchSnapTarget ?? 90;
  const HALF_PI = Math.PI / 2;
  const targetPhi = Math.max(HALF_PI - snapTargetDeg * DEG2RAD, 0.001);

  const polar = controls.getPolarAngle();

  switch (snap.state) {
    case 'idle': {
      const minPolar = controls.minPolarAngle;
      // Only activate when there is a meaningful upper-pitch limit (> ~3°)
      if (minPolar <= 0.05) return;
      // And only if the snap target is actually above the max
      if (targetPhi >= minPolar) return;
      if (polar <= minPolar + 0.03) {
        snap.state = 'to_top';
        snap.originalMinPolar = minPolar;
        controls.minPolarAngle = Math.max(targetPhi - 0.01, 0.001);
        controls.enableRotate = false;
        controls.enablePan = false;
      }
      break;
    }

    case 'to_top': {
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);

      sph.phi = THREE.MathUtils.lerp(sph.phi, targetPhi, 0.08);
      sph.makeSafe();
      offset.setFromSpherical(sph);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);

      if (Math.abs(sph.phi - targetPhi) < 0.015) {
        snap.state = 'at_top';
        controls.minPolarAngle = Math.max(targetPhi - 0.01, 0.001);
        controls.enableRotate = true;
        controls.enablePan = true;
      }
      break;
    }

    case 'at_top': {
      // User can freely pan / zoom from the snapped view.
      // If they tilt downward past a small threshold → animate back.
      if (polar > targetPhi + 0.08) {
        snap.state = 'to_limit';
        controls.enableRotate = false;
        controls.enablePan = false;
      }
      break;
    }

    case 'to_limit': {
      const returnPhi = snap.originalMinPolar;
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);

      sph.phi = THREE.MathUtils.lerp(sph.phi, returnPhi, 0.08);
      sph.makeSafe();
      offset.setFromSpherical(sph);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);

      if (Math.abs(sph.phi - returnPhi) < 0.015) {
        snap.state = 'cooldown';
        controls.minPolarAngle = snap.originalMinPolar;
        controls.enableRotate = true;
        controls.enablePan = true;
      }
      break;
    }

    case 'cooldown': {
      // Don't re-trigger until user moves well past the limit
      if (polar > snap.originalMinPolar + 0.2) {
        snap.state = 'idle';
      }
      break;
    }
  }
}

/* ─── Click Zoom Animation ─── */
/**
 * Press-and-hold zoom: on pointerdown the camera FOV narrows (zoom in),
 * on pointerup it smoothly returns to the original FOV.
 * Uses FOV instead of camera distance to avoid conflicts with OrbitControls.
 *
 * States:
 *   idle        → Normal; watching for pointerdown
 *   zooming_in  → Animating FOV toward narrower value (zoom in)
 *   held        → At zoomed FOV; waiting for pointerup
 *   zooming_out → Animating FOV back to original value
 */
export function onCanvasPointerDown(s) {
  const { camera, clickZoom: cz, pendingOrbit: orbit } = s;
  if (!camera) return;
  if (orbit?.clickZoomEnabled !== true) return;

  // Only capture original FOV when starting from idle
  if (cz.state === 'idle') {
    cz.originalFov = camera.fov;
  }
  cz.state = 'zooming_in';
}

export function onCanvasPointerUp(s) {
  const { clickZoom: cz, pendingOrbit: orbit } = s;
  if (orbit?.clickZoomEnabled !== true) return;

  if (cz.state === 'zooming_in' || cz.state === 'held') {
    cz.state = 'zooming_out';
  }
}

export function handleClickZoom(s) {
  const { camera, clickZoom: cz, pendingOrbit: orbit } = s;
  if (!camera) return;

  const enabled = orbit?.clickZoomEnabled === true;

  // If disabled mid-animation, restore FOV cleanly
  if (!enabled && cz.state !== 'idle') {
    camera.fov = cz.originalFov;
    camera.updateProjectionMatrix();
    cz.state = 'idle';
    return;
  }
  if (!enabled || cz.state === 'idle') return;

  const THREE = s.THREE;
  if (!THREE) return;

  const amount = (orbit?.clickZoomAmount ?? 30) / 100; // 0→1
  const targetFov = cz.originalFov * (1 - amount);

  if (cz.state === 'zooming_in') {
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.09);
    camera.updateProjectionMatrix();

    if (Math.abs(camera.fov - targetFov) < 0.05) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
      cz.state = 'held';
    }
  } else if (cz.state === 'zooming_out') {
    camera.fov = THREE.MathUtils.lerp(camera.fov, cz.originalFov, 0.09);
    camera.updateProjectionMatrix();

    if (Math.abs(camera.fov - cz.originalFov) < 0.05) {
      camera.fov = cz.originalFov;
      camera.updateProjectionMatrix();
      cz.state = 'idle';
    }
  }
}

/* ─── Focus Camera Animation ─── */
export function handleFocusAnimation(s) {
  const { camera, controls, focusTarget: focus, THREE } = s;
  if (!camera || !controls || !focus || !THREE || focus.state === 'idle') return;

  if (focus.state === 'animating') {
    // focusSpeed: 5 (very slow) → 100 (instant), stored in orbit settings
    const speed = s.pendingOrbit?.focusSpeed ?? 25;
    const LERP_SPEED = focus.lerpOverride ?? (speed / 1000); // override for view transitions

    // Get current camera position in spherical coords relative to orbit target
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const current = new THREE.Spherical().setFromVector3(offset);

    // Lerp each spherical component independently
    current.phi = THREE.MathUtils.lerp(current.phi, focus.targetPhi, LERP_SPEED);
    current.theta = THREE.MathUtils.lerp(current.theta, focus.targetTheta, LERP_SPEED);
    current.radius = THREE.MathUtils.lerp(current.radius, focus.targetRadius, LERP_SPEED);
    current.makeSafe();

    // Convert back to cartesian and apply
    offset.setFromSpherical(current);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);

    // Check convergence
    const dPhi = Math.abs(current.phi - focus.targetPhi);
    const dTheta = Math.abs(current.theta - focus.targetTheta);
    const dRadius = Math.abs(current.radius - focus.targetRadius);

    if (dPhi < 0.002 && dTheta < 0.002 && dRadius < 0.05) {
      current.phi = focus.targetPhi;
      current.theta = focus.targetTheta;
      current.radius = focus.targetRadius;
      current.makeSafe();
      offset.setFromSpherical(current);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      focus.state = 'idle';
      focus.lerpOverride = null;
      if (typeof focus.onComplete === 'function') {
        focus.onComplete();
        focus.onComplete = null;
      }
    }
  }
}

/* ─── GLB Reveal Animation ─── */
export function handleGlbReveal(s) {
  const rev = s.glbReveal;
  if (!rev.active) return;

  const elapsed = (performance.now() - rev.startTime) / 1000;
  const t = Math.min(elapsed / rev.duration, 1);
  const easeFn = EASING_FNS[rev.easing] || EASING_FNS.easeOut;
  const eased = easeFn(t);

  const currentY = rev.minY + eased * (rev.range * 1.05);

  if (rev.mode === 'clip') {
    rev.clippingPlane.constant = currentY;
  } else if (rev.mode === 'dissolve') {
    for (const m of rev.materials) {
      const shader = m.userData._revealShader;
      if (shader) {
        shader.uniforms.uRevealY.value = currentY;
      }
    }
  }

  if (t >= 1) {
    rev.active = false;
    if (rev.mode === 'clip' && s.glbModel) {
      s.glbModel.traverse((child) => {
        if (child.isMesh) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) {
            m.clippingPlanes = [];
            m.needsUpdate = true;
          }
        }
      });
    }
    if (rev.mode === 'dissolve') {
      for (const m of rev.materials) {
        const shader = m.userData._revealShader;
        if (shader) {
          shader.uniforms.uRevealY.value = rev.maxY + rev.range;
        }
      }
    }
    console.log(`[Viewer] GLB reveal complete (${rev.mode}, ${rev.duration}s)`);
  }
}

/* ─── Splat Point→Splat Animation ─── */
export function handleSplatFade(s) {
  const fade = s.splatFade;
  if (!fade?.active || !s.splatMesh) return;

  const elapsed = (performance.now() - fade.startTime) / 1000;
  const t = Math.min(elapsed / fade.duration, 1);
  const easeFn = EASING_FNS[fade.easing] || EASING_FNS.easeOut;
  const eased = easeFn(t);

  if (!s.splatClip?.active) {
    s.splatMesh.opacity = eased;
  }

  if (fade.splatSizeU) {
    fade.splatSizeU.value = 0.01 + eased * 0.99;
  }

  if (fade.splatShapeU) {
    const shapeT = Math.max(0, (t - 0.3) / 0.7);
    fade.splatShapeU.value = easeFn(Math.min(shapeT, 1));
  }

  if (t >= 1) {
    fade.active = false;
    if (fade.splatSizeU) fade.splatSizeU.value = 1;
    if (fade.splatShapeU) fade.splatShapeU.value = 1;
    if (!s.splatClip?.active) s.splatMesh.opacity = 1;
    console.log(`[Viewer] Splat point→splat complete (${fade.duration}s)`);

    // SOG fully revealed — fade tint to target opacity
    if (s.tintMesh) {
      const startOpacity = s.tintMesh.material.uniforms.uTintOpacity.value;
      const endOpacity = s.tintTargetOpacity ?? 0;
      if (Math.abs(startOpacity - endOpacity) > 0.001) {
        const dur = 1.5;
        const t0 = performance.now();
        function animateTint() {
          const el = (performance.now() - t0) / 1000;
          const p = Math.min(el / dur, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          const op = startOpacity + (endOpacity - startOpacity) * eased;
          s.tintMesh.material.uniforms.uTintOpacity.value = op;
          s.tintMesh.visible = op > 0.001;
          if (p < 1) requestAnimationFrame(animateTint);
        }
        requestAnimationFrame(animateTint);
      }
    }
  }
}

/* ─── Splat Radial Clip Animation ─── */
export function handleSplatClip(s) {
  const clip = s.splatClip;
  if (!clip?.active || !s.splatMesh) return;

  const elapsed = (performance.now() - clip.startTime) / 1000;
  const t = Math.min(elapsed / clip.duration, 1);
  const easeFn = EASING_FNS[clip.easing] || EASING_FNS.easeOut;
  const eased = easeFn(t);

  s.splatMesh.opacity = Math.max(s.splatMesh.opacity, eased);

  const currentRadius = eased * clip.maxRadius * 1.4;
  clip.clipRadiusU.value = currentRadius;
  clip.clipEdgeU.value = clip.maxRadius * 0.4;

  if (t >= 1) {
    clip.active = false;
    clip.clipRadiusU.value = 99999;
    s.splatMesh.opacity = 1;
    console.log(`[Viewer] Splat radial clip complete (${clip.duration}s)`);

    // SOG fully revealed — fade tint to target opacity
    if (s.tintMesh) {
      const startOpacity = s.tintMesh.material.uniforms.uTintOpacity.value;
      const endOpacity = s.tintTargetOpacity ?? 0;
      if (Math.abs(startOpacity - endOpacity) > 0.001) {
        const dur = 1.5;
        const t0 = performance.now();
        function animateTintClip() {
          const el = (performance.now() - t0) / 1000;
          const p = Math.min(el / dur, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          const op = startOpacity + (endOpacity - startOpacity) * eased;
          s.tintMesh.material.uniforms.uTintOpacity.value = op;
          s.tintMesh.visible = op > 0.001;
          if (p < 1) requestAnimationFrame(animateTintClip);
        }
        requestAnimationFrame(animateTintClip);
      }
    }
  }
}
