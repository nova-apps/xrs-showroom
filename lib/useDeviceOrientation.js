'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/**
 * useDeviceOrientation — drive a panorama's look direction from the phone's
 * motion sensors (gyroscope + accelerometer, surfaced by the browser as
 * DeviceOrientationEvent).
 *
 * How it plugs in: both viewers aim the camera every frame from two refs —
 * `lonRef` (yaw, degrees) and `latRef` (pitch). This hook computes the phone's
 * absolute yaw/pitch on each sensor reading and applies the *delta* since the
 * previous reading to those refs. Working in deltas (rather than writing an
 * absolute heading) means:
 *   - enabling the sensor keeps whatever view the user was already looking at,
 *   - the viewer's existing yaw/pitch clamps and drag-to-look still apply,
 *   - there's no integration drift (each delta is derived from the absolute
 *     sensor reading, not accumulated error).
 *
 * The alpha/beta/gamma → world quaternion conversion mirrors three.js's old
 * DeviceOrientationControls, including the screen-orientation term, so it
 * behaves correctly in portrait and landscape.
 *
 * iOS 13+ gates the sensor behind DeviceOrientationEvent.requestPermission(),
 * which MUST be called from a user gesture — hence `enable()` is async and
 * meant to be wired to a button tap.
 *
 * @param {object} opts
 * @param {React.MutableRefObject<number>} opts.lonRef        yaw ref (degrees)
 * @param {React.MutableRefObject<number>} opts.latRef        pitch ref (degrees)
 * @param {React.MutableRefObject<{lon:number,lat:number}>} [opts.velocityRef]
 *   inertia ref — zeroed on each reading so a leftover fling doesn't fight the gyro
 * @param {React.MutableRefObject<boolean>} [opts.isDraggingRef]
 *   while the user is actively dragging, sensor deltas are skipped (drag wins)
 * @param {number} [opts.sensitivity=1] gain applied to the deltas; negate to
 *   invert an axis if a given device reads a direction backwards
 */
export function orientationSupported() {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

// Coarse pointer ≈ a touch device that actually has these sensors. Desktop
// Chrome exposes DeviceOrientationEvent but never fires it, so we hide the
// control there to avoid offering a button that does nothing.
export function orientationUsable() {
  if (!orientationSupported()) return false;
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : true;
}

const ZEE = new THREE.Vector3(0, 0, 1);
// -PI/2 rotation about X — maps the device frame (screen facing user) to the
// three.js camera frame (looking down -Z).
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

function deviceToWorldQuaternion(out, alpha, beta, gamma, screenAngle, euler, qScreen) {
  euler.set(beta, alpha, -gamma, 'YXZ'); // device Euler → quaternion
  out.setFromEuler(euler);
  out.multiply(Q1);
  out.multiply(qScreen.setFromAxisAngle(ZEE, -screenAngle)); // account for screen rotation
  return out;
}

export function useDeviceOrientation({
  lonRef,
  latRef,
  velocityRef,
  isDraggingRef,
  sensitivity = 1,
  autoStart = false,
}) {
  // Computed once — support doesn't change during a session.
  const [usable] = useState(orientationUsable);
  const [enabled, setEnabled] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    // Reused across events to avoid per-frame allocation.
    const q = new THREE.Quaternion();
    const qScreen = new THREE.Quaternion();
    const deviceEuler = new THREE.Euler();
    const outEuler = new THREE.Euler();
    let prev = null; // { yaw, pitch } in degrees, last reading

    const screenAngleRad = () => {
      const deg = window.screen?.orientation?.angle ?? window.orientation ?? 0;
      return THREE.MathUtils.degToRad(deg);
    };

    const onOrient = (ev) => {
      if (ev.alpha == null) return; // sensor not delivering data yet
      const alpha = THREE.MathUtils.degToRad(ev.alpha);
      const beta = THREE.MathUtils.degToRad(ev.beta || 0);
      const gamma = THREE.MathUtils.degToRad(ev.gamma || 0);

      deviceToWorldQuaternion(q, alpha, beta, gamma, screenAngleRad(), deviceEuler, qScreen);
      outEuler.setFromQuaternion(q, 'YXZ');
      const yaw = THREE.MathUtils.radToDeg(outEuler.y);
      const pitch = THREE.MathUtils.radToDeg(outEuler.x);

      if (prev && !isDraggingRef?.current) {
        let dYaw = yaw - prev.yaw;
        if (dYaw > 180) dYaw -= 360;
        else if (dYaw < -180) dYaw += 360;
        const dPitch = pitch - prev.pitch;

        // Yaw is negated: turning the phone right must pan the view right, but
        // the sensor's yaw increases the opposite way relative to lonRef.
        lonRef.current -= dYaw * sensitivity;
        latRef.current += dPitch * sensitivity;
        if (velocityRef) velocityRef.current = { lon: 0, lat: 0 };
      }
      prev = { yaw, pitch };
    };

    // `true` (capture) matches three's DeviceOrientationControls; some browsers
    // only deliver to a capturing listener.
    window.addEventListener('deviceorientation', onOrient, true);
    return () => window.removeEventListener('deviceorientation', onOrient, true);
  }, [enabled, lonRef, latRef, velocityRef, isDraggingRef, sensitivity]);

  const enable = useCallback(async () => {
    if (!orientationSupported()) return;
    const DOE = window.DeviceOrientationEvent;
    // iOS 13+ permission gate. Must run inside the user-gesture call stack.
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res !== 'granted') {
          setDenied(true);
          return;
        }
      } catch {
        setDenied(true);
        return;
      }
    }
    setDenied(false);
    setEnabled(true);
  }, []);

  const disable = useCallback(() => setEnabled(false), []);

  const toggle = useCallback(() => {
    if (enabled) disable();
    else enable();
  }, [enabled, enable, disable]);

  // Auto-start on mount. The viewer opens from a tap, so on iOS this enable()
  // still runs inside the gesture's transient-activation window (~5s) and the
  // permission request is honored. If iOS declines to honor it (or permission
  // is denied), we fail quietly — the toggle button stays available for a
  // manual, gesture-driven retry.
  const autoTriedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoTriedRef.current || !usable) return;
    autoTriedRef.current = true;
    enable();
  }, [autoStart, usable, enable]);

  return { usable, enabled, denied, enable, disable, toggle };
}
