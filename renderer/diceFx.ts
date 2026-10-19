import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cellNoise } from "../schema/noise.js";
import {
  DIE_RADIUS_MIN,
  NUMBER_LIFT,
  NUMBER_SIZE,
  dieRadius,
  facePlacements,
  faceUpQuaternion,
  faceUps,
  advanceShake,
  dieState,
  contactsIn,
  frameAt,
  numberUps,
  packColumns,
  packInto,
  packSlot,
  applyQuat,
  quatMultiply,
  settleFrom,
  tipOut,
  orthoFramingOf,
  percentileFaces,
  simulateThrow,
  THROW_STEP,
  vertexUps,
  type DiceSize,
  type DieState,
  type DieStart,
  type Framing,
  type Quat,
  type FacePlacement,
  type ThrowPath,
  type TrayBox,
  type Vec3,
} from "./diceMath.js";
import {
  CUP_SCALE,
  advanceCup,
  cupBox,
  cupEnvelope,
  cupOpacity,
  cupState,
  cupTransform,
  pourFrom,
  releaseCup,
  shakeEnergy,
  shakeReversed,
  shakeSecondsOf,
  type CupPose,
  type CupState,
} from "./cupMath.js";
import { DiceAudio } from "./diceAudio.js";

// The dice you can see, over the roll that has already happened.
//
// **A file of its own, like waterFx.** Everything here needs a GL context so none of it can be
// tested, which is exactly why it should be as small as possible and hold no decisions: the
// decisions — which face is which, where a die is partway through its throw, what orientation shows
// a given number — are all in renderer/diceMath.ts, which is pure and covered. What is left is
// geometry, a canvas texture, and writing transforms.
//
// Nothing here rolls anything. It is handed faces that engine/tray.ts already chose.

/**
 * The tray's interior, measured off the model — see demo/public/models/custom/README.md.
 *
 * The walls' inner faces are at ±0.4249; this is a hair inside that, so a die clamped to
 * `half - radius` is against the wall rather than in it. The model is lifted to put the felt at the
 * origin, and these are the numbers in the model's own frame, which is what the lift is from.
 */
const TRAY: TrayBox = { half: 0.42, floorY: 0 };
/**
 * Where the felt sits in the model's own frame, before it is lifted.
 *
 * **Read off the `felt_pad` node's matrix, not off its mesh**, which is a flat pad sitting at zero
 * in its own space and lifted onto the base by its transform. Measuring the mesh gives 0 and puts
 * every die a base's thickness below the surface it is supposed to land on.
 */
const TRAY_FELT_Y = 0.047;

/**
 * The radius the geometry is *built* at, which is no longer the size it is drawn at.
 *
 * **A die's real size is decided per throw** — see `dieRadius`, which gives a small handful up to
 * three times this and a large one exactly this. The solids and their number quads are still made
 * once per die kind and cached, because the difference between one handful and the next is a
 * uniform scale, and rebuilding a geometry to multiply it by a number would throw the cache away
 * for nothing.
 *
 * So this is the unit the cache is in, and `begin` scales each die's group by `radius / this`.
 */
const DIE_BUILD_RADIUS = DIE_RADIUS_MIN;
/**
 * How much clear air a die is dropped from, above its own resting height.
 *
 * **Above its own height, not an absolute** — a die can be three times bigger on one throw than
 * the next, and a fixed 0.16 that read as a short drop for a small die was most of the way up the
 * frame for a big one.
 */
const DROP_CLEAR = 0.1;
/** How hard they are thrown across the tray, and how much that varies. */
const THROW_SPEED = 0.85;
const SPREAD_SPEED = 0.45;
/** Radians per second of free tumble, at most. */
const TUMBLE_RATE = 14;
/**
 * How the tray is framed.
 *
 * **Orthographic and fitted, rather than a camera position picked by eye.** See `orthoFraming`,
 * which is where the arithmetic and the reasoning live; these are the three numbers it takes.
 * Square-on, so the unit-square tray fills a square canvas with almost nothing wasted — turned 45°
 * it would be a diamond 1.41 wide and would draw about a third smaller in the same box.
 *
 * Steep, at 70°, which matters more now the dice are large: a die stands proud of this tray's
 * shallow rim at every setting above the smallest, and the further over it you are looking the less
 * that reads as a die sitting *on* the tray rather than in it. It also puts a resting face closer
 * to square-on to the camera.
 */
const CAMERA_ELEVATION_DEG = 70;
const FRAME_MARGIN = 1.06;
/**
 * A little room above the rim, for a die that comes to rest on top of another one at the far side.
 *
 * **Deliberately the amount that is free, and that amount depends on both the elevation and the
 * model.** Squaring the frustum to the square canvas widens the vertical for nothing up to a point;
 * past it, headroom starts growing the frame and shrinking every die in it. This has now been
 * re-derived three times — 0.07 at 60° with the old tray, 0.015 at 70°, and 0.009 for this one,
 * whose 1.024 footprint and shallower walls leave less of a gap between the two extents. Anything
 * above it is a straight tax: 0.06 here would cost 5% of every die.
 *
 * Nothing needs more. Dice arrive over the *near* rim, which at this angle projects to the bottom
 * of the frame rather than off the top of it, and the tallest thing that can happen — a die at the
 * largest setting resting on another against the far wall — stays well inside.
 */
const FRAME_HEADROOM = 0.009;
/**
 * The tray's own extent, for the one frame drawn before the model has loaded.
 *
 * Superseded by the real bounds in `ready()`. These are the README's measurements, in the model's
 * frame *after* the lift that puts the felt at zero.
 */
const NOMINAL_MIN: Vec3 = [-0.512, -0.059, -0.512];
const NOMINAL_MAX: Vec3 = [0.512, 0.095, 0.512];
/** Scratch, so measuring the canvas every re-fit allocates nothing. */
const SIZE = new THREE.Vector2();
/**
 * A soft fill from below the camera, so the felt is not a flat sheet of one colour.
 *
 * **This replaces a green point light, and the reason it is gone is worth keeping.** The tray this
 * app used to load shipped a `__runelight` inside it — the glow on its rim was that light plus an
 * emissive texture — so when vendoring started stripping punctual lights from every model, the
 * renderer put an equivalent back rather than silently changing how the model looked.
 *
 * `dice_tray_minimal.glb` has no runes, no emissive and no light of its own. Keeping that code
 * would not have been faithful to anything; it would just have been a green hotspot in the middle
 * of black wood.
 */
const FILL_COLOR = 0xbfd0e0;
const FILL_INTENSITY = 0.55;
/** How wide a d4's three-to-a-number corner marks are, as a share of the room on the face they share. */
const CORNER_SIZE = 0.38;
/** How far from the middle of a face toward its corner a d4's mark sits. */
const CORNER_PULL = 0.5;

/**
 * The shortest a shake can be, however briefly the button was pressed.
 *
 * A click is a press and a release a few milliseconds apart, and dice that appeared already at rest
 * would not read as a throw at all. Everybody gets at least this much rattle — including keyboard
 * users, for whom Enter is exactly that click.
 */
export const MIN_SHAKE = 0.35;
/** How long a shake may run before the tray throws them for you. */
export const SHAKE_LIMIT = 10;

/** cellNoise streams for the throw. The renderer's block runs 911–931; these sit above it. */
const THROW_SALT = 1229;
const SPIN_SALT = 1231;

/**
 * How long the frame takes to widen for the cup and to close back on the tray.
 *
 * **The camera pulls back while the cup is up and returns for the read**, which is the whole reason
 * the dice can stay the size three rounds of work made them. Framed for both at once, every die
 * would draw about fifteen per cent smaller for ever — including on the throws where there is no cup
 * involved at all. Framed only for the tray, the shake somebody is holding a button for would happen
 * mostly above the top of the picture.
 *
 * Long enough to read as a camera move rather than a cut, short enough to be finished before there
 * is anything to look at.
 */
const FRAME_EASE = 0.35;

/**
 * Slots in the digit atlas, so a texture is built once per die kind rather than per die.
 *
 * A number quad is drawn about 45 CSS pixels across now, which is 90 device pixels at the ratio
 * most screens report — 96 was already being asked to stretch.
 */
const ATLAS_CELL = 128;

export type DieKind = 4 | 6 | 8 | 10 | 12 | 20;

/** How the digits are drawn into the atlas. */
export interface NumberStyle {
  /** Height of a one-character label, as a share of the atlas cell. */
  face: number;
  /** The same for a two-character one, so "00" and "7" fill the same width. */
  wide: number;
  /** A dark outline behind the digit, as a share of the cell. 0 for none. */
  stroke: number;
  fill: string;
  outline: string;
}

/**
 * The three the preview page compares — `demo/dice-angles.html`.
 *
 * **`outlined` is the one the app uses.** A dark die sits on green felt and catches its bounce, so
 * a cream digit with nothing behind it has to win against whatever the face happens to be doing. A
 * dark outline is the cheapest way to make a number legible against a background you do not
 * control, and it costs one `strokeText`.
 */
export const NUMBER_STYLES: Readonly<Record<"plain" | "bold" | "outlined", NumberStyle>> = {
  plain: { face: 0.72, wide: 0.5, stroke: 0, fill: "#f4ead8", outline: "#1a0f10" },
  bold: { face: 0.86, wide: 0.6, stroke: 0, fill: "#f8f0e2", outline: "#1a0f10" },
  outlined: { face: 0.86, wide: 0.6, stroke: 0.09, fill: "#f8f0e2", outline: "#1a0f10" },
};

/** What a DiceStage may be told to do differently. The preview page is the only caller that does. */
export interface DiceStageOptions {
  /** Degrees above the horizon the tray is viewed from. */
  elevationDeg?: number;
  numberStyle?: NumberStyle;
  /**
   * The cup, if there is to be one.
   *
   * Optional because the workbench page compares angles and number styles, and a two-second cup
   * animation in front of every comparison would be answering a different question. Left out, a
   * shake is what it was before the cup existed: the dice rattle around the tray itself.
   */
  cupUrl?: string;
}

/**
 * The shapes, and how they are read.
 *
 * `d100` is not here, and that is the interesting entry. There is no hundred-sided solid — a
 * percentile roll is shown on **two** ten-sided dice, one marked in tens. The engine still rolls a
 * single number from 1 to 100, because that is the honest distribution and `rollDie` already gives
 * it; this file only takes that number apart to decide what the two dice show. One roll, two dice,
 * and no chance of the pair disagreeing with the total.
 */
export function solidFor(kind: DieKind): THREE.BufferGeometry {
  switch (kind) {
    case 4:
      return new THREE.TetrahedronGeometry(DIE_BUILD_RADIUS);
    case 6:
      return new THREE.BoxGeometry(DIE_BUILD_RADIUS * 1.2, DIE_BUILD_RADIUS * 1.2, DIE_BUILD_RADIUS * 1.2).toNonIndexed();
    case 8:
      return new THREE.OctahedronGeometry(DIE_BUILD_RADIUS);
    case 12:
      return new THREE.DodecahedronGeometry(DIE_BUILD_RADIUS);
    case 20:
      return new THREE.IcosahedronGeometry(DIE_BUILD_RADIUS);
    case 10:
      return trapezohedron(DIE_BUILD_RADIUS);
  }
}

/**
 * The ten-sided die: a pentagonal trapezohedron, the one shape three.js does not ship.
 *
 * Two apexes and ten vertices in a zig-zag ring, cut into ten kites. **The apex height is derived
 * rather than eyeballed**, because a kite whose four corners are not coplanar is two triangles with
 * two different normals — and `faceUps` groups triangles by normal, so a d10 built by eye would
 * come back with twenty faces and get numbered to twenty. Solving for the plane through the apex
 * and one kite's two wings gives `h = m (1 + cos36) / (1 - cos36)`, and everything else follows.
 */
export function trapezohedron(radius: number): THREE.BufferGeometry {
  const cos36 = Math.cos(Math.PI / 5);
  const waist = 0.105;
  const apex = (waist * (1 + cos36)) / (1 - cos36);
  const ring: Vec3[] = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = (i * Math.PI) / 5;
    ring.push([Math.cos(angle), i % 2 === 1 ? waist : -waist, Math.sin(angle)]);
  }
  const top: Vec3 = [0, apex, 0];
  const bottom: Vec3 = [0, -apex, 0];
  const points: number[] = [];
  const push = (...vs: Vec3[]) => {
    for (const v of vs) points.push(v[0] * radius, v[1] * radius, v[2] * radius);
  };
  for (let k = 0; k < 5; k += 1) {
    // Upper kite: the apex, a far point on the lower ring, and the two upper points either side.
    const far = ring[(2 * k) % 10]!;
    push(top, ring[(2 * k + 9) % 10]!, far);
    push(top, far, ring[(2 * k + 1) % 10]!);
    // And its mirror below, around an upper far point.
    const under = ring[(2 * k + 1) % 10]!;
    push(bottom, under, ring[(2 * k) % 10]!);
    push(bottom, ring[(2 * k + 2) % 10]!, under);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Which of a ten-sided die's three jobs this one is doing.
 *
 * The only solid that appears more than once. A d100 is two of them — one counting tens, one
 * counting units — and neither is marked the way a d10 thrown on its own is.
 */
export type LabelRole = "plain" | "tens" | "units";

/**
 * What each face of a die is marked with, in face order.
 *
 * **The rule is the same for every die and every role: roll `v` is drawn on index `v - 1`.** It was
 * not, and a d10 spent its whole life showing one less than it rolled. The list ran `0…9`, so index
 * 8 carried an `8` where every other die's index 8 carries a `9`; `ups[roll - 1]` then put that
 * under the player's nose while the panel printed the roll.
 *
 * The d100 hid it. `percentileFaces` returns `[floor(n/10) + 1, (n%10) + 1]` — it adds one to turn a
 * 0-based digit into a 1-based index — and that cancelled the off-by-one exactly. One path
 * compensated for the bug and the other did not, so a percentile roll read correctly all along and
 * a plain d10 never did.
 *
 * **A ten is drawn as a zero**, which is the convention and the reason `plain` ends on `0` rather
 * than starting on it. Read that way, opposite faces sum to eleven like every other die's — the
 * pairs are (1,10), (2,9), (3,8), (4,7), (5,6) — which puts a zero opposite a one.
 */
export function labelsFor(kind: DieKind, role: LabelRole): string[] {
  if (kind !== 10) return Array.from({ length: kind }, (_, i) => `${i + 1}`);
  // Tens and units are digits of a number rather than a die's own reading, so they start at zero.
  if (role === "tens") return Array.from({ length: 10 }, (_, i) => `${i * 10}`.padStart(2, "0"));
  if (role === "units") return Array.from({ length: 10 }, (_, i) => `${i}`);
  return Array.from({ length: 10 }, (_, i) => `${(i + 1) % 10}`);
}

/**
 * One texture holding every number a die kind carries, in a grid.
 *
 * The alternative is a material per face, which for a d20 is twenty materials and twenty draw
 * calls for one die. An atlas plus one mesh of quads is two draws for a whole die however many
 * sides it has, and it is the arrangement every other texture in this renderer already uses.
 */
function numberAtlas(labels: readonly string[], style: NumberStyle): THREE.CanvasTexture {
  const columns = Math.ceil(Math.sqrt(labels.length));
  const rows = Math.ceil(labels.length / columns);
  const canvas = document.createElement("canvas");
  canvas.width = columns * ATLAS_CELL;
  canvas.height = rows * ATLAS_CELL;
  const context = canvas.getContext("2d")!;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = style.fill;
  context.strokeStyle = style.outline;
  context.lineJoin = "round";
  labels.forEach((label, i) => {
    const x = (i % columns) * ATLAS_CELL + ATLAS_CELL / 2;
    const y = Math.floor(i / columns) * ATLAS_CELL + ATLAS_CELL / 2;
    // Sized to the label so "00" and "7" fill the same width — a two-character face drawn at the
    // one-character size reads as a smaller number rather than as a wider one.
    context.font = `bold ${Math.round(ATLAS_CELL * (label.length > 1 ? style.wide : style.face))}px sans-serif`;
    // The outline goes down first and the fill covers its inner half, so the digit keeps its
    // drawn weight instead of being thinned by a line laid over the top of it.
    if (style.stroke > 0) {
      context.lineWidth = ATLAS_CELL * style.stroke;
      context.strokeText(label, x, y);
    }
    context.fillText(label, x, y);
    // The bar that keeps a 6 from being a 9, which is the one piece of dice typography that is
    // not decoration.
    if (label === "6" || label === "9") {
      const bar = [x - ATLAS_CELL * 0.16, y + ATLAS_CELL * 0.3, ATLAS_CELL * 0.32, ATLAS_CELL * 0.055] as const;
      if (style.stroke > 0) {
        context.lineWidth = ATLAS_CELL * style.stroke;
        context.strokeRect(...bar);
      }
      context.fillRect(...bar);
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Where one number is written: which label it is, and the patch of surface it goes on. */
export interface NumberSpot {
  /** Index into the label list, so the quad picks up the right cell of the atlas. */
  index: number;
  centre: THREE.Vector3;
  normal: THREE.Vector3;
  /**
   * Which way is up for this number, lying in the face.
   *
   * **Carried rather than worked out where the quad is built**, because only the caller knows what
   * the number is written on: a face has a symmetry axis, and a d4's corner mark wants to point at
   * its own corner. The quad builder used to pick this from world space and every die but the cube
   * paid for it — see `FacePlacement.axis`.
   */
  up: THREE.Vector3;
  half: number;
}

/**
 * One spot per face, in the middle of it.
 *
 * **Seated and sized from the face rather than from the die**, which is the whole of the fix — see
 * `NUMBER_LIFT` and `facePlacements` for what it was doing before and why nobody noticed.
 */
export function faceSpots(ups: readonly Vec3[], placements: readonly FacePlacement[]): NumberSpot[] {
  return ups.map((face, index) => {
    const normal = new THREE.Vector3(face[0], face[1], face[2]).normalize();
    const place = placements[index]!;
    return {
      index,
      normal,
      up: new THREE.Vector3(...place.axis),
      // **The middle of the face, lifted off it — not the foot of the perpendicular.** Those are
      // the same point on every solid here except the ten-sided one, whose kites are not symmetric
      // about it; see FacePlacement.middle.
      centre: new THREE.Vector3(...place.middle).addScaledVector(normal, place.distance * (NUMBER_LIFT - 1)),
      // Half the *side* of a square that fits the face's inscribed circle, so the corners land on
      // the circle rather than outside it — the square quad on a triangular face is the reason a
      // d20's digits used to reach 44% past their own edges.
      half: (place.extent * NUMBER_SIZE) / Math.SQRT2,
    };
  });
}

/**
 * Three spots per number, one at each corner of the faces that meet it — a real d4's marking.
 *
 * **A tetrahedron has nothing to write on in the direction it is read.** It is read at its apex
 * (see `vertexUps`), and a vertex is a point: `facePlacements` returns an extent of 0 there, which
 * is it saying so. Seated on that, a number would be a plate balanced on a spike.
 *
 * So the numbers go where a real d4 puts them — on the faces, near the corner, three to a number,
 * so that whichever corner is up you can read it from any side. Twelve marks for four numbers.
 */
export function cornerSpots(positions: ArrayLike<number>, ups: readonly Vec3[]): NumberSpot[] {
  const spots: NumberSpot[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i + 8 < positions.length; i += 9) {
    a.set(positions[i]!, positions[i + 1]!, positions[i + 2]!);
    b.set(positions[i + 3]!, positions[i + 4]!, positions[i + 5]!);
    c.set(positions[i + 6]!, positions[i + 7]!, positions[i + 8]!);
    const middle = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    // Outward by the centroid, for the reason faceUps gives: wound-correctly is an assumption, and
    // a die numbered from the inside would be a very quiet way to discover it was wrong.
    if (normal.dot(middle) < 0) normal.negate();
    // The circle that fits this triangle, which is what the three marks have to share.
    const inradius = triangleInradius(a, b, c);
    // Lifted by the same rule as every other face — a share of the plane's own distance, not of
    // some other measurement of the triangle. Lifting by the inradius instead put a d4's marks
    // twice as far proud as the rest of the dice, which the containment test caught.
    const lift = Math.abs(normal.dot(a)) * (NUMBER_LIFT - 1);
    for (const corner of [a, b, c]) {
      const index = ups.findIndex((up) => corner.clone().normalize().dot(new THREE.Vector3(up[0], up[1], up[2]).normalize()) > 0.999);
      if (index < 0) continue;
      spots.push({
        index,
        normal: normal.clone(),
        // Pointing at its own corner, so it reads the right way up when that corner is the one
        // standing at the top of the die — which is the only way a d4 is ever read.
        up: corner.clone().sub(middle).projectOnPlane(normal).normalize(),
        centre: middle.clone().lerp(corner, CORNER_PULL).addScaledVector(normal, lift),
        half: (inradius * CORNER_SIZE) / Math.SQRT2,
      });
    }
  }
  return spots;
}

/** The radius of the largest circle that fits in a triangle: its area over its half-perimeter. */
function triangleInradius(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const sides = [a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)];
  const s = (sides[0]! + sides[1]! + sides[2]!) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - sides[0]!) * (s - sides[1]!) * (s - sides[2]!)));
  return s > 0 ? area / s : 0;
}

/**
 * A quad at every spot, turned to face outward.
 *
 * The technique the reference `d6.glb` in this project's asset folder uses — its `face_1`…`face_6`
 * nodes are exactly this — chosen over UV-mapping digits onto the solid itself, which would mean
 * hand-assigning texture coordinates per face for six different topologies.
 */
function numberMesh(spots: readonly NumberSpot[], labels: readonly string[], texture: THREE.CanvasTexture): THREE.Mesh {
  const columns = Math.ceil(Math.sqrt(labels.length));
  const rows = Math.ceil(labels.length / columns);
  const position: number[] = [];
  const uv: number[] = [];
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (const spot of spots) {
    const { centre, normal, half } = spot;
    // **The face's own up, not one borrowed from the world.** Whoever built the spot knows what the
    // number is written on; picking an axis here from whichever of X or Y was least parallel to the
    // face left a d20's twenty triangles spread across the whole 120° of their symmetry and a d10's
    // ten kites split evenly between upright and upside down.
    up.copy(spot.up).projectOnPlane(normal).normalize();
    right.copy(up).cross(normal).normalize();
    const corner = (sx: number, sy: number) =>
      position.push(
        centre.x + right.x * half * sx + up.x * half * sy,
        centre.y + right.y * half * sx + up.y * half * sy,
        centre.z + right.z * half * sx + up.z * half * sy,
      );
    const u0 = (spot.index % columns) / columns;
    const v0 = 1 - (Math.floor(spot.index / columns) + 1) / rows;
    const u1 = u0 + 1 / columns;
    const v1 = v0 + 1 / rows;
    corner(-1, -1);
    corner(1, -1);
    corner(1, 1);
    uv.push(u0, v0, u1, v0, u1, v1);
    corner(-1, -1);
    corner(1, 1);
    corner(-1, 1);
    uv.push(u0, v0, u1, v1, u0, v1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
}

/** Everything one kind of die needs, built once and shared by every die of that kind. */
interface DieBuild {
  solid: THREE.BufferGeometry;
  /** Where each numbered face points, in model space. Index 0 is the face marked 1. */
  ups: Vec3[];
  numbers: THREE.Mesh;
}

/** One die on the table, and the path it is playing back. */
interface ThrownDie {
  group: THREE.Group;
  /** Its index into the baked path. */
  index: number;
}

/**
 * The tray, and the dice in it.
 *
 * **Its own canvas, its own renderer, its own scene — the arrangement the Forge's turntable uses.**
 * The tray is asked to sit over the map and not interact with it, and a canvas above the map is the
 * only version of that which is true of *pointer events* as well as of pixels: a second render pass
 * into the map's own renderer would still leave clicks falling through to the board underneath.
 *
 * It also keeps the tray out of the map's depth pre-pass. Mist there fades against whatever that
 * pass saw, so a tray living in the map scene would have fog thinning around it.
 *
 * Nothing here rolls anything. It is handed faces `engine/tray.ts` already chose.
 */
export class DiceStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 20);
  private readonly dice = new THREE.Group();
  // Keyed by kind *and* by markings, because the two dice of a percentile roll are the same solid
  // carrying different numbers — one atlas of 1–10 and one of 00–90.
  private readonly builds = new Map<string, DieBuild>();
  private readonly body = new THREE.MeshStandardMaterial({ color: 0x2b1416, roughness: 0.45, metalness: 0.05 });
  private thrown: ThrownDie[] = [];
  private path?: ThrowPath;
  private elapsed = 0;
  private last = 0;
  private running = false;
  private tray?: THREE.Object3D;
  private loading?: Promise<void>;
  /** What the camera is framed around. The nominal tray until the real one has loaded. */
  private box: readonly [Vec3, Vec3] = [NOMINAL_MIN, NOMINAL_MAX];
  /** The room the cup needs, once it has loaded. Framed alongside the tray, never fused with it. */
  private wide?: readonly [Vec3, Vec3];
  /** How far the frame has opened for the cup, 0 to 1, and where it is heading. */
  private frameBlend = 0;
  private frameTarget = 0;
  /** The cup itself, how tall it is once measured, and the materials the fade writes to. */
  private cup?: THREE.Object3D;
  private cupHeight = 0;
  private readonly cupSkin: THREE.Material[] = [];
  /** The cup's run, from the press until it has faded. Outlives the shake — see `agitate`. */
  private cupPlay?: CupState;
  /** Its pose at every step from the release, walked out when the throw was baked. */
  private cupTrack?: readonly CupPose[];
  /** The live shake, while the dice are still in hand. Absent the rest of the time. */
  private agitation?: {
    dice: DieState[];
    landings: Quat[];
    seed: number;
    /** How long it has been shaken for, in whole steps. */
    seconds: number;
    /** Real time not yet worth a whole step, so the shake is the same length on any machine. */
    carry: number;
    letGo: boolean;
  };
  private readonly audio = new DiceAudio();

  /** Degrees above the horizon. A field rather than the constant, so the preview page can vary it. */
  private readonly elevationDeg: number;
  private readonly numberStyle: NumberStyle;
  private readonly cupUrl?: string;

  constructor(canvas: HTMLCanvasElement, private readonly url: string, options: DiceStageOptions = {}) {
    this.elevationDeg = options.elevationDeg ?? CAMERA_ELEVATION_DEG;
    this.numberStyle = options.numberStyle ?? NUMBER_STYLES.outlined;
    this.cupUrl = options.cupUrl;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.frame(NOMINAL_MIN, NOMINAL_MAX);
    this.scene.add(this.dice);

    // A fresh scene has no lights and the tray's materials are PBR, so without these it renders
    // black. Over the viewer's left shoulder, the same place MiniaturePreview puts its key.
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-2, 4, 3);
    this.scene.add(key, new THREE.AmbientLight(0xffffff, 0.75));

    // Opposite the key and low, so the near wall and the sides of the dice are not solid black —
    // the tray is dark wood and the dice are darker, and one light leaves them a silhouette.
    const fill = new THREE.DirectionalLight(FILL_COLOR, FILL_INTENSITY);
    fill.position.set(2.5, 1.2, -2);
    this.scene.add(fill);
  }

  /**
   * Load the tray model.
   *
   * Called once and remembered, so a throw arriving before it finishes waits rather than racing it.
   * Everything else this draws is procedural and needs no file at all.
   */
  private ready(): Promise<void> {
    this.loading ??= Promise.all([this.loadTray(), this.loadCup()]).then(() => undefined);
    return this.loading;
  }

  /**
   * The cup, seated on the felt.
   *
   * **The file already stands the way `cupMath` wants it, and the loader's job is only to check.**
   * Its mesh's long axis is its own Z and its node transform has already turned that into world Y —
   * so the spec's routine for finding the long axis and raycasting both ways to locate the open end
   * describes a problem this file does not have.
   *
   * Measured through its own node matrix, the closed disc is at the *bottom* of the bounding box and
   * the mouth is the top: base at zero, mouth straight up, which is exactly the frame every pose in
   * `cupMath` is written in. This once carried a half-turn about X as well, from reading that matrix
   * off in the wrong column order — and the cost was not a cup lying on its side, which anyone would
   * have caught. It was a cup that looked plausible while pouring the dice out of its closed end.
   *
   * The height and the seat are measured rather than assumed, so a re-export at a different scale
   * re-fits itself instead of quietly sinking through the felt — the courtesy the tray already gets.
   *
   * **A cup that will not load costs the cup and nothing else.** The shake falls back to what it was
   * before this existed: the dice rattle around the tray, and a roll still happens.
   */
  private loadCup(): Promise<void> {
    if (!this.cupUrl) return Promise.resolve();
    return new GLTFLoader()
      .loadAsync(this.cupUrl)
      .then((gltf) => {
        const model = gltf.scene;
        const measured = new THREE.Box3().setFromObject(model);
        const native = Math.max(1e-6, measured.max.y - measured.min.y);
        // Seated rather than centred: the base is the part that has to be at zero.
        model.position.y = -measured.min.y;
        model.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = false;
          // Kept so the cup can be faded out. `GLTFLoader` makes these fresh per load and nothing
          // else uses them, so writing to them is safe — but `transparent` is only switched on while
          // it is actually fading, because a transparent material is sorted and drawn differently
          // for the whole of the rest of the time it is on screen.
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            this.cupSkin.push(material as THREE.Material);
          }
        });
        const cup = new THREE.Group();
        cup.scale.setScalar(CUP_SCALE);
        cup.add(model);
        cup.visible = false;
        this.cup = cup;
        this.cupHeight = native * CUP_SCALE;
        this.scene.add(cup);
        this.widen();
      })
      .catch((error: unknown) => {
        console.error(`Dice cup failed to load from ${this.cupUrl}`, error);
      });
  }

  private loadTray(): Promise<void> {
    return new GLTFLoader()
      .loadAsync(this.url)
      .then((gltf) => {
        const model = gltf.scene;
        // Seated so the felt is the plane the dice land on. The model is centred vertically about
        // its own middle, so dropped in at zero the floor would sit below the origin and every die
        // would have to know it.
        model.position.y = -TRAY_FELT_Y;
        model.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) mesh.castShadow = false;
        });
        this.tray = model;
        this.scene.add(model);
        // **Framed from the model rather than from constants.** The nominal box got the first frame
        // drawn; this is the real thing, measured after the lift. A re-export at a different scale
        // then re-frames itself instead of quietly clipping, which is precisely how the tray came
        // to be cut off in the first place.
        const box = new THREE.Box3().setFromObject(model);
        this.frame([box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z]);
      })
      .catch((error: unknown) => {
        // The dice are procedural, so a tray that will not load costs the tray and nothing else —
        // you still get a readable roll, floating over the map on nothing.
        console.error(`Dice tray failed to load from ${this.url}`, error);
      });
  }

  /** Point the camera at a box, and remember it so a resize can re-fit to the same thing. */
  private frame(min: Vec3, max: Vec3): void {
    this.box = [min, max];
    this.widen();
  }

  /**
   * Work out where the cup needs room, so the widened frame can be fitted around it.
   *
   * **Kept as its own box beside the tray's rather than fused with it** — see `orthoFramingOf`, which
   * is where the reason lives and what it is worth. Re-derived whenever either half arrives: the two
   * models load in parallel and either can be the one that finishes last.
   */
  private widen(): void {
    this.wide = this.cup ? cupEnvelope(this.cupHeight) : undefined;
    this.refit();
  }

  /**
   * Fit the frustum to the remembered box, at the canvas's current shape.
   *
   * All of the thinking is in `orthoFraming`; this is the half that needs a `THREE` camera. The
   * frustum planes are set from the framing's own offsets rather than by moving the camera, because
   * those offsets are already expressed in the camera's screen axes — which is what they are for.
   *
   * **The aspect is read from the canvas rather than assumed.** It is square today, because
   * `showTray` writes the same number into both dimensions. An orthographic camera has no `aspect`
   * of its own and will happily draw a frustum of one shape into a viewport of another, stretched,
   * so a square assumed here would be a squashed tray the day somebody changed that one line.
   *
   * **Two boxes are fitted and the *fits* are blended, not the boxes.** The answer wanted is a
   * rectangle on the screen, and interpolating the world boxes would take a detour through a space
   * where the two are not even the same shape — the widening is nearly all in Y, which at this
   * elevation contributes a third of what Z does. Mixing the results is linear in the thing being
   * looked at, which is what makes the move read as a camera pulling back rather than as a lens
   * changing its mind.
   */
  private refit(): void {
    const size = this.renderer.getSize(SIZE);
    const aspect = size.y > 0 ? size.x / size.y : 1;
    const tight = orthoFramingOf([this.box], this.elevationDeg, FRAME_MARGIN, FRAME_HEADROOM, aspect);
    const t = this.frameBlend;
    const fit: Framing =
      t <= 0 || !this.wide
        ? tight
        : (() => {
            const open = orthoFramingOf([this.box, this.wide!], this.elevationDeg, FRAME_MARGIN, FRAME_HEADROOM, aspect);
            const mix = (a: number, b: number) => a + (b - a) * t;
            return {
              position: tight.position,
              halfWidth: mix(tight.halfWidth, open.halfWidth),
              halfHeight: mix(tight.halfHeight, open.halfHeight),
              offsetRight: mix(tight.offsetRight, open.offsetRight),
              offsetUp: mix(tight.offsetUp, open.offsetUp),
            };
          })();
    this.camera.position.set(fit.position[0], fit.position[1], fit.position[2]);
    this.camera.lookAt(0, 0, 0);
    this.camera.left = fit.offsetRight - fit.halfWidth;
    this.camera.right = fit.offsetRight + fit.halfWidth;
    this.camera.bottom = fit.offsetUp - fit.halfHeight;
    this.camera.top = fit.offsetUp + fit.halfHeight;
    this.camera.updateProjectionMatrix();
  }

  /**
   * How wide the canvas is, in CSS pixels. Given, never measured — see MiniaturePreview.
   *
   * **What is in frame does not depend on this.** The frustum is in tray units, so a resize changes
   * how many pixels the tray is drawn with and nothing about how much of it you can see — the ortho
   * camera earning its keep. It is re-fitted only because a resize is where the canvas could change
   * *shape*, which the frustum does have to follow.
   */
  resize(size: number): void {
    const side = Math.max(1, Math.floor(size));
    this.renderer.setSize(side, side, false);
    this.refit();
    this.draw();
  }

  /**
   * Throw a handful, replacing whatever was on the felt.
   *
   * **Replacing rather than adding**, because a tray that accumulated would bury the last roll —
   * which is the one you want to read — under every roll before it.
   */
  throwDice(faces: ReadonlyArray<{ sides: number; face: number }>, seed: number, size?: DiceSize): void {
    // No cup on this path — see `showSize`, its only caller. A settings click should not cost two
    // seconds of animation. The dice still land, and landing is what makes the sound.
    this.audio.start();
    void this.ready().then(() => {
      const starts = this.begin(faces, seed, size);
      this.path = simulateThrow(starts, TRAY);
      this.elapsed = 0;
      this.audio.clatter(contactsIn(this.path, TRAY, starts.map((start) => start.radius)));
      this.play();
    });
  }

  /**
   * Put the handful in the cup and start shaking it.
   *
   * **The faces are already decided and this has no idea what they are.** They were rolled before
   * anything here ran and are only read at the pour, so however long somebody leans on the button
   * cannot reach the outcome — the same rule `engine/dice.ts` opens with, applied to the one
   * interaction that would otherwise be able to break it. That gap is now a second of cup animation
   * rather than a rattle; none of it is allowed any nearer the answer for that.
   *
   * **Nothing is drawn while they are in the cup.** They are still simulated, and that is what a long
   * hold buys: the order they come out in, which the shake genuinely scrambles. Hiding them is what
   * makes it cheap — no gravity to rotate into a turning frame, and no dice poking through a shell
   * that is one surface thick and has no inside.
   *
   * Called from a press, which is the gesture the audio needs to wake up in.
   */
  shake(faces: ReadonlyArray<{ sides: number; face: number }>, seed: number, size?: DiceSize): void {
    this.audio.start();
    void this.ready().then(() => {
      const starts = this.begin(faces, seed, size);
      this.path = undefined;
      const dice = starts.map(dieState);
      if (this.cup) {
        packInto(dice, cupBox(this.cupHeight));
        this.cupPlay = cupState(seed, this.cupHeight);
        this.cupTrack = undefined;
        this.cup.visible = true;
        this.frameTarget = 1;
      }
      this.agitation = { dice, landings: starts.map((start) => start.landing), seed, seconds: 0, carry: 0, letGo: false };
      this.play();
    });
  }

  /**
   * Let go: the cup lifts, turns over, and tips out.
   *
   * Marked rather than done, because a tap should still look like a throw. The loop keeps shaking
   * until `MIN_SHAKE` has passed and leaves then — so a click gets a brief rattle instead of a cup
   * appearing and immediately pouring, and a keyboard user gets the same throw as everybody else.
   */
  release(): void {
    if (this.agitation) this.agitation.letGo = true;
  }

  /** Whether sound is switched off. The dice panel owns the setting; the stage owns the graph. */
  get muted(): boolean {
    return this.audio.muted;
  }

  set muted(value: boolean) {
    this.audio.muted = value;
  }

  /**
   * How long the shake has been going, for the button that is driving it.
   *
   * **The cup's shake phase, not the whole run**, where there is a cup. The button fills toward the
   * ten-second limit, and the drop-in before the rattle starts is not time anybody was holding it
   * for.
   */
  get shakeSeconds(): number {
    if (this.cupPlay) return shakeSecondsOf(this.cupPlay);
    return this.agitation?.seconds ?? 0;
  }

  /** Whether a shake is in progress — a roll is owed until this goes false. */
  get shaking(): boolean {
    return this.agitation !== undefined;
  }

  private begin(faces: ReadonlyArray<{ sides: number; face: number }>, seed: number, size?: DiceSize): DieStart[] {
    this.clear();
    // Two dice for a percentile roll and one for everything else — see percentileFaces.
    const shown = faces.flatMap((die) => (die.sides === 100 ? percentile(die.face) : [{ kind: die.sides as DieKind, face: die.face }]));

    // **How big a die is this throw**, which is a question about the handful rather than about the
    // die — see dieRadius. One d20 gets three times what twenty d6 get, and the whole layout below
    // is written in terms of it rather than in tray units, because those two throws want different
    // absolute numbers for everything.
    const radius = dieRadius(shown.length, TRAY, size);
    // How far a centre may get from the middle before its die is against a wall.
    const edge = Math.max(0, TRAY.half - radius);
    // **Laid out across the felt rather than queued at the near rim.** A single file of dice has to
    // barge its way apart after it lands, and at the sizes this now reaches that took most of the
    // throw: four dice at 2.5× were still shoving each other three and a quarter seconds in, and
    // twenty ran the clock out entirely. Started on a grid they arrive already clear of each other
    // and only have to settle. The arrangement is `packSlot`, which the cup and the pour share.
    const cols = packColumns(TRAY.half, radius);
    const perLayer = cols * cols;
    // How much of the tray the handful already covers, which is how much of a throw it needs. One
    // die gets flung across the felt; a fistful is poured in and left to find its own room.
    const rowsUsed = Math.max(1, Math.ceil(Math.min(shown.length, perLayer) / cols));
    const pace = 1 / rowsUsed;

    const starts: DieStart[] = [];
    shown.forEach((die, i) => {
      const build = this.buildFor(die.kind, die.role ?? "plain");
      if (!build) return;
      const group = new THREE.Group();
      const solid = new THREE.Mesh(build.solid, this.body);
      const numbers = build.numbers.clone();
      solid.frustumCulled = false;
      numbers.frustumCulled = false;
      group.add(solid, numbers);
      // The geometry is cached at DIE_BUILD_RADIUS and the difference is a uniform scale, which
      // leaves every orientation alone — so the landing quaternions and the face reading are
      // untouched by this, and the number quads come along without being rebuilt.
      group.scale.setScalar(radius / DIE_BUILD_RADIUS);
      this.dice.add(group);
      this.thrown.push({ group, index: starts.length });

      // Thrown in over the near rim, deterministically: the same roll bounces the same way twice,
      // which is the property this whole tier is arranged around.
      const roll = (field: number) => cellNoise(i, seed + field, THROW_SALT) - 0.5;
      const up = build.ups[Math.min(build.ups.length, Math.max(1, die.face)) - 1]!;
      // Its slot on the grid, and which layer of the grid it is on once the felt is full.
      const slot = packSlot(i, TRAY.half, radius);
      starts.push({
        position: [
          // Filling the width, so the gaps come out at least a step wherever the columns landed. All
          // inside the wall clamp: at 3× the old `TRAY.half * 0.8` sat *outside* it, and a die
          // would have been snapped into the tray on its very first step.
          slot.x,
          // Clear air above where it will end up, rather than a fixed height: a drop that read as a
          // short one for a small die was most of the way up the frame for a big one. Alternate
          // rows come in a little higher so a grid does not land all at once.
          TRAY.floorY + radius + DROP_CLEAR + (slot.layer * 2.2 + (slot.row % 2) * 0.5) * radius,
          // Coming in over the near rim, which is the far end of the grid from where `packSlot`
          // counts, so the row order runs back to front.
          cols > 1 ? -slot.z : edge * 0.8,
        ],
        velocity: [roll(1) * SPREAD_SPEED * pace, 0, (-THROW_SPEED - Math.abs(roll(2)) * SPREAD_SPEED) * pace],
        spin: [roll(3) * TUMBLE_RATE, roll(4) * TUMBLE_RATE, roll(5) * TUMBLE_RATE],
        radius,
        landing: faceUpQuaternion(up, cellNoise(i, seed, SPIN_SALT) * Math.PI * 2),
      });
    });

    return starts;
  }

  /** Sweep the felt. */
  clear(): void {
    // A shake in progress is abandoned rather than thrown — sweeping the felt while somebody is
    // still holding the button should not produce a roll they did not ask for. The cup goes with
    // it, mid-pour if that is where it was: a cup left hanging over the map would be the one thing
    // on screen with nothing left to explain it.
    this.agitation = undefined;
    this.cupPlay = undefined;
    this.cupTrack = undefined;
    this.frameTarget = 0;
    this.skin(1);
    if (this.cup) this.cup.visible = false;
    this.audio.stop();
    for (const die of this.thrown) {
      this.dice.remove(die.group);
      // The solid and the atlas are shared and must not be disposed; the cloned number mesh owns
      // its own material, which is the one thing here that would leak per throw.
      for (const child of die.group.children) {
        if (child instanceof THREE.Mesh && child.material !== this.body) (child.material as THREE.Material).dispose();
      }
    }
    this.thrown = [];
    this.path = undefined;
    this.draw();
  }

  /**
   * Whether anything is still moving.
   *
   * **The frame counts as movement**, which is the one entry here that is not a thing on the felt.
   * The pull-back and the return are eased over a third of a second and the dice can easily have
   * finished before the camera has; without this the loop stands down halfway through the return and
   * leaves the tray framed for a cup that has gone.
   */
  get busy(): boolean {
    return (
      this.agitation !== undefined ||
      (this.cupPlay !== undefined && !this.cupPlay.done) ||
      this.frameBlend !== this.frameTarget ||
      (this.path !== undefined && this.elapsed < this.path.seconds)
    );
  }

  dispose(): void {
    this.running = false;
    this.clear();
    this.audio.close();
    this.renderer.dispose();
    // **`dispose` frees the resources; it does not give up the context.** The app builds one stage
    // and keeps it, so that distinction never came up — but `demo/dice-angles.html` builds a new
    // one every time you change the angle, and a browser allows only a handful of live contexts
    // and reclaims abandoned ones whenever it feels like it. Without this the workbench runs out.
    this.renderer.forceContextLoss();
  }

  /**
   * Run until the dice stop, then draw one last frame and stand down.
   *
   * **A loop of its own, and only while it is needed.** The map's loop is stopped in every mapless
   * mode and would be the wrong clock anyway; an idle tray should cost nothing at all, which a
   * permanent requestAnimationFrame chain does not.
   */
  private play(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = () => {
      if (!this.running) return;
      const now = performance.now();
      // Clamped, so a backgrounded tab does not resume with the throw already over — the one
      // moment of this effect anybody actually watches.
      const delta = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const settling = this.path !== undefined;
      if (this.cupPlay) this.driveCup(delta);
      if (this.agitation) this.agitate(delta);
      // **Nothing is added on the frame the throw begins.** `pour` sets the clock to zero partway
      // through this frame, and a frame's worth added on top of that would draw the settle's second
      // step first — which is a frame of the fall skipped, against a sound scheduled from the
      // beginning of it. One frame is not much; it is also free to not be wrong.
      else if (settling) this.elapsed += delta;
      this.ease(delta);
      this.place();
      this.draw();
      if (!this.busy) {
        this.running = false;
        return;
      }
      requestAnimationFrame(frame);
    };
    frame();
  }

  /**
   * Carry the shake forward by however long the last frame took.
   *
   * **Whole fixed steps, with the remainder carried**, so a hold is worth the same number of steps
   * on a fast machine as on a slow one. Stepping by the frame time instead would make a shake on a
   * 144 Hz screen a different shake from the same hold on a 30 Hz one, and this is the one part of
   * the throw a person is directly steering.
   */
  private agitate(delta: number): void {
    const shake = this.agitation;
    if (!shake) return;
    const cup = this.cupPlay;
    shake.carry += delta;
    while (shake.carry >= THROW_STEP) {
      shake.carry -= THROW_STEP;
      if (!cup) {
        // No cup: this is what a shake was before one existed, and what happens if the model will
        // not load. The dice rattle around the tray itself.
        advanceShake(shake.dice, TRAY, shake.seed, shake.seconds);
        shake.seconds += THROW_STEP;
        // Let go, and once it has had its minimum, out they go. The minimum is what makes a click
        // look like a throw rather than dice materialising already at rest.
        if (shake.letGo && shake.seconds >= MIN_SHAKE) {
          tipOut(shake.dice, shake.seed);
          this.path = settleFrom(shake.dice, shake.landings, TRAY);
          this.elapsed = 0;
          this.agitation = undefined;
          this.audio.clatter(contactsIn(this.path, TRAY, shake.dice.map((die) => die.radius)));
          return;
        }
        continue;
      }

      // **The cup moves on the same clock as the dice inside it.** It used to advance once per frame
      // while they advanced in fixed steps, which was harmless while nothing collided with it — but
      // they are clamped against its walls now, and a wall that moved by a variable amount between
      // their steps would push them differently on a fast machine than on a slow one.
      if (shake.letGo && shakeSecondsOf(cup) >= MIN_SHAKE) releaseCup(cup);
      const before = cup.tau;
      advanceCup(cup, THROW_STEP);
      if (cup.phase === "shake" && shakeReversed(before, cup.tau, cup.seed)) {
        this.audio.rattle(shakeEnergy(cup.tau));
      }
      // Gone past the shake: everything from here is fixed-length and can be worked out at once.
      if (cup.phase !== "enter" && cup.phase !== "shake") {
        this.spill(cup);
        return;
      }
      advanceShake(shake.dice, cupBox(this.cupHeight, cup.pose), shake.seed, shake.seconds);
      shake.seconds += THROW_STEP;
    }
  }

  /**
   * Let go: bake the rest of the throw, cup and all.
   *
   * **Everything from here is determined**, which is what lets the whole of it be worked out before
   * any of it is drawn: the cup's motion from the release is fixed-length, and the dice are wherever
   * the hold left them. So one pass produces the in-cup slide, each die's exit through the mouth, and
   * the settle on the felt — see `settleFrom`, which now takes a vessel.
   *
   * The hold in front of it was never bakeable, because its length is up to whoever is holding the
   * button. Nothing about how much is baked touches what a die *shows*: `seatFaces` guarantees that
   * inside the bake either way.
   */
  private spill(cup: CupState): void {
    const shake = this.agitation;
    if (!shake) return;
    const pouring = pourFrom(cup, shake.dice.map(() => true));
    this.cupTrack = pouring.poses;
    this.path = settleFrom(shake.dice, shake.landings, TRAY, pouring.held);
    this.elapsed = 0;
    this.agitation = undefined;
    this.audio.clatter(contactsIn(this.path, TRAY, shake.dice.map((die) => die.radius)));
  }

  /**
   * Carry the cup forward once the dice have been let go of.
   *
   * **It outlives the shake it started.** The dice's whole remaining throw was baked at the release,
   * but the cup still has its turn, its jiggle and its fade to do — and the frame is closing back on
   * the tray for the whole of it. So it keeps its own phase machine running here for the fade and the
   * opacity, while `place` takes its *pose* from the baked track: both on the same clock as the dice,
   * with nothing to drift.
   *
   * While the button is still held the cup is advanced inside `agitate` instead, in the same fixed
   * steps the dice take, because they are colliding with its walls.
   */
  private driveCup(delta: number): void {
    const cup = this.cupPlay;
    if (!cup) return;
    if (this.agitation) return;
    advanceCup(cup, delta);
    // **The frame starts closing when the cup starts going, not when it has gone**, so the dice are
    // back at full size for the last of their settling rather than for none of it. The cup is
    // thinning away over the same half second, which is what makes a frame tightening past it read
    // as the camera returning rather than as the cup being cropped.
    if (cup.phase === "fade") this.frameTarget = 0;
    // Put away on the frame it finishes rather than on the next one: `busy` goes false the moment
    // it is done, so a cup dropped a frame later would be dropped after the loop had stood down and
    // would still be sitting in the scene waiting for the frame to widen again.
    if (cup.done) {
      this.cupPlay = undefined;
      this.cupTrack = undefined;
      this.skin(1);
      if (this.cup) this.cup.visible = false;
      this.frameTarget = 0;
    }
  }

  /**
   * How solid the cup is drawn.
   *
   * `transparent` is switched on only while it is actually fading. Left on, the cup would be sorted
   * against the transparent pass and drawn without writing depth for the whole of every roll — which
   * on a double-sided tube means seeing its far wall through its near one.
   */
  private skin(opacity: number): void {
    for (const material of this.cupSkin) {
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.depthWrite = opacity >= 1;
      material.needsUpdate = true;
    }
  }

  /** Move the frame toward whichever of the two boxes is wanted, and re-fit if it moved. */
  private ease(delta: number): void {
    if (this.frameBlend === this.frameTarget) return;
    const step = delta / FRAME_EASE;
    this.frameBlend =
      this.frameTarget > this.frameBlend
        ? Math.min(this.frameTarget, this.frameBlend + step)
        : Math.max(this.frameTarget, this.frameBlend - step);
    this.refit();
  }

  /** Put every die where its baked path says it is — or, mid-shake, where the simulation has it. */
  private place(): void {
    const cup = this.cupPlay;
    if (this.cup && cup) {
      // **Off the baked track once there is one, and off the live state before that.** The track was
      // walked out in the same fixed steps the dice were baked in, so taking the cup's pose from it
      // is what keeps the mouth in the same place as the die that is coming out of it. Its phase
      // machine still runs, for the fade and for knowing when it is done.
      const step = Math.floor(this.elapsed / THROW_STEP);
      const track = this.cupTrack;
      const pose = track ? track[Math.min(step, track.length - 1)]! : cup.pose;
      const { quaternion, position } = cupTransform(pose, this.cupHeight);
      this.cup.position.set(position[0], position[1], position[2]);
      this.cup.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
      this.skin(cupOpacity(cup));
    }
    const shake = this.agitation;
    if (shake) {
      // Mid-hold. With a cup the dice live in its coordinates, so they are converted here — which is
      // the whole of what it takes to see them in there.
      const inCup = cup ? cupTransform(cup.pose, this.cupHeight) : undefined;
      for (const die of this.thrown) {
        const at = shake.dice[die.index];
        if (!at) continue;
        if (inCup) {
          const world = applyQuat(at.position, inCup.quaternion);
          const turned = quatMultiply(inCup.quaternion, at.quaternion);
          die.group.position.set(world[0] + inCup.position[0], world[1] + inCup.position[1], world[2] + inCup.position[2]);
          die.group.quaternion.set(turned[0], turned[1], turned[2], turned[3]);
          continue;
        }
        die.group.position.set(at.position[0], at.position[1], at.position[2]);
        die.group.quaternion.set(at.quaternion[0], at.quaternion[1], at.quaternion[2], at.quaternion[3]);
      }
      return;
    }
    const path = this.path;
    if (!path) return;
    for (const die of this.thrown) {
      const at = frameAt(path, die.index, this.elapsed);
      if (!at) continue;
      die.group.position.set(at.position[0], at.position[1], at.position[2]);
      die.group.quaternion.set(at.quaternion[0], at.quaternion[1], at.quaternion[2], at.quaternion[3]);
    }
  }

  private draw(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private buildFor(kind: DieKind, role: LabelRole): DieBuild | undefined {
    // Keyed by markings as well as kind, because the two dice of a percentile roll are the same
    // solid carrying different atlases — and now a plain d10 is a third set again.
    const key = `${kind}:${role}`;
    const built = this.builds.get(key);
    if (built) return built;
    if (![4, 6, 8, 10, 12, 20].includes(kind)) return undefined;
    const solid = solidFor(kind);
    const positions = solid.getAttribute("position").array as ArrayLike<number>;
    // **The four-sided die is read at its corners, and every other one at its faces.** A
    // tetrahedron's faces are not opposite each other, so the one pointing up is the one it is
    // balancing on a point to show you — which is why a real d4 has its numbers at the corners and
    // is read at the apex. Landing a chosen *vertex* up puts the die flat on a face, as it would
    // actually come to rest, with the number that counts at the top.
    const ups = numberUps(kind === 4 ? vertexUps(positions) : faceUps(positions));
    const labels = labelsFor(kind, role);
    // The d4 is read at a corner, so its numbers go on the faces around that corner; every other
    // die is read at a face, so its number goes in the middle of it.
    const spots = kind === 4 ? cornerSpots(positions, ups) : faceSpots(ups, facePlacements(positions, ups));
    const build: DieBuild = { solid, ups, numbers: numberMesh(spots, labels, numberAtlas(labels, this.numberStyle)) };
    this.builds.set(key, build);
    return build;
  }
}

/** A percentile roll, as the two dice that show it — see percentileFaces, which does the arithmetic. */
function percentile(rolled: number): Array<{ kind: DieKind; face: number; role?: LabelRole }> {
  const [tens, units] = percentileFaces(rolled);
  return [
    { kind: 10, face: tens, role: "tens" },
    { kind: 10, face: units, role: "units" },
  ];
}
