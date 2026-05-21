'use client';

/**
 * Compass — small HUD that shows where world-north sits relative to the
 * camera's current view. The compass rose rotates so the "N" mark always
 * points at the real-world north direction.
 *
 * Anchor:
 *   north = panoramaSettings.northOffset (degrees) — the same value the
 *   panorama-viewer math uses. When cameraYaw === northOffset, the camera
 *   is facing north and the "N" sits at the top of the dial.
 *
 * Math:
 *   The rose rotation is `northOffset - cameraYaw`. cameraYaw increases when
 *   the camera turns right (Three.js convention exposed by Viewer3D), so a
 *   right turn should swing "N" to the left of the dial → negative CSS
 *   rotation → matches `-(yaw - north)`.
 */
export default function Compass({ yaw = 0, northOffset = 0 }) {
  const rotation = (northOffset || 0) - (yaw || 0);
  return (
    <div className="compass" title={`Norte: ${Math.round(northOffset)}° · Yaw cámara: ${Math.round(yaw)}°`}>
      <div className="compass-rose" style={{ transform: `rotate(${rotation}deg)` }}>
        <span className="compass-tick compass-tick-n" />
        <span className="compass-tick compass-tick-e" />
        <span className="compass-tick compass-tick-s" />
        <span className="compass-tick compass-tick-o" />
        <span className="compass-mark compass-mark-n">N</span>
        <span className="compass-mark compass-mark-e">E</span>
        <span className="compass-mark compass-mark-s">S</span>
        <span className="compass-mark compass-mark-o">O</span>
      </div>
      <span className="compass-center" />
    </div>
  );
}
