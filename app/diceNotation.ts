import type { Advantage } from "../engine/dice.js";
import { DICE, DIE_BLOCK, allowsAdvantage, type DieSides, type TrayPicks } from "../engine/tray.js";
import { MODIFIER_LIMIT } from "./diceTray.js";

// Typed dice notation — `2d6+3`, `1d20+5 adv` — read into the same picks, modifier and mode the
// panel's buttons build, so a typed roll and a clicked one are the same roll and the study's
// `isValidSelection` cannot tell them apart.
//
// DOM-free for the same reason diceTray.ts is: what can be *wrong* here is which roll a string
// means, and that is worth asserting without a browser.
//
// **Nothing here is a rule the engine does not already have.** Advantage is the SRD's "roll the d20
// twice", offered only where `allowsAdvantage` says it means something; the modifier is the one
// signed number the buttons build, within the same ±MODIFIER_LIMIT; and each die type stops at
// DIE_BLOCK, where `rollTray` would otherwise quietly stop counting.

export interface NotationRoll {
  picks: TrayPicks;
  modifier: number;
  mode: Advantage;
}

export type NotationResult = ({ ok: true } & NotationRoll) | { ok: false; error: string };

export const NOTATION_MAX_LENGTH = 60;

const SUPPORTED = new Set<number>(DICE);
const SUPPORTED_MESSAGE = "Supported dice: d4, d6, d8, d10, d12, d20, d100.";
const EXAMPLE = "Try something like 2d6+3 or 1d20+5 adv.";

// Longest first, so "disadvantage" is not read as "dis" followed by leftovers.
const MODE_SUFFIX = /\s*(disadvantage|advantage|dis|adv)$/;
// One signed term: dice (with an optional keep-highest/lowest) or a plain number.
const TERM = /([+-]?)(?:(\d*)d(\d+|%)(?:k([hl])(\d+))?|(\d+))/y;

function fail(error: string): NotationResult {
  return { ok: false, error };
}

/** Read a typed roll. Case and spaces do not matter; anything not understood is an error, never a guess. */
export function parseNotation(text: string): NotationResult {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return fail(`Type a roll first. ${EXAMPLE}`);
  if (trimmed.length > NOTATION_MAX_LENGTH) return fail(`Keep it under ${NOTATION_MAX_LENGTH} characters.`);

  let body = trimmed;
  let mode: Advantage = "flat";
  const suffix = MODE_SUFFIX.exec(body);
  if (suffix) {
    mode = suffix[1]!.startsWith("dis") ? "disadvantage" : "advantage";
    body = body.slice(0, suffix.index);
  }
  // Spaces are fine around an operator or a "d", and nowhere else: dropping every space would read
  // "2d6 3" (a forgotten plus) as a d63 and blame the die instead of the gap.
  body = body.replace(/\s*([+-])\s*/g, "$1").replace(/\s*d\s*/g, "d");
  if (!body) return fail(`Include at least one die, e.g. 1d20+5.`);

  const picks: TrayPicks = {};
  let modifier = 0;
  let sawDice = false;
  let keepMode: Advantage | undefined;
  let position = 0;

  while (position < body.length) {
    TERM.lastIndex = position;
    const match = TERM.exec(body);
    // Every term after the first needs its sign; without one, "2d6 3" would be two numbers run together.
    if (!match || match[0].length === 0 || (position > 0 && !match[1])) {
      return fail(`Couldn't read "${body.slice(position).trim()}". ${EXAMPLE}`);
    }
    position = TERM.lastIndex;
    const [, sign, countText, sidesText, keep, keepCountText, constant] = match;

    if (constant !== undefined) {
      modifier += (sign === "-" ? -1 : 1) * Number(constant);
      continue;
    }

    if (sign === "-") return fail("Dice can only be added, not subtracted.");
    const count = countText ? Number(countText) : 1;
    const sides = sidesText === "%" ? 100 : Number(sidesText);
    if (count < 1) return fail("Roll at least one of each die you name, e.g. 1d6.");
    if (!SUPPORTED.has(sides)) return fail(SUPPORTED_MESSAGE);

    if (keep) {
      // The SRD's Advantage is two d20s keeping one; any other keep rule is not one this game has.
      if (count !== 2 || sides !== 20 || keepCountText !== "1") {
        return fail("Only 2d20kh1 (advantage) and 2d20kl1 (disadvantage) are supported.");
      }
      if (keepMode) return fail("Use only one advantage or disadvantage.");
      keepMode = keep === "h" ? "advantage" : "disadvantage";
      picks[20] = (picks[20] ?? 0) + 1;
      sawDice = true;
      continue;
    }

    const next = (picks[sides as DieSides] ?? 0) + count;
    if (next > DIE_BLOCK) return fail(`At most ${DIE_BLOCK} of each die.`);
    picks[sides as DieSides] = next;
    sawDice = true;
  }

  if (!sawDice) return fail("Include at least one die, e.g. 1d20+5.");
  if (keepMode) {
    if (mode !== "flat" && mode !== keepMode) return fail("Use only one advantage or disadvantage.");
    mode = keepMode;
  }
  if (Math.abs(modifier) > MODIFIER_LIMIT) {
    return fail(`The modifier must be between -${MODIFIER_LIMIT} and +${MODIFIER_LIMIT}.`);
  }
  if (mode !== "flat" && !allowsAdvantage(picks)) {
    return fail("Advantage and disadvantage apply to a single d20 only, e.g. 1d20+5 adv.");
  }
  return { ok: true, picks, modifier, mode };
}

/** The canonical way to write a roll: `2d6+1d4-1`, `1d20+5 adv`. Dice in `DICE` order, like the panel. */
export function formatNotation(roll: NotationRoll): string {
  const dice = DICE.filter((sides) => (roll.picks[sides] ?? 0) > 0).map((sides) => `${roll.picks[sides]}d${sides}`).join("+");
  const bonus = roll.modifier === 0 ? "" : roll.modifier > 0 ? `+${roll.modifier}` : `${roll.modifier}`;
  const suffix = roll.mode === "advantage" ? " adv" : roll.mode === "disadvantage" ? " dis" : "";
  return `${dice}${bonus}${suffix}`;
}
