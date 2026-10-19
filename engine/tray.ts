import { D20, SECOND_DIE_OFFSET, d20CheckDetail, rollDie, type Advantage } from "./dice.js";

// A handful of dice, thrown together.
//
// **`engine/dice.ts` rolls; this decides what to roll and keeps the answers apart.** The split is
// worth stating because the hard part here is not the arithmetic — `rollDie` has been right and
// tested for months — it is that a stateless die gives the same number for the same index, so a
// tray of five d6 is five chances to ask the same question and get one answer five times. Every
// rule below exists to make that impossible to write by accident.
//
// Nothing here knows about a character, a panel or a map. It takes a list of dice and a seed and
// hands back what they showed.

/**
 * The dice this app rolls.
 *
 * Seven, because that is the set a d20 game uses. A d2 or a d3 is a d6 read differently and a d30
 * is a curiosity; neither is worth a button.
 */
export type DieSides = 4 | 6 | 8 | 10 | 12 | 20 | 100;

/**
 * In the order they are offered, which is **not** ascending.
 *
 * The d20 first because it is the one nearly every roll uses, then down the ladder with the
 * percentile pair kept together. Read left to right this is roughly "how often will you want this",
 * which is what a menu should be sorted by.
 */
export const DICE: readonly DieSides[] = [20, 12, 100, 10, 8, 6, 4];

/**
 * How many indices each die type owns.
 *
 * **The one number here that is silently wrong if it is wrong.** `rollDie` is stateless — the same
 * `(sides, seed, index)` always gives the same face — so every die in a throw needs an index no
 * other die is using. Each type gets a contiguous block and counts within it, which makes a
 * collision a matter of arithmetic rather than of remembering.
 *
 * 100 is far more dice of one kind than anybody rolls, and seven blocks of it come to 700 — well
 * clear of `SECOND_DIE_OFFSET`, where an Advantage roll puts its second die. That margin is the
 * real constraint and `tests/tray.test.ts` asserts it rather than trusting this comment.
 */
export const DIE_BLOCK = 100;

/** How many of one kind of die are in the tray. Absent and zero mean the same thing. */
export type TrayPicks = Partial<Record<DieSides, number>>;

export interface RolledDie {
  sides: DieSides;
  face: number;
  /**
   * Whether this die counted toward the total.
   *
   * Only ever false for the discarded half of an Advantage or Disadvantage roll. It is on the die
   * rather than implied by position because a tray that showed you a 3 and a 17 and a total of 17
   * without saying which it kept would be showing its working and hiding its reasoning.
   */
  kept: boolean;
}

export interface TrayRoll {
  dice: readonly RolledDie[];
  /** As applied: truncated, and zero where no ability was picked. */
  modifier: number;
  total: number;
}

export interface TrayOptions {
  modifier?: number;
  mode?: Advantage;
}

/**
 * Whether Advantage means anything for this tray.
 *
 * **One d20 and nothing else.** Advantage is a d20 mechanic — the SRD defines it as rolling the d20
 * twice for one check — and "3d6 with advantage" is not a rule this game has. Rather than invent
 * one, or apply it to the first d20 and quietly ignore the rest of the handful, the control is
 * simply not offered unless the tray is the thing the rule is about.
 */
export function allowsAdvantage(picks: TrayPicks): boolean {
  return countOf(picks, D20) === 1 && total(picks) === 1;
}

/** How many dice are in the tray altogether. */
export function total(picks: TrayPicks): number {
  return DICE.reduce((sum, sides) => sum + countOf(picks, sides), 0);
}

function countOf(picks: TrayPicks, sides: DieSides): number {
  const count = picks[sides];
  if (!Number.isFinite(count) || count === undefined || count < 0) return 0;
  return Math.min(DIE_BLOCK, Math.floor(count));
}

/**
 * Throw the tray.
 *
 * Dice come back in `DICE` order rather than in the order they were added, so a handful reads the
 * same way twice and the panel does not reshuffle itself as you add to it.
 *
 * **Advantage is applied only where `allowsAdvantage` says it means something**, and asked here as
 * well as in the panel: a caller that offered the toggle and forgot to disable it should get a flat
 * roll rather than a rule this game does not have.
 */
export function rollTray(picks: TrayPicks, seed: number, options: TrayOptions = {}): TrayRoll {
  const modifier = Number.isFinite(options.modifier) ? Math.trunc(options.modifier!) : 0;
  const mode: Advantage = options.mode ?? "flat";

  if (mode !== "flat" && allowsAdvantage(picks)) {
    // Straight to the check, so the pair of dice and the rule for where the second comes from are
    // the same ones initiative uses. Index 0: this tray is the only thing rolling on this seed.
    const check = d20CheckDetail(modifier, seed, 0, mode);
    const [first, second] = check.dice;
    return {
      dice: [
        { sides: D20 as DieSides, face: first!, kept: first === check.kept },
        // Marked against the *other* die rather than against `kept`, or two dice that rolled the
        // same number would both be marked kept and the total would look like it dropped one.
        { sides: D20 as DieSides, face: second!, kept: first !== check.kept },
      ],
      modifier,
      total: check.total,
    };
  }

  const dice: RolledDie[] = [];
  let sum = 0;
  DICE.forEach((sides, type) => {
    const count = countOf(picks, sides);
    for (let die = 0; die < count; die += 1) {
      // The block, and the die's place in it. Two dice of one kind differ because `die` does; two
      // kinds differ because `type` does.
      const face = rollDie(sides, seed, type * DIE_BLOCK + die);
      dice.push({ sides, face, kept: true });
      sum += face;
    }
  });

  // **The modifier lands once, on the handful.** Per die it would turn 3d6+2 into 3d6+6, which is a
  // different roll that looks like a typo.
  return { dice, modifier, total: dice.length === 0 ? 0 : sum + modifier };
}
