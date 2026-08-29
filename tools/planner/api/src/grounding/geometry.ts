/**
 * How far a point is from a corridor — pure arithmetic, no network, no model.
 *
 * pl-29 Build step 4: "distance from the point to the route polyline is free
 * and rules out almost everything." This file is that filter, and it is
 * deliberately separate from the Overpass adapter that calls it: `nearby`'s
 * query already asks Overpass's own `around:` filter to restrict its reply to
 * the corridor's radius (see the header of `valhalla.ts`'s discovery section),
 * so everything this file discards on top of that is defence against a
 * boundary case Overpass's own filter might get right or might not — a
 * captured payload cannot prove a server-side filter is exact everywhere, only
 * that it was exact for the one query that produced it. Trusting the far side
 * of a network call to enforce this seam's contract is exactly the kind of
 * thing the rest of this tool refuses to do, and there is no reason to make an
 * exception for the one filter that happens to be cheap to redo.
 *
 * ## The projection is deliberately not exact
 *
 * A corridor is a road trip's origin to its destination — tens to low
 * hundreds of kilometres, not a hemisphere — so an equirectangular projection
 * around the corridor's own latitude is accurate to well under 1% at these
 * distances, and it is the projection that turns "distance from a point to a
 * line segment" back into ordinary planar geometry instead of spherical
 * trigonometry nobody needs here. `radiusMetres` in practice is a handful of
 * kilometres (pl-29's own title picks six), so the error this introduces is
 * irrelevant next to the radius it is being compared against.
 */

import type { Coordinates } from "@planner/contract";
import type { Corridor } from "@planner/agent";

/** Mean Earth radius, metres. Good enough for a projection this local. */
const EARTH_RADIUS_METRES = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two points, in metres.
 *
 * The Haversine formula, exact enough for anything this tool measures and the
 * same shape every routing engine's straight-line estimate uses. Kept separate
 * from the projection below because a caller that only wants "how far apart
 * are these two points" — not "how far is this point from a line" — should not
 * have to build a one-segment corridor to ask.
 */
export function haversineMetres(a: Coordinates, b: Coordinates): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  // Clamped: floating-point can push `h` fractionally past 1 for two points
  // that are (near) antipodal or identical, and `Math.asin` of anything past 1
  // is `NaN` — a corridor this tool ever draws is never that, but a filter
  // that can silently start returning `NaN` for a reason nobody wrote down is
  // exactly the failure mode this whole file exists to avoid in the adapter it
  // feeds.
  const clamped = Math.min(1, Math.sqrt(h));
  return 2 * EARTH_RADIUS_METRES * Math.asin(clamped);
}

/** A point projected onto a local metric plane, in metres from an origin. */
interface PlanarPoint {
  x: number;
  y: number;
}

/**
 * Project onto a plane tangent to the Earth at `origin`'s latitude.
 *
 * `x` is stretched by `cos(latitude)` because a degree of longitude is shorter
 * than a degree of latitude everywhere except the equator — the classic
 * equirectangular approximation, and exactly why the header above bounds where
 * it is trustworthy.
 */
function project(point: Coordinates, originLatitudeRadians: number): PlanarPoint {
  const metresPerDegreeLat = (Math.PI / 180) * EARTH_RADIUS_METRES;
  const metresPerDegreeLon = metresPerDegreeLat * Math.cos(originLatitudeRadians);
  return {
    x: point.longitude * metresPerDegreeLon,
    y: point.latitude * metresPerDegreeLat,
  };
}

/**
 * Distance from a point to a line segment, in a plane already in metres.
 *
 * The standard projection-and-clamp: project the point onto the infinite line
 * through `a` and `b`, clamp the parameter to `[0, 1]` so the closest point is
 * never past either end, and measure to whichever point that leaves.
 */
function distanceToSegmentMetres(point: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  // `a` and `b` are the same point — a degenerate segment, which is a
  // corridor whose two ends coincide. Distance to a point rather than a
  // division by zero.
  if (lengthSquared === 0) {
    const px = point.x - a.x;
    const py = point.y - a.y;
    return Math.sqrt(px * px + py * py);
  }

  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  const closestX = a.x + clamped * dx;
  const closestY = a.y + clamped * dy;
  const ex = point.x - closestX;
  const ey = point.y - closestY;
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * The shortest distance from `point` to any segment of `corridor`, in metres.
 *
 * A corridor of one point is treated as that point — a caller that built a
 * degenerate corridor gets a real answer rather than an exception, which
 * matches `distanceToSegmentMetres`'s own handling of a zero-length segment.
 * An empty corridor has no distance to report and is a caller error: it throws
 * rather than returning `Infinity`, which would silently pass every point
 * through a radius filter meant to reject almost everything.
 */
export function distanceToCorridorMetres(point: Coordinates, corridor: Corridor): number {
  if (corridor.length === 0) {
    throw new RangeError("distanceToCorridorMetres: an empty corridor has no distance to measure.");
  }
  if (corridor.length === 1) {
    const only = corridor[0];
    if (only === undefined) {
      throw new RangeError(
        "distanceToCorridorMetres: an empty corridor has no distance to measure.",
      );
    }
    return haversineMetres(point, only);
  }

  // Every point projected relative to the *point's own* latitude, so the
  // approximation is centred on what is actually being measured rather than
  // on one end of a potentially long corridor.
  const originLat = toRadians(point.latitude);
  const projectedPoint = project(point, originLat);

  let closest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < corridor.length - 1; i += 1) {
    const a = corridor[i];
    const b = corridor[i + 1];
    if (a === undefined || b === undefined) continue;
    const distance = distanceToSegmentMetres(
      projectedPoint,
      project(a, originLat),
      project(b, originLat),
    );
    if (distance < closest) closest = distance;
  }
  return closest;
}

/** A bounding box padded by a radius, for a query that needs one cheaply. */
export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * The smallest box containing every point of the corridor, padded outward by
 * `radiusMetres` so a point just outside the corridor's own extent but still
 * within the radius is not excluded before the exact filter above ever sees
 * it.
 *
 * The padding is converted degree-by-degree from the corridor's own latitude
 * span, which is the same trade the projection above already makes: exact
 * enough at these distances, and there is no call to a routing engine hiding
 * in a bounding box.
 */
export function corridorBoundingBox(corridor: Corridor, radiusMetres: number): BoundingBox {
  if (corridor.length === 0) {
    throw new RangeError("corridorBoundingBox: an empty corridor has no box to draw.");
  }

  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  for (const point of corridor) {
    if (point.latitude < south) south = point.latitude;
    if (point.latitude > north) north = point.latitude;
    if (point.longitude < west) west = point.longitude;
    if (point.longitude > east) east = point.longitude;
  }

  const metresPerDegreeLat = (Math.PI / 180) * EARTH_RADIUS_METRES;
  const latPad = radiusMetres / metresPerDegreeLat;
  // Padded at the box's most poleward latitude, where a degree of longitude is
  // shortest — the conservative choice, so the box never ends up narrower than
  // the radius really reaches at its other edge.
  const widestLat = Math.max(Math.abs(south), Math.abs(north));
  const metresPerDegreeLon = metresPerDegreeLat * Math.cos(toRadians(widestLat));
  const lonPad = metresPerDegreeLon === 0 ? 180 : radiusMetres / metresPerDegreeLon;

  return {
    south: Math.max(-90, south - latPad),
    north: Math.min(90, north + latPad),
    west: Math.max(-180, west - lonPad),
    east: Math.min(180, east + lonPad),
  };
}
