import { cellNoise } from "../schema/noise.js";

// Dice, and the reason they are not `Math.random()`.
//
// **There is no randomness anywhere else in this repo, and that is on purpose.** Every varying
// thing — which tree grows where, how long a burn smokes, where a bolt lands, how a cloud drifts —
// derives from `cellNoise` and a seed. `engine/lightning.ts` records what happened the one time
// something reached for the platform instead: a strike chosen by `Math.random()` moved every time
// anything redrew, so no test could pin it and the same storm was never the same storm twice.
//
// Initiative has the same shape of problem. A roll is a fact about an encounter — it decides the
// order for the whole fight, and the order is fixed from round to round — so it has to survive a
// redraw, a rebuild and a reload. Seeded, it does, and a test can assert an exact order.
//
// The cost is that a re-roll has to be asked for rather than just happening: rolling again means
// changing the seed, which is what `rerollSeed` is for. That is the honest shape of the thing —
// "roll again" is a decision someone makes, not a side effect of asking twice.

/**
 * One die of `sides`, from a seed and an index within that seed.
 *
 * `index` is what lets one seed serve a whole table: each combatant asks with its own, and the
 * results are independent because `cellNoise`'s two coordinates are. Nothing here consumes state,
 * so asking twice with the same arguments always gives the same answer — which is the property the
 * whole module exists for, and also the thing to remember when writing a caller that wants two
 * different rolls: give them different indices, not two calls.
 */
export function rollDie(sides: number, seed: number, index: number): number {
  if (!Number.isFinite(sides) || sides < 1) return 1;
  const faces = Math.floor(sides);
  // Floor of a [0, 1) noise value scaled to the face count. Clamped at the top for the rounding
  // edge cellNoise's own callers guard the same way — the product only reaches `faces` on a
  // floating-point boundary, and a wrap to zero there would make a d20 occasionally roll a 0.
  return Math.min(faces, 1 + Math.floor(cellNoise(seed, index, DIE_SALT) * faces));
}

/** cellNoise stream for dice. Clear of every salt in the repo — see BACKLOG.md on the run. */
const DIE_SALT = 1181;

/**
 * A handful of the same die, added up: 2d6, 8d6, 1d4.
 *
 * **Consecutive indices, which is the whole reason this is a function and not a loop at the call
 * site.** `rollDie` has no state, so two calls with the same arguments give the same number twice —
 * a caller writing "roll 2d6" as `rollDie(6, seed, i) * 2` or as two identical calls gets a
 * distribution with no 7 in it and no error anywhere. Asking for the dice together makes that
 * impossible to write.
 *
 * The indices run from `index` upward, so a caller giving two rolls indices 0 and 1 will have them
 * collide the moment either is more than one die. Space them by the largest roll in play — the same
 * care `SECOND_DIE_OFFSET` takes, for the same reason.
 */
export function rollDice(count: number, sides: number, seed: number, index: number): number {
  if (!Number.isFinite(count) || count < 1) return 0;
  let total = 0;
  for (let die = 0; die < Math.floor(count); die += 1) total += rollDie(sides, seed, index + die);
  return total;
}

/** The die every check in this game is made with. */
export const D20 = 20;

/**
 * A d20 check: the die plus a modifier, rolled straight, with Advantage, or with Disadvantage.
 *
 * **Two rolls and take one**, which is what the SRD means by Advantage and Disadvantage — not a
 * bonus and not a re-roll. Taking the higher of two d20s is worth about +3.3 on average and is
 * shaped quite differently from +3, which is why it is worth implementing rather than approximating.
 *
 * The second die comes from a derived index rather than from a second call with the same one, for
 * the reason `rollDie`'s own note gives: this module has no state, so the same arguments give the
 * same answer, and "roll two dice" has to mean "ask two different questions".
 */
export type Advantage = "flat" | "advantage" | "disadvantage";

export function d20Check(modifier: number, seed: number, index: number, mode: Advantage = "flat"): number {
  return d20CheckDetail(modifier, seed, index, mode).total;
}

/** Everything a d20 check did, for a caller that has to show its working. */
export interface D20Roll {
  /** The dice as they were rolled: two for Advantage or Disadvantage, one for a flat check. */
  dice: readonly number[];
  /** The one that counted. Equal to `dice[0]` on a flat check. */
  kept: number;
  /** The modifier as applied — truncated, and zero for anything that was not a number. */
  modifier: number;
  total: number;
}

/**
 * The same check, with the dice it threw.
 *
 * **`d20Check` is this function's total**, rather than the two being written side by side. A dice
 * tray has to show you both dice of an Advantage roll and which one it kept — a panel that only
 * reported 17 would be asking you to take its word for it — and the *rule* for where the second die
 * comes from must not exist twice. `SECOND_DIE_OFFSET` is private, so a second implementation could
 * not even agree with this one by accident.
 */
export function d20CheckDetail(
  modifier: number,
  seed: number,
  index: number,
  mode: Advantage = "flat",
): D20Roll {
  const bonus = Number.isFinite(modifier) ? Math.trunc(modifier) : 0;
  const first = rollDie(D20, seed, index);
  if (mode === "flat") return { dice: [first], kept: first, modifier: bonus, total: first + bonus };
  // Offset far enough that a table of a few dozen combatants cannot have one member's second die
  // collide with another member's first.
  const second = rollDie(D20, seed, index + SECOND_DIE_OFFSET);
  const kept = mode === "advantage" ? Math.max(first, second) : Math.min(first, second);
  return { dice: [first, second], kept, modifier: bonus, total: kept + bonus };
}

/**
 * How far the second die of an Advantage roll sits from the first.
 *
 * Large and prime, so it cannot alias with a small index run. A collision here would be invisible
 * and would quietly correlate two combatants' rolls, which is exactly the failure the salt block in
 * `renderer/scene3dMath.ts` and the BACKLOG entry beside it are about.
 *
 * **Exported so callers can prove they stay clear of it.** It was private while initiative was the
 * only caller and one combatant per index was the whole scheme; a dice tray hands out a block of
 * indices per die type, and "does the block run reach the second-die offset" is a question that
 * should be answerable by a test rather than by reading this file. See `DIE_BLOCK` in engine/tray.ts.
 */
export const SECOND_DIE_OFFSET = 7919;

/**
 * A different seed, for rolling again.
 *
 * Deliberately a function rather than "add one": consecutive seeds are not independent in an
 * obvious way to a reader, and a caller writing `seed + 1` would have to know that they happen to
 * be here. It is a hash step, so successive re-rolls wander rather than march.
 */
export function rerollSeed(seed: number): number {
  return Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0;
}
