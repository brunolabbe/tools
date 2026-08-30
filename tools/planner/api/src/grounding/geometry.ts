/**
 * How far a point is from a corridor — pure arithmetic, no network, no model.
 *
 * pl-29 Build step 4: "distance from the point to the route polyline is free
 * and rules out almost everything." This file is that filter, and it runs
 * *after* `nearby`'s Overpass query has already asked its own `around:` filter
 * to restrict the reply to the corridor's radius (see `valhalla.ts`'s
 * discovery section) — so everything this file discards on top of that is
 * defence against a boundary case the server's own filter might get right or
 * might not. A captured payload cannot prove a server-side filter is exact
 * everywhere, only that it was exact for the one query that produced it, and
 * this environment has captured none yet (see pl-29's Log and pl-33).
 * Trusting the far side of a network call to enforce this seam's contract is
 * exactly the kind of thing the rest of this tool refuses to do, and there is
 * no reason to make an exception for the one filter that happens to be cheap
 * to redo.
 *
 * **Gate B (2026-08-29) found this paragraph false as first written**: the
 * query it described built a bounding box, and `valhalla.ts` said so
 * correctly two comments over — two files in one commit disagreeing about
 * what the code did. The fix taken is the query, not the sentence: a bounding
 * box around a diagonal corridor is dramatically oversized (measured 26–27x
 * for this tool's own motivating Montréal→Percé example — see pl-29's Log),
 * costs real bytes and parse time on a self-hosted, resource-constrained
 * instance, and buys nothing this file's own re-filter did not already
 * guarantee. `overpassQuery` (`valhalla.ts`) now sends `around:` with the
 * corridor's own points, which is what pl-29's Build step 2 named as the
 * reason to prefer Overpass in the first place — so this paragraph is true
 * again because the code changed to match it, not because the words did.
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
 *
 * ## Unhandled: the antimeridian (gate B, 2026-08-29)
 *
 * `project` multiplies a longitude by a fixed metres-per-degree factor with no
 * wraparound, so a corridor whose points straddle ±180° is measured as if they
 * were on opposite sides of the earth rather than metres apart. Checked by
 * hand rather than estimated: for a corridor from (0°, 179°) to (0°, -179°) —
 * `haversineMetres` puts the two ends `222,389.85` m apart the short way — the
 * point exactly between them the short way, (0°, 180°), comes back
 * `111,194.93` m from `distanceToCorridorMetres`, not the near-zero a point
 * genuinely on the corridor should measure. That is one degree of longitude
 * at the equator, which is exactly what the naive (unwrapped) segment's
 * nearest endpoint gives — the function measured to the wrong nearest point
 * because it never noticed the corridor crosses the seam. Wrong, silently,
 * not a crash. This tool plans trips inside Québec and nearby, so the
 * antimeridian is not a route this deployment draws — the risk is real but
 * the domain never reaches it — and it is written down here rather than
 * fixed so the day this code is reused somewhere that crosses ±180°, the
 * limit is the first thing a reader finds, not the last.
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
