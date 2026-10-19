import { cellNoise } from "../schema/noise.js";
import {
  THROW_STEP,
  applyQuat,
  quatFromAxisAngle,
  quatMultiply,
  quatSlerp,
  type HeldIn,
  type Quat,
  type TrayBox,
  type Vec3,
  type VesselAt,
} from "./diceMath.js";

// The dice cup: where it is at every moment between the press and the read.
//
// **Pure, like diceMath and for the same reason.** Everything that could be *wrong* here is
// arithmetic — where the mouth is pointing, whether the pose jumps between two phases, whether the
// dice would land on felt or on a wall — and none of it needs a GL context to answer. What is left
// for renderer/diceFx.ts is writing a quaternion onto an Object3D.
//
// **Nothing here knows what a die shows.** The faces were rolled the instant the button went down;
// this is the second or so between that and seeing them, and it is deliberately built so that there
// is nothing in it a face could be read from or written to.
//
// The curves come from an authored reference reel — lift, rattle, slam, tip — with three changes,
// all of them about the difference between a demo and an interaction:
//
// 1. **Every phase starts from where the last one ended.** The reel is a loop, so its author could
//    arrange for the shake to calm down into exactly the pose the next phase opens on. A shake
//    somebody is holding cannot do that: it ends wherever their finger left it. So the phases below
//    take a pose to move *out of* rather than a fixed one to start at, and the seams are continuous
//    by construction instead of by coincidence.
// 2. **The pour is anchored by its mouth.** The reel tips onto an open table and its translations are
//    free numbers. Ours has to land dice on felt less than a unit across, so the mouth is placed and
//    the cup's position is derived from it — see `mouthPose`.
// 3. **There is no tap.** The reel slams the cup down and lets it wobble before picking it up again,
//    which is a real thing people do and is two thirds of a second of nothing happening between
//    letting go and seeing a number. Watched once it is characterful; watched on every roll it is a
//    wait. Release now goes straight to the lift, which more than halves the gap.

/**
 * How big the cup is drawn, as a share of the model's own height.
 *
 * **Its interior has to hold the largest die the size setting allows**, which is what stops this
 * being a number picked by eye. A d20 at the 3x ceiling is 0.36 across against a bore of 0.63, and a
 * scale much under this would have a die wedged in a tube barely wider than it is.
 * `tests/cupMath.test.ts` asserts the fit at every setting, so this fails loudly if `DIE_SIZE_CAPS`
 * ever moves.
 *
 * The other end is the frame: the cup is the tallest thing in this scene by a factor of six, and
 * every unit of it is paid for in how small the dice draw while it is up. See `cupEnvelope`.
 */
export const CUP_SCALE = 0.75;

/** The bore, as a share of the height. The model is a plain tube; this is measured off it. */
export const CUP_BORE = 0.42;

/**
 * Where a hand would hold it, up from the base as a share of the height.
 *
 * Everything rotates about this rather than about the base, which is the whole difference between a
 * cup being shaken and a cup pivoting on the table like a hinge.
 */
const GRIP = 0.55;

/**
 * How far above its resting height the cup is held while being shaken, in cup heights.
 *
 * **Lower than the reference reel's, and the frame is why.** The reel is a cup on its own against a
 * clear background and can afford to be picked right up; here every unit of height the cup reaches
 * is paid for by every die in the tray drawing smaller while it is up. Measured, the reel's figure
 * put the dice at 68 per cent; this and the two below bring it back — see `cupEnvelope`.
 */
const LIFT = 0.3;

/** Shakes per second, and how far each one throws it. */
const SHAKE_RATE = 4.6;
/** How far each one throws it. Twenty degrees, which is a wrist rather than an arm. */
const SHAKE_AMPLITUDE = 0.36;
/**
 * How long the rattle takes to come up to strength.
 *
 * The reel fades out again before the phase it leads into; this cannot, because it has no idea when
 * the release is coming. It does not need to: the lift eases out of whatever pose the release left,
 * so there is nothing for a fade-out to smooth over.
 */
const SHAKE_RAMP = 0.18;
/** The lean a cup is held at, before any rattle is added. */
const BASE_TILT = -0.12;
/**
 * How much of the sway goes into the tip toward and away from the camera, rather than across it.
 *
 * **Less than the reference's, and it is a framing trade rather than a change of mind about the
 * motion.** At this elevation, depth projects onto the vertical of the picture at nearly its full
 * length while height projects at a third of it — so a wrist flick *toward* the viewer costs about
 * three times as much frame as the same flick sideways. The rattle keeps its full sway across the
 * picture, where it is both cheapest and most visible, and gives up some of the one that is neither.
 */
const TIP_SHARE = 0.45;

/** How far above the shake it drops in from, in cup heights. */
const ENTER_DROP = 1.4;
/**
 * How far it drifts up while fading, in cup heights.
 *
 * **It fades rather than being carried off, and the drift is only so that it is clearly leaving.**
 * Lifted out of shot instead, it has to travel most of its own height again before it stops covering
 * the tray — and it is covering the tray at exactly the moment the dice are settling on it. A fade
 * hands the felt back immediately and costs nothing to look at.
 */
const FADE_RISE = 0.12;

/**
 * Where the turn ends.
 *
 * **Nearly straight over rather than the reel's hundred and thirty-five degrees**, for the same
 * reason `LIFT` is lower. A cup lying at forty-five degrees reaches most of its own length sideways
 * from its mouth, and the mouth has to be over the middle of the tray — so the body ends up well
 * outside the frame the tray needs and drags the whole picture wider. Tipped almost fully over it
 * stands nearly above its own mouth, which costs a fraction of that and is what emptying a cup
 * actually looks like.
 *
 * **There is no second angle to go with it.** The lift used to aim at an authored waypoint partway
 * over and the pour used to start again from there — see `pourAngle`, which is now one curve through
 * both.
 */
const POUR_OVER = -2.9;
/**
 * How high above the felt the mouth ends up, in tray units.
 *
 * Low enough that the dice have barely any distance to fall — they should tumble out rather than be
 * dropped from a height — and high enough that a die at the largest setting clears the rim on its
 * way down.
 */
export const POUR_HEIGHT = 0.34;

/** cellNoise stream. The dice block runs 1229-1249; this is the next prime above it. */
const CUP_SALT = 1259;

/**
 * How long each phase lasts.
 *
 * `shake` is missing because it has no length — it runs for as long as the button is held, between
 * the minimum a click is given and the ten-second limit, both of which live in `renderer/diceFx.ts`
 * with the interaction they belong to.
 *
 * **How long the release takes to produce a die is not a sum of these**, and that is the point of the
 * change that made it so: the dice fall out when the cup has turned far enough for them to, which is
 * physics rather than a schedule. What these decide is how quickly it turns far enough.
 *
 * **`pourUp` and `pour` are two thirds of what they were, and the roll is that much shorter.** They
 * were sized when the turn stalled halfway through itself — see `pourAngle` — so most of them was
 * spent with the dice pressed into the closed end, unable to move whatever the clock said. Measured
 * across every size and handful, the cup finishes turning at three fifths of a second after the
 * release rather than nine tenths, the first die is out at about a half rather than three quarters,
 * and the last at one and three tenths rather than one and three fifths.
 *
 * **`pourHold` is sized against the slowest handful rather than by eye.** It is the last phase the
 * cup exists for, and anything still inside when it ends has to be tipped out by force — see
 * `HeldIn.until`, which is the one failure this arrangement has. Measured, the slowest die is out by
 * one and three tenths against a deadline of one and a half, and nothing is ever forced.
 */
export const PHASE_SECONDS = {
  enter: 0.3,
  pourUp: 0.25,
  pour: 0.35,
  pourHold: 0.85,
  fade: 0.55,
} as const;

/**
 * How long the cup takes to go from the release to fully over.
 *
 * The lift and the pour are two phases because they are anchored differently — one by the grip, one
 * by the mouth — and for no other reason. The *turn* does not notice the seam between them.
 */
const TURN_SECONDS = PHASE_SECONDS.pourUp + PHASE_SECONDS.pour;

export type CupPhase = "enter" | "shake" | "pourUp" | "pour" | "pourHold" | "fade";

/** The order they run in. `shake` sits between `enter` and `pourUp` and leaves when it is let go. */
const ORDER: readonly CupPhase[] = ["enter", "shake", "pourUp", "pour", "pourHold", "fade"];

/**
 * Where the cup is, as a rotation and the world position of the point it turns about.
 *
 * **The grip rather than the origin**, because the grip is the thing with a meaning: it is where the
 * hand is, it is what the lift raises and the pour turns about, and it is the one point whose path
 * is simple in every phase. The model's own origin follows from it — see `cupTransform` — and is
 * only wanted at the moment a transform is written.
 */
export interface CupPose {
  rotation: Quat;
  grip: Vec3;
}

const IDENTITY: Quat = [0, 0, 0, 1];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** The `3t² − 2t³` fade used throughout this project — schema/noise.ts lattice, the shake, and here. */
function smoothstep(t: number): number {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}

/** The same, between two edges. */
function ss(edge0: number, edge1: number, x: number): number {
  return edge1 <= edge0 ? (x >= edge1 ? 1 : 0) : smoothstep((x - edge0) / (edge1 - edge0));
}

/** Fast out of the gate and easing into place — a hand picking something up. */
function outCubic(u: number): number {
  const t = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return 1 - (1 - t) ** 3;
}

/**
 * Euler angles as the reference writes them, in its ZXY order.
 *
 * Composed rather than expanded into a closed form: three axis-angle quaternions multiplied is the
 * definition, it reads as the thing it is, and the cost is nine multiplies on a path that runs once
 * a frame.
 */
export function eulerZXY(rx: number, ry: number, rz: number): Quat {
  const qz = quatFromAxisAngle([0, 0, 1], rz);
  const qx = quatFromAxisAngle([1, 0, 0], rx);
  const qy = quatFromAxisAngle([0, 1, 0], ry);
  return quatMultiply(quatMultiply(qz, qx), qy);
}

/** Where the cup's own origin — the middle of its base — sits, given a pose. */
export function cupTransform(pose: CupPose, height: number): { quaternion: Quat; position: Vec3 } {
  const pivot: Vec3 = [0, GRIP * height, 0];
  const carried = applyQuat(pivot, pose.rotation);
  return {
    quaternion: pose.rotation,
    position: [pose.grip[0] - carried[0], pose.grip[1] - carried[1], pose.grip[2] - carried[2]],
  };
}

/** Where the middle of the open end is, given a pose. */
export function mouthOf(pose: CupPose, height: number): Vec3 {
  const along = applyQuat([0, (1 - GRIP) * height, 0], pose.rotation);
  return [pose.grip[0] + along[0], pose.grip[1] + along[1], pose.grip[2] + along[2]];
}

/** Which way the mouth is facing — the cup's own axis, base to mouth. */
export function mouthAxis(pose: CupPose): Vec3 {
  return applyQuat([0, 1, 0], pose.rotation);
}

/**
 * The pose that tips the cup to `rz` **and puts its mouth exactly there**.
 *
 * **This is the change that makes the pour trustworthy.** The reference gives the pour a translation
 * of its own — the cup goes to some offset and the mouth ends up wherever the rotation leaves it,
 * which is fine when you are pouring onto an open table. Here the dice have to arrive on felt 0.85
 * across, and a mouth a little to one side would put them straight into the wall clamp on their
 * first simulated step: a die snapped bodily sideways on the frame it appears.
 *
 * Placing the mouth and deriving the body removes the possibility rather than tuning it away. There
 * is no offset left to get wrong.
 */
export function mouthPose(rz: number, mouth: Vec3, height: number): CupPose {
  const rotation = quatFromAxisAngle([0, 0, 1], rz);
  const along = applyQuat([0, (1 - GRIP) * height, 0], rotation);
  return { rotation, grip: [mouth[0] - along[0], mouth[1] - along[1], mouth[2] - along[2]] };
}

/** Where the mouth is asked to be at the end of the pour: over the middle of the felt. */
function pourTarget(): Vec3 {
  return [0, POUR_HEIGHT, 0];
}

/**
 * Where the lift hands the cup to the pour: raised, already well over, and with the mouth over the
 * middle of the felt at whatever height being well over has left it.
 *
 * **Held by the mouth, at a height taken from the grip, which is the arrangement both of the
 * failures here argue for.** Placed by the mouth outright, a cup still nearly upright has its whole
 * length *below* the point being placed, so a mouth put where the pour wants it left the base a tenth
 * of a unit under the felt and the cup swept up through the tray on its way over. Turned about the
 * grip outright, the mouth ends the lift out to one side by most of the cup's forward half — and the
 * pour then has to unwind that while the mouth is already pointing down, which is to say while dice
 * are already falling out of it, onto anywhere but the felt. Taking the *height* from the grip and
 * the *centring* from the mouth is neither.
 */
function pourUpPose(height: number): CupPose {
  const rz = pourAngle(PHASE_SECONDS.pourUp);
  const turned = mouthOf({ rotation: quatFromAxisAngle([0, 0, 1], rz), grip: [0, (GRIP + LIFT) * height, 0] }, height);
  return mouthPose(rz, [0, turned[1], 0], height);
}

/**
 * How far through the lift's blend out of the shake, `tau` seconds into it.
 *
 * **The turn's own curve, renormalised.** The lift has two jobs — wash out the tilt and twist the
 * shake left behind, and get the cup started over — and they used to have separate shapes, one an
 * `outCubic` easing into a standstill and the other a `smoothstep` starting from one. Riding the
 * turn's curve means the wash-out finishes exactly as the seam arrives and still moving: measured,
 * the cup reaches the seam turning at about three quarters of the rate the pour takes it on at,
 * against a dead stop before. It goes over in one motion.
 */
function liftBlend(tau: number): number {
  return Math.min(1, smoothstep(tau / TURN_SECONDS) / smoothstep(PHASE_SECONDS.pourUp / TURN_SECONDS));
}

/** The height the grip sits at while shaking, and the height it rests at. */
function shakeGripY(height: number): number {
  return (GRIP + LIFT) * height;
}
/**
 * Going: drifting up in place, while it thins away to nothing.
 *
 * **It keeps the angle it emptied at, and that is the whole design of this phase.** Righting itself
 * on the way out looks better in the abstract and is exactly wrong here: turning back through a
 * radian and a half about a grip most of a cup-length from its far end swings that end most of a
 * unit across the tray — measured, four fifths of one — and it does that over the half second the
 * dice are settling underneath it. A cup that has been emptied stays tipped, which costs nothing to
 * look at and leaves the felt alone.
 *
 * The drift is small for the same reason: where it goes barely matters, because for most of the
 * phase it is not really there.
 */
function fadePose(from: CupPose, tau: number, height: number): CupPose {
  const e = smoothstep(tau / PHASE_SECONDS.fade);
  return { rotation: from.rotation, grip: [from.grip[0], from.grip[1] + FADE_RISE * height * e, from.grip[2]] };
}

/**
 * How solid the cup is, 0 to 1.
 *
 * **Its own function rather than a field on the pose**, because it is the one thing about the cup
 * that is not geometry: every other value here goes into a transform and this one goes into a
 * material. A caller that ignores it gets a cup that vanishes rather than one in the wrong place.
 */
export function cupOpacity(state: CupState): number {
  if (state.done) return 0;
  if (state.phase !== "fade") return 1;
  return 1 - smoothstep(state.tau / PHASE_SECONDS.fade);
}

/** Jiggling the last die out, once it is fully over. */
function pourHoldPose(tau: number, height: number): CupPose {
  const u = tau / PHASE_SECONDS.pourHold;
  const env = ss(0.1, 0.3, u) * (1 - ss(0.7, 1, u));
  const target = pourTarget();
  return mouthPose(
    POUR_OVER + 0.09 * env * Math.sin(19 * tau),
    [
      target[0] + 0.02 * height * env * Math.sin(23 * tau),
      target[1] + 0.025 * height * env * Math.abs(Math.sin(19 * tau)),
      target[2],
    ],
    height,
  );
}

/** Turning over, with the mouth already over the middle of the felt and settling down onto it. */
function pourPose(tau: number, height: number): CupPose {
  // Continuous with `pourUp` by construction: `mouthPose` is the inverse of `mouthOf` at the same
  // rotation, so at zero this rebuilds the pose the last phase ended on exactly.
  //
  // **The mouth only has to come *down* here, because `pourUpPose` already centred it.** It used to
  // travel across as well, and had an ease of its own for it because the traverse had to finish
  // before the mouth pointed downward — a bore's worth of dice leaving an off-centre mouth reaches
  // past the tray wall. That was a race the pour could win only while it opened with the cup still
  // climbing toward the horizontal. It does not any more: the cup is past it within a fifteenth of a
  // second. Centring at the seam retires the race rather than re-timing it.
  const e = smoothstep(Math.min(1, tau / (PHASE_SECONDS.pour * MOUTH_HOME)));
  return mouthPose(
    pourAngle(PHASE_SECONDS.pourUp + tau),
    lerpVec(mouthOf(pourUpPose(height), height), pourTarget(), e),
    height,
  );
}

/** How much of the pour the mouth takes to settle onto its final height. The turn takes all of it. */
const MOUTH_HOME = 0.55;

/**
 * The rattle.
 *
 * **Six sinusoids at unrelated rates, each with its own offset re-thrown per roll.** Related rates
 * would beat against each other and come back to the same pose every second or so, which reads as a
 * mechanism rather than as a hand; unrelated ones never quite repeat. The offsets are what make one
 * hold different from the next — the periods are fixed, so without them every shake would start the
 * same way and a long one would be the only kind that looked varied.
 */
export function shakePose(tau: number, seed: number, height: number): CupPose {
  const t = Number.isFinite(tau) ? Math.max(0, tau) : 0;
  const omega = 2 * Math.PI * SHAKE_RATE;
  const offset = (which: number) => cellNoise(which, seed, CUP_SALT) * Math.PI * 2;
  const env = ss(0, SHAKE_RAMP, t);
  const wave = (which: number, rate: number) => env * Math.sin(rate * omega * t + offset(which));
  return shakeAt(height, [wave(0, 1), wave(1, 1.31), wave(2, 0.53), wave(4, 1.7), wave(3, 2), wave(5, 1.13)]);
}

/**
 * The shake's pose, written in terms of how far along each of its six waves happens to be.
 *
 * **Separated from the waves themselves so `cupEnvelope` can reach the same poses without them.**
 * The frame has to hold every pose a shake *could* reach, and six sinusoids at unrelated rates never
 * repeat — so the envelope walks the corners of this instead of sampling a seed. Sharing the shape
 * means the two cannot come to disagree about what a shake is, which is exactly the drift the
 * sampled envelope exists to prevent.
 *
 * The six, in order: sway across the picture, tip toward and away from the viewer, twist, and the
 * three the grip itself wanders by.
 */
function shakeAt(height: number, at: readonly [number, number, number, number, number, number]): CupPose {
  const a = SHAKE_AMPLITUDE;
  return {
    rotation: eulerZXY(BASE_TILT + TIP_SHARE * a * at[1], 0.3 * a * at[2], a * at[0]),
    grip: [0.035 * height * at[3], shakeGripY(height) + 0.06 * height * at[4], 0.02 * height * at[5]],
  };
}

/**
 * Whether the wrist has just changed direction, for the rattle that plays over it.
 *
 * The sway is `sin(ωτ + p)`, so its reversals are where the cosine changes sign. Compared across a
 * step rather than solved, because the caller has a previous time in hand anyway and a solved answer
 * would still have to be matched to a frame.
 */
export function shakeReversed(previous: number, tau: number, seed: number): boolean {
  if (!(tau > previous)) return false;
  const omega = 2 * Math.PI * SHAKE_RATE;
  const offset = cellNoise(0, seed, CUP_SALT) * Math.PI * 2;
  const before = Math.cos(omega * previous + offset);
  const after = Math.cos(omega * tau + offset);
  return before === 0 ? after !== 0 : before < 0 !== after < 0;
}

/** How hard it is being shaken right now, 0 to 1 — the rattle is only played over the loud part. */
export function shakeEnergy(tau: number): number {
  return ss(0, SHAKE_RAMP, Math.max(0, tau));
}

/** The cup, and where it is in its sequence. */
export interface CupState {
  phase: CupPhase;
  /** Seconds into the current phase. */
  tau: number;
  /** The pose the current phase is easing out of — see the note at the top of this file. */
  from: CupPose;
  pose: CupPose;
  seed: number;
  height: number;
  /** Set when the button is let go. The shake ends on the next step. */
  letGo: boolean;
  /** True once the cup has faded. Nothing more will move, and nothing is left to draw. */
  done: boolean;
}

export function cupState(seed: number, height: number): CupState {
  const from: CupPose = { rotation: IDENTITY, grip: [0, shakeGripY(height) + ENTER_DROP * height, 0] };
  return { phase: "enter", tau: 0, from, pose: from, seed, height, letGo: false, done: false };
}

/** Let go. The shake finishes on the next step and the lift follows straight after it. */
export function releaseCup(state: CupState): void {
  state.letGo = true;
}

/** How long it has been shaking, which is what fills the button and what the limit is measured against. */
export function shakeSecondsOf(state: CupState): number {
  return state.phase === "shake" ? state.tau : 0;
}

/**
 * How long the current phase runs for, or `Infinity` for the one that is held.
 */
function lengthOf(phase: CupPhase): number {
  return phase === "shake" ? Infinity : PHASE_SECONDS[phase];
}

/**
 * Carry the cup forward.
 *
 * **Phases are advanced in a loop rather than one per call**, so a frame long enough to skip a short
 * phase entirely still runs every transition, and each one still eases out of the pose the last one
 * actually ended on. `pour` is half a second and a dropped frame on a loaded machine is comfortably
 * a tenth, so one advancing a single phase per call would be two bad frames from a visible jump.
 */
export function advanceCup(state: CupState, delta: number): void {
  if (state.done) return;
  let left = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  while (left > 0) {
    const length = lengthOf(state.phase);
    const room = length - state.tau;
    if (state.phase === "shake" && state.letGo) {
      // Leaving the shake: the lift starts from wherever the finger left it, which is what makes
      // the seam continuous however energetic the hold was when it ended.
      state.from = state.pose;
      state.phase = "pourUp";
      state.tau = 0;
      continue;
    }
    if (left < room) {
      state.tau += left;
      left = 0;
    } else {
      // Landed exactly on the boundary: settle the pose at the end of this phase, so the next one
      // eases out of the pose that was actually drawn rather than one a rounding error away.
      state.tau = length;
      state.pose = poseAt(state);
      left -= room;
      const next = ORDER[ORDER.indexOf(state.phase) + 1];
      if (!next) {
        state.done = true;
        return;
      }
      state.from = state.pose;
      state.phase = next;
      state.tau = 0;
    }
    state.pose = poseAt(state);
  }
  state.pose = poseAt(state);
}

/**
 * How far over the cup is, this many seconds after the release.
 *
 * **One curve across both phases, and that is the whole of the fix it came from.** The lift used to
 * ease *out* to an angle partway over and the pour used to ease *in* from it, so both rates were zero
 * at the seam and the cup came to a standstill at fifty-one degrees in the middle of being tipped.
 * The dice cannot move toward the mouth until the pull along the cup's axis turns that way, which is
 * past ninety, so the stall was the wait: measured, the first die took most of a second longer than
 * it needed to and the cup hung fully inverted with the dice still in it for half of one.
 *
 * The angle the seam happens to fall at is now a consequence of this rather than a number anybody
 * picked — which is what makes another stall impossible to write rather than merely fixed.
 */
function pourAngle(sinceRelease: number): number {
  return lerp(BASE_TILT, POUR_OVER, smoothstep(sinceRelease / TURN_SECONDS));
}

/** The pose the state describes. Pure in its state, so a test can ask for any moment directly. */
export function poseAt(state: CupState): CupPose {
  const { tau, from, seed, height } = state;
  switch (state.phase) {
    case "enter": {
      const e = outCubic(tau / PHASE_SECONDS.enter);
      const to = shakePose(0, seed, height);
      return { rotation: quatSlerp(from.rotation, to.rotation, e), grip: lerpVec(from.grip, to.grip, e) };
    }
    case "shake":
      return shakePose(tau, seed, height);
    case "pourUp": {
      const e = liftBlend(tau);
      const to = pourUpPose(height);
      return { rotation: quatSlerp(from.rotation, to.rotation, e), grip: lerpVec(from.grip, to.grip, e) };
    }
    case "pour":
      return pourPose(tau, height);
    case "pourHold":
      return pourHoldPose(tau, height);
    case "fade":
      return fadePose(from, tau, height);
  }
}

/**
 * The box the cup needs on screen, in tray units.
 *
 * **Sampled from the animation rather than written down.** A hand-measured box is right until a
 * duration or an amplitude moves, and then it is wrong with nothing to say so — the same argument
 * `orthoFraming` makes against a camera position picked by eye. This walks the track and unions the
 * cup's own corners, so the frame cannot come to disagree with the thing it is framing.
 *
 * **`enter` is deliberately left out.** Its whole job is to be off screen; framing for it would mean
 * sizing every roll around a cup that has not arrived. `fade` is in, because unlike the lift out of
 * shot it replaced, it happens where you can see it.
 *
 * The shake is not a path but a range — six sinusoids that never repeat — so it is covered by its
 * component extremes rather than by sampling a seed. Three levels on each of six components is 729
 * poses, which is a superset of anything a real shake can reach and takes under a millisecond once.
 */
export function cupEnvelope(height: number, radius: number = CUP_BORE * CUP_SCALE): readonly [Vec3, Vec3] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  // The cup as a box: a tube of `radius` standing `height` tall on its own origin.
  const corners: Vec3[] = [];
  for (const x of [-radius, radius]) for (const y of [0, height]) for (const z of [-radius, radius]) corners.push([x, y, z]);
  const swallow = (pose: CupPose) => {
    const { quaternion, position } = cupTransform(pose, height);
    for (const corner of corners) {
      const at = applyQuat(corner, quaternion);
      for (const axis of [0, 1, 2] as const) {
        const value = at[axis] + position[axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  };

  // The shake, as the corners of the range each of its six waves moves through — three levels on
  // each of six is 729 poses, a superset of anything a real shake reaches, and it goes through
  // `shakeAt` so it is the same shake the run draws.
  const levels = [-1, 0, 1];
  for (const w0 of levels)
    for (const w1 of levels)
      for (const w2 of levels)
        for (const w3 of levels)
          for (const w4 of levels)
            for (const w5 of levels) swallow(shakeAt(height, [w0, w1, w2, w3, w4, w5]));

  // **The phases with a shape of their own are sampled through the functions that draw them**,
  // rather than restated here. Restating was how the first version of this went wrong: the poses in
  // it were a copy of the poses in `poseAt`, so a fix to one was invisible to the other, and the
  // frame was sized around a cup that had stopped moving that way.
  const lifted = pourUpPose(height);
  const steps = 120;
  const held = pourHoldPose(PHASE_SECONDS.pourHold, height);
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    swallow(pourPose(u * PHASE_SECONDS.pour, height));
    swallow(pourHoldPose(u * PHASE_SECONDS.pourHold, height));
    swallow(fadePose(held, u * PHASE_SECONDS.fade, height));
  }

  // **The lift is the one phase whose start is a pose only the run knows**, because it eases out of
  // wherever the release left the shake. So it is walked from each corner of the shake's own range
  // rather than from one pose: sixty-four extremes, which is every wave at both ends of its travel,
  // and a lerp between two poses that are both already inside the box cannot leave it by more than
  // the rotation's own bulge.
  const ends = [-1, 1];
  for (const w0 of ends)
    for (const w1 of ends)
      for (const w2 of ends)
        for (const w3 of ends)
          for (const w4 of ends)
            for (const w5 of ends) {
              const start = shakeAt(height, [w0, w1, w2, w3, w4, w5]);
              for (let i = 1; i < 16; i += 1) {
                const u = i / 16;
                swallow({
                  rotation: quatSlerp(start.rotation, lifted.rotation, outCubic(u)),
                  grip: lerpVec(start.grip, lifted.grip, outCubic(u)),
                });
              }
            }

  // **A hair generous, on purpose.** A sampled maximum always under-reports the real one by
  // something like the square of the sample spacing: measured, the pour's furthest reach sat two
  // hundredths of a millimetre outside a box walked at twice the rate the animation is drawn at, and
  // no amount of sampling removes that — it only makes it smaller. A frame a few millimetres wider
  // than it needs to be costs a fraction of a per cent of a die; a frame a hundredth of a millimetre
  // short clips the cup. So the error is spent in the direction that is free.
  const pad = ENVELOPE_PAD * height;
  return [
    [min[0] - pad, min[1] - pad, min[2] - pad],
    [max[0] + pad, max[1] + pad, max[2] + pad],
  ];
}

/** How far outside the sampled extremes the frame is opened. A share of the cup's height. */
const ENVELOPE_PAD = 0.005;

/**
 * Which way is down, in the cup's own frame.
 *
 * **The dice are simulated in the cup's coordinates, which is what lets them be drawn inside it while
 * it moves.** In those coordinates "down" swings as it tips, and a simulation that assumed otherwise
 * would have a die riding the closed end as the cup turned over, as though the bottom of the cup
 * were still the bottom of the world. It was — for as long as nobody could see in.
 */
export function cupGravity(pose: CupPose): Vec3 {
  const q = pose.rotation;
  return applyQuat([0, -1, 0], [-q[0], -q[1], -q[2], q[3]]);
}

/**
 * The vessel the dice are inside, in the cup's own frame.
 *
 * **Round, and the bore rather than a square inscribed in it.** The inscribed square was right while
 * this was invisible — it is the cheap way to be certain nothing ends up through the wall — but it
 * costs a die about fifteen per cent of the bore's width, so it can never actually reach the side.
 * Fine for a container nobody looks into; the first thing you would notice in one you can.
 *
 * The ceiling is the mouth. It is a lid while the cup is being held, or a die would be shaken out of
 * the top: `shakeAccel` pumps energy in for as long as somebody leans on the button, and ten seconds
 * of it will clear a container a fraction of a unit deep. It is a way out once the pour starts.
 */
export function cupBox(height: number, pose?: CupPose, radius: number = CUP_BORE * CUP_SCALE): TrayBox {
  return { half: radius, round: true, floorY: 0, ceilingY: height, gravity: pose ? cupGravity(pose) : undefined };
}

/**
 * Everything the throw needs to know about the cup, for every step of it.
 *
 * **The whole pour is baked at the release, and this is what makes that possible.** From the moment
 * somebody lets go, the cup's motion is fixed-length and `poseAt` is pure — so the pose at every
 * step of the next two seconds can simply be walked out in advance. The dice's own state is known
 * too. Nothing about the rest of the throw depends on anything that has not happened yet.
 *
 * That matters for one thing in particular: the clatter is scheduled ahead of the dice rather than
 * fired when they land, and it can only be scheduled ahead if the moment they land is known before
 * they are drawn.
 *
 * `until` is the last step the cup still exists for — anything still inside is tipped out then,
 * because the cup is about to fade and a die in it would go with it.
 */
export interface Pouring {
  held: HeldIn;
  /** The cup's pose at each step, so the drawn cup and the baked dice share one clock. */
  poses: readonly CupPose[];
}

export function pourFrom(state: CupState, inside: readonly boolean[]): Pouring {
  const height = state.height;
  const walker: CupState = { ...state };
  const poses: CupPose[] = [walker.pose];
  let until = 0;
  // Bounded by the phase durations, which are constants — but a walk that could not end would hang
  // a browser rather than fail, so it is bounded here as well.
  for (let guard = 0; guard < 10000 && !walker.done; guard += 1) {
    advanceCup(walker, THROW_STEP);
    poses.push(walker.pose);
    if (walker.phase !== "fade") until = poses.length - 1;
  }

  const at = (step: number): VesselAt => {
    const now = poses[Math.min(Math.max(0, step), poses.length - 1)]!;
    const before = poses[Math.min(Math.max(0, step - 1), poses.length - 1)]!;
    const { quaternion, position } = cupTransform(now, height);
    const mouth = mouthOf(now, height);
    const back = mouthOf(before, height);
    return {
      box: { ...cupBox(height, now), open: true },
      rotation: quaternion,
      position,
      mouthY: height,
      velocity: [(mouth[0] - back[0]) / THROW_STEP, (mouth[1] - back[1]) / THROW_STEP, (mouth[2] - back[2]) / THROW_STEP],
    };
  };

  return { held: { inside, at, until }, poses };
}
