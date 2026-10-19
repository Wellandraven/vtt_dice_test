import { describe, expect, it } from "vitest";
import {
  CUP_BORE,
  CUP_SCALE,
  POUR_HEIGHT,
  PHASE_SECONDS,
  advanceCup,
  cupBox,
  cupEnvelope,
  cupOpacity,
  cupState,
  cupTransform,
  mouthAxis,
  mouthOf,
  mouthPose,
  poseAt,
  pourFrom,
  releaseCup,
  shakeEnergy,
  shakePose,
  shakeReversed,
  shakeSecondsOf,
  type CupPhase,
  type CupPose,
} from "../renderer/cupMath.js";
import {
  DIE_SIZE_CAPS,
  advanceShake,
  applyQuat,
  dieRadius,
  dieState,
  packInto,
  settleFrom,
  type Vec3,
} from "../renderer/diceMath.js";

/** The shortest hold a click is given, from renderer/diceFx.ts. */
const MIN_SHAKE = 0.35;

// The cup, as arithmetic.
//
// **What is being checked here is not that the poses look nice.** It is the three things about them
// that are load-bearing and invisible: that the seams between separately written curves do not jump,
// that the cup never sweeps through the tray it is pouring into, and that when the dice are handed
// over the mouth is somewhere they can actually land. Every one of those would otherwise be found by
// watching a two-second animation and squinting.

/** The tray's felt and its walls, from renderer/diceFx.ts. */
const TRAY = { half: 0.42, floorY: 0 };
const HEIGHT = CUP_SCALE;
const RADIUS = CUP_BORE * CUP_SCALE;
const STEP = 1 / 120;

/**
 * The cup as points, in its own frame: two rings, base and mouth.
 *
 * **Round rather than the eight corners of a box**, which is what the file itself is — a faceted
 * tube — and the difference is not cosmetic. A square cross-section reaches out to the bore times
 * root two along its diagonal, so a box model of a leaning cup dips further below the table than the
 * cup does and would fail the seating test for a reason the model does not have.
 */
const RING = 24;
function corners(): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < RING; i += 1) {
    const angle = (i * 2 * Math.PI) / RING;
    for (const y of [0, HEIGHT]) out.push([Math.cos(angle) * RADIUS, y, Math.sin(angle) * RADIUS]);
  }
  return out;
}

/** Where a pose puts the cup's corners, in tray units. */
function shell(pose: CupPose): Vec3[] {
  const { quaternion, position } = cupTransform(pose, HEIGHT);
  return corners().map((corner) => {
    const at = applyQuat(corner, quaternion);
    return [at[0] + position[0], at[1] + position[1], at[2] + position[2]] as Vec3;
  });
}

/** How far apart two poses are: the largest distance any corner of the cup moves between them. */
function apart(a: CupPose, b: CupPose): number {
  const from = shell(a);
  const to = shell(b);
  return Math.max(...from.map((p, i) => Math.hypot(p[0] - to[i]![0], p[1] - to[i]![1], p[2] - to[i]![2])));
}

/** Run a whole cup from press until it has faded, holding for `held` seconds, sampling every step. */
interface Frame {
  phase: CupPhase;
  tau: number;
  pose: CupPose;
  opacity: number;
  seconds: number;
}

function run(held: number, seed = 4242): Frame[] {
  const state = cupState(seed, HEIGHT);
  const track: Frame[] = [];
  let elapsed = 0;
  while (!state.done && elapsed < 30) {
    if (elapsed >= PHASE_SECONDS.enter + held) releaseCup(state);
    advanceCup(state, STEP);
    elapsed += STEP;
    track.push({
      phase: state.phase,
      tau: state.tau,
      pose: state.pose,
      opacity: cupOpacity(state),
      seconds: elapsed,
    });
  }
  return track;
}

describe("the cup's pose", () => {
  it("starts above the frame and comes down to the shake", () => {
    const state = cupState(1, HEIGHT);
    expect(state.phase).toBe("enter");
    // Its base is well clear of the tray at the start — it is dropping in, not standing there.
    expect(Math.min(...shell(state.pose).map((p) => p[1]))).toBeGreaterThan(HEIGHT);
    advanceCup(state, PHASE_SECONDS.enter);
    expect(apart(state.pose, shakePose(0, 1, HEIGHT))).toBeLessThan(1e-9);
  });

  it("never jumps between one phase and the next", () => {
    // **The defect this is for**, and the reason the phases are written as lerps out of the previous
    // pose rather than as the reference reel writes them. The reel is a loop whose shake fades to a
    // known pose before the next phase begins; a shake somebody is holding ends wherever their
    // finger left it, so an author's constant would be a visible snap on most releases.
    //
    // Measured as how far a corner moves in one step, against how far it moves in a step either
    // side: a seam is a jump only if it is out of scale with the motion around it.
    for (const held of [0.4, 1.7, 4.3]) {
      const track = run(held);
      for (let i = 2; i + 2 < track.length; i += 1) {
        const here = apart(track[i - 1]!.pose, track[i]!.pose);
        const around = Math.max(apart(track[i - 2]!.pose, track[i - 1]!.pose), apart(track[i]!.pose, track[i + 1]!.pose));
        const label = `${track[i - 1]!.phase} -> ${track[i]!.phase} at ${track[i]!.seconds.toFixed(3)}s`;
        expect(here, label).toBeLessThan(Math.max(0.004, around * 3));
      }
    }
  });

  it("finishes, whatever it was given", () => {
    for (const held of [0, 0.05, 1, 9.9]) {
      const track = run(held);
      expect(track.length, `held ${held}`).toBeGreaterThan(0);
      expect(track.at(-1)!.phase).toBe("fade");
      // Every phase runs, in order, exactly once.
      const seen = track.map((f) => f.phase).filter((phase, i, all) => phase !== all[i - 1]);
      expect(seen).toEqual(["enter", "shake", "pourUp", "pour", "pourHold", "fade"]);
    }
  });

  it("counts the hold as the shake and nothing else", () => {
    // The button fills toward the ten-second limit off this, so the drop-in before the rattle
    // starts must not be time anybody was credited with holding.
    const state = cupState(7, HEIGHT);
    advanceCup(state, PHASE_SECONDS.enter / 2);
    expect(shakeSecondsOf(state)).toBe(0);
    advanceCup(state, PHASE_SECONDS.enter / 2 + 1);
    expect(state.phase).toBe("shake");
    expect(shakeSecondsOf(state)).toBeCloseTo(1, 6);
    releaseCup(state);
    advanceCup(state, STEP);
    expect(shakeSecondsOf(state)).toBe(0);
  });

  it("goes straight from the shake to the lift", () => {
    // **There is no tap.** The reference reel slams the cup down and lets it wobble before picking it
    // back up, which is two thirds of a second of nothing happening between letting go and seeing a
    // number. Asserted as an ordering rather than as an absence, so it fails if the phase comes back.
    const track = run(1);
    const at = track.findIndex((f) => f.phase === "pourUp");
    expect(at).toBeGreaterThan(0);
    expect(track[at - 1]!.phase).toBe("shake");
  });

  it("thins away to nothing rather than being carried off", () => {
    const track = run(1);
    // Solid for the whole roll, and only then going.
    for (const frame of track) {
      if (frame.phase !== "fade") expect(frame.opacity, `${frame.phase} at ${frame.tau.toFixed(3)}`).toBe(1);
    }
    const fading = track.filter((f) => f.phase === "fade");
    expect(fading.length).toBeGreaterThan(10);
    expect(fading[0]!.opacity).toBeGreaterThan(0.99);
    for (let i = 1; i < fading.length; i += 1) {
      expect(fading[i]!.opacity, `step ${i}`).toBeLessThanOrEqual(fading[i - 1]!.opacity);
    }
    expect(fading.at(-1)!.opacity).toBeLessThan(0.01);

    // **And it does not wander off while it goes.** Lifted out of shot instead — which is what this
    // replaced — it has to travel most of its own height again before it stops covering the tray,
    // and it is covering the tray at exactly the moment the dice are settling on it.
    expect(apart(fading[0]!.pose, fading.at(-1)!.pose)).toBeLessThan(HEIGHT / 2);

    // Gone for good once it is done, whatever anyone asks it afterwards.
    const state = cupState(1, HEIGHT);
    releaseCup(state);
    advanceCup(state, 30);
    expect(state.done).toBe(true);
    expect(cupOpacity(state)).toBe(0);
  });

  it("steps every transition however long the frame was", () => {
    // A dropped frame on a loaded machine is comfortably a tenth of a second and `pour` is half of
    // one, so a machine that advanced a single phase per call would be two bad frames from skipping
    // one entirely — and each phase eases out of the pose the last one ended on, so a skipped phase
    // is a pose nothing eased out of.
    const state = cupState(11, HEIGHT);
    releaseCup(state);
    advanceCup(state, 30);
    expect(state.done).toBe(true);

    // The same run in one call and in small ones lands in the same place.
    const stepped = cupState(11, HEIGHT);
    releaseCup(stepped);
    for (let i = 0; i < 400; i += 1) advanceCup(stepped, STEP);
    expect(stepped.done).toBe(true);
    expect(apart(state.pose, stepped.pose)).toBeLessThan(1e-9);
  });
});

describe("the shake", () => {
  it("is a different shake for every roll", () => {
    const a = shakePose(0.7, 101, HEIGHT);
    const b = shakePose(0.7, 202, HEIGHT);
    expect(apart(a, b)).toBeGreaterThan(0.02);
  });

  it("comes up to strength rather than switching on", () => {
    expect(shakeEnergy(0)).toBe(0);
    expect(shakeEnergy(0.09)).toBeGreaterThan(0);
    expect(shakeEnergy(0.09)).toBeLessThan(1);
    expect(shakeEnergy(1)).toBe(1);
  });

  it("reports a reversal about as often as it sways", () => {
    // Twice per cycle at four and a bit cycles a second, so about nine a second. The rattle is
    // played on these, and a count wildly out either way is a rattle that is either a drone or
    // silence.
    let count = 0;
    for (let i = 1; i <= 120; i += 1) if (shakeReversed((i - 1) * STEP, i * STEP, 5)) count += 1;
    expect(count).toBeGreaterThanOrEqual(8);
    expect(count).toBeLessThanOrEqual(10);
  });
});

describe("the pour", () => {
  it("turns the mouth over, and keeps turning it", () => {
    // The cup's own axis runs base to mouth, so a mouth pointing down is a negative y. It has to get
    // there, because that is the only thing that empties it: nothing inside moves toward the mouth
    // until the pull along the cup's axis points that way.
    const track = run(1.2).filter((f) => f.phase === "pourUp" || f.phase === "pour");
    const facing = track.map((f) => mouthAxis(f.pose)[1]);
    expect(facing[0]!, "starts with the mouth still up").toBeGreaterThan(0);
    expect(facing.at(-1)!, "ends with it well over").toBeLessThan(-0.9);
    for (let i = 1; i < facing.length; i += 1) {
      expect(facing[i]!, `step ${i}`).toBeLessThanOrEqual(facing[i - 1]! + 1e-9);
    }
  });

  it("goes over in one motion rather than stopping halfway", () => {
    // **The defect this schedule was written to fix, as arithmetic.** The lift used to ease *out* to
    // an authored angle and the pour to ease *in* from it, so both rates were zero where they met and
    // the cup stood still at fifty-one degrees in the middle of being tipped. Measured, the rate at
    // that seam was three thousandths of a second against a peak of seven — a dead stop — and nothing
    // inside a cup moves toward the mouth until it is past ninety, so the stall *was* the wait.
    //
    // Checked at the seam rather than as a global minimum: the rate here is the mouth's *height*
    // changing, which goes to zero at both ends of the turn because the cup is upright at one and
    // inverted at the other. Those zeroes are geometry. A zero in the middle is a stall.
    for (const held of [0.4, 1.2, 3.3]) {
      const track = run(held).filter((f) => f.phase === "pourUp" || f.phase === "pour");
      const rate = (i: number) => (mouthAxis(track[i - 1]!.pose)[1] - mouthAxis(track[i]!.pose)[1]) / STEP;
      const seam = track.findIndex((f) => f.phase === "pour");
      const before = rate(seam - 1);
      const after = rate(seam + 1);
      const peak = Math.max(...track.map((_, i) => (i > 0 ? rate(i) : 0)));
      expect(before, `held ${held}: still turning into the seam`).toBeGreaterThan(peak / 3);
      expect(after, `held ${held}: still turning out of it`).toBeGreaterThan(peak / 3);
      // Continuous in *rate*, not only in position. Position continuity has been tested since the
      // seam was written and passes on both schedules, which is exactly why the stall survived it.
      expect(Math.max(before, after) / Math.min(before, after), `held ${held}: seam is smooth`).toBeLessThan(2);
    }
  });

  it("has the mouth over the middle before it ever points down", () => {
    // The mouth used to arrive over the felt partway through the pour, which was safe only while the
    // cup spent the first fifth of a second of it still climbing toward the horizontal. It is past
    // the horizontal almost at once now, and a mouth pointing down is a mouth dice fall out of.
    for (const held of [0.4, 1.2, 3.3]) {
      const first = run(held).find((f) => f.phase !== "enter" && f.phase !== "shake" && mouthAxis(f.pose)[1] <= 0);
      expect(first, `held ${held}: it does point down`).toBeDefined();
      const mouth = mouthOf(first!.pose, HEIGHT);
      expect(Math.hypot(mouth[0], mouth[2]), `held ${held}`).toBeLessThan(1e-9);
    }
  });

  it("keeps the mouth over the felt for the whole of it", () => {
    // **What would otherwise be found by eye**, as dice teleporting sideways off a wall on the frame
    // they appear: `advanceDie` clamps a centre to `half - radius` on its very first step, so a die
    // leaving a mouth that is not over the tray is snapped bodily across it. They now leave whenever
    // the physics takes them out rather than at one chosen instant, so the mouth has to be over the
    // felt for the whole time it is pointing down, not just at one moment of it.
    for (const frame of run(1.2)) {
      if (frame.phase !== "pour" && frame.phase !== "pourHold") continue;
      if (mouthAxis(frame.pose)[1] > 0) continue;
      const mouth = mouthOf(frame.pose, HEIGHT);
      const label = `${frame.phase} at ${frame.tau.toFixed(3)}`;
      // Inside the tray's walls with a bore to spare, and above the felt.
      expect(Math.hypot(mouth[0], mouth[2]) + cupBox(HEIGHT).half, label).toBeLessThan(TRAY.half);
      expect(mouth[1], label).toBeGreaterThan(TRAY.floorY);
    }
  });

  it("puts the mouth over the middle of the felt when it is done", () => {
    const track = run(1.2);
    const end = track.filter((f) => f.phase === "pour").at(-1)!;
    const mouth = mouthOf(end.pose, HEIGHT);
    // The last frame the run actually drew, which is a step short of the phase's end — so this is
    // "arrived", not "arrived to the twelfth decimal place". A step of the pour is a hundredth of a
    // radian, and what is being checked is that the mouth is aimed at the middle.
    expect(Math.hypot(mouth[0], mouth[2])).toBeLessThan(1e-3);
    expect(Math.abs(mouth[1] - POUR_HEIGHT)).toBeLessThan(1e-3);
  });

  it("rebuilds the pose it was given, so the mouth anchor is exact", () => {
    // `mouthPose` is the inverse of `mouthOf` at the same rotation, which is what makes the seam
    // into the pour continuous without a blend.
    const pose = mouthPose(-1.6, [0.1, 0.5, -0.2], HEIGHT);
    const mouth = mouthOf(pose, HEIGHT);
    expect(mouth[0]).toBeCloseTo(0.1, 12);
    expect(mouth[1]).toBeCloseTo(0.5, 12);
    expect(mouth[2]).toBeCloseTo(-0.2, 12);
  });
});

describe("the cup and the tray", () => {
  it("never dips below the felt", () => {
    // **This one caught a real defect.** Seated by the middle of its base, a cup landing with a
    // tenth of a radian of forward lean put its far rim a fifth of the tray's own height *under* the
    // felt — and the pour, anchored by its mouth while still nearly upright, swept the whole body up
    // through the tray on the way over. Both read as the cup passing through the table.
    for (const held of [0.4, 2.2]) {
      for (const frame of run(held)) {
        if (frame.phase === "enter") continue;
        const lowest = Math.min(...shell(frame.pose).map((p) => p[1]));
        expect(lowest, `${frame.phase} at ${frame.tau.toFixed(3)}`).toBeGreaterThan(TRAY.floorY - 1e-3);
      }
    }
  });

  it("empties itself before it goes, at every size and handful", () => {
    // **What sizes `pourHold`.** It is the last phase the cup exists for, and `HeldIn.until` tips out
    // by force anything still inside when it ends — which is the one thing about this pour that could
    // look wrong, a die appearing at the mouth because the clock said so rather than because it got
    // there. So the phase is measured against the slowest handful rather than picked, and this is the
    // measurement: nothing is ever forced, and the last die out has room to spare.
    //
    // Run through the real cup rather than a stand-in, unlike the vessel tests in
    // `tests/diceMath.test.ts` — the question here *is* whether this particular schedule turns fast
    // enough for gravity to empty it in time.
    let last = 0;
    for (const size of [1, 2, 3] as const) {
      for (const count of [1, 6, 20]) {
        for (const hold of [MIN_SHAKE, 1.5, 9.7]) {
          const radius = dieRadius(count, TRAY, size);
          const dice = Array.from({ length: count }, (_, i) =>
            dieState({ position: [0, 0, 0], velocity: [0, 0, 0], spin: [3 + i, 2, 5], radius, landing: [0, 0, 0, 1] }),
          );
          packInto(dice, cupBox(HEIGHT));

          const cup = cupState(7 + count, HEIGHT);
          let seconds = 0;
          for (let step = 0; cup.phase === "enter" || cup.phase === "shake"; step += 1) {
            if (step * STEP >= PHASE_SECONDS.enter + hold && shakeSecondsOf(cup) >= MIN_SHAKE) releaseCup(cup);
            advanceCup(cup, STEP);
            if (cup.phase !== "enter" && cup.phase !== "shake") break;
            advanceShake(dice, cupBox(HEIGHT, cup.pose), cup.seed, seconds);
            seconds += STEP;
          }

          const left = dice.map(() => -1);
          const pouring = pourFrom(cup, dice.map(() => true));
          pouring.held.onLeave = (i, step) => {
            if (left[i]! < 0) left[i] = step;
          };
          settleFrom(dice, dice.map(() => [0, 0, 0, 1] as const), TRAY, pouring.held);
          const label = `size ${size}, ${count} dice, held ${hold}`;
          for (const [i, step] of left.entries()) {
            expect(step, `${label}: die ${i} left through the mouth`).toBeGreaterThanOrEqual(0);
            expect(step, `${label}: die ${i} was not forced out`).toBeLessThan(pouring.held.until);
          }
          last = Math.max(last, Math.max(...left) * STEP);
        }
      }
    }
    // Measured at one and three tenths of a second against a deadline of one and a half. A margin
    // this size is what `pourHold` is buying; if it thins, that is the number to look at.
    expect(last).toBeLessThan(PHASE_SECONDS.pourUp + PHASE_SECONDS.pour + PHASE_SECONDS.pourHold - 0.1);
  });

  it("holds a die at every size setting", () => {
    // `CUP_SCALE` is a number chosen against this, so it should fail loudly if `DIE_SIZE_CAPS` moves
    // rather than quietly clipping a die through a wall nobody can see into.
    const box = cupBox(HEIGHT);
    for (const size of [1, 2, 3] as const) {
      const radius = dieRadius(1, TRAY, size);
      expect(radius).toBe(DIE_SIZE_CAPS[size]);
      expect(box.half / radius, `size ${size}`).toBeGreaterThan(1.2);
    }
    expect(box.ceilingY).toBe(HEIGHT);
  });
});

/**
 * The furthest anything sticks out of the envelope over a whole run, and where.
 *
 * One number rather than a hundred thousand assertions: the loops below are half a million points
 * between them, and an `expect` each is most of a second of test time to say the same thing.
 */
function escapes(held: number, seed: number): { worst: number; where: string } {
  const [min, max] = cupEnvelope(HEIGHT);
  let worst = 0;
  let where = "nothing";
  for (const frame of run(held, seed)) {
    if (frame.phase === "enter") continue;
    for (const point of shell(frame.pose)) {
      for (const axis of [0, 1, 2] as const) {
        const out = Math.max(min[axis] - point[axis], point[axis] - max[axis]);
        if (out > worst) {
          worst = out;
          where = `${frame.phase} at ${frame.tau.toFixed(3)}, axis ${axis}, by ${out.toFixed(6)}`;
        }
      }
    }
  }
  return { worst, where };
}

describe("the envelope", () => {
  it("contains the cup everywhere it goes while it is on screen", () => {
    // The claim `cupEnvelope` makes is about the animation, so it is checked against the animation
    // rather than against a copy of its own arithmetic. Anything outside it is a cup with its top
    // cropped off, which is the whole failure the sampled envelope exists to prevent.
    for (const held of [0.4, 1.1, 3.5]) {
      const { worst, where } = escapes(held, 4242);
      expect(worst, `held ${held}: ${where}`).toBe(0);
    }
  });

  it("does not grow with the seed", () => {
    // It walks the range each of the shake's six waves moves through rather than sampling one roll,
    // so a frame cannot come out a different size for a different throw.
    for (const seed of [1, 999, 40404]) {
      const { worst, where } = escapes(2, seed);
      expect(worst, `seed ${seed}: ${where}`).toBe(0);
    }
  });
});

describe("poseAt", () => {
  it("is pure in its state, so any moment can be asked for directly", () => {
    // Which is what lets `diceFx` measure the mouth's own speed by stepping one frame backward
    // rather than by keeping a previous pose about.
    const state = cupState(3, HEIGHT);
    releaseCup(state);
    advanceCup(state, PHASE_SECONDS.enter + PHASE_SECONDS.pourUp + 0.2);
    const again = poseAt({ ...state });
    expect(apart(state.pose, again)).toBe(0);
  });
});
