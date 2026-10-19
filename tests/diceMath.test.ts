import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_DICE_SIZE,
  DIE_RADIUS_MIN,
  DIE_SIZE_CAPS,
  UP,
  advanceShake,
  applyQuat,
  contactsIn,
  dieRadius,
  dieState,
  firstContactSeconds,
  orthoFramingOf,
  packColumns,
  packInto,
  packSlot,
  settleFrom,
  shakeAccel,
  tipOut,
  THROW_CAP_SECONDS,
  THROW_STEP,
  faceUpQuaternion,
  frameAt,
  simulateThrow,
  faceUps,
  normalize,
  numberUps,
  orthoFraming,
  percentileFaces,
  quatFromUnitVectors,
  quatSlerp,
  vertexUps,
  type DiceSize,
  type DieStart,
  type DieState,
  type HeldIn,
  type TrayBox,
  type Quat,
  type VesselAt,
  type Vec3,
} from "../renderer/diceMath.js";

/**
 * The five solids three.js builds, plus the cube, as non-indexed position buffers.
 *
 * Built here from three rather than hand-typed, because the point of `faceUps` is that it reads
 * whatever the geometry actually is — a table of expected normals typed into a test would be
 * asserting what I believe three does rather than what it does.
 */
const SOLIDS: ReadonlyArray<readonly [string, number, THREE.BufferGeometry]> = [
  ["d4", 4, new THREE.TetrahedronGeometry(1)],
  ["d6", 6, new THREE.BoxGeometry(1.2, 1.2, 1.2).toNonIndexed()],
  ["d8", 8, new THREE.OctahedronGeometry(1)],
  ["d12", 12, new THREE.DodecahedronGeometry(1)],
  ["d20", 20, new THREE.IcosahedronGeometry(1)],
];

function positionsOf(geometry: THREE.BufferGeometry): Float32Array {
  return geometry.getAttribute("position").array as Float32Array;
}

describe("finding a solid's faces", () => {
  it("counts the faces of every die, however many triangles each takes", () => {
    // A cube is twelve triangles in six faces, a dodecahedron thirty-six in twelve. Counting
    // triangles would give a d6 twelve numbers and a d12 thirty-six.
    for (const [name, faces, geometry] of SOLIDS) {
      expect(faceUps(positionsOf(geometry)).length, name).toBe(faces);
    }
  });

  it("gives every face a unit direction", () => {
    for (const [name, , geometry] of SOLIDS) {
      for (const up of faceUps(positionsOf(geometry))) {
        expect(Math.hypot(...up), name).toBeCloseTo(1, 9);
      }
    }
  });

  it("gives no two faces the same direction", () => {
    for (const [name, faces, geometry] of SOLIDS) {
      const ups = faceUps(positionsOf(geometry));
      for (let i = 0; i < ups.length; i += 1) {
        for (let j = i + 1; j < ups.length; j += 1) {
          const same = ups[i]![0] * ups[j]![0] + ups[i]![1] * ups[j]![1] + ups[i]![2] * ups[j]![2];
          expect(same, `${name} faces ${i} and ${j}`).toBeLessThan(0.999);
        }
      }
      expect(ups.length, name).toBe(faces);
    }
  });

  it("survives a degenerate direction rather than returning NaN", () => {
    // A zero-length direction ends up in a rotation, and one NaN in a matrix takes the object out
    // of the scene with nothing on screen to say why.
    expect(normalize([0, 0, 0])).toEqual([0, 1, 0]);
  });
});

describe("numbering the faces", () => {
  it("puts opposite faces on either side of one more than the count", () => {
    // 1 opposite 6, 7 opposite 14 — the convention every real die follows, and the first thing
    // anybody who owns dice would notice us getting wrong.
    for (const [name, faces, geometry] of SOLIDS) {
      if (name === "d4") continue; // a tetrahedron has no opposite faces — see vertexUps
      const ups = numberUps(faceUps(positionsOf(geometry)));
      for (let i = 0; i < faces; i += 1) {
        const face = ups[i]!;
        const opposite = ups[faces - 1 - i]!;
        const facing = face[0] * opposite[0] + face[1] * opposite[1] + face[2] * opposite[2];
        expect(facing, `${name}: ${i + 1} against ${faces - i}`).toBeLessThan(-0.999);
      }
    }
  });

  it("keeps every face, and loses none to the pairing", () => {
    for (const [name, faces, geometry] of SOLIDS) {
      const before = faceUps(positionsOf(geometry));
      const after = numberUps(before);
      expect(after.length, name).toBe(faces);
      for (const up of before) {
        expect(after.some((seen) => Math.hypot(seen[0] - up[0], seen[1] - up[1], seen[2] - up[2]) < 1e-6), name).toBe(true);
      }
    }
  });

  it("numbers a shape with no opposites straight through", () => {
    const ups = numberUps(faceUps(positionsOf(new THREE.TetrahedronGeometry(1))));
    expect(ups.length).toBe(4);
    expect(new Set(ups.map((up) => up.join(","))).size).toBe(4);
  });

  it("finds a tetrahedron's four corners, which is how a d4 is read", () => {
    // A d4's faces are not opposite each other, so the one pointing up is the one it is balancing
    // on a point to show you. Landing a corner up puts the die flat on a face, as it would really
    // come to rest, with the number that counts at the top.
    const corners = vertexUps(positionsOf(new THREE.TetrahedronGeometry(1)));
    expect(corners.length).toBe(4);
    for (const corner of corners) expect(Math.hypot(...corner)).toBeCloseTo(1, 9);
    // And no two of them are the same corner counted twice — each is shared by three faces.
    for (let i = 0; i < 4; i += 1) {
      for (let j = i + 1; j < 4; j += 1) {
        const same = corners[i]![0] * corners[j]![0] + corners[i]![1] * corners[j]![1] + corners[i]![2] * corners[j]![2];
        expect(same).toBeLessThan(0.999);
      }
    }
  });

  it("brings any corner of a d4 to the top", () => {
    const corners = numberUps(vertexUps(positionsOf(new THREE.TetrahedronGeometry(1))));
    corners.forEach((corner, i) => {
      expect(applyQuat(corner, faceUpQuaternion(corner, 1.3))[1], `corner ${i + 1}`).toBeCloseTo(1, 6);
    });
  });
});

describe("landing on a face", () => {
  it("brings any face of any die to the top", () => {
    // **The one thing about this feature that could be quietly, permanently wrong**: a die that
    // shows 4 when the panel says 17. Checked for every face of every solid rather than spot-checked.
    for (const [name, , geometry] of SOLIDS) {
      const ups = numberUps(faceUps(positionsOf(geometry)));
      ups.forEach((up, i) => {
        for (const yaw of [0, 1.1, 2.9, -0.7]) {
          const landed = applyQuat(up, faceUpQuaternion(up, yaw));
          expect(landed[1], `${name} face ${i + 1} at yaw ${yaw}`).toBeCloseTo(1, 6);
        }
      });
    }
  });

  it("handles the face that wants to come from straight down", () => {
    // There is no shortest turn between a vector and its own opposite, and the cross product used
    // for every other case is zero there. Not exotic: it is every die whose face starts underneath.
    const landed = applyQuat([0, -1, 0], quatFromUnitVectors([0, -1, 0], UP));
    expect(landed[1]).toBeCloseTo(1, 9);
    expect(Number.isFinite(landed[0])).toBe(true);
  });

  it("leaves a face already on top alone", () => {
    const q = quatFromUnitVectors(UP, UP);
    expect(q).toEqual([0, 0, 0, 1]);
  });

  it("turns the die about the vertical without disturbing which face is up", () => {
    const up: Vec3 = normalize([0.3, 0.5, -0.8]);
    const square = applyQuat(up, faceUpQuaternion(up, 0));
    const turned = applyQuat(up, faceUpQuaternion(up, 2.4));
    expect(square[1]).toBeCloseTo(1, 6);
    expect(turned[1]).toBeCloseTo(1, 6);
  });
});

describe("the frame", () => {
  /**
   * Where a corner lands on screen, worked out from the framing alone.
   *
   * **Deliberately a second implementation rather than a call into the first.** The whole claim is
   * that a parallel projection puts a point at its distance along the camera's own right and up
   * axes; a test that reused the function's own basis could only agree with it. This rebuilds the
   * basis from the returned camera position, which is the part a caller can see.
   */
  function screen(fit: ReturnType<typeof orthoFraming>, corner: Vec3): { h: number; v: number } {
    const camera = new THREE.Vector3(...fit.position);
    const forward = camera.clone().negate().normalize();
    const right = new THREE.Vector3(1, 0, 0);
    const up = right.clone().cross(forward).normalize();
    const p = new THREE.Vector3(...corner);
    return { h: p.dot(right), v: p.dot(up) };
  }

  const corners = (min: Vec3, max: Vec3): Vec3[] =>
    [min[0], max[0]].flatMap((x) => [min[1], max[1]].flatMap((y) => [min[2], max[2]].map((z): Vec3 => [x, y, z])));

  /** The tray, after the lift that puts the felt at zero. */
  const TRAY_MIN: Vec3 = [-0.5, -0.02, -0.5];
  const TRAY_MAX: Vec3 = [0.5, 0.104, 0.5];

  it("keeps every corner of the box inside the frustum", () => {
    // **The bug this function exists for, as a test.** The tray was framed by a perspective camera
    // at a hand-picked height, and the near corners of the unit square fell about a quarter of a
    // frustum outside it — the whole near rim was cut off on screen and nothing said so.
    for (const elevation of [30, 45, 60, 75, 85]) {
      for (const [min, max] of [
        [TRAY_MIN, TRAY_MAX],
        [[-0.5, 0, -0.5], [0.5, 0.6, 0.5]],
        [[-2, -1, -0.2], [2, 1, 0.2]],
      ] as Array<[Vec3, Vec3]>) {
        const fit = orthoFraming(min, max, elevation, 1, 0);
        for (const corner of corners(min, max)) {
          const { h, v } = screen(fit, corner);
          const where = `${elevation} deg, corner ${corner.join()}`;
          expect(Math.abs(h - fit.offsetRight), where).toBeLessThanOrEqual(fit.halfWidth + 1e-9);
          expect(Math.abs(v - fit.offsetUp), where).toBeLessThanOrEqual(fit.halfHeight + 1e-9);
        }
      }
    }
  });

  it("leaves air around the box when asked for a margin", () => {
    const tight = orthoFraming(TRAY_MIN, TRAY_MAX, 60, 1, 0);
    const roomy = orthoFraming(TRAY_MIN, TRAY_MAX, 60, 1.06, 0);
    expect(roomy.halfWidth).toBeCloseTo(tight.halfWidth * 1.06, 9);
    expect(roomy.halfHeight).toBeCloseTo(tight.halfHeight * 1.06, 9);
    // Strictly inside now, rather than touching, which is the whole point of asking for it.
    for (const corner of corners(TRAY_MIN, TRAY_MAX)) {
      expect(Math.abs(screen(roomy, corner).h - roomy.offsetRight)).toBeLessThan(roomy.halfWidth);
    }
  });

  it("puts the headroom above the box and not around it", () => {
    // Dice drop in from over the rim, so the space has to be on the side they come from. Added
    // symmetrically it would be an equal gap under the tray and half the benefit for twice the cost.
    const snug = orthoFraming(TRAY_MIN, TRAY_MAX, 60, 1, 0);
    const roomy = orthoFraming(TRAY_MIN, TRAY_MAX, 60, 1, 0.12);
    expect(roomy.halfHeight - snug.halfHeight).toBeCloseTo(0.06, 9);
    expect(roomy.offsetUp - snug.offsetUp).toBeCloseTo(0.06, 9);
    // The bottom edge has not moved: the box still sits on the same line.
    expect(roomy.offsetUp - roomy.halfHeight).toBeCloseTo(snug.offsetUp - snug.halfHeight, 9);
    expect(roomy.halfWidth).toBeCloseTo(snug.halfWidth, 9);
  });

  it("grows vertically for a taller box and leaves the width alone", () => {
    const short = orthoFraming(TRAY_MIN, TRAY_MAX, 60, 1, 0);
    const tall = orthoFraming(TRAY_MIN, [0.5, 0.6, 0.5], 60, 1, 0);
    expect(tall.halfHeight).toBeGreaterThan(short.halfHeight);
    expect(tall.halfWidth).toBeCloseTo(short.halfWidth, 9);
  });

  it("projects the unit square to very nearly a square at 60 degrees", () => {
    // The reason the tray is viewed square-on rather than corner-on: at this angle it fills a
    // square canvas almost exactly. Turned 45 degrees it would be a 1.41-wide diamond and would be
    // drawn about a third smaller in the same box. If this ever drifts, so does that choice.
    const fit = orthoFraming(TRAY_MIN, TRAY_MAX, 60, 1, 0);
    expect(fit.halfWidth * 2).toBeCloseTo(1, 6);
    expect(fit.halfHeight / fit.halfWidth).toBeGreaterThan(0.85);
    expect(fit.halfHeight / fit.halfWidth).toBeLessThan(1);
  });

  it("looks down at the box from the front", () => {
    const fit = orthoFraming(TRAY_MIN, TRAY_MAX, 60, 1, 0);
    expect(fit.position[0]).toBeCloseTo(0, 9);
    expect(fit.position[1]).toBeGreaterThan(0);
    expect(fit.position[2]).toBeGreaterThan(0);
    // Steeper means higher and nearer, which is the one thing the elevation is allowed to mean.
    const steeper = orthoFraming(TRAY_MIN, TRAY_MAX, 80, 1, 0);
    expect(steeper.position[1]).toBeGreaterThan(fit.position[1]);
    expect(steeper.position[2]).toBeLessThan(fit.position[2]);
  });

  it("refuses to produce a NaN out of a degenerate elevation", () => {
    // Straight down collapses the basis — the up axis and the view direction become parallel — and
    // one NaN in a projection matrix takes the whole tray off screen with nothing to say why.
    for (const elevation of [0, 90, 180, -40, Number.NaN, Number.POSITIVE_INFINITY]) {
      const fit = orthoFraming(TRAY_MIN, TRAY_MAX, elevation, 1.06, 0.12);
      for (const n of [...fit.position, fit.halfWidth, fit.halfHeight, fit.offsetRight, fit.offsetUp]) {
        expect(Number.isFinite(n), `elevation ${elevation}`).toBe(true);
      }
      expect(fit.halfWidth).toBeGreaterThan(0);
      expect(fit.halfHeight).toBeGreaterThan(0);
    }
  });

  it("matches the viewport's shape, so nothing is drawn stretched", () => {
    // **An orthographic camera has no `aspect` of its own.** A perspective one is handed the
    // viewport's shape and divides by it; this one takes four planes and draws whatever is between
    // them into whatever it is given. Fitted to the tray, the frustum comes out about 1.06 x 1.11 —
    // handed to a square canvas unchanged, that is a 5% vertical squash on every die in it, which
    // is small enough to look like the model rather than like a bug.
    for (const aspect of [1, 4 / 3, 16 / 9, 0.75]) {
      const fit = orthoFraming(TRAY_MIN, TRAY_MAX, 60, 1.06, 0.12, aspect);
      expect(fit.halfWidth / fit.halfHeight, `aspect ${aspect}`).toBeCloseTo(aspect, 9);
    }
  });

  it("grows to meet the viewport rather than trimming to it", () => {
    // The correction has to add air, never take it. Trimming the other extent would be a second way
    // for the tray to be cut off — by the very function whose job is that it cannot be.
    for (const aspect of [0.5, 1, 1.5, 3]) {
      const fit = orthoFraming(TRAY_MIN, TRAY_MAX, 60, 1, 0, aspect);
      // Measured against the box itself rather than against another framing, because every framing
      // has already had the correction applied and none of them can testify about it.
      let width = 0;
      let height = 0;
      for (const corner of corners(TRAY_MIN, TRAY_MAX)) {
        const { h, v } = screen(fit, corner);
        width = Math.max(width, Math.abs(h - fit.offsetRight));
        height = Math.max(height, Math.abs(v - fit.offsetUp));
      }
      expect(fit.halfWidth, `aspect ${aspect}`).toBeGreaterThanOrEqual(width - 1e-9);
      expect(fit.halfHeight, `aspect ${aspect}`).toBeGreaterThanOrEqual(height - 1e-9);
    }
  });

  it("frames the same box the same way twice", () => {
    expect(orthoFraming(TRAY_MIN, TRAY_MAX, 60, 1.06, 0.12)).toEqual(orthoFraming(TRAY_MIN, TRAY_MAX, 60, 1.06, 0.12));
  });

  it("carries a box that is not centred rather than growing to reach it", () => {
    // A frustum widened until it happened to contain an off-centre box would draw it small and off
    // to one side. Shifting the frustum instead is what keeps the tray as large as it can be.
    const off = orthoFraming([1, -0.02, -0.5], [2, 0.104, 0.5], 60, 1, 0);
    expect(off.offsetRight).toBeCloseTo(1.5, 9);
    expect(off.halfWidth).toBeCloseTo(0.5, 9);
  });
});

describe("how big a die is", () => {
  /** The tray as `renderer/diceFx.ts` measures it — see TRAY there. */
  const TRAY: TrayBox = { half: 0.42, floorY: 0 };
  const SIZES: readonly DiceSize[] = [1, 2, 3];

  it("gives one die the most its setting allows and a crowd the least", () => {
    for (const size of SIZES) {
      expect(dieRadius(1, TRAY, size), `size ${size}`).toBe(DIE_SIZE_CAPS[size]);
      // **The cap stops mattering once the handful is large**, which is the property that makes the
      // setting safe to expose: past this point every size draws the same die.
      expect(dieRadius(40, TRAY, size), `size ${size}`).toBe(DIE_RADIUS_MIN);
    }
    // The floor is a floor because legibility beats tidiness: a very large handful comes to rest on
    // itself rather than shrinking to a size nobody can read.
    expect(DIE_RADIUS_MIN).toBe(0.06);
    expect(DIE_SIZE_CAPS[3] / DIE_SIZE_CAPS[1]).toBeCloseTo(3, 9);
  });

  it("draws every handful the same at the smallest setting", () => {
    // Size 1's cap *is* the floor, so it is a flat line rather than a third curve. Worth asserting
    // because it is the one setting whose behaviour is a consequence of two numbers being equal.
    for (let n = 1; n <= 50; n += 1) expect(dieRadius(n, TRAY, 1), `${n} dice`).toBe(DIE_RADIUS_MIN);
  });

  it("never grows as the handful does", () => {
    // A rule that gave a bigger die for a bigger handful somewhere in the middle would be a very
    // quiet bug — it would look like the dice were breathing rather than like anything was wrong.
    for (const size of SIZES) {
      let last = Infinity;
      for (let n = 1; n <= 200; n += 1) {
        const r = dieRadius(n, TRAY, size);
        expect(r, `size ${size}, ${n} dice`).toBeLessThanOrEqual(last);
        expect(r, `size ${size}, ${n} dice`).toBeGreaterThanOrEqual(DIE_RADIUS_MIN);
        expect(r, `size ${size}, ${n} dice`).toBeLessThanOrEqual(DIE_SIZE_CAPS[size]);
        last = r;
      }
    }
  });

  it("never draws a bigger die for a smaller setting", () => {
    // The settings have to stay in order at every handful, or "3" would sometimes mean smaller
    // than "2" and the row of buttons would be lying about what it does.
    for (let n = 1; n <= 60; n += 1) {
      expect(dieRadius(n, TRAY, 1), `${n} dice`).toBeLessThanOrEqual(dieRadius(n, TRAY, 2));
      expect(dieRadius(n, TRAY, 2), `${n} dice`).toBeLessThanOrEqual(dieRadius(n, TRAY, 3));
    }
  });

  it("falls back to the default for a nonsense setting, and a usable size for a nonsense count", () => {
    // One NaN here reaches a scale factor and takes the die off screen with nothing to say why.
    for (const bad of [0, -4, Number.NaN, Number.POSITIVE_INFINITY, 1e5, 0.5]) {
      const r = dieRadius(bad, TRAY, 2);
      expect(Number.isFinite(r), `${bad}`).toBe(true);
      expect(r, `${bad}`).toBeGreaterThanOrEqual(DIE_RADIUS_MIN);
      expect(r, `${bad}`).toBeLessThanOrEqual(DIE_SIZE_CAPS[2]);
    }
    for (const bad of [undefined, 0, 4, -1, Number.NaN, "2"]) {
      expect(dieRadius(1, TRAY, bad as DiceSize), `size ${String(bad)}`).toBe(DIE_SIZE_CAPS[DEFAULT_DICE_SIZE]);
    }
    expect(Number.isFinite(dieRadius(4, { half: Number.NaN, floorY: 0 }, 2))).toBe(true);
  });

  it("throws a handful of any size and has them all fit", () => {
    // **The claim the whole rule rests on, tested against the physics rather than against the
    // packing formula that produced it.** simulateThrow is pure, so a real throw can be run here:
    // for every handful from one to twenty-five, at whatever size the rule chose for it, every die
    // must come to rest inside the walls and clear of every other die.
    for (const size of SIZES) for (let handful = 1; handful <= 25; handful += 1) {
      const radius = dieRadius(handful, TRAY, size);
      const edge = TRAY.half - radius;
      // The grid `begin` lays a handful out on, mirrored here. It is the layout as much as the size
      // that makes them fit: queued in one file instead, four dice were still shoving each other
      // three seconds in and twenty never finished at all.
      const step = radius * 2.1;
      const cols = Math.max(1, Math.floor((2 * edge) / step) + 1);
      const perLayer = cols * cols;
      const spread = cols > 1 ? (2 * edge) / (cols - 1) : 0;
      const pace = 1 / Math.max(1, Math.ceil(Math.min(handful, perLayer) / cols));
      const starts: DieStart[] = Array.from({ length: handful }, (_, i) => {
        const slot = i % perLayer;
        const row = Math.floor(slot / cols);
        return {
          position: [
            cols > 1 ? -edge + (slot % cols) * spread : 0,
            radius + 0.1 + (Math.floor(i / perLayer) * 2.2 + (row % 2) * 0.5) * radius,
            cols > 1 ? edge - row * spread : edge * 0.8,
          ] as Vec3,
          velocity: [(i % 2 === 0 ? 0.2 : -0.25) * pace, 0, -0.85 * pace] as Vec3,
          spin: [7 + i, 5 - i, 9 + i] as Vec3,
          radius,
          landing: faceUpQuaternion(normalize([0.2, 1, 0.3]), 0.4 + i),
        };
      });
      const path = simulateThrow(starts, TRAY);

      // They should also be *done* well inside the cap — a throw that ran the clock out would mean
      // they were still jostling when the tray went still, which is the slow-settle bug this
      // layout replaced rather than a fit problem.
      expect(path.seconds, `size ${size}, ${handful} dice never settled`).toBeLessThan(2);

      const rest = path.frames.map((die) => die[die.length - 1]!.position);
      rest.forEach((p, i) => {
        expect(Math.abs(p[0]), `size ${size}, ${handful} dice: die ${i} is against the x wall`).toBeLessThanOrEqual(edge + 1e-6);
        expect(Math.abs(p[2]), `size ${size}, ${handful} dice: die ${i} is against the z wall`).toBeLessThanOrEqual(edge + 1e-6);
      });
      // Touching is the right answer and `separate()` converges to it rather than landing on it —
      // a die stops being pushed the moment it is called rested, so a pair that settled against
      // each other ends a whisker inside the exact sum. 2% of a radius is far below anything an eye
      // could find and far above the arithmetic; a die that genuinely came to rest *in* another
      // leaves a gap of a fraction of that.
      const touching = radius * 2 * 0.98;
      for (let i = 0; i < rest.length; i += 1) {
        for (let j = i + 1; j < rest.length; j += 1) {
          const gap = Math.hypot(rest[i]![0] - rest[j]![0], rest[i]![1] - rest[j]![1], rest[i]![2] - rest[j]![2]);
          expect(gap, `size ${size}, ${handful} dice: ${i} and ${j} came to rest inside each other`).toBeGreaterThan(touching);
        }
      }
    }
  });
});

describe("the shake", () => {
  const TRAY: TrayBox = { half: 0.42, floorY: 0 };

  /** A handful in the tray, laid out the way `begin` lays one out. */
  function handful(count: number, size: DiceSize = 2): { dice: DieState[]; landings: Quat[] } {
    const radius = dieRadius(count, TRAY, size);
    const edge = TRAY.half - radius;
    const cols = Math.max(1, Math.floor((2 * edge) / (radius * 2.1)) + 1);
    const spread = cols > 1 ? (2 * edge) / (cols - 1) : 0;
    const starts: DieStart[] = Array.from({ length: count }, (_, i) => {
      const slot = i % (cols * cols);
      const row = Math.floor(slot / cols);
      return {
        position: [cols > 1 ? -edge + (slot % cols) * spread : 0, radius + 0.1, cols > 1 ? edge - row * spread : 0] as Vec3,
        velocity: [0, 0, 0] as Vec3,
        spin: [5, 3, 7] as Vec3,
        radius,
        landing: faceUpQuaternion(normalize([0.2 + i * 0.1, 1, 0.3]), 0.4 + i),
      };
    });
    return { dice: starts.map(dieState), landings: starts.map((start) => start.landing) };
  }

  /** Shake a handful for `hold` seconds and let it settle, as the stage does. */
  function shaken(count: number, seed: number, hold: number, size: DiceSize = 2) {
    const { dice, landings } = handful(count, size);
    for (let step = 0; step < Math.round(hold / THROW_STEP); step += 1) {
      advanceShake(dice, TRAY, seed, step * THROW_STEP);
    }
    const moving = dice.map((die) => Math.hypot(...die.velocity));
    tipOut(dice, seed);
    return { path: settleFrom(dice, landings, TRAY), landings, moving, radius: dice[0]?.radius ?? 0 };
  }

  it("lands every die on its face however badly it was shaken", () => {
    // **The invariant the whole feature rests on, and the reason `settleFrom` was split out.** A
    // shake leaves the dice anywhere — fast, spinning, piled against a wall — and it is allowed to,
    // because where a die ends up says nothing. What it *shows* was decided before the shake began
    // and has to survive whatever the shake did. Checked exactly, not approximately.
    for (const count of [1, 3, 8, 20]) {
      for (const hold of [0.35, 1.0, 4.0, 10]) {
        const { path, landings } = shaken(count, 7, hold);
        path.frames.forEach((frames, i) => {
          const last = frames[frames.length - 1]!.quaternion;
          const landing = landings[i]!;
          // Quaternions are double-covered, so q and -q are the same orientation.
          const same = Math.abs(last[0] * landing[0] + last[1] * landing[1] + last[2] * landing[2] + last[3] * landing[3]);
          expect(same, `${count} dice, ${hold}s hold, die ${i}`).toBeCloseTo(1, 9);
        });
      }
    }
  });

  it("puts the dice somewhere different every time", () => {
    // **The complaint this feature exists for, asserted.** Twenty dice used to be dropped onto a
    // grid and stay on it, so every roll came to rest in the same five neat rows. A different seed
    // and a different hold have to move them somewhere else.
    for (const count of [1, 5, 20]) {
      const arrangements = [
        shaken(count, 11, 0.4).path,
        shaken(count, 12, 0.9).path,
        shaken(count, 13, 1.7).path,
      ].map((path) => path.frames.map((frames) => frames[frames.length - 1]!.position));
      for (let a = 1; a < arrangements.length; a += 1) {
        let furthest = 0;
        for (let i = 0; i < count; i += 1) {
          const now = arrangements[a]![i]!;
          const before = arrangements[a - 1]![i]!;
          furthest = Math.max(furthest, Math.hypot(now[0] - before[0], now[2] - before[2]));
        }
        expect(furthest, `${count} dice, roll ${a}`).toBeGreaterThan(TRAY.half * 0.25);
      }
    }
  });

  it("shakes the same handful the same way twice", () => {
    // A hold is a human length and never repeats, but *given* one it has to be arithmetic like
    // everything else here — a slow machine must not shake differently from a fast one.
    expect(shaken(6, 4, 1.3).path).toEqual(shaken(6, 4, 1.3).path);
  });

  it("keeps every die in the tray while it is being shaken", () => {
    const { dice } = handful(12);
    for (let step = 0; step < Math.round(10 / THROW_STEP); step += 1) {
      advanceShake(dice, TRAY, 3, step * THROW_STEP);
      for (const die of dice) {
        const edge = TRAY.half - die.radius;
        expect(Math.abs(die.position[0])).toBeLessThanOrEqual(edge + 1e-6);
        expect(Math.abs(die.position[2])).toBeLessThanOrEqual(edge + 1e-6);
        expect(die.position[1]).toBeGreaterThanOrEqual(TRAY.floorY + die.radius - 1e-6);
        expect(Number.isFinite(die.position[0] + die.position[1] + die.position[2])).toBe(true);
      }
    }
  });

  it("never lets a die fall asleep mid-shake", () => {
    // A die that stopped being agitated would sit in a corner while the rest of the handful moved,
    // which reads as one die having got stuck rather than as a tray being shaken.
    const { dice } = handful(10);
    for (let step = 0; step < Math.round(10 / THROW_STEP); step += 1) advanceShake(dice, TRAY, 5, step * THROW_STEP);
    for (const [i, die] of dice.entries()) {
      expect(die.restedAt, `die ${i}`).toBe(-1);
      expect(die.still, `die ${i}`).toBe(0);
    }
  });

  it("settles well inside the cap, at every size and handful", () => {
    // The shake used to leave dice stacked and moving, and a stacked die could not rest at all —
    // every one of those throws ran the full cap out and froze mid-motion. See REST_SPEED.
    for (const size of [1, 2, 3] as DiceSize[]) {
      for (const count of [1, 5, 20]) {
        for (const seed of [2, 9, 21]) {
          const { path } = shaken(count, seed, 0.35, size);
          expect(path.seconds, `size ${size}, ${count} dice, seed ${seed}`).toBeLessThan(THROW_CAP_SECONDS);
        }
      }
    }
  });

  it("leaves nothing overlapping when it has finished", () => {
    for (const count of [5, 20]) {
      const { path, radius } = shaken(count, 8, 1.2);
      const rest = path.frames.map((frames) => frames[frames.length - 1]!.position);
      for (let i = 0; i < rest.length; i += 1) {
        for (let j = i + 1; j < rest.length; j += 1) {
          const gap = Math.hypot(rest[i]![0] - rest[j]![0], rest[i]![1] - rest[j]![1], rest[i]![2] - rest[j]![2]);
          expect(gap, `${count} dice: ${i} and ${j}`).toBeGreaterThan(radius * 2 * 0.98);
        }
      }
    }
  });
});

describe("how hard the tray is shaken", () => {
  it("is bounded and finite, wherever in the shake you look", () => {
    for (let step = 0; step < 2000; step += 1) {
      const push = shakeAccel(step * THROW_STEP, 17);
      for (const axis of push) {
        expect(Number.isFinite(axis)).toBe(true);
        expect(Math.abs(axis)).toBeLessThanOrEqual(30);
      }
    }
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      for (const axis of shakeAccel(bad, 3)) expect(Number.isFinite(axis), `${bad}`).toBe(true);
    }
  });

  it("changes smoothly rather than in jerks", () => {
    // **Sampled raw it would be white noise**, which is a buzz rather than a shake, and a die would
    // be hit by an impulse every step instead of carried by a hand. The eased blend between beats is
    // what makes it read as somebody shaking a cup.
    let biggest = 0;
    for (let step = 1; step < 2000; step += 1) {
      const now = shakeAccel(step * THROW_STEP, 17);
      const before = shakeAccel((step - 1) * THROW_STEP, 17);
      biggest = Math.max(biggest, Math.hypot(now[0] - before[0], now[1] - before[1], now[2] - before[2]));
    }
    expect(biggest).toBeLessThan(6);
  });

  it("does not push one way for long, or the tray would only ever tip", () => {
    // Averaged over a shake it has to come out near nothing. A bias would be a tray tilted rather
    // than shaken, and every die would end up against the same wall on every roll.
    const total = [0, 0, 0];
    const steps = 4000;
    for (let step = 0; step < steps; step += 1) {
      const push = shakeAccel(step * THROW_STEP, 23);
      for (let axis = 0; axis < 3; axis += 1) total[axis]! += push[axis]!;
    }
    for (const axis of total) expect(Math.abs(axis / steps)).toBeLessThan(3);
  });

  it("shakes differently on a different seed", () => {
    const a = shakeAccel(0.5, 1);
    const b = shakeAccel(0.5, 2);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(0.5);
  });
});

describe("the throw", () => {
  const TRAY: TrayBox = { half: 0.4, floorY: 0 };
  /** DIE_RADIUS, kept in step by hand. A containment test at a size the app no longer draws would
   *  pass for ever while proving nothing about the dice anybody can see. */
  const RADIUS = 0.06;

  function start(i: number, landing = faceUpQuaternion(normalize([0.2, 1, 0.3]), 0.4)): DieStart {
    return {
      position: [(i % 3) * 0.05 - 0.05, 0.16 + (i % 3) * 0.13, 0.3],
      velocity: [(i % 2 === 0 ? 0.2 : -0.25), 0, -0.85],
      spin: [7 + i, 5 - i, 9 + i],
      radius: RADIUS,
      landing,
    };
  }

  it("brings every die to rest inside the cap", () => {
    // A die still moving when the tray is dismissed would have hung there for as long as it was up.
    for (let handful = 1; handful <= 8; handful += 1) {
      const path = simulateThrow(Array.from({ length: handful }, (_, i) => start(i)), TRAY);
      expect(path.seconds, `${handful} dice`).toBeLessThanOrEqual(THROW_CAP_SECONDS + THROW_STEP);
      expect(path.seconds, `${handful} dice`).toBeGreaterThan(0);
    }
  });

  it("never lets a die out of the tray", () => {
    const path = simulateThrow(Array.from({ length: 6 }, (_, i) => start(i)), TRAY);
    for (const die of path.frames) {
      for (const frame of die) {
        expect(Math.abs(frame.position[0])).toBeLessThanOrEqual(TRAY.half - RADIUS + 1e-6);
        expect(Math.abs(frame.position[2])).toBeLessThanOrEqual(TRAY.half - RADIUS + 1e-6);
        expect(frame.position[1]).toBeGreaterThanOrEqual(TRAY.floorY + RADIUS - 1e-6);
      }
    }
  });

  it("does not let a die thrown far too hard step through a wall", () => {
    // **The tunnelling case.** A fixed-step integrator that only turned a die round once it was
    // already past the wall would let a fast one cross the whole wall in a single tick and carry
    // on into the map. Thrown at forty times the normal speed, which no roll does and one bug would.
    const fast: DieStart = { ...start(0), velocity: [34, 0, -40], position: [0, 0.1, 0] };
    const path = simulateThrow([fast], TRAY);
    for (const frame of path.frames[0]!) {
      expect(Math.abs(frame.position[0])).toBeLessThanOrEqual(TRAY.half - RADIUS + 1e-6);
      expect(Math.abs(frame.position[2])).toBeLessThanOrEqual(TRAY.half - RADIUS + 1e-6);
    }
  });

  it("ends every die exactly on the face it was given", () => {
    // **The one thing here that could be quietly, permanently wrong**: a die that shows 4 when the
    // panel says 17. Not "close to" the landing orientation — the same one, to the bit.
    const landings = [
      faceUpQuaternion(normalize([1, 0, 0]), 0),
      faceUpQuaternion(normalize([0, -1, 0]), 2.2),
      faceUpQuaternion(normalize([-0.3, 0.5, 0.8]), 5),
    ];
    const path = simulateThrow(landings.map((landing, i) => start(i, landing)), TRAY);
    path.frames.forEach((die, i) => {
      expect(die[die.length - 1]!.quaternion, `die ${i}`).toEqual(landings[i]);
    });
  });

  it("shows the right face once it has stopped, not only on the last frame", () => {
    // The tray sits there after the throw. If only the final frame were correct, a die would settle
    // and then be read wrong for as long as anybody looked at it.
    const landing = faceUpQuaternion(normalize([0.4, 0.6, -0.7]), 1.1);
    const path = simulateThrow([start(0, landing)], TRAY);
    const settled = frameAt(path, 0, path.seconds + 5)!;
    expect(settled.quaternion).toEqual(landing);
  });

  it("actually bounces rather than dropping straight down", () => {
    // A die that fell and stopped is not a die in a tray. Measured as: after its first contact it
    // gets back off the floor.
    const path = simulateThrow([start(0)], TRAY);
    const heights = path.frames[0]!.map((frame) => frame.position[1]);
    const floor = TRAY.floorY + RADIUS;
    const firstTouch = heights.findIndex((y) => y <= floor + 1e-6);
    expect(firstTouch).toBeGreaterThan(0);
    expect(Math.max(...heights.slice(firstTouch))).toBeGreaterThan(floor + RADIUS * 0.2);
  });

  it("leaves no two dice resting inside each other", () => {
    // Without a push between them a handful thrown from one place falls down the same line and
    // comes to rest in the same spot, which reads as broken rather than as approximate.
    const path = simulateThrow(Array.from({ length: 6 }, (_, i) => start(i)), TRAY);
    const rest = path.frames.map((die) => die[die.length - 1]!.position);
    for (let i = 0; i < rest.length; i += 1) {
      for (let j = i + 1; j < rest.length; j += 1) {
        const apart = Math.hypot(rest[i]![0] - rest[j]![0], rest[i]![1] - rest[j]![1], rest[i]![2] - rest[j]![2]);
        expect(apart, `dice ${i} and ${j}`).toBeGreaterThan(RADIUS);
      }
    }
  });

  it("throws the same handful the same way twice", () => {
    const dice = Array.from({ length: 4 }, (_, i) => start(i));
    expect(simulateThrow(dice, TRAY)).toEqual(simulateThrow(dice, TRAY));
  });

  it("gives every die a frame for every step", () => {
    const path = simulateThrow(Array.from({ length: 3 }, (_, i) => start(i)), TRAY);
    const length = path.frames[0]!.length;
    for (const die of path.frames) expect(die.length).toBe(length);
    expect(path.seconds).toBeCloseTo(length * THROW_STEP, 9);
  });

  it("throws nothing without falling over", () => {
    const empty = simulateThrow([], TRAY);
    expect(empty.frames).toEqual([]);
    expect(frameAt(empty, 0, 1)).toBeUndefined();
  });

  it("clamps a lookup outside the throw rather than reading off the end", () => {
    const path = simulateThrow([start(0)], TRAY);
    const last = path.frames[0]![path.frames[0]!.length - 1];
    expect(frameAt(path, 0, -5)).toBe(path.frames[0]![0]);
    expect(frameAt(path, 0, 999)).toBe(last);
    expect(frameAt(path, 0, Number.NaN)).toBe(path.frames[0]![0]);
    expect(frameAt(path, 9, 0.1)).toBeUndefined();
  });
});

describe("percentileFaces", () => {
  /** What the two dice add up to, reading 00 + 0 as a hundred. */
  const shown = (rolled: number): number => {
    const [tens, units] = percentileFaces(rolled);
    const value = (tens - 1) * 10 + (units - 1);
    return value === 0 ? 100 : value;
  };

  it("shows the number that was rolled, all hundred of them", () => {
    // The one thing this has to do. A pair that disagreed with the total would be two dice on the
    // table saying something the panel does not.
    for (let n = 1; n <= 100; n += 1) expect(shown(n), `rolled ${n}`).toBe(n);
  });

  it("reads a double zero as a hundred", () => {
    // The one roll where neither die shows what it looks like it shows, and the only reason this
    // is a function rather than two divisions at the call site.
    expect(percentileFaces(100)).toEqual([1, 1]);
    expect(shown(100)).toBe(100);
  });

  it("puts both dice on faces a ten-sided die has", () => {
    for (let n = 1; n <= 100; n += 1) {
      for (const face of percentileFaces(n)) {
        expect(face).toBeGreaterThanOrEqual(1);
        expect(face).toBeLessThanOrEqual(10);
      }
    }
  });

  it("takes a roll from outside the die without leaving the die", () => {
    for (const bad of [0, -5, 137, Number.NaN, Number.POSITIVE_INFINITY]) {
      const [tens, units] = percentileFaces(bad);
      expect(tens, `${bad}`).toBeGreaterThanOrEqual(1);
      expect(tens, `${bad}`).toBeLessThanOrEqual(10);
      expect(units, `${bad}`).toBeGreaterThanOrEqual(1);
      expect(units, `${bad}`).toBeLessThanOrEqual(10);
    }
  });
});

describe("quatSlerp", () => {
  it("takes the short way round", () => {
    // Without the sign flip a die occasionally tumbles the long way for no reason anyone could
    // see — and lands correctly anyway, which makes it a bug nobody reports.
    const a: Quat = [0, 0, 0, 1];
    const b: Quat = [0, 0, 0, -1];
    const middle = quatSlerp(a, b, 0.5);
    expect(Math.abs(middle[3])).toBeCloseTo(1, 6);
  });

  it("is its endpoints at nought and one", () => {
    const a = faceUpQuaternion(normalize([1, 1, 0]), 0.3);
    const b = faceUpQuaternion(normalize([0, 0, 1]), 2.1);
    for (let i = 0; i < 4; i += 1) {
      expect(quatSlerp(a, b, 0)[i]).toBeCloseTo(a[i]!, 6);
      expect(quatSlerp(a, b, 1)[i]).toBeCloseTo(b[i]!, 6);
    }
  });

  it("stays a unit rotation the whole way", () => {
    const a = faceUpQuaternion(normalize([1, 0.3, 0.2]), 0);
    const b = faceUpQuaternion(normalize([-0.4, 1, 0.1]), 3);
    for (let t = 0; t <= 1; t += 0.05) {
      expect(Math.hypot(...quatSlerp(a, b, t))).toBeCloseTo(1, 6);
    }
  });
});

describe("laying a handful out", () => {
  it("never puts two dice inside each other, at any size or count", () => {
    for (const half of [0.42, 0.223]) {
      for (const radius of [0.06, 0.12, 0.18]) {
        const slots = Array.from({ length: 25 }, (_, i) => packSlot(i, half, radius));
        for (let i = 0; i < slots.length; i += 1) {
          for (let j = i + 1; j < slots.length; j += 1) {
            const a = slots[i]!;
            const b = slots[j]!;
            const gap = Math.hypot(a.x - b.x, a.z - b.z, (a.layer - b.layer) * radius * 2.1);
            expect(gap, `half ${half}, radius ${radius}, ${i} vs ${j}`).toBeGreaterThan(radius * 2);
          }
        }
      }
    }
  });

  it("keeps every die inside the box it is laid out in", () => {
    for (const half of [0.42, 0.223]) {
      for (const radius of [0.06, 0.12, 0.18]) {
        for (let i = 0; i < 30; i += 1) {
          const slot = packSlot(i, half, radius);
          expect(Math.abs(slot.x)).toBeLessThanOrEqual(Math.max(0, half - radius) + 1e-12);
          expect(Math.abs(slot.z)).toBeLessThanOrEqual(Math.max(0, half - radius) + 1e-12);
        }
      }
    }
  });

  it("gives a die too big for the box the middle of it rather than a negative slot", () => {
    // A single die at the largest setting in a cup barely wider than it is: `packColumns` has to
    // come out at one rather than at zero, or the layout divides by a gap that does not exist.
    expect(packColumns(0.19, 0.18)).toBe(1);
    expect(packSlot(0, 0.19, 0.18)).toMatchObject({ x: 0, z: 0, layer: 0 });
  });

  it("stands a handful still on the floor of its box", () => {
    const box: TrayBox = { half: 0.223, floorY: 0, ceilingY: 0.75 };
    const dice = Array.from({ length: 12 }, () => dieState({ position: [9, 9, 9], velocity: [3, 3, 3], spin: [0, 0, 0], radius: 0.07, landing: [0, 0, 0, 1] }));
    packInto(dice, box);
    for (const die of dice) {
      expect(Math.hypot(...die.velocity)).toBe(0);
      expect(die.position[1]).toBeGreaterThanOrEqual(box.floorY + die.radius - 1e-12);
      expect(die.position[1]).toBeLessThanOrEqual(box.ceilingY! - die.radius);
    }
  });
});

describe("a vessel that is not the tray", () => {
  const TRAY: TrayBox = { half: 0.42, floorY: 0 };
  /** A cup: round, a closed base, a mouth at the top, and gravity wherever it has been turned to. */
  const CUP: TrayBox = { half: 0.315, round: true, floorY: 0, ceilingY: 0.75 };

  /** Drop a handful into a vessel and let it come to rest. */
  function drop(box: TrayBox, from: number, count = 4): DieState[] {
    const dice = Array.from({ length: count }, (_, i) =>
      dieState({
        position: [0.04 * i - 0.06, from, 0.03 * i - 0.04] as Vec3,
        velocity: [0, 0, 0] as Vec3,
        spin: [2, 1, 3] as Vec3,
        radius: 0.07,
        landing: [0, 0, 0, 1] as Quat,
      }),
    );
    for (let step = 0; step < 400; step += 1) settleFrom(dice, dice.map(() => [0, 0, 0, 1] as Quat), box);
    return dice;
  }

  /** Shake a handful hard for a long time, and see where it ends up. */
  function rattle(box: TrayBox, seconds: number): DieState[] {
    const dice = Array.from({ length: 6 }, (_, i) =>
      dieState({ position: [0.05 * i - 0.1, 0.1, 0], velocity: [0, 0, 0], spin: [3, 1, 2], radius: 0.07, landing: [0, 0, 0, 1] }),
    );
    for (let step = 0; step < Math.round(seconds / THROW_STEP); step += 1) advanceShake(dice, box, 31, step * THROW_STEP);
    return dice;
  }

  it("leaves the tray exactly as it was", () => {
    // **A shared type gaining fields is how a change for one caller reaches another.** The tray sets
    // none of them, so its own path has to be identical to the byte — checked by running the same
    // throw through both and comparing every frame, rather than by reading the branch and agreeing
    // that it looks skipped.
    const starts: DieStart[] = Array.from({ length: 5 }, (_, i) => ({
      position: [0.1 * i - 0.2, 0.3, 0.2] as Vec3,
      velocity: [0.2, 0, -0.8] as Vec3,
      spin: [6, 2, 9] as Vec3,
      radius: 0.08,
      landing: faceUpQuaternion(normalize([0.1 * i, 1, 0.2]), i),
    }));
    const spelled = simulateThrow(starts, { ...TRAY, ceilingY: undefined, round: undefined, open: undefined, gravity: undefined });
    const plain = simulateThrow(starts, TRAY);
    expect(spelled.seconds).toBe(plain.seconds);
    expect(spelled.frames).toEqual(plain.frames);
  });

  it("keeps a ten-second shake inside a lidded cup", () => {
    // **The reason `ceilingY` exists.** A shake pumps speed in for as long as somebody holds the
    // button, and a container a fraction of a unit deep cannot hold that without a lid.
    for (const die of rattle(CUP, 10)) {
      expect(Math.hypot(die.position[0], die.position[2])).toBeLessThanOrEqual(CUP.half + 1e-9);
      expect(die.position[1]).toBeGreaterThanOrEqual(CUP.floorY - 1e-9);
      expect(die.position[1]).toBeLessThanOrEqual(CUP.ceilingY! + 1e-9);
    }
  });

  it("lets a die out of an open mouth and holds one under a lid", () => {
    const thrown = (): DieState =>
      dieState({ position: [0, 0.6, 0], velocity: [0, 4, 0], spin: [0, 0, 0], radius: 0.07, landing: [0, 0, 0, 1] });
    const highest = (box: TrayBox) =>
      Math.max(...settleFrom([thrown()], [[0, 0, 0, 1]], box).frames[0]!.map((frame) => frame.position[1]));
    expect(highest(CUP)).toBeLessThanOrEqual(CUP.ceilingY!);
    expect(highest({ ...CUP, open: true })).toBeGreaterThan(CUP.ceilingY!);
  });

  it("rests a die against the low side when the vessel is tipped", () => {
    // **The defect, as arithmetic.** Left along the vessel's own −Y, a die rides the closed end as
    // the cup turns over, as though the bottom of the cup were still the bottom of the world. Tipped
    // most of the way over, it should be at the mouth end and off the axis, not sitting on the base.
    const lean = Math.PI * 0.4;
    const tipped: TrayBox = { ...CUP, open: true, gravity: [Math.sin(lean), -Math.cos(lean), 0] };
    const [die] = drop(tipped, 0.4, 1);
    expect(die!.position[0], "pulled toward the low side").toBeGreaterThan(0.1);
    // And the same die in a vessel that thinks down is its own axis stays on the axis.
    const [straight] = drop({ ...CUP, open: true }, 0.4, 1);
    expect(Math.abs(straight!.position[0])).toBeLessThan(0.1);
  });

  it("keeps a round vessel round", () => {
    // A square clamp inscribed in the bore is the cheap way to be sure nothing ends up through the
    // wall, and it costs a die about fifteen per cent of the bore's width — it can never reach the
    // side. Fine while nobody could see in.
    const dice = Array.from({ length: 6 }, (_, i) =>
      dieState({ position: [0.05 * i - 0.1, 0.1, 0], velocity: [0, 0, 0], spin: [3, 1, 2], radius: 0.07, landing: [0, 0, 0, 1] }),
    );
    // Tracked across the whole shake rather than read off the end of it: where they finish is luck,
    // and the claim is that the wall is reachable at all.
    let closest = Infinity;
    for (let step = 0; step < Math.round(4 / THROW_STEP); step += 1) {
      advanceShake(dice, CUP, 31, step * THROW_STEP);
      for (const die of dice) {
        const out = Math.hypot(die.position[0], die.position[2]);
        closest = Math.min(closest, CUP.half - die.radius - out);
        expect(out).toBeLessThanOrEqual(CUP.half - die.radius + 1e-9);
      }
    }
    // Inscribed in the bore instead, a die's centre stops a good deal short of this.
    expect(closest, "nothing ever reached the wall").toBeLessThan(1e-6);
  });
});

describe("spilling out of a held vessel", () => {
  const TRAY: TrayBox = { half: 0.42, floorY: 0 };
  const HEIGHT = 0.75;
  const BORE = 0.315;

  /**
   * A tube that turns over above the middle of the tray, as the cup does.
   *
   * **Built here rather than imported from `cupMath`.** What is being checked is `settleFrom`'s
   * half of the bargain — that dice inside a vessel are simulated in its frame, drawn in the
   * world's, and handed over once when they pass its mouth — and a test that fetched the real cup
   * would be asking about the cup's particular motion instead.
   */
  function tube(steps: number): HeldIn {
    const at = (step: number): VesselAt => {
      const u = Math.min(1, step / steps);
      // Upright to fully over, mouth held above the felt.
      const angle = -Math.PI * u;
      const rotation: Quat = [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
      // High enough that the tube's base is above the felt while it is still upright — otherwise it
      // starts through the floor of the tray it is pouring into.
      const mouth: Vec3 = [0, 1, 0];
      const along = applyQuat([0, HEIGHT, 0], rotation);
      const position: Vec3 = [mouth[0] - along[0], mouth[1] - along[1], mouth[2] - along[2]];
      const down = applyQuat([0, -1, 0], [-rotation[0], -rotation[1], -rotation[2], rotation[3]]);
      return {
        box: { half: BORE, round: true, floorY: 0, ceilingY: HEIGHT, open: true, gravity: down },
        rotation,
        position,
        mouthY: HEIGHT,
        velocity: [0, 0, 0],
      };
    };
    return { inside: [], at, until: steps };
  }

  function loaded(count: number, radius: number): DieState[] {
    const dice = Array.from({ length: count }, () =>
      dieState({ position: [0, 0, 0] as Vec3, velocity: [0, 0, 0] as Vec3, spin: [3, 2, 5] as Vec3, radius, landing: [0, 0, 0, 1] as Quat }),
    );
    packInto(dice, { half: BORE, round: true, floorY: 0, ceilingY: HEIGHT });
    return dice;
  }

  function spill(count: number, radius: number, steps = 120) {
    const dice = loaded(count, radius);
    const landings: Quat[] = dice.map((_, i) => faceUpQuaternion(normalize([0.2 + i * 0.07, 1, 0.3]), i));
    const held = { ...tube(steps), inside: dice.map(() => true) };
    return { dice, landings, path: settleFrom(dice, landings, TRAY, held), held };
  }

  it("empties: every die is out by the time the vessel goes", () => {
    for (const [count, radius] of [[1, 0.18], [3, 0.12], [12, 0.07], [20, 0.06]] as const) {
      const { dice } = spill(count, radius);
      for (const [i, die] of dice.entries()) {
        // Out means in the tray, which is where the world's floor is. Nothing is left in a tube that
        // is about to stop existing.
        expect(die.position[1], `${count} dice of ${radius}, die ${i}`).toBeLessThan(0.4);
      }
    }
  });

  it("puts every die inside the tray, and never through a wall", () => {
    for (const [count, radius] of [[1, 0.18], [3, 0.12], [12, 0.07], [20, 0.06]] as const) {
      const { path } = spill(count, radius);
      path.frames.forEach((frames, i) => {
        for (const [step, frame] of frames.entries()) {
          const label = `${count} dice of ${radius}, die ${i} at step ${step}`;
          // Never below the felt, and never outside the tray once it is low enough to be in it.
          expect(frame.position[1], label).toBeGreaterThan(-1e-6);
          if (frame.position[1] < 0.3) {
            expect(Math.abs(frame.position[0]), label).toBeLessThanOrEqual(TRAY.half + 1e-6);
            expect(Math.abs(frame.position[2]), label).toBeLessThanOrEqual(TRAY.half + 1e-6);
          }
        }
      });
    }
  });

  it("lands every die on its face, however it came out", () => {
    // **The invariant, through the longest path it has ever taken.** The bake now spans the slide
    // inside the vessel, each die's exit, and the settle on the felt — and the final orientation
    // still has to be the landing exactly.
    for (const [count, radius] of [[1, 0.18], [8, 0.09], [20, 0.06]] as const) {
      const { path, landings } = spill(count, radius);
      path.frames.forEach((frames, i) => {
        const last = frames[frames.length - 1]!.quaternion;
        const landing = landings[i]!;
        const same = Math.abs(last[0] * landing[0] + last[1] * landing[1] + last[2] * landing[2] + last[3] * landing[3]);
        expect(same, `${count} dice, die ${i}`).toBeCloseTo(1, 9);
      });
    }
  });

  it("shows them inside the vessel before they leave it", () => {
    // The frames are in the world throughout, so a die still in the tube is drawn wherever the tube
    // is holding it — which is the whole of what it takes to see them in there. Early on that is
    // well above the felt and around the axis the tube is standing on.
    // The tube stands with its base a quarter of a unit above the felt, so a die resting on that
    // base starts higher than anything could be if it were already in the tray.
    const { path } = spill(6, 0.07);
    for (const frames of path.frames) {
      expect(frames[0]!.position[1], "still up in the tube").toBeGreaterThan(0.3);
    }
  });

  it("brings them out in the order they were stacked", () => {
    // Nearest the mouth is highest in an upright tube, and highest leaves first. This is the whole
    // of what a long hold buys, and it is now a consequence of the physics rather than a sort.
    const { dice, path } = spill(12, 0.07);
    const depth = dice.map((_, i) => path.frames[i]![0]!.position[1]);
    const landed = dice.map((_, i) => path.frames[i]!.findIndex((frame) => frame.position[1] < 0.25));
    const order = dice.map((_, i) => i).sort((a, b) => depth[b]! - depth[a]!);
    // Not strictly — they knock each other about on the way — but the top half should be out first.
    const early = order.slice(0, 6).reduce((sum, i) => sum + landed[i]!, 0);
    const late = order.slice(6).reduce((sum, i) => sum + landed[i]!, 0);
    expect(early).toBeLessThan(late);
  });

  it("is the same spill twice", () => {
    const a = spill(8, 0.08).path;
    const b = spill(8, 0.08).path;
    expect(a.frames).toEqual(b.frames);
  });
});

describe("when the clatter is heard", () => {
  const TRAY: TrayBox = { half: 0.42, floorY: 0 };
  const radii = (starts: readonly DieStart[]) => starts.map((start) => start.radius);

  it("is the first moment a die reaches the felt", () => {
    // The recordings are dice *landing*, so the cue is the landing rather than the moment the cup
    // tips — which is most of a second earlier and would put the first clatter before anything had
    // hit anything.
    const start: DieStart = { position: [0, 0.5, 0], velocity: [0, 0, 0], spin: [0, 0, 0], radius: 0.06, landing: [0, 0, 0, 1] };
    const path = simulateThrow([start], TRAY);
    const seconds = firstContactSeconds(path, TRAY, radii([start]));
    // Dropped from 0.5 onto a die of radius 0.06: `t = sqrt(2 * 0.44 / 9)` under this gravity.
    expect(seconds).toBeCloseTo(Math.sqrt((2 * 0.44) / 9), 2);
    const frames = path.frames[0]!;
    const at = Math.round(seconds / THROW_STEP);
    expect(frames[at]!.position[1]).toBeLessThanOrEqual(TRAY.floorY + start.radius + 1e-6);
    expect(frames[at - 1]!.position[1]).toBeGreaterThan(TRAY.floorY + start.radius + 1e-6);
  });

  it("is not fooled by a die that stops falling without landing", () => {
    // **The defect this replaced.** "The first frame its height turns round" was right while a throw
    // was nothing but a fall. It stopped being right the moment a throw began inside a cup: a die
    // sitting in one that is being turned over rises and falls with it, several times, long before
    // it is near the tray. Measured, the old rule fired within a hundredth of a second of the release
    // against dice that landed more than a second later.
    //
    // Here that is a die lobbed upward: it stops falling at the top of its arc and again at every
    // bounce, and only one of those is the landing.
    const lobbed: DieStart = { position: [0, 0.2, 0], velocity: [0, 2, 0], spin: [0, 0, 0], radius: 0.06, landing: [0, 0, 0, 1] };
    const path = simulateThrow([lobbed], TRAY);
    const seconds = firstContactSeconds(path, TRAY, radii([lobbed]));
    const apex = Math.max(...path.frames[0]!.map((frame) => frame.position[1]));
    expect(apex, "it really did go up first").toBeGreaterThan(0.4);
    // Up from 0.2 at 2 and back down to 0.06 takes well over a third of a second under this gravity.
    expect(seconds).toBeGreaterThan(0.35);
  });

  it("takes the earliest of the handful, not the first die listed", () => {
    const high: DieStart = { position: [-0.2, 0.6, 0], velocity: [0, 0, 0], spin: [0, 0, 0], radius: 0.06, landing: [0, 0, 0, 1] };
    const low: DieStart = { position: [0.2, 0.2, 0], velocity: [0, 0, 0], spin: [0, 0, 0], radius: 0.06, landing: [0, 0, 0, 1] };
    expect(firstContactSeconds(simulateThrow([high, low], TRAY), TRAY, radii([high, low]))).toBeLessThan(
      firstContactSeconds(simulateThrow([high], TRAY), TRAY, radii([high])),
    );
  });

  it("measures each die against its own size", () => {
    // A die at the largest setting rests on the felt with its centre three times as high as a small
    // one, so it has less far to fall and lands sooner. One shared threshold would report it as
    // still in the air.
    const at = (radius: number) => {
      const die: DieStart = { position: [0, 0.5, 0], velocity: [0, 0, 0], spin: [0, 0, 0], radius, landing: [0, 0, 0, 1] };
      return firstContactSeconds(simulateThrow([die], TRAY), TRAY, radii([die]));
    };
    // Falling `0.5 - radius` under this gravity, resolved to whichever step it happened on.
    for (const radius of [0.06, 0.12, 0.18]) {
      expect(Math.abs(at(radius) - Math.sqrt((2 * (0.5 - radius)) / 9)), `radius ${radius}`).toBeLessThan(2 * THROW_STEP);
    }
    expect(at(0.18)).toBeLessThan(at(0.06));
  });

  it("is immediate for a handful that was never in the air", () => {
    // Already on the felt, so there is no landing to wait for and the sound belongs now.
    const flat: DieStart = { position: [0, 0.06, 0], velocity: [0, 0, 0], spin: [0, 0, 0], radius: 0.06, landing: [0, 0, 0, 1] };
    expect(firstContactSeconds(simulateThrow([flat], TRAY), TRAY, radii([flat]))).toBe(0);
  });
});

describe("every contact, which is what the clatter is made of", () => {
  const TRAY: TrayBox = { half: 0.42, floorY: 0 };
  const radii = (starts: readonly DieStart[]) => starts.map((start) => start.radius);
  const drop = (height: number, radius = 0.06, x = 0): DieStart => ({
    position: [x, height, 0],
    velocity: [0, 0, 0],
    spin: [0, 0, 0],
    radius,
    landing: [0, 0, 0, 1],
  });

  it("reports one per bounce, not one per step spent on the felt", () => {
    // **A crossing, not a state.** A die is below the felt line for hundreds of steps once it has
    // stopped, and it arrived once. Counted as a state this would be several hundred sounds, which
    // is the version of this that would have had to be capped.
    const die = drop(0.5);
    const path = simulateThrow([die], TRAY);
    const contacts = contactsIn(path, TRAY, radii([die]));
    expect(contacts.length).toBeGreaterThan(1);
    expect(contacts.length).toBeLessThan(8);
    // Bounces, so strictly increasing in time with real gaps between them rather than adjacent steps.
    for (let i = 1; i < contacts.length; i += 1) {
      expect(contacts[i]!.seconds - contacts[i - 1]!.seconds, `gap ${i}`).toBeGreaterThan(THROW_STEP * 2);
    }
  });

  it("hits softer every time, by about the restitution", () => {
    // What the sound is scaled by. A die keeps 0.42 of its downward speed per bounce, so if this
    // came back flat the fourth bounce would play as loud as the first.
    const die = drop(0.5);
    const contacts = contactsIn(simulateThrow([die], TRAY), TRAY, radii([die]));
    for (let i = 1; i < contacts.length; i += 1) {
      expect(contacts[i]!.speed, `bounce ${i}`).toBeLessThan(contacts[i - 1]!.speed);
    }
    expect(contacts[0]!.speed, "the first landing is a real fall").toBeGreaterThan(1);
  });

  it("measures the fall rather than the step it was clamped on", () => {
    // **The defect this was written around.** `advanceDie` pushes a die that would have gone through
    // the felt back onto it, so the drop recorded *on* the landing step is however far it had left
    // to fall — which for one that crossed the line by a hair is near zero however fast it was
    // going. Two dice falling from the same height must land at the same speed whatever fraction of
    // a step they happen to cross on; measured on the landing step they differ by a factor of ten.
    const high = contactsIn(simulateThrow([drop(0.5)], TRAY), TRAY, [0.06])[0]!;
    const nudged = contactsIn(simulateThrow([drop(0.5001)], TRAY), TRAY, [0.06])[0]!;
    expect(nudged.speed).toBeCloseTo(high.speed, 1);
    // And it is the speed a fall of that height actually reaches: sqrt(2 * 9 * 0.44).
    expect(high.speed).toBeCloseTo(Math.sqrt(2 * 9 * 0.44), 0);
  });

  it("interleaves the dice rather than grouping them", () => {
    // It is a running order for a sound. Grouped by die, a handful would play as one die's whole
    // bouncing life, then the next one's.
    const dice = [drop(0.5, 0.06, -0.2), drop(0.2, 0.06, 0), drop(0.8, 0.06, 0.2)];
    const contacts = contactsIn(simulateThrow(dice, TRAY), TRAY, radii(dice));
    for (let i = 1; i < contacts.length; i += 1) {
      expect(contacts[i]!.seconds).toBeGreaterThanOrEqual(contacts[i - 1]!.seconds);
    }
  });

  it("reports nothing for a handful that was never in the air", () => {
    // The same throw `firstContactSeconds` answers 0 for, and it answers it because there are no
    // contacts rather than in spite of them.
    const flat = drop(0.06);
    const path = simulateThrow([flat], TRAY);
    expect(contactsIn(path, TRAY, radii([flat]))).toEqual([]);
    expect(firstContactSeconds(path, TRAY, radii([flat]))).toBe(0);
  });

  it("stays a handful of sounds rather than a machine gun", () => {
    // **The measurement the decision not to cap rests on.** Ten dice, thrown properly. If this ever
    // comes back in the hundreds then something upstream is wrong, and a cap here would have hidden
    // it rather than shown it.
    const dice = Array.from({ length: 10 }, (_, i) => drop(0.4 + (i % 3) * 0.1, 0.05, -0.3 + i * 0.06));
    const contacts = contactsIn(simulateThrow(dice, TRAY), TRAY, radii(dice));
    expect(contacts.length).toBeGreaterThan(10);
    expect(contacts.length).toBeLessThan(120);
  });
});

describe("framing two boxes at once", () => {
  const TRAY: readonly [Vec3, Vec3] = [[-0.512, -0.059, -0.512], [0.512, 0.095, 0.512]];
  /** Tall, narrow, and only ever over the middle — the cup. */
  const CUP: readonly [Vec3, Vec3] = [[-0.32, 0, -0.32], [0.32, 1.2, 0.32]];

  function fused(a: readonly [Vec3, Vec3], b: readonly [Vec3, Vec3]): readonly [Vec3, Vec3] {
    const axes = [0, 1, 2] as const;
    return [
      axes.map((i) => Math.min(a[0][i], b[0][i])) as unknown as Vec3,
      axes.map((i) => Math.max(a[1][i], b[1][i])) as unknown as Vec3,
    ];
  }

  it("is tighter than framing their fused bounding box", () => {
    // **The reason `orthoFramingOf` is not just `orthoFraming` twice.** Fused, the two make a box
    // with a corner where a tall cup stands at the far rim of the tray — a place nothing ever is —
    // and at this elevation that phantom corner is the highest point in the picture and sets the
    // whole frame around it.
    const apart = orthoFramingOf([TRAY, CUP], 70, 1.06, 0.009, 1);
    const together = orthoFramingOf([fused(TRAY, CUP)], 70, 1.06, 0.009, 1);
    expect(apart.halfWidth).toBeLessThan(together.halfWidth);
    expect(apart.halfHeight).toBeLessThan(together.halfHeight);
  });

  it("still contains every corner of every box", () => {
    // Tighter must not mean clipped, which is the one thing this whole family of functions is for.
    const fit = orthoFramingOf([TRAY, CUP], 70, 1.06, 0.009, 1);
    const elevation = (70 * Math.PI) / 180;
    const right: Vec3 = [1, 0, 0];
    const up: Vec3 = [0, Math.cos(elevation), -Math.sin(elevation)];
    for (const [min, max] of [TRAY, CUP]) {
      for (const x of [min[0], max[0]]) {
        for (const y of [min[1], max[1]]) {
          for (const z of [min[2], max[2]]) {
            const h = x * right[0] + y * right[1] + z * right[2];
            const v = x * up[0] + y * up[1] + z * up[2];
            expect(Math.abs(h - fit.offsetRight)).toBeLessThanOrEqual(fit.halfWidth + 1e-9);
            expect(Math.abs(v - fit.offsetUp)).toBeLessThanOrEqual(fit.halfHeight + 1e-9);
          }
        }
      }
    }
  });

  it("agrees with the one-box call it stands behind", () => {
    const one = orthoFraming(TRAY[0], TRAY[1], 70, 1.06, 0.009, 1);
    expect(orthoFramingOf([TRAY], 70, 1.06, 0.009, 1)).toEqual(one);
  });

  it("frames a unit box rather than returning NaN when given nothing", () => {
    // A frustum of NaN takes the whole tray off screen with nothing at all to say why.
    const fit = orthoFramingOf([], 70, 1.06, 0.009, 1);
    expect(Number.isFinite(fit.halfWidth)).toBe(true);
    expect(Number.isFinite(fit.halfHeight)).toBe(true);
  });
});
