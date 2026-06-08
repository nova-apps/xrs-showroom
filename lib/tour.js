/**
 * Amenity tour math — shared by the public TourViewer and the editor's
 * TourEditorModal.
 *
 * The model in one paragraph:
 *   - A tour is a set of NODES (one equirectangular image each) connected by
 *     LINKS. Each node has a normalized `position` {x, y} on the amenity's
 *     floor plan (0..1, x→right, y→down), used both for the minimap and to
 *     DERIVE the direction of each hotspot.
 *   - Each image has a `northOffset`: the longitude inside the image that
 *     corresponds to "plan-up" (bearing 0). Same idea as the unit panoramas'
 *     per-image offset (see lib/panorama.js) but relative to the floor plan
 *     instead of the compass — interiors have no meaningful compass north.
 *   - A hotspot pointing from node A to node B sits at
 *     lon = A.northOffset + bearing(A→B). The sign matters: in the viewer's
 *     camera convention (inverted sphere + lookAt with θ=lon), increasing
 *     lon turns the camera clockwise as seen from above, and plan bearings
 *     also grow clockwise — so they ADD. (Subtracting, as lib/panorama does
 *     for its own compass model, mirrors every direction around the
 *     calibration axis: targets left/right of it land fine, targets
 *     perpendicular to it point exactly backwards.)
 *   - Calibration is one click per node: the operator centers the view on a
 *     known neighbor and we solve northOffset = lon − bearing (the inverse).
 */

import { normalizeDeg } from './panorama';

/** Coerce a possibly-RTDB-shaped value (array stored as object) into an array. */
function toArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v && typeof v === 'object') return Object.values(v).filter(Boolean);
  return [];
}

/** A fresh, fully-formed tour node. */
export function emptyNode(id) {
  return {
    id,
    nombre: '',
    url: '',
    position: { x: 0.5, y: 0.5 },
    northOffset: 0,
    links: [], // array of target node ids
  };
}

/**
 * Normalize an incoming tour (from Firebase) into a clean working shape:
 * `{ startNode, plano, nodes: { [id]: node } }`. Handles RTDB array/object
 * quirks, drops links to nodes that no longer exist, and fills missing
 * fields. Returns null if there's no usable tour.
 *
 * `plano` is the tour's own floor-plan image (uploaded from the tour editor)
 * — distinct from the amenity's `plano`, which is a cover PHOTO. It backs
 * both the editor's positioning canvas and the viewer's minimap.
 */
export function normalizeTour(tour) {
  if (!tour || typeof tour !== 'object') return null;
  const plano = typeof tour.plano === 'string' ? tour.plano.trim() : '';
  const rawNodes = tour.nodes && typeof tour.nodes === 'object' ? tour.nodes : {};
  const nodes = {};
  for (const [id, n] of Object.entries(rawNodes)) {
    if (!n || !n.url) continue;
    nodes[id] = {
      ...emptyNode(id),
      ...n,
      id,
      position: {
        x: clamp01(Number(n.position?.x ?? 0.5)),
        y: clamp01(Number(n.position?.y ?? 0.5)),
      },
      northOffset: Number(n.northOffset) || 0,
      links: toArray(n.links).filter((t) => typeof t === 'string'),
    };
  }
  // Second pass: a link is only valid if its target survived.
  for (const n of Object.values(nodes)) {
    n.links = [...new Set(n.links)].filter((t) => t !== n.id && nodes[t]);
  }
  const ids = Object.keys(nodes);
  // A plano alone (no nodes yet) is still worth keeping — the operator may
  // upload the plan first and add positions later.
  if (ids.length === 0 && !plano) return null;
  const startNode = nodes[tour.startNode] ? tour.startNode : (ids[0] || null);
  return { startNode, plano, nodes };
}

/** True if the amenity has a tour worth showing (≥1 node with an image). */
export function tourHasNodes(tour) {
  const t = normalizeTour(tour);
  return !!t && Object.keys(t.nodes).length > 0;
}

/** Ordered node list (stable by insertion order of the nodes map). */
export function tourNodeList(tour) {
  const t = normalizeTour(tour);
  return t ? Object.values(t.nodes) : [];
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.5));
}

/**
 * Bearing (degrees, clockwise) from node A to node B in floor-plan space.
 * Plan-up is 0°, plan-right is 90° — matching the compass convention of
 * lib/panorama (N=0, E=90) so the lon↔bearing formulas carry over verbatim.
 * Plan y grows DOWNWARD (image coordinates), hence the −dy.
 */
export function planBearingDeg(from, to) {
  const dx = (to?.position?.x ?? 0.5) - (from?.position?.x ?? 0.5);
  const dy = (to?.position?.y ?? 0.5) - (from?.position?.y ?? 0.5);
  if (dx === 0 && dy === 0) return 0;
  return normalizeDeg((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/**
 * Longitude (degrees) inside `node`'s image where the hotspot toward
 * `target` should be rendered: lon = northOffset + bearing.
 */
export function hotspotLon(node, target) {
  return normalizeDeg((Number(node?.northOffset) || 0) + planBearingDeg(node, target));
}

/**
 * Inverse of hotspotLon, for calibration: the operator centered the view on
 * `target` while standing at `node`, with the camera at `lon`. Solve the
 * northOffset that makes the math agree:
 *   lon = northOffset + bearing  ⟹  northOffset = lon − bearing
 */
export function northOffsetFromLon(lon, node, target) {
  return normalizeDeg((Number(lon) || 0) - planBearingDeg(node, target));
}

/**
 * Camera longitude to open `to` with when arriving from `from`, preserving
 * the real-world heading the camera had (lon `fromLon`) — the detail that
 * keeps multi-node navigation from being disorienting.
 *   worldBearing = fromLon − from.northOffset   (constant across the jump)
 *   toLon        = to.northOffset + worldBearing
 */
export function arrivalLon(from, to, fromLon) {
  const heading = (Number(fromLon) || 0) - (Number(from?.northOffset) || 0);
  return normalizeDeg((Number(to?.northOffset) || 0) + heading);
}
