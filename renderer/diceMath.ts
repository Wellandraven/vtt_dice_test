// Where a die's faces point, and how one flies to land showing a number that has already been
// rolled.
//
// **The number comes first and the flight is steered to it.** `engine/dice.ts` opens by saying
// there is no randomness anywhere in this repo, and a physics throw that *produced* a face would
// be exactly that: unseedable, untestable, and a different roll every time anything redrew. So the
// engine rolls, and everything here is the problem of making a die land the way it already landed.
//
// No three.js, so this can be tested. Quaternions are `[x, y, z, w]` tuples and the forty lines of
// arithmetic below are the price of being able to assert that a d20 asked for a 17 actually shows
// one — which is the only thing about this whole feature that could be quietly, permanently wrong.

import { cellNoise } from "../schema/noise.js";

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

/** How far off a normal two triangles can be and still be called one face. */
const SAME_FACE = 1e-3;

export const UP: Vec3 = [0, 1, 0];

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize(v: Vec3): Vec3 {
  const l = length(v);
  // A zero-length direction cannot be normalized and must not become NaN: this ends up in a
  // rotation, and one NaN in a matrix takes the object out of the scene with nothing to say why.
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * The readable directions of a solid, one per face, as unit vectors from its centre.
 *
 * **Faces are found by grouping triangles that share a normal**, rather than assumed to be one
 * triangle each. Only three of the seven dice are built from triangular faces: three.js gives a
 * dodecahedron as thirty-six triangles in twelve pentagons, a cube as twelve in six squares, and
 * the ten-sided die is kites. Grouping by normal is the one rule that reads all of them, and it
 * needs no table of how many triangles each shape's faces take.
 *
 * Takes a non-indexed position buffer — three vertices to a triangle, in order — which is what
 * `PolyhedronGeometry` and `BoxGeometry.toNonIndexed()` both produce.
 */
export function faceUps(positions: ArrayLike<number>): Vec3[] {
  const ups: Vec3[] = [];
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const a: Vec3 = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
    const b: Vec3 = [positions[i + 3]!, positions[i + 4]!, positions[i + 5]!];
    const c: Vec3 = [positions[i + 6]!, positions[i + 7]!, positions[i + 8]!];
    // **The triangle's own normal, not its centroid**, and the difference is the whole reason this
    // grouping works. A triangle's normal is its *face's* normal wherever in the face it sits; a
    // centroid is only the face direction when the face is that one triangle. On a cube — two
    // triangles to a square — the two centroids point at different corners, so a centroid rule
    // finds twelve faces on a six-sided die and numbers it to twelve.
    const normal = normalize(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    // Turned outward by the centroid rather than trusted to be wound that way. These solids are all
    // wound consistently today; a die whose faces were numbered from the inside would be a very
    // quiet way to find out that one of them was not.
    const centre: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const out: Vec3 = dot(normal, centre) >= 0 ? normal : [-normal[0], -normal[1], -normal[2]];
    if (!ups.some((seen) => dot(seen, out) > 1 - SAME_FACE)) ups.push(out);
  }
  return ups;
}

/**
 * The same, for the corners instead — which is how a four-sided die is read.
 *
 * **A tetrahedron cannot rest on a face and show one.** Its faces are not opposite each other, so
 * the face pointing up is the one it is balancing on a point to show you. A real d4 is read at its
 * apex, and so is this one: the die comes to rest flat on a face, and the number that counts is the
 * corner sticking up.
 */
export function vertexUps(positions: ArrayLike<number>): Vec3[] {
  const ups: Vec3[] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const point = normalize([positions[i]!, positions[i + 1]!, positions[i + 2]!]);
    if (!ups.some((seen) => dot(seen, point) > 1 - SAME_FACE)) ups.push(point);
  }
  return ups;
}

/**
 * How far proud of its own face a number sits, as a multiple of that face's distance.
 *
 * **This used to be 1.06 of the die's *radius*, and it was the bug you could see.** The radius
 * these solids are built from is the distance to a corner, not to a face — so every digit was drawn
 * on an invisible sphere outside the die, floating above its surface by a quarter of the radius on
 * a d20 and three quarters on a d4. What is left is a hair of clearance so the two planes do not
 * fight for depth.
 */
export const NUMBER_LIFT = 1.015;

/**
 * How wide a number is, as a share of the room on its face.
 *
 * A share of `FacePlacement.extent`, not of the die. The quad is square and a d20's face is a
 * triangle, so it is inscribed in the face's own circle — sized off the radius instead, its corners
 * reached 44% past the edges of that triangle.
 */
export const NUMBER_SIZE = 0.86;

/** Where a number sits on the face it belongs to. */
export interface FacePlacement {
  /** Distance from the die's centre to the face's plane, along that face's own normal. */
  distance: number;
  /**
   * The middle of the face itself.
   *
   * **Not the same point as `distance` along the normal, and the ten-sided die is why.** Every other
   * solid here is face-transitive, so the perpendicular dropped from the die's centre lands in the
   * middle of a face and the two are interchangeable. A trapezohedron's kite is not symmetric about
   * that perpendicular — it runs from a sharp apex down to the waist — so its middle is somewhere
   * else on the plane. Placing a number at the foot of the perpendicular put a d10's digits off
   * centre on their kites, and off centre against the `extent` measured about the middle, far
   * enough that a corner of the quad hung over the edge.
   */
  middle: Vec3;
  /**
   * Which way is up on this face, as a unit direction lying in it.
   *
   * **A number's rotation belongs to the face, not to the world** — see `faceAxis`, which is where
   * the reasoning and the measurements live. Every face of a die gets the same angle relative to its
   * own outline, so a handful reads consistently instead of each die carrying its digits at whatever
   * angle its normal happened to produce.
   */
  axis: Vec3;
  /** Radius of the largest circle that fits inside the face, about `middle`. */
  extent: number;
}

/**
 * How far out each face is, and how much room there is on it.
 *
 * **The bug this exists for put every number in a shell outside the die.** The quads were seated at
 * `DIE_RADIUS * 1.06` — but that radius is the *circumradius* the three.js polyhedra are built
 * from, the distance to a **vertex**, and a face plane is a good deal nearer than its corners are.
 * On a d20 the face sits at 0.795 of it and on a d4 at 0.333, so the digits floated above the
 * surface by a quarter to three quarters of the die's own radius. They were being drawn on an
 * invisible sphere the die happened to be inside.
 *
 * The same measurement fixes the second half of it. The quads were also *sized* off the radius,
 * half a diagonal reaching 0.438 of it, while a d20's triangular face has only 0.304 to give — so
 * the corners hung over the edges. Transparent corners hid that until the digits got bolder.
 *
 * **Derived per shape rather than tabulated**, for the reason `faceUps` gives: a table of "how big
 * is a face on each of the six solids" is six numbers that are right until somebody changes a
 * geometry, and nothing would say so.
 *
 * `distance` is the support distance — the furthest any vertex reaches along that direction. For a
 * face normal that *is* the face's plane, because every vertex of the face lies on it and no other
 * vertex of a convex solid is beyond it. For a **vertex** direction, which is how a d4 is read, it
 * is the corner itself and `extent` comes back 0: there is no face there to write on, and 0 is how
 * this says so rather than by inventing a size.
 *
 * Takes directions rather than indices, so it is unaffected by `numberUps` having already put the
 * faces in numbering order.
 */
export function facePlacements(positions: ArrayLike<number>, ups: readonly Vec3[]): FacePlacement[] {
  return ups.map((up) => {
    const unit = normalize(up);
    let distance = -Infinity;
    for (let i = 0; i + 2 < positions.length; i += 3) {
      distance = Math.max(distance, unit[0] * positions[i]! + unit[1] * positions[i + 1]! + unit[2] * positions[i + 2]!);
    }
    if (!Number.isFinite(distance)) return { distance: 0, middle: [0, 0, 0], axis: sideAxis(unit), extent: 0 };
    /** The foot of the perpendicular — the right answer only where the face is centred on it. */
    const foot: Vec3 = [unit[0] * distance, unit[1] * distance, unit[2] * distance];

    // The corners of this face: every vertex sitting on the supporting plane, deduplicated. The
    // tolerance is loose because these arrive as Float32 — a tolerance tight enough to be exact
    // leaves near-duplicates in the ring, and a "corner" a whisker from its twin makes an edge with
    // no length, which reads as a face with almost no room on it.
    const grip = Math.max(1e-6, Math.abs(distance) * 1e-3);
    const ring: Vec3[] = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const v: Vec3 = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
      if (Math.abs(dot(unit, v) - distance) > grip) continue;
      if (!ring.some((seen) => Math.hypot(seen[0] - v[0], seen[1] - v[1], seen[2] - v[2]) < grip)) ring.push(v);
    }
    // A vertex direction has no face under it — a d4 is read at a corner, and `extent: 0` is how
    // that is reported. Its marks are placed by `cornerSpots` instead, which has a face to work in.
    if (ring.length < 3) return { distance, middle: foot, axis: sideAxis(unit), extent: 0 };

    const corners: Vec3 = [
      ring.reduce((s, v) => s + v[0], 0) / ring.length,
      ring.reduce((s, v) => s + v[1], 0) / ring.length,
      ring.reduce((s, v) => s + v[2], 0) / ring.length,
    ];
    // Put the corners in order around the middle before measuring anything. They arrive in whatever
    // order the triangles were wound, and the distance to the segment between two corners that are
    // not neighbours is not an edge of anything.
    const across = normalize([ring[0]![0] - corners[0], ring[0]![1] - corners[1], ring[0]![2] - corners[2]]);
    const other = cross(unit, across);
    const sorted = [...ring].sort((p, q) => angleAbout(p, corners, across, other) - angleAbout(q, corners, across, other));

    // **The middle of the *area*, not the average of the corners**, which is what the eye reads as
    // the centre of a shape. Identical on every regular face — a square, a triangle and a pentagon
    // all measure the same to within 1e-5 — so this moves nothing except the one face that needed
    // it. A d10's kite is a long teardrop, and averaging its corners put the digit at 34% along the
    // taper with a conspicuous empty spike above it.
    const middle = areaCentre(sorted, corners, unit);
    const axis = faceAxis(sorted, middle, unit);

    let extent = Infinity;
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i]!;
      const b = sorted[(i + 1) % sorted.length]!;
      const edge: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const length = dot(edge, edge);
      if (length < 1e-18) continue;
      const t = ((middle[0] - a[0]) * edge[0] + (middle[1] - a[1]) * edge[1] + (middle[2] - a[2]) * edge[2]) / length;
      const near: Vec3 = [a[0] + edge[0] * t, a[1] + edge[1] * t, a[2] + edge[2] * t];
      extent = Math.min(extent, Math.hypot(middle[0] - near[0], middle[1] - near[1], middle[2] - near[2]));
    }
    return { distance, middle, axis, extent: Number.isFinite(extent) ? extent : 0 };
  });
}

/** Any direction square to this one. For the cases where there is no outline to take one from. */
function sideAxis(normal: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(normal[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(normal, cross(helper, normal)));
}

/** The centre of a face's area, found by the usual sum over its edges. */
function areaCentre(ring: readonly Vec3[], about: Vec3, normal: Vec3): Vec3 {
  const across = normalize([ring[0]![0] - about[0], ring[0]![1] - about[1], ring[0]![2] - about[2]]);
  const other = cross(normal, across);
  const flat = ring.map((v): [number, number] => [
    (v[0] - about[0]) * across[0] + (v[1] - about[1]) * across[1] + (v[2] - about[2]) * across[2],
    (v[0] - about[0]) * other[0] + (v[1] - about[1]) * other[1] + (v[2] - about[2]) * other[2],
  ]);
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 1) {
    const a = flat[i]!;
    const b = flat[(i + 1) % flat.length]!;
    const step = a[0] * b[1] - b[0] * a[1];
    twiceArea += step;
    x += (a[0] + b[0]) * step;
    y += (a[1] + b[1]) * step;
  }
  // A face with no area cannot have a centre; the corner average is the honest fallback.
  if (Math.abs(twiceArea) < 1e-12) return about;
  x /= 3 * twiceArea;
  y /= 3 * twiceArea;
  return [about[0] + across[0] * x + other[0] * y, about[1] + across[1] * x + other[1] * y, about[2] + across[2] * x + other[2] * y];
}

/**
 * Which way is up on a face, as a direction lying in it.
 *
 * **The number's rotation used to come from world space** — an axis picked as whichever of X or Y
 * was least parallel to the face — under a comment claiming a number has no up on a die you see
 * from every side. It does: it has an up relative to *its own face*, and a face is a shape with
 * axes. Measured across one symmetry step, that rule left the d20 spread over the whole 120° of it,
 * the d8 over 60°, and a d10's ten kites split exactly 0° and 180° — five upright and five upside
 * down, which is the one a person notices.
 *
 * A face's axis is a **reflection symmetry of its own outline**, found rather than tabulated, in
 * keeping with `faceUps` refusing to keep a table of what each shape's faces are made of. Edge
 * midpoints are tried before corners and that ordering is load-bearing: a square is symmetric about
 * its diagonals too, and picking one of those would set a cube's digits at forty-five degrees.
 *
 * It is then turned to face the **narrower** side, which puts a digit's top at the point of a kite
 * and on the apex of a triangle — a number standing on the face's base rather than hanging from it.
 */
function faceAxis(ring: readonly Vec3[], middle: Vec3, normal: Vec3): Vec3 {
  const candidates: Vec3[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    candidates.push([(a[0] + b[0]) / 2 - middle[0], (a[1] + b[1]) / 2 - middle[1], (a[2] + b[2]) / 2 - middle[2]]);
  }
  for (const corner of ring) candidates.push([corner[0] - middle[0], corner[1] - middle[1], corner[2] - middle[2]]);

  for (const candidate of candidates) {
    if (Math.hypot(candidate[0], candidate[1], candidate[2]) < 1e-9) continue;
    const axis = normalize(candidate);
    if (reflects(ring, middle, axis, normal)) return narrowest(ring, middle, axis);
  }
  // No symmetry at all — a face this does not understand still gets an axis of its own rather than
  // one borrowed from the world, which is what makes it consistent with its neighbours.
  return normalize([ring[0]![0] - middle[0], ring[0]![1] - middle[1], ring[0]![2] - middle[2]]);
}

/** Whether mirroring the outline across this line leaves it where it was. */
function reflects(ring: readonly Vec3[], middle: Vec3, axis: Vec3, normal: Vec3): boolean {
  const sideways = cross(normal, axis);
  const scale = ring.reduce((far, v) => Math.max(far, Math.hypot(v[0] - middle[0], v[1] - middle[1], v[2] - middle[2])), 0);
  const near = Math.max(1e-9, scale * 1e-3);
  for (const corner of ring) {
    const arm: Vec3 = [corner[0] - middle[0], corner[1] - middle[1], corner[2] - middle[2]];
    const off = dot(arm, sideways);
    // The mirror image of this corner: the same distance along the axis, the other way across it.
    const mirrored: Vec3 = [arm[0] - 2 * off * sideways[0], arm[1] - 2 * off * sideways[1], arm[2] - 2 * off * sideways[2]];
    const found = ring.some((other) =>
      Math.hypot(other[0] - middle[0] - mirrored[0], other[1] - middle[1] - mirrored[1], other[2] - middle[2] - mirrored[2]) < near,
    );
    if (!found) return false;
  }
  return true;
}

/**
 * The axis, turned to point at whichever end of the face tapers.
 *
 * **Measured by how far the outline reaches, not by area on each side.** A shape tapers toward
 * whatever sticks out furthest: a kite's point reaches 0.90 where its blunt end reaches 0.59, and a
 * triangle's corner reaches twice as far as the middle of the edge opposite it. Splitting the area
 * instead is the same idea and much fussier to get right — a first attempt assigned each edge's
 * triangle wholly to one side, which is wrong for exactly the faces this exists for, because a
 * kite's two long edges straddle the divide. It put a d10's numbers upside down.
 */
function narrowest(ring: readonly Vec3[], middle: Vec3, axis: Vec3): Vec3 {
  let ahead = 0;
  let behind = 0;
  for (const corner of ring) {
    const along = dot([corner[0] - middle[0], corner[1] - middle[1], corner[2] - middle[2]], axis);
    ahead = Math.max(ahead, along);
    behind = Math.max(behind, -along);
  }
  // Equal ends — a square, either way up — keep the axis as found, so the answer stays the same
  // between runs rather than turning on which side won a rounding.
  return behind > ahead ? [-axis[0], -axis[1], -axis[2]] : axis;
}

/** Where a point sits around a face's middle, as an angle in that face's plane. */
function angleAbout(point: Vec3, middle: Vec3, across: Vec3, other: Vec3): number {
  const arm: Vec3 = [point[0] - middle[0], point[1] - middle[1], point[2] - middle[2]];
  return Math.atan2(dot(arm, other), dot(arm, across));
}

/**
 * Put the readable directions in an order where opposite faces sum to one more than the face count.
 *
 * The convention every real die follows — 1 opposite 6, 7 opposite 14 — and it is worth doing
 * rather than numbering in whatever order the geometry came out, because a die whose opposite faces
 * summed to something else is the first thing a player who owns dice would notice. (The reference
 * `d6.glb` in this project's asset folder gets it wrong: its opposites sum to 3, 7 and 11.)
 *
 * A shape with no opposite faces — the tetrahedron — simply numbers straight through, which is what
 * a d4 does anyway.
 */
export function numberUps(ups: readonly Vec3[]): Vec3[] {
  const count = ups.length;
  const numbered: Array<Vec3 | undefined> = new Array(count).fill(undefined);
  let next = 1;
  for (const up of ups) {
    if (numbered.some((seen) => seen !== undefined && dot(seen, up) > 1 - SAME_FACE)) continue;
    const opposite = ups.find((other) => dot(other, up) < -1 + SAME_FACE);
    numbered[next - 1] = up;
    if (opposite) numbered[count - next] = opposite;
    next += 1;
    while (next <= count && numbered[next - 1] !== undefined) next += 1;
  }
  // Anything the pairing missed keeps its place, so a shape this does not understand still gets a
  // complete set of faces rather than a hole.
  const left = ups.filter((up) => !numbered.some((seen) => seen !== undefined && dot(seen, up) > 1 - SAME_FACE));
  for (let i = 0; i < count; i += 1) if (numbered[i] === undefined) numbered[i] = left.pop() ?? ups[i]!;
  return numbered as Vec3[];
}

/** Hamilton product. `a` then `b`, read right to left the way rotations compose. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** A turn about an axis, which for dice is always the vertical one. */
export function quatFromAxisAngle(axis: Vec3, radians: number): Quat {
  const unit = normalize(axis);
  const half = radians / 2;
  const s = Math.sin(half);
  return [unit[0] * s, unit[1] * s, unit[2] * s, Math.cos(half)];
}

/**
 * The shortest rotation taking one unit vector onto another.
 *
 * The antiparallel case is the one worth writing carefully: there is no shortest turn between a
 * vector and its own opposite — every half-turn about any perpendicular axis does it — so one is
 * chosen rather than left to a cross product that is zero and would come out as NaN. That case is
 * not exotic here: it is every die that happens to want the face pointing straight down.
 */
export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const a = normalize(from);
  const b = normalize(to);
  const d = dot(a, b);
  if (d > 1 - 1e-9) return [0, 0, 0, 1];
  if (d < -1 + 1e-9) {
    // Any perpendicular will do; take the one furthest from `a` so the cross product is stable.
    const axis = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
    return quatFromAxisAngle(axis, Math.PI);
  }
  const axis = cross(a, b);
  return normalizeQuat([axis[0], axis[1], axis[2], 1 + d]);
}

export function normalizeQuat(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 1e-9 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}

/** Turn a vector by a rotation. Used by the tests to check a face really does end up on top. */
export function applyQuat(v: Vec3, q: Quat): Vec3 {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

/**
 * The orientation that shows a given face, turned by `yaw` about the vertical.
 *
 * The yaw is what stops a handful of dice all landing square to the same axis, and it is applied
 * *after* the face is brought up so it cannot disturb which face that is.
 */
export function faceUpQuaternion(up: Vec3, yaw: number): Quat {
  return quatMultiply(quatFromAxisAngle(UP, yaw), quatFromUnitVectors(up, UP));
}

/** The shortest interpolation between two orientations. */
export function quatSlerp(from: Quat, to: Quat, t: number): Quat {
  const a = normalizeQuat(from);
  let [bx, by, bz, bw] = normalizeQuat(to);
  let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  // Take the short way round. Without this a die occasionally tumbles the long way for no reason
  // anyone could see, and lands correctly anyway — which makes it a bug nobody reports.
  if (d < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    d = -d;
  }
  if (d > 1 - 1e-6) return normalizeQuat([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
  const theta = Math.acos(d);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/**
 * A percentile roll, as the two ten-sided dice that show it: `[tens face, units face]`, both 1–10.
 *
 * **There is no hundred-sided solid**, so a d100 is two dice, one marked 00–90. The engine still
 * rolls a single number from 1 to 100 — that is the honest distribution and `rollDie` already gives
 * it — and this takes it apart. Doing it the other way round, rolling two dice and adding them,
 * gives the same distribution and one more thing that could disagree with the total.
 *
 * **00 and 0 read as 100**, which is the convention and the only reason this is worth a function:
 * 100 is the one roll where neither die shows what it looks like it shows.
 */
export function percentileFaces(rolled: number): readonly [number, number] {
  const bounded = Number.isFinite(rolled) ? Math.max(1, Math.min(100, Math.round(rolled))) : 1;
  const n = bounded % 100;
  return [Math.floor(n / 10) + 1, (n % 10) + 1];
}

// ---------------------------------------------------------------------------------------------
// The frame.

/** Where an orthographic camera stands, and how much of the world it sees. */
export interface Framing {
  /** Where the camera stands. It looks at the origin. */
  position: Vec3;
  /** Half-extents of the orthographic frustum, in tray units. */
  halfWidth: number;
  halfHeight: number;
  /**
   * Where the frustum's centre sits, along the camera's own right and up axes.
   *
   * **Screen axes, not world ones.** A box that is not centred in view is carried by shifting the
   * camera sideways rather than by growing the frustum until it reaches — which is what keeps the
   * headroom *above* the tray instead of adding the same gap below it.
   */
  offsetRight: number;
  offsetUp: number;
}

/** How far back the camera stands. Arbitrary under a parallel projection — see orthoFraming. */
const FRAME_DISTANCE = 4;

/**
 * Fit an orthographic camera around a box, looking down at it from the front.
 *
 * **The bug this replaces was a camera position tuned by eye.** The tray was framed by a
 * perspective camera at a hand-picked height and setback, and the near corners of a unit square
 * fell about 25% outside the frustum — the whole near rim was cut off. Numbers chosen by looking
 * are wrong the moment anything they depended on moves, and nothing says so.
 *
 * A parallel projection can be *solved* instead. There is no perspective divide, so a corner's
 * screen position is just its distance along the camera's right and up axes — project all eight
 * corners of the box onto those two axes, take the extents, and the frustum that contains the box
 * is arithmetic. It cannot clip, and `tests/diceMath.test.ts` asserts exactly that.
 *
 * It is also what "isometric" actually means, which is the look this is for: a die at the back of
 * the tray draws the same size as one at the front, and both are read the same way.
 *
 * `margin` is a multiplier on both extents — 1.06 leaves a little air around the rim.
 * `headroom` is added to the **top only**, in world units, so dice dropping in from above the box
 * are visible for their first bounce without the tray being pushed into the middle of a tall empty
 * frame.
 *
 * `aspect` is the viewport's width over its height. **An orthographic camera does not correct for
 * this on its own** — unlike a perspective one, which has an `aspect` of its own — so a frustum
 * fitted to the box and handed to a viewport of a different shape draws the whole scene stretched.
 * The fitted extents are grown, never shrunk, to match, so nothing can leave the frame in the
 * process. Left out, the fit is the box's own shape and nothing is corrected.
 *
 * The camera's distance does not matter under a parallel projection — only its direction — so
 * `FRAME_DISTANCE` is a round number far enough out that a near plane at zero clears the box.
 */
export function orthoFraming(min: Vec3, max: Vec3, elevationDeg: number, margin: number, headroom: number, aspect?: number): Framing {
  return orthoFramingOf([[min, max]], elevationDeg, margin, headroom, aspect);
}

/**
 * The same, around several boxes at once.
 *
 * **Not the same as framing their fused bounding box, and the difference is worth the function.**
 * The tray is wide and shallow; the cup is narrow and six times as tall and only ever over the
 * middle. Fused, the two make a box with a corner where a cup stands at the far rim — a place
 * nothing ever is — and at this elevation that phantom corner is the highest point in the picture
 * and sets the whole frame around it. Projected separately and combined on the screen, each box only
 * claims the space it actually occupies.
 *
 * Measured on the shapes this app has, that is about four per cent of every die's size, given back
 * for nothing. It cannot clip either box: every corner of every one of them is still projected, and
 * the extents are still taken over all of them.
 */
export function orthoFramingOf(
  boxes: ReadonlyArray<readonly [Vec3, Vec3]>,
  elevationDeg: number,
  margin: number,
  headroom: number,
  aspect?: number,
): Framing {
  // Clamped off the poles: at exactly 90° the up axis and the view direction are parallel and the
  // basis collapses, which would put NaN into a projection matrix and take the tray off screen with
  // nothing at all to say why.
  const elevation = (Math.min(89, Math.max(1, Number.isFinite(elevationDeg) ? elevationDeg : 60)) * Math.PI) / 180;
  const distance = FRAME_DISTANCE;
  const position: Vec3 = [0, Math.sin(elevation) * distance, Math.cos(elevation) * distance];
  // Looking at the origin, so the view direction is the camera's own position, reversed.
  const forward = normalize([-position[0], -position[1], -position[2]]);
  // Square-on: no yaw, so right is world X and up follows from the other two. The 45° corner view
  // would only change this line — and would need a frustum √2 wide for the same tray.
  const right: Vec3 = [1, 0, 0];
  const up = normalize(cross(right, forward));

  let left = Infinity;
  let right_ = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (const [min, max] of boxes) {
    for (const x of [min[0], max[0]]) {
      for (const y of [min[1], max[1]]) {
        for (const z of [min[2], max[2]]) {
          const corner: Vec3 = [x, y, z];
          const h = dot(corner, right);
          const v = dot(corner, up);
          left = Math.min(left, h);
          right_ = Math.max(right_, h);
          bottom = Math.min(bottom, v);
          top = Math.max(top, v);
        }
      }
    }
  }
  // An empty list has nothing to frame. A unit box beats returning NaN into a projection matrix.
  if (!Number.isFinite(left)) {
    left = -1;
    right_ = 1;
    bottom = -1;
    top = 1;
  }

  const scale = Number.isFinite(margin) && margin > 0 ? margin : 1;
  top += Number.isFinite(headroom) && headroom > 0 ? headroom : 0;
  let halfWidth = ((right_ - left) / 2) * scale;
  let halfHeight = ((top - bottom) / 2) * scale;

  // Grown to the viewport's shape, whichever way it is out. Grown rather than trimmed, so this can
  // only ever add air — a version that shrank the other extent to match would be a second way for
  // the tray to get cut off, which is the one thing this function is for.
  if (aspect !== undefined && Number.isFinite(aspect) && aspect > 0) {
    if (halfWidth / halfHeight < aspect) halfWidth = halfHeight * aspect;
    else halfHeight = halfWidth / aspect;
  }

  return { position, halfWidth, halfHeight, offsetRight: (left + right_) / 2, offsetUp: (top + bottom) / 2 };
}

// ---------------------------------------------------------------------------------------------
// The throw.
//
// **The position is simulated and the orientation is steered**, and that split is the whole design.
// Where a die ends up says nothing, so physics may decide it: gravity, four walls, a felt floor,
// and the dice knocking into each other. What a die *shows* was decided by `engine/dice.ts` before
// any of this ran, and that cannot be left to a simulation — a face that came out of a bounce would
// be the one thing in this app no test could pin and that came up differently on every reload.
//
// So a die tumbles freely while it is bouncing, and over the last stretch before it stops it turns
// into the face it was always going to show. Corrected while it is still moving, that reads as a
// die tipping onto its face. Snapped at the end it would be a visible jump.

/**
 * Something dice are inside: the tray, or the cup.
 *
 * **Two shapes and one name, because everything else about them is the same** — a floor, a wall, a
 * radius a die is clamped to, and the arithmetic in `separate` that pushes two of them apart. What
 * differs is whether the wall is four flat ones or one round one, which way is down, and whether the
 * top is a lid or a way out.
 *
 * **Every field past `floorY` is optional and absent means "the tray".** That is not tidiness: the
 * tray's path through `advanceDie` is the tuned one — `REST_SPEED` measured against a step of
 * gravity, the felt's friction, the resting-contact rule — and each of those numbers was arrived at
 * by watching a throw fail. A vessel that sets any of the fields below takes a different branch
 * entirely rather than generalising that path, and `tests/diceMath.test.ts` asserts the tray's
 * frames are identical with the fields absent.
 */
export interface TrayBox {
  /** Half the interior width, or the radius when `round`. */
  half: number;
  /** The felt, or the closed end. */
  floorY: number;
  /**
   * The top of the vessel, for one that has a top. Absent for the tray, which has none.
   *
   * With `open` it is a mouth: a die may pass it, and above it there is no wall. Without, it is a
   * lid it bounces off — which is what a cup needs while it is being held, because a shake has no
   * fixed length and ten seconds of pumped-in energy will throw a die clean out of a container a
   * fraction of a unit deep.
   */
  ceilingY?: number;
  /** `half` is a radius rather than a half-width, and the wall is one round one. */
  round?: boolean;
  /** The top is a way out rather than a lid. */
  open?: boolean;
  /**
   * Which way is down, in this vessel's own frame. A unit vector. Absent means straight down.
   *
   * **The cup's whole reason for existing as a second shape.** Its contents are simulated in its own
   * frame — that is what lets them be drawn inside it while it moves — and in that frame "down"
   * swings as it tips. Left along −Y, a die rides the closed end as the cup turns over, as though
   * the bottom of the cup were still the bottom of the world.
   */
  gravity?: Vec3;
}

/** Whether a vessel is anything other than the tray, and so takes the other branch. */
function isVessel(box: TrayBox): boolean {
  return box.round === true || box.open === true || box.gravity !== undefined;
}

/** Straight down, for a vessel that does not say otherwise. */
const DOWN: Vec3 = [0, -1, 0];

/**
 * The floor: today's size, and the size a die stays at once the tray is busy.
 *
 * **Legibility wins over tidiness**, so this does not go lower to make a very large handful tidy. At
 * this radius a five-by-five grid of centres fits the felt, which is twenty-five dice; past that
 * they come to rest on each other, the way too many real dice thrown into a real tray do. That is
 * self-limiting rather than an error, and it has to be, because nothing caps the handful —
 * `addDie` simply increments, up to the engine's hundred per die type.
 */
export const DIE_RADIUS_MIN = 0.06;

/** Which of the three ceilings a player has chosen. */
export type DiceSize = 1 | 2 | 3;

/**
 * The ceiling each setting asks for, as a multiple of the floor.
 *
 * **The setting moves the ceiling and never the floor**, which is the whole reason it is safe to
 * expose. `dieRadius` shrinks a die until the handful fits whatever the choice was; the cap only
 * ever binds when there was room to spare. So no setting can make dice stop fitting, and the one
 * test that matters — throw every handful and check nothing overlaps — holds at all three.
 *
 * Size 1 sits *on* the floor, which makes it a flat "always small" rather than a third curve.
 */
export const DIE_SIZE_CAPS: Readonly<Record<DiceSize, number>> = {
  1: DIE_RADIUS_MIN,
  2: DIE_RADIUS_MIN * 2,
  3: DIE_RADIUS_MIN * 3,
};

/** What the app starts on, and what a nonsense setting falls back to. */
export const DEFAULT_DICE_SIZE: DiceSize = 2;

/** The chosen ceiling, or the default if the caller passed something that is not one of the three. */
export function sizeCap(size: DiceSize | undefined): number {
  return DIE_SIZE_CAPS[size!] ?? DIE_SIZE_CAPS[DEFAULT_DICE_SIZE];
}

/**
 * How much more room than a perfect grid a handful is given.
 *
 * Dice have to arrive, bounce and scatter, not tile. At 1 they would be shoulder to shoulder the
 * moment they landed and `separate()` would spend the whole throw shoving them apart.
 */
const DIE_CROWDING = 1.8;

/**
 * How big a die should be, given how many are being thrown.
 *
 * **The size is not fixed, and that is the only way a big die and a big handful fit in one tray.**
 * Twice the old size is what a die needs to be read at a glance — but the tray is 0.85 across
 * inside its walls, so at three times it holds three of them, and twenty d6 would need several
 * times the felt there is. A single size cannot be both.
 *
 * It does not have to be. You only need a die *small* when there are many of them, and when there
 * are many you are reading the total off the panel rather than squinting at one face. So a die is
 * as big as the handful leaves room for, up to whatever ceiling the player picked.
 *
 * Nothing in the simulation had to change for this. `DieStart` already carries a radius per die,
 * `advanceDie` clamps each one against the walls with its own and `separate()` pushes pairs apart
 * by the sum of theirs — dice of different sizes in one throw were always legal, nobody had just
 * asked for it.
 */
export function dieRadius(count: number, tray: TrayBox, size?: DiceSize): number {
  const cap = sizeCap(size);
  const many = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  const half = Number.isFinite(tray.half) && tray.half > 0 ? tray.half : cap;
  // A grid of `√(n · crowding)` dice to a side, so `2r` times that spans the interior.
  const fits = half / Math.sqrt(many * DIE_CROWDING);
  return Math.max(DIE_RADIUS_MIN, Math.min(cap, fits));
}

/**
 * How much room a die is given beside its neighbour when a handful is laid out.
 *
 * A little over twice the radius, so they start clear rather than touching — `separate()` converges
 * on tangent from below and a layout that began there would spend the throw being nudged apart.
 */
const PACK_STEP = 2.1;

/** Where one die goes when a handful is laid out to fill a box. */
export interface Slot {
  x: number;
  z: number;
  /** Which floor of the box it is on, once one layer is full. */
  layer: number;
  column: number;
  row: number;
}

/**
 * How many dice fit across a box, at a given size.
 *
 * `cols - 1` gaps of a step fit between the walls, so `cols` dice do.
 */
export function packColumns(half: number, radius: number): number {
  const edge = Math.max(0, half - radius);
  return Math.max(1, Math.floor((2 * edge) / Math.max(1e-6, radius * PACK_STEP)) + 1);
}

/**
 * Where the nth die of a handful goes, laid out to fill a box rather than queued in a line.
 *
 * **One arrangement in one place, because there are now three callers and they must agree.** Dice
 * are laid out to be dropped into the tray, to be put inside the cup, and to come back out of its
 * mouth — different frames, different boxes, same problem. When this lived inline in the first of
 * them, the second was a copy with `2.1` written out again, and the third would have been a third.
 *
 * Filling the width rather than clustering in the middle, so the gaps come out at least a step
 * wherever the column count landed.
 */
export function packSlot(index: number, half: number, radius: number): Slot {
  const cols = packColumns(half, radius);
  const edge = Math.max(0, half - radius);
  const spread = cols > 1 ? (2 * edge) / (cols - 1) : 0;
  const perLayer = cols * cols;
  const at = Math.max(0, Math.floor(index));
  const slot = at % perLayer;
  const column = slot % cols;
  const row = Math.floor(slot / cols);
  return {
    x: cols > 1 ? -edge + column * spread : 0,
    z: cols > 1 ? -edge + row * spread : 0,
    layer: Math.floor(at / perLayer),
    column,
    row,
  };
}

/**
 * Stand a handful still inside a box, laid out and stacked.
 *
 * What goes in the cup before the shake starts. They are motionless, because a cup you have not
 * begun to shake is a cup with dice sitting in the bottom of it.
 */
export function packInto(dice: DieState[], box: TrayBox): void {
  const radius = dice.reduce((most, die) => Math.max(most, die.radius), 0);
  // **A square grid in a round vessel fits the square inside the circle, not around it.** The layout
  // is a grid because dice are, and a corner slot of a grid drawn to the bore would start a die
  // through the wall — from where `separate` would spend the shake pushing it back in.
  const half = box.round ? box.half / Math.SQRT2 : box.half;
  dice.forEach((die, i) => {
    const slot = packSlot(i, half, radius);
    die.position[0] = slot.x;
    die.position[1] = box.floorY + radius + slot.layer * radius * PACK_STEP;
    die.position[2] = slot.z;
    die.velocity[0] = 0;
    die.velocity[1] = 0;
    die.velocity[2] = 0;
    die.still = 0;
    die.restedAt = -1;
  });
}

export interface DieStart {
  position: Vec3;
  velocity: Vec3;
  /** Radians per second about each axis, for the free tumble. */
  spin: Vec3;
  radius: number;
  /** The orientation it must be in when it stops. */
  landing: Quat;
}

export interface DieFrame {
  position: Vec3;
  quaternion: Quat;
}

export interface ThrowPath {
  /** `frames[die][step]`, one entry per fixed step. */
  frames: DieFrame[][];
  /** How long the whole throw lasts. */
  seconds: number;
}

/** The fixed step the throw is simulated at, so the result cannot depend on the frame rate. */
export const THROW_STEP = 1 / 120;
/** How long a throw may run before it is called finished, however lively it still is. */
export const THROW_CAP_SECONDS = 3.5;
/** How long before a die stops it begins turning onto its face. */
const SETTLE_SECONDS = 0.42;
/** Tray units per second squared. Tuned to the tray, which is one unit across. */
const GRAVITY = 9;
/** How much of its approach speed a die keeps when it bounces. */
const RESTITUTION = 0.42;
/** How much of its sideways speed it keeps when it hits the felt. Felt is not ice. */
const FLOOR_FRICTION = 0.78;
/** Rolling drag, per second, once it is down. */
const ROLL_DRAG = 2.6;
/**
 * Below this speed, a die has stopped.
 *
 * **It has to clear one step of gravity, and that is not a free parameter.** A die resting on top of
 * another is pulled into it by `GRAVITY * THROW_STEP` every step and only pushed back by `separate`
 * *after* its speed has been measured — so at 0.06, under that 0.075, a stacked die read as moving
 * for ever and the throw ran its whole cap out. One on the felt escaped only because `advanceDie`
 * zeroes that component itself before measuring, which it cannot do for a contact it knows nothing
 * about.
 *
 * The cost of the higher figure is nothing anyone could see: a die drifting at 0.12 would take
 * seven seconds to cross this tray.
 */
const REST_SPEED = 0.12;
/** How long it must stay that slow before it counts as stopped, so a die at the top of a bounce
 * — momentarily motionless and about to fall — is not mistaken for one at rest. */
const REST_HOLD = 0.08;
/**
 * How far two dice may lap before it counts as an overlap rather than as resting against each other.
 *
 * Half a percent of a radius is invisible and is far above where `separate()` converges — see the
 * comment there. Nothing in a tray looks different at this distance; what it decides is whether the
 * throw is allowed to finish.
 */
const SETTLE_SLACK = 0.005;

/**
 * One die mid-flight.
 *
 * Exported because a shake hands its end state to `settleFrom` — the dice are somewhere, moving,
 * and the settle has to carry on from exactly there rather than from a fresh throw.
 */
export interface DieState {
  position: [number, number, number];
  velocity: [number, number, number];
  spin: Vec3;
  radius: number;
  quaternion: Quat;
  /** How long it has been slow enough to be finished. */
  still: number;
  /** The step it came to rest on, or -1 while it is still moving. */
  restedAt: number;
}

/** A die dropped into the tray, before anything has happened to it. */
export function dieState(start: DieStart): DieState {
  return {
    position: [start.position[0], start.position[1], start.position[2]],
    velocity: [start.velocity[0], start.velocity[1], start.velocity[2]],
    spin: start.spin,
    radius: Math.max(1e-4, start.radius),
    quaternion: [0, 0, 0, 1],
    still: 0,
    restedAt: -1,
  };
}

/**
 * Throw a handful and record every step of it.
 *
 * **Baked in one go rather than integrated per frame**, for two reasons. It makes the whole
 * simulation a pure function of its inputs — the same throw replays identically on a slow machine,
 * where a per-frame integrator would drift with the frame rate and could land a die on a different
 * face. And it means the moment each die stops is known *before* anything is drawn, which is what
 * the orientation needs: a die can only start turning onto its face if you know when it will get
 * there.
 *
 * A few thousand steps of arithmetic over a handful of dice, once per roll.
 */
export function simulateThrow(starts: readonly DieStart[], tray: TrayBox): ThrowPath {
  return settleFrom(starts.map(dieState), starts.map((start) => start.landing), tray);
}

/**
 * Let a handful come to rest from wherever it already is, and turn each die onto its face.
 *
 * **The back half of `simulateThrow`, split out because a shake needs it.** A shaken handful is not
 * a throw waiting to start: the dice are scattered, moving and spinning when you let go, and the
 * settle has to carry on from exactly that state. Everything that made the throw trustworthy is
 * here rather than there — the cap, the resting rule, and `seatFaces`, which is what actually
 * guarantees a die shows the number it was given.
 *
 * That guarantee is now directly testable for the first time: hand this the worst end state a
 * shake could produce and the final orientation must still be the landing exactly.
 */
export function settleFrom(dice: DieState[], landings: readonly Quat[], tray: TrayBox, held?: HeldIn): ThrowPath {
  const frames: DieFrame[][] = dice.map(() => []);
  const inside = held ? [...held.inside] : [];
  const steps = (held ? held.until + 1 : 0) + Math.ceil(THROW_CAP_SECONDS / THROW_STEP);

  for (let step = 0; step < steps; step += 1) {
    const vessel = held && step <= held.until ? held.at(step) : undefined;
    for (const [i, die] of dice.entries()) {
      if (inside[i]) {
        // **Still in the cup: simulated in the cup's own frame, recorded in the world's.** That is
        // the whole trick — the vessel moves and turns, and a die that lives in its coordinates does
        // not have to know. It is only converted at the moment it is written down, and once, for
        // good, at the moment it leaves.
        if (vessel) {
          advanceDie(die, vessel.box, THROW_STEP);
          if (die.position[1] > vessel.mouthY) {
            inside[i] = spill(die, vessel);
            held!.onLeave?.(i, step);
          }
        } else {
          // The deadline has passed and it is still in there. Tipped out where it stands rather than
          // left behind, because the cup is about to fade and a die inside it would go with it.
          inside[i] = spill(die, held!.at(held!.until));
          held!.onLeave?.(i, step);
        }
      } else if (die.restedAt < 0) {
        advanceDie(die, tray, THROW_STEP);
      }
      const seen = inside[i] && vessel ? intoWorld(die, vessel) : { position: [...die.position] as Vec3, quaternion: die.quaternion };
      frames[i]!.push(seen);
      // A die in the cup is not resting however still it is, or it would stop being advanced and
      // never come out.
      if (!inside[i] && die.restedAt < 0 && die.still >= REST_HOLD) die.restedAt = step;
    }
    // **Each group in its own frame.** A die halfway out of the mouth is briefly not colliding with
    // one still inside it. That is a smaller approximation than treating two cubes as spheres, which
    // is already the deal here — and the alternative is converting the whole handful into one frame
    // every step to answer a question about a pair of them.
    if (vessel) {
      const stillIn = dice.filter((_, i) => inside[i]);
      if (stillIn.length > 1) separate(stillIn, vessel.box);
    }
    const out = dice.filter((_, i) => !inside[i]);
    const clear = separate(out, tray);
    // **Resting is not enough; they have to be clear of each other too.** Stopping the moment every
    // die was slow enough froze whatever arrangement they happened to be in — and a handful of big
    // dice dropped down one lane is in each other at that moment. They are still being pushed
    // apart; ending the loop there is what made the overlap permanent.
    if (clear && out.length === dice.length && dice.every((die) => die.restedAt >= 0)) break;
  }

  // Everything still moving when the cap ran out is called finished where it stands, rather than
  // left mid-air: a die that never settled would hang there for as long as the tray was up.
  const length = frames[0]?.length ?? 0;
  for (const die of dice) if (die.restedAt < 0) die.restedAt = Math.max(0, length - 1);

  seatFaces(frames, dice, landings);
  return { frames, seconds: length * THROW_STEP };
}

/** Where a vessel is, and what it is, at one step of a throw. */
export interface VesselAt {
  /** Its interior, in its own frame, with gravity already rotated into it. */
  box: TrayBox;
  /** How it is turned, and where its origin sits, in the world. */
  rotation: Quat;
  position: Vec3;
  /** The height, in its own frame, past which a die has left. */
  mouthY: number;
  /** How fast its mouth is travelling, in the world. What actually flings them. */
  velocity: Vec3;
}

/** A vessel the dice start a throw inside of. */
export interface HeldIn {
  /** Which dice are in it to begin with. Not written to; `settleFrom` keeps its own copy. */
  inside: readonly boolean[];
  at: (step: number) => VesselAt;
  /** The last step it exists for. Anything still inside is tipped out then. */
  until: number;
  /**
   * Told which die left, and when.
   *
   * **Purely so that somebody can check.** The transfer is seamless by construction — a die is drawn
   * in the world's coordinates whether it is in the vessel or out of it, so the frame it leaves on
   * looks exactly like the frame before — which is right to watch and leaves nothing to observe
   * afterwards. A die that had to be tipped out at the deadline rather than falling out would be
   * indistinguishable, and it is the one failure this arrangement has.
   */
  onLeave?: (index: number, step: number) => void;
}

/** How much of the mouth's own speed a die is given as it comes out — see `POUR_CARRY`. */
const POUR_CARRY = 0.45;

/**
 * A die leaves the cup: everything about it converted, once, into the world.
 *
 * Returns `false` for "no longer inside", so the caller reads as the sentence it is.
 *
 * The mouth's speed is used for every die rather than the speed of the exact point each one is
 * leaving from. They are all within a bore of it and the difference is a fraction of what the cup's
 * own swing contributes, so it would be arithmetic for its own sake.
 */
function spill(die: DieState, vessel: VesselAt): false {
  const at = intoWorld(die, vessel);
  const carried = applyQuat(die.velocity, vessel.rotation);
  for (const axis of [0, 1, 2] as const) {
    die.position[axis] = at.position[axis];
    die.velocity[axis] = carried[axis] + vessel.velocity[axis] * POUR_CARRY;
  }
  die.quaternion = normalizeQuat(quatMultiply(vessel.rotation, die.quaternion));
  die.still = 0;
  die.restedAt = -1;
  return false;
}

/** Where a die inside a vessel is, in the world. */
function intoWorld(die: DieState, vessel: VesselAt): DieFrame {
  const at = applyQuat(die.position, vessel.rotation);
  return {
    position: [at[0] + vessel.position[0], at[1] + vessel.position[1], at[2] + vessel.position[2]],
    quaternion: normalizeQuat(quatMultiply(vessel.rotation, die.quaternion)),
  };
}

// ---------------------------------------------------------------------------------------------
// The shake.
//
// **What this is for is variety, and the variety is real rather than sprinkled on.** The dice used
// to be dropped onto a grid and barely move, so twenty of them came to rest in five neat rows every
// single time — the faces changed and the picture did not. Jittering the start would have been a
// patch over that. Agitating them properly, with the collision code the settle already uses, gives
// a different arrangement because they genuinely knock each other about, and no two holds on a
// button are the same length.
//
// **It cannot touch the result.** The faces are rolled before the first shake step runs and handed
// to `settleFrom` at the end; nothing here has any idea what a die is going to show. That is the
// same rule `engine/dice.ts` opens with, and a shake is exactly the sort of thing that would break
// it if it were allowed to decide anything.

/** How long the tray is jerked in one direction before it changes its mind. */
const SHAKE_BEAT = 0.14;
/** How hard, across and upward. Up is weaker: enough to lift a die off the felt, not to launch it. */
const SHAKE_SWAY = 20;
const SHAKE_LIFT = 4;
/** cellNoise streams. The dice block runs 1229–1231; these are the next primes above it. */
const SHAKE_SALT = 1237;
const SHAKE_SPIN_SALT = 1249;

/**
 * Where the tray is being thrown at a given moment, as an acceleration every die inside it feels.
 *
 * **One direction shared by all of them, rather than a random nudge each.** That is what shaking a
 * cup actually does, and it is why the dice end up somewhere interesting: they all surge at the
 * same wall together, arrive as a crowd, and have to sort themselves out. Per-die noise would make
 * them vibrate in place and never touch.
 *
 * A new direction every `SHAKE_BEAT`, eased between beats with the same `3t² − 2t³` fade
 * `schema/noise.ts` uses on its lattice — sampled raw it would be white noise, which is a rattle
 * rather than a shake, and stepped without the ease it would be a series of hammer blows.
 */
export function shakeAccel(seconds: number, seed: number): Vec3 {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const beat = Math.floor(t / SHAKE_BEAT);
  const into = t / SHAKE_BEAT - beat;
  const ease = into * into * (3 - 2 * into);
  const at = (which: number, axis: number) => cellNoise(which, seed * 3 + axis, SHAKE_SALT) * 2 - 1;
  const blend = (axis: number) => at(beat, axis) + (at(beat + 1, axis) - at(beat, axis)) * ease;
  return [blend(0) * SHAKE_SWAY, blend(1) * SHAKE_LIFT, blend(2) * SHAKE_SWAY];
}

/**
 * One fixed step of being shaken.
 *
 * **No resting, deliberately.** `advanceDie` counts how long a die has been slow so the settle knows
 * when to stop; a die in a shaken tray that was allowed to accumulate that would fall asleep against
 * a wall halfway through the hold and sit there while everything else moved. The counter is zeroed
 * every step here, so a shake can run for as long as somebody leans on the button.
 *
 * The spin axis is re-thrown as it goes, because a die spun about one fixed axis for ten seconds
 * reads as a top rather than as a tumbling die.
 */
export function advanceShake(dice: DieState[], tray: TrayBox, seed: number, seconds: number): void {
  const push = shakeAccel(seconds, seed);
  const step = Math.max(0, Math.round(seconds / THROW_STEP));
  for (const [i, die] of dice.entries()) {
    die.velocity[0] += push[0] * THROW_STEP;
    die.velocity[1] += push[1] * THROW_STEP;
    die.velocity[2] += push[2] * THROW_STEP;
    advanceDie(die, tray, THROW_STEP);
    die.still = 0;
    die.restedAt = -1;
    // A fresh tumble axis every beat, per die, so a crowd does not spin in unison.
    if (step % Math.round(SHAKE_BEAT / THROW_STEP) === 0) {
      const spin = (axis: number) => (cellNoise(step + i * 7, seed + axis, SHAKE_SPIN_SALT) - 0.5) * 2;
      die.spin = [spin(0) * TUMBLE_SHAKE, spin(1) * TUMBLE_SHAKE, spin(2) * TUMBLE_SHAKE];
    }
  }
  separate(dice, tray);
}

/** Radians per second of tumble while being shaken. */
const TUMBLE_SHAKE = 16;

/** How much of the shake's speed a die keeps when it comes out. The rest is the flourish below. */
const TIP_KEEP = 0.3;
/** The last shove, as the dice go out: outward, upward, and a per-die scatter on top. */
const TIP_OUT = 1.5;
const TIP_LIFT = 1.1;
const TIP_SCATTER = 0.9;

/**
 * The flourish at the end of a shake, when you let go.
 *
 * **Two problems, one cause, one fix.** `shakeAccel` is a smooth wave, so where in it you happen to
 * release is luck: measured, dice came out anywhere between 0.08 and 2.1 units per second, and at
 * the bottom of that range letting go left them sitting still — a shake that ended in a shrug. And
 * a shake *compresses* a handful, because every die surges at the same wall together, so releasing
 * after a short hold left twenty dice in a heap that took the settle 2.6 seconds to unpick.
 *
 * Throwing them **outward from the middle** solves both. Every roll leaves with the same energy
 * however the wave was going, and a crowd disperses on the way out instead of arguing about it
 * after it lands. It is also what the last moment of shaking a cup actually does.
 */
export function tipOut(dice: DieState[], seed: number): void {
  // **Shared out between them, rather than given to each.** Energy goes as the square of speed, so
  // holding the total steady across a handful means each die gets `1/√n` of it. Without that, twenty
  // dice all thrown as hard as one would ricochet around a tray under a metre across for longer than
  // the throw is allowed to last — measured, they ran the 3.5 second cap out and were still going.
  const share = 1 / Math.sqrt(Math.max(1, dice.length));
  dice.forEach((die, i) => {
    // **The shake's own energy is bled off first, not added to.** Agitation pumps speed in for as
    // long as you hold, so a crowd released mid-surge comes out carrying all of it and ricochets
    // around a tray under a metre across — twenty dice ran the cap out that way. Damping to a known
    // fraction before the shove means a roll leaves with the same energy whether it was shaken for
    // a third of a second or for ten, which is what makes the settle predictable.
    die.velocity[0] *= TIP_KEEP;
    die.velocity[1] *= TIP_KEEP;
    die.velocity[2] *= TIP_KEEP;
    const reach = Math.hypot(die.position[0], die.position[2]);
    // A die exactly in the middle has no outward to go; any fixed direction will do, and a fixed
    // one keeps the throw reproducible where a random one would not.
    const outX = reach > 1e-6 ? die.position[0] / reach : 1;
    const outZ = reach > 1e-6 ? die.position[2] / reach : 0;
    const jitter = (field: number) => (cellNoise(i, seed + field, SHAKE_SALT) - 0.5) * 2;
    die.velocity[0] += (outX * TIP_OUT + jitter(11) * TIP_SCATTER) * share;
    die.velocity[1] += TIP_LIFT * (0.6 + cellNoise(i, seed + 13, SHAKE_SALT) * 0.8) * share;
    die.velocity[2] += (outZ * TIP_OUT + jitter(17) * TIP_SCATTER) * share;
    die.still = 0;
    die.restedAt = -1;
  });
}


/**
 * When the first die touches the felt, in seconds from the start of the throw.
 *
 * **A cue for the recording, and a better one than the moment the cup tips.** The clips are dice
 * *landing*; fired when the mouth passes horizontal, the first clatter would arrive most of a second
 * before anything had hit anything. The throw is baked before it is drawn, so the moment is already
 * known rather than needing to be guessed at.
 *
 * **It asks whether a die has reached the felt, not whether it has stopped falling**, and the
 * difference is the whole of the function. Stopping falling was right while a throw was nothing but
 * a fall: the first time any die's height turned round was the first bounce. It became wrong the
 * moment the throw began inside a cup — a die sitting in a cup that is being turned over rises and
 * falls with it, several times, long before it is anywhere near the tray. Measured, the cue fired
 * within a hundredth of a second of the release on most handfuls, against dice that landed more than
 * a second later.
 *
 * Zero if nothing ever reaches it, which is a handful already at rest: the sound plays immediately,
 * which is the right answer for a throw with no fall in it.
 */
export function firstContactSeconds(path: ThrowPath, tray: TrayBox, radii: readonly number[]): number {
  return contactsIn(path, tray, radii)[0]?.seconds ?? 0;
}

/** One die arriving on the felt: when it happens, and how hard. */
export interface Contact {
  /** Seconds from the start of the throw. */
  seconds: number;
  /** How fast it was coming down as it arrived, in tray units per second. */
  speed: number;
}

/**
 * Every time a die touches the felt, in the order they happen.
 *
 * **What the clatter is made of.** `renderer/diceAudio.ts` plays one recording of a single die
 * hitting a table for each of these, at the moment it says — so the sound is assembled from the same
 * baked path as the picture rather than being a recording of somebody else's throw laid over it.
 * `firstContactSeconds` is the first of them, and is written in terms of this so that the two cannot
 * come to disagree about what touching the felt means.
 *
 * **A crossing, not a state.** A die at rest is below the felt line for hundreds of steps and has
 * arrived once; the test is that this step is on or under it and the step before was above. Bounces
 * are separate crossings, which is the point — a die that lands and bounces three times makes four
 * sounds.
 *
 * **No cap, and that is a result rather than an omission.** A die keeps `RESTITUTION` of its
 * downward speed per bounce and is stopped below `REST_SPEED`, so from a cup-height drop of about
 * 2.3 it bounces four times before it stays down. Ten dice is around forty contacts across the whole
 * throw. If a handful ever produces far more than that, something upstream is wrong and a cap here
 * would only hide it.
 */
export function contactsIn(path: ThrowPath, tray: TrayBox, radii: readonly number[]): Contact[] {
  const contacts: Contact[] = [];
  path.frames.forEach((frames, i) => {
    const felt = tray.floorY + (radii[i] ?? 0) + 1e-6;
    for (let step = 1; step < frames.length; step += 1) {
      const height = frames[step]!.position[1];
      const before = frames[step - 1]!.position[1];
      if (height > felt || before <= felt) continue;
      // **Measured over the step before the landing, not the step it lands on.** `advanceDie` clamps
      // a die that would have gone through the felt back up onto it, so the drop recorded on the
      // landing step is however far it had left to fall — near nothing for one that crossed the line
      // by a hair, whatever speed it was doing when it crossed. The step in front of it is still
      // free flight, and is the speed the sound should be scaled by.
      const speed = step >= 2 ? (frames[step - 2]!.position[1] - before) / THROW_STEP : (before - height) / THROW_STEP;
      contacts.push({ seconds: step * THROW_STEP, speed: Math.max(0, speed) });
    }
  });
  // Sorted across dice rather than grouped by them: this is a running order for a sound, and the
  // dice are interleaved in it.
  return contacts.sort((a, b) => a.seconds - b.seconds);
}

/**
 * One die, one step: gravity, the felt, and four walls.
 *
 * A vessel that is anything other than the tray goes to `advanceInVessel` before any of this runs —
 * see `TrayBox` for why generalising instead was the wrong trade.
 */
function advanceDie(die: DieState, tray: TrayBox, dt: number): void {
  if (isVessel(tray)) {
    advanceInVessel(die, tray, dt);
    return;
  }
  die.velocity[1] -= GRAVITY * dt;
  die.position[0] += die.velocity[0] * dt;
  die.position[1] += die.velocity[1] * dt;
  die.position[2] += die.velocity[2] * dt;

  // **Clamped to the wall rather than tested against it.** A reflection that only fired when the
  // die was *past* the wall would let a fast one step clean through in a single tick — the
  // tunnelling that any fixed-step integrator has, and the reason the position is pushed back
  // inside as well as the velocity turned round.
  const edge = Math.max(0, tray.half - die.radius);
  for (const axis of [0, 2] as const) {
    if (die.position[axis] > edge) {
      die.position[axis] = edge;
      if (die.velocity[axis] > 0) die.velocity[axis] *= -RESTITUTION;
    } else if (die.position[axis] < -edge) {
      die.position[axis] = -edge;
      if (die.velocity[axis] < 0) die.velocity[axis] *= -RESTITUTION;
    }
  }

  // The lid, if the box has one. Same clamp as the walls and for the same reason — a die moving
  // fast enough would otherwise step through it — but with no friction: it is glanced off, not
  // landed on.
  if (tray.ceilingY !== undefined) {
    const lid = Math.max(tray.floorY, tray.ceilingY - die.radius);
    if (die.position[1] > lid) {
      die.position[1] = lid;
      if (die.velocity[1] > 0) die.velocity[1] *= -RESTITUTION;
    }
  }

  const rest = tray.floorY + die.radius;
  if (die.position[1] <= rest) {
    die.position[1] = rest;
    if (die.velocity[1] < 0) die.velocity[1] *= -RESTITUTION;
    // A bounce too small to see is a die that jitters on the felt for ever.
    if (Math.abs(die.velocity[1]) < REST_SPEED) die.velocity[1] = 0;
    die.velocity[0] *= FLOOR_FRICTION;
    die.velocity[2] *= FLOOR_FRICTION;
    const drag = Math.max(0, 1 - ROLL_DRAG * dt);
    die.velocity[0] *= drag;
    die.velocity[2] *= drag;
  }

  tumble(die, dt);
}

/**
 * How still it is, and how far it has turned. Shared by both containers.
 *
 * **Slow for long enough, wherever it is — not "slow and on the floor".** Requiring the felt meant a
 * die that came to rest *on another die* could never finish: it is supported, it is not moving, and
 * it was never grounded, so the throw ran the full cap out every time one landed in a pile. Rare
 * when dice were dropped in and common the moment they were shaken.
 *
 * Dropping the floor test costs nothing, because `REST_HOLD` already rules out the case it was
 * guarding: a die at the top of a bounce is motionless for an instant, and gravity alone gives it
 * ten times `REST_SPEED` within the eightieth of a second it would have to stay slow for.
 *
 * The tumble is about the axis its own throw gave it, scaled down as it slows, so a die that has
 * nearly stopped is nearly still rather than spinning on the spot.
 */
function tumble(die: DieState, dt: number): void {
  const speed = Math.hypot(die.velocity[0], die.velocity[1], die.velocity[2]);
  die.still = speed < REST_SPEED ? die.still + dt : 0;
  const turn = Math.min(1, speed / 2);
  die.quaternion = normalizeQuat(
    quatMultiply(
      quatFromAxisAngle(die.spin, Math.hypot(die.spin[0], die.spin[1], die.spin[2]) * dt * turn),
      die.quaternion,
    ),
  );
}

/**
 * One die, one step, inside a cup: gravity in whatever direction the cup has turned it, one round
 * wall, a closed end, and a mouth that is either shut or a way out.
 *
 * **Written beside `advanceDie` rather than as a generalisation of it**, for the reason `TrayBox`
 * gives at length. What is genuinely different is not the shape but the *contacts*: in a tray the
 * only surface a die ever rests on is the floor, so friction and the too-small-to-see bounce could
 * be written into the floor case. In a tipped tube the surface it rests on is usually the side, and
 * which one it is changes as the cup turns. So the surfaces touched this step are collected and each
 * is answered the same way, whichever it was.
 */
function advanceInVessel(die: DieState, vessel: TrayBox, dt: number): void {
  const down = vessel.gravity ?? DOWN;
  for (const axis of [0, 1, 2] as const) {
    die.velocity[axis] += down[axis] * GRAVITY * dt;
    die.position[axis] += die.velocity[axis] * dt;
  }

  // Inward normals of everything it is touching. At most three, and usually none.
  const contacts: Vec3[] = [];
  const top = vessel.ceilingY;
  const floor = vessel.floorY + die.radius;

  // **The wall stops where the vessel does.** Past an open mouth a die is out and free, and clamping
  // it there would hold it in the air above the rim by exactly its own radius.
  if (top === undefined || die.position[1] <= top) {
    const edge = Math.max(0, vessel.half - die.radius);
    if (vessel.round) {
      const out = Math.hypot(die.position[0], die.position[2]);
      if (out > edge && out > 1e-9) {
        die.position[0] *= edge / out;
        die.position[2] *= edge / out;
        contacts.push([-die.position[0] / out, 0, -die.position[2] / out]);
      }
    } else {
      for (const axis of [0, 2] as const) {
        if (die.position[axis] > edge) {
          die.position[axis] = edge;
          contacts.push(axis === 0 ? [-1, 0, 0] : [0, 0, -1]);
        } else if (die.position[axis] < -edge) {
          die.position[axis] = -edge;
          contacts.push(axis === 0 ? [1, 0, 0] : [0, 0, 1]);
        }
      }
    }
  }

  if (die.position[1] < floor) {
    die.position[1] = floor;
    contacts.push([0, 1, 0]);
  }
  if (top !== undefined && !vessel.open) {
    const lid = Math.max(floor, top - die.radius);
    if (die.position[1] > lid) {
      die.position[1] = lid;
      contacts.push([0, -1, 0]);
    }
  }

  const drag = Math.max(0, 1 - ROLL_DRAG * dt);
  for (const n of contacts) {
    const into = die.velocity[0] * n[0] + die.velocity[1] * n[1] + die.velocity[2] * n[2];
    // Already moving away from this surface: it was clamped by another one, or by a neighbour.
    if (into >= 0) continue;
    // **Cancelled rather than bounced when it is too slow to see**, which is the same call the felt
    // makes and for the same reason: a bounce below this is a die that jitters against a wall for
    // ever and never gets the eightieth of a second of stillness it needs to be called finished.
    const bounce = Math.abs(into) < REST_SPEED ? 1 : 1 + RESTITUTION;
    for (const axis of [0, 1, 2] as const) die.velocity[axis] -= n[axis] * into * bounce;
    // **Friction in proportion to how hard the surface is being leaned on**, which the tray never
    // had to care about because the only surface it has is one gravity presses straight into. A tube
    // has a wall running *along* the pull, and the felt's figure — a fifth of the speed gone every
    // step — glues a die to it: measured, a lone die slid so slowly down a cup tipped past vertical
    // that it was still inside when the cup was due to disappear, and only left because the deadline
    // made it. Pressed head-on this is the felt exactly; edge-on it is nothing.
    const press = Math.max(0, -(down[0] * n[0] + down[1] * n[1] + down[2] * n[2]));
    const grip = 1 - (1 - FLOOR_FRICTION) * press;
    const settled = die.velocity[0] * n[0] + die.velocity[1] * n[1] + die.velocity[2] * n[2];
    for (const axis of [0, 1, 2] as const) {
      const along = die.velocity[axis] - n[axis] * settled;
      die.velocity[axis] = n[axis] * settled + along * grip * drag;
    }
  }

  tumble(die, dt);
}

/**
 * Push dice out of each other, as spheres.
 *
 * **An approximation, and the honest alternative is a physics engine.** Two cubes resting corner to
 * corner are not two spheres. What this buys is the thing that would otherwise look broken rather
 * than merely approximate: without it a handful thrown from one point falls down the same line and
 * comes to rest inside itself.
 */
function separate(dice: DieState[], tray: TrayBox): boolean {
  let clear = true;
  for (let i = 0; i < dice.length; i += 1) {
    for (let j = i + 1; j < dice.length; j += 1) {
      const a = dice[i]!;
      const b = dice[j]!;
      const dx = b.position[0] - a.position[0];
      const dy = b.position[1] - a.position[1];
      const dz = b.position[2] - a.position[2];
      const gap = a.radius + b.radius;
      const distance = Math.hypot(dx, dy, dz);
      if (distance >= gap) continue;
      // **Touching does not count as overlapping**, and the difference decides whether the throw
      // can ever end. This pushes a pair apart by exactly their overlap, so a pair resting against
      // each other *converges* on tangent from below and never reaches it — a "no overlap at all"
      // test on that is false for ever, and a full tray would run the clock out every time.
      if (gap - distance > gap * SETTLE_SLACK) clear = false;
      // Two dice exactly on top of each other have no direction to be pushed apart along. Any one
      // will do, and a fixed one keeps the throw reproducible where a random one would not.
      const n: Vec3 = distance > 1e-6 ? [dx / distance, dy / distance, dz / distance] : [1, 0, 0];
      const overlap = (gap - distance) / 2;
      // **A die that has stopped still gets moved out of the way.** Only its velocity is left
      // alone, below — being shoved by a neighbour should not set it rolling again, but refusing to
      // move it at all is what let two dice stay inside each other for good once both were still.
      for (const [die, sign] of [[a, -1], [b, 1]] as const) {
        die.position[0] += n[0] * overlap * sign;
        die.position[1] += n[1] * overlap * sign;
        die.position[2] += n[2] * overlap * sign;
      }
      const closing = (b.velocity[0] - a.velocity[0]) * n[0] + (b.velocity[1] - a.velocity[1]) * n[1] + (b.velocity[2] - a.velocity[2]) * n[2];
      if (closing >= 0) continue;
      // **A resting contact is cancelled, not bounced** — the same call the felt makes just above,
      // for the same reason. A die sitting on top of another is pulled into it by gravity every
      // step; answered with a bounce, however small, it micro-hops for ever and never gets the
      // eightieth of a second of stillness it needs to be called finished.
      const kick = closing > -REST_SPEED ? closing : closing * RESTITUTION;
      for (const [die, sign] of [[a, 1], [b, -1]] as const) {
        if (die.restedAt >= 0) continue;
        die.velocity[0] += n[0] * kick * sign;
        die.velocity[1] += n[1] * kick * sign;
        die.velocity[2] += n[2] * kick * sign;
      }
    }
  }
  // **Everything that was pushed goes back inside the tray.** A die still moving would be clamped
  // by its next `advanceDie`, but one that has stopped never runs through that again — so without
  // this, shoving a resting die out of a neighbour is a way to shove it through a wall.
  for (const die of dice) {
    const edge = Math.max(0, tray.half - die.radius);
    if (tray.round) {
      // Only where there is a wall: a die on its way out of the mouth is past it, and pulling it
      // back to the bore would be the vessel catching one it had already let go of.
      const out = Math.hypot(die.position[0], die.position[2]);
      if (out > edge && out > 1e-9 && (tray.ceilingY === undefined || die.position[1] <= tray.ceilingY)) {
        die.position[0] *= edge / out;
        die.position[2] *= edge / out;
      }
    } else {
      die.position[0] = Math.max(-edge, Math.min(edge, die.position[0]));
      die.position[2] = Math.max(-edge, Math.min(edge, die.position[2]));
    }
    die.position[1] = Math.max(tray.floorY + die.radius, die.position[1]);
    // And under the lid, where there is one — being shoved out of a neighbour is otherwise a second
    // way out of a closed box, and the one that does not need any speed at all.
    if (tray.ceilingY !== undefined && !tray.open) {
      die.position[1] = Math.min(Math.max(tray.floorY, tray.ceilingY - die.radius), die.position[1]);
    }
  }
  return clear;
}

/**
 * Turn each die onto the face it was always going to show, over its last moments.
 *
 * Done as a second pass because it needs to know when the die stops, which the simulation only
 * discovers by running. **The final frame is the landing orientation exactly** — that is the
 * contract the whole feature rests on.
 */
function seatFaces(frames: DieFrame[][], dice: readonly DieState[], landings: readonly Quat[]): void {
  const blend = Math.max(1, Math.round(SETTLE_SECONDS / THROW_STEP));
  frames.forEach((path, i) => {
    // A shake can hand over more dice than landings only if a caller has got its lists out of step;
    // leaving the die where it is beats turning it onto `undefined`.
    const landing = landings[i];
    if (!landing) return;
    const rested = dice[i]!.restedAt;
    const from = Math.max(0, rested - blend);
    for (let step = from; step < path.length; step += 1) {
      const t = step >= rested ? 1 : (step - from) / Math.max(1, rested - from);
      path[step] = {
        position: path[step]!.position,
        // Eased, so the correction is gentlest where it starts and the die does not visibly change
        // what it was doing the instant the turn begins.
        quaternion: t >= 1 ? landing : quatSlerp(path[step]!.quaternion, landing, t * t * (3 - 2 * t)),
      };
    }
  });
}

/**
 * Where a die is at a given moment.
 *
 * A lookup rather than a step, which is what makes playback immune to the frame rate: a slow
 * machine drops frames of the throw rather than simulating it differently.
 */
export function frameAt(path: ThrowPath, die: number, seconds: number): DieFrame | undefined {
  const steps = path.frames[die];
  if (!steps || steps.length === 0) return undefined;
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return steps[Math.min(steps.length - 1, Math.floor(t / THROW_STEP))];
}
