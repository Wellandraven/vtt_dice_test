import type { Advantage } from "../engine/dice.js";
import { DICE, allowsAdvantage, type DieSides, type TrayPicks, type TrayRoll } from "../engine/tray.js";
import { DEFAULT_DICE_SIZE, DIE_SIZE_CAPS, type DiceSize } from "../renderer/diceMath.js";
import { ABILITY_NAMES, type AbilityName, type Character } from "../schema/character.js";

// The dice panel's state and the strings it shows, with no DOM in it.
//
// Kept DOM-free so it can be unit-tested, the same split demo/tokenCard.ts and demo/modes.ts make:
// main.ts owns the elements and the listeners, and everything that could be *wrong* rather than
// merely ugly lives here. What is worth asserting is not that a button exists — it is that a roll
// of two dice and a dropped one reads as what happened, and that picking an ability off a sheet
// that does not have one is a zero rather than a NaN.

/** What is in the tray, how it will be thrown, and what it last showed. */
export interface DiceTray {
  picks: TrayPicks;
  mode: Advantage;
  /** The signed numeric modifier added once to the whole roll. */
  modifier: number;
  /** Kept separately so choosing a negative sign at zero affects the next increment. */
  modifierNegative: boolean;
  /** Advanced on every throw — see rerollSeed, and DemoState's note on why it is its own. */
  seed: number;
  /** The last throw, kept so the rail still says what happened after the panel is dismissed. */
  last?: TrayRoll;
  /**
   * How big the dice are drawn, 1 to 3.
   *
   * **A preference about looking, not about rolling**, which is why `resetTray` leaves it alone —
   * Reset is about what you are going to throw. It cannot change a roll either: see `dieRadius`,
   * which the setting only gives a ceiling to.
   */
  size: DiceSize;
  /**
   * Whether the tray makes any sound.
   *
   * **Beside `size` because it is the same kind of setting**: about the experience of a roll rather
   * than about the roll, so `resetTray` leaves it alone and nothing here can reach a face with it.
   * Sound is on to begin with, because a roll you asked for is not a page making noise at you — and
   * nothing else in this app makes any, so there is nothing for it to interrupt. It is not written
   * anywhere, so the choice lasts the session, which is all `main.ts` allows anything to.
   */
  muted: boolean;
  open: boolean;
}

export function emptyTray(seed: number): DiceTray {
  return {
    picks: {},
    mode: "flat",
    modifier: 0,
    modifierNegative: false,
    seed,
    size: DEFAULT_DICE_SIZE,
    muted: false,
    open: false,
  };
}

/**
 * One more of a die.
 *
 * Returns a new tray rather than mutating, because the whole of `DemoState` is replaced field by
 * field — see how `state.character` is written — and a picks object edited in place would be one
 * that had already changed before anything noticed.
 */
export function addDie(tray: DiceTray, sides: DieSides): DiceTray {
  return withApplicableMode({ ...tray, picks: { ...tray.picks, [sides]: (tray.picks[sides] ?? 0) + 1 } });
}

/**
 * Back to Flat once Advantage no longer applies to the handful.
 *
 * **The roll was already flat; this makes the selection say so.** `rollTray` ignores Advantage on
 * anything but a single d20, so a tray still marked "advantage" after the d20 became a d8 would roll
 * flat and be *recorded* as advantage — and a study task asking for a flat d8 would mark that roll
 * wrong, for a setting greyed out and doing nothing. Typed rolls always say their mode, so without
 * this the buttons alone carried a hidden extra step.
 */
function withApplicableMode(tray: DiceTray): DiceTray {
  return tray.mode === "flat" || allowsAdvantage(tray.picks) ? tray : { ...tray, mode: "flat" };
}

/**
 * One fewer, and gone at zero rather than left at it.
 *
 * `{ 6: 0 }` and `{}` roll identically, so keeping the key would be a difference only a reader
 * could see — and it would make an emptied tray compare as different from a fresh one.
 */
export function removeDie(tray: DiceTray, sides: DieSides): DiceTray {
  const left = (tray.picks[sides] ?? 0) - 1;
  const picks = { ...tray.picks };
  if (left > 0) picks[sides] = left;
  else delete picks[sides];
  return withApplicableMode({ ...tray, picks });
}

/** The three sizes, in the order the buttons offer them. */
export const DICE_SIZES: readonly DiceSize[] = [1, 2, 3];

/**
 * What a size button says.
 *
 * Worked out from the caps rather than written down, so a label cannot come to disagree with the
 * size it selects — `DIE_SIZE_CAPS` is where the numbers live and this is a view of them.
 */
export function sizeLabel(size: DiceSize): string {
  return `${Math.round(DIE_SIZE_CAPS[size] / DIE_SIZE_CAPS[1])}×`;
}

/** The setting a click asks for, or the default if it is not one of the three. */
export function asDiceSize(value: unknown): DiceSize {
  return DICE_SIZES.find((size) => size === Number(value)) ?? DEFAULT_DICE_SIZE;
}

/** Empty the tray. The last roll stays — RESET is about what you are *going* to throw. */
export function resetTray(tray: DiceTray): DiceTray {
  return { ...tray, picks: {}, mode: "flat", modifier: 0, modifierNegative: false };
}

export const MODIFIER_STEPS = [1, 2, 3] as const;
export const MODIFIER_LIMIT = 20;

/** Flat rolls are always available; Advantage and Disadvantage require exactly one d20. */
export function modeAvailable(picks: TrayPicks, mode: Advantage): boolean {
  return mode === "flat" || allowsAdvantage(picks);
}

/** Add the displayed amount in the selected direction, capped to a practical d20 modifier. */
export function addModifier(tray: DiceTray, amount: number): DiceTray {
  const step = Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0;
  const magnitude = Math.min(MODIFIER_LIMIT, Math.abs(tray.modifier) + step);
  return { ...tray, modifier: tray.modifierNegative ? -magnitude : magnitude };
}

/** Switch the direction without losing the amount already entered. */
export function toggleModifierSign(tray: DiceTray): DiceTray {
  const modifierNegative = !tray.modifierNegative;
  return {
    ...tray,
    modifierNegative,
    modifier: modifierNegative ? -Math.abs(tray.modifier) : Math.abs(tray.modifier),
  };
}

/** The explicit value shown above the modifier controls, including zero's selected sign. */
export function modifierLabel(tray: Pick<DiceTray, "modifier" | "modifierNegative">): string {
  const sign = tray.modifierNegative ? "−" : "+";
  return `${sign}${Math.abs(tray.modifier)}`;
}

/** Highlight the numbered control that represents the current modifier magnitude. */
export function modifierStepSelected(tray: Pick<DiceTray, "modifier">, step: number): boolean {
  return Math.abs(tray.modifier) === step;
}

/**
 * The modifier a character brings, or zero.
 *
 * **Zero for every way of not having one**, and there are four: no ability picked, no sheet, no
 * ability block on the sheet, and a sheet whose block has no entry for that ability. A sheet is
 * transcribed from a PDF and every field on it is optional, so all four happen.
 *
 * **The six modifiers and nothing else.** The sheet also carries saves, skills, armour class and a
 * proficiency bonus, all transcribed and none of them rolled — see BACKLOG.md. A skill check is a
 * rule rather than a convenience, and adding one means deciding what happens when it succeeds.
 */
export function abilityModifier(character: Character | undefined, ability: AbilityName | undefined): number {
  if (!ability) return 0;
  const written = character?.sheet?.abilities?.modifier?.[ability];
  return Number.isFinite(written) ? Math.trunc(written!) : 0;
}

/** Which abilities a character can roll with. All six, always — the picker says what is written. */
export const TRAY_ABILITIES: readonly AbilityName[] = ABILITY_NAMES;

/** A signed modifier the way a sheet writes one: `+3`, `-1`, `+0`. */
function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

/**
 * What the tray is about to throw: `2d20 + 3d6`.
 *
 * In `DICE` order, so adding a d4 to a handful of d20s does not reorder what was already there.
 */
export function trayLabel(picks: TrayPicks): string {
  const parts = DICE.filter((sides) => (picks[sides] ?? 0) > 0).map((sides) => `${picks[sides]}d${sides}`);
  return parts.length === 0 ? "No dice" : parts.join(" + ");
}

/**
 * What a throw showed, as one line.
 *
 * **Every die, not just the total.** A bare 20 is a number you cannot check — the same argument the
 * initiative list makes for printing the modifier beside the roll. A dropped die is shown in
 * brackets rather than left out, because "I rolled a 4 and kept the 17" is the whole point of
 * having asked for Advantage.
 */
export function trayLine(roll: TrayRoll | undefined): string {
  if (!roll || roll.dice.length === 0) return "Nothing thrown yet.";
  const faces = roll.dice.map((die) => (die.kept ? `${die.face}` : `(${die.face})`)).join(", ");
  const bonus = roll.modifier === 0 ? "" : ` ${signed(roll.modifier)}`;
  return `${trayLabel(countOf(roll))} — ${faces}${bonus} = ${roll.total}`;
}

/** The picks a roll came from, rebuilt from its dice, so the line names what was actually thrown. */
function countOf(roll: TrayRoll): TrayPicks {
  const picks: TrayPicks = {};
  for (const die of roll.dice) picks[die.sides] = (picks[die.sides] ?? 0) + 1;
  return picks;
}
