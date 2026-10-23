import { describe, expect, it } from "vitest";
import {
  TRAY_ABILITIES,
  addModifier,
  abilityModifier,
  addDie,
  DICE_SIZES,
  asDiceSize,
  emptyTray,
  removeDie,
  resetTray,
  modifierLabel,
  modifierStepSelected,
  modeAvailable,
  sizeLabel,
  trayLabel,
  trayLine,
  toggleModifierSign,
} from "../app/diceTray.js";
import { DEFAULT_DICE_SIZE } from "../renderer/diceMath.js";
import { rollTray } from "../engine/tray.js";
import { emptyCharacter, type Character } from "../schema/character.js";

function sheeted(modifiers: Record<string, number>): Character {
  return { ...emptyCharacter("c1"), sheet: { abilities: { score: {}, modifier: modifiers } } };
}

describe("picking dice", () => {
  it("adds one at a time", () => {
    let tray = emptyTray(1);
    tray = addDie(tray, 6);
    tray = addDie(tray, 6);
    tray = addDie(tray, 20);
    expect(tray.picks).toEqual({ 6: 2, 20: 1 });
  });

  it("drops a die's key at zero rather than leaving a nought behind", () => {
    // `{6: 0}` and `{}` roll identically, so keeping the key would be a difference only a reader
    // could see — and an emptied tray would stop comparing equal to a fresh one.
    let tray = addDie(emptyTray(1), 6);
    tray = removeDie(tray, 6);
    expect(tray.picks).toEqual({});
  });

  it("takes a removal from a die that is not there without going negative", () => {
    expect(removeDie(emptyTray(1), 12).picks).toEqual({});
  });

  it("drops back to flat when adding a die means Advantage no longer applies", () => {
    const advantaged = { ...addDie(emptyTray(1), 20), mode: "advantage" as const };
    expect(addDie(advantaged, 6).mode).toBe("flat");
    expect(addDie(advantaged, 20).mode).toBe("flat");
  });

  it("drops back to flat when removing the d20 Advantage applied to", () => {
    // The study's recovery task: start from 1d20 with Advantage and change it to a flat 1d8.
    const advantaged = { ...addDie(emptyTray(1), 20), mode: "disadvantage" as const };
    const changed = addDie(removeDie(advantaged, 20), 8);
    expect(changed.picks).toEqual({ 8: 1 });
    expect(changed.mode).toBe("flat");
  });

  it("keeps Advantage while the tray is still a single d20", () => {
    const advantaged = { ...addDie(emptyTray(1), 20), mode: "advantage" as const };
    expect(removeDie(advantaged, 6).mode).toBe("advantage");
    expect(removeDie(addDie(advantaged, 6), 6).mode).toBe("flat");
  });

  it("never edits the tray it was handed", () => {
    // The whole of DemoState is replaced field by field, so a picks object edited in place would
    // be one that had already changed before anything noticed.
    const before = addDie(emptyTray(1), 6);
    const snapshot = { ...before.picks };
    addDie(before, 6);
    removeDie(before, 6);
    resetTray(before);
    expect(before.picks).toEqual(snapshot);
  });

  it("keeps the last throw through a reset", () => {
    // Reset is about what you are *going* to throw. Wiping what just happened as well would take
    // the answer off the screen at the moment you reached for the next roll.
    const thrown = { ...addDie(emptyTray(1), 6), last: rollTray({ 6: 1 }, 3) };
    const after = resetTray(thrown);
    expect(after.picks).toEqual({});
    expect(after.mode).toBe("flat");
    expect(after.last).toBe(thrown.last);
  });

  it("puts the mode back to flat, since the dice it applied to are gone", () => {
    const tray = { ...addDie(emptyTray(1), 20), mode: "advantage" as const };
    expect(resetTray(tray).mode).toBe("flat");
  });

  it("resets the numeric modifier with the roll inputs", () => {
    const tray = addModifier(addDie(emptyTray(1), 20), 3);
    expect(resetTray(tray)).toMatchObject({ modifier: 0, modifierNegative: false });
  });

  it("starts at the default size and keeps it through a reset", () => {
    // **Size is a preference about looking, not about rolling.** Reset is about what you are going
    // to throw; clearing how you like to see it would be the panel forgetting something you told it
    // for a reason that has nothing to do with dice.
    expect(emptyTray(1).size).toBe(DEFAULT_DICE_SIZE);
    const picked = { ...addDie(emptyTray(1), 6), size: 3 as const };
    expect(resetTray(picked).size).toBe(3);
  });

  it("starts with the sound on and keeps whichever way it was left", () => {
    // The same argument as size, one setting along: it is about the experience of a roll rather than
    // about the roll, so emptying the tray has no business changing it. On to begin with, because a
    // roll you asked for is not a page making noise at you.
    expect(emptyTray(1).muted).toBe(false);
    expect(resetTray({ ...addDie(emptyTray(1), 6), muted: true }).muted).toBe(true);
  });
});

describe("the numeric modifier controls", () => {
  it("add their displayed amounts", () => {
    let tray = emptyTray(1);
    tray = addModifier(tray, 1);
    tray = addModifier(tray, 2);
    expect(tray.modifier).toBe(3);
    expect(modifierLabel(tray)).toBe("+3");
  });

  it("remember a negative sign selected before a number", () => {
    let tray = toggleModifierSign(emptyTray(1));
    expect(modifierLabel(tray)).toBe("−0");
    tray = addModifier(tray, 2);
    expect(tray.modifier).toBe(-2);
    expect(modifierLabel(tray)).toBe("−2");
  });

  it("changes the sign without throwing away the magnitude", () => {
    const positive = addModifier(emptyTray(1), 3);
    const negative = toggleModifierSign(positive);
    expect(negative.modifier).toBe(-3);
    expect(toggleModifierSign(negative).modifier).toBe(3);
  });

  it("keeps the control matching the current magnitude selected", () => {
    const positive = addModifier(emptyTray(1), 2);
    const negative = toggleModifierSign(positive);
    expect([1, 2, 3].map((step) => modifierStepSelected(positive, step))).toEqual([false, true, false]);
    expect([1, 2, 3].map((step) => modifierStepSelected(negative, step))).toEqual([false, true, false]);
    expect([1, 2, 3].some((step) => modifierStepSelected(emptyTray(1), step))).toBe(false);
  });

  it("caps repeated additions at a practical value", () => {
    let tray = emptyTray(1);
    for (let i = 0; i < 20; i += 1) tray = addModifier(tray, 3);
    expect(tray.modifier).toBe(20);
  });
});

describe("roll mode availability", () => {
  it("keeps Flat selectable when Advantage no longer applies", () => {
    expect(modeAvailable({ 12: 1 }, "flat")).toBe(true);
    expect(modeAvailable({ 12: 1 }, "advantage")).toBe(false);
    expect(modeAvailable({ 12: 1 }, "disadvantage")).toBe(false);
  });

  it("offers every mode for exactly one d20", () => {
    for (const mode of ["disadvantage", "flat", "advantage"] as const) {
      expect(modeAvailable({ 20: 1 }, mode)).toBe(true);
    }
  });
});

describe("the size buttons", () => {
  it("offers three, labelled by what they actually do", () => {
    expect([...DICE_SIZES]).toEqual([1, 2, 3]);
    // Read off the caps rather than written down, so a label cannot come to disagree with the size
    // it selects.
    expect(DICE_SIZES.map(sizeLabel)).toEqual(["1×", "2×", "3×"]);
  });

  it("takes a click and refuses anything else", () => {
    expect(asDiceSize(1)).toBe(1);
    expect(asDiceSize("3")).toBe(3);
    for (const bad of [0, 4, -1, Number.NaN, undefined, null, "big"]) {
      expect(asDiceSize(bad), String(bad)).toBe(DEFAULT_DICE_SIZE);
    }
  });
});

describe("abilityModifier", () => {
  it("reads what the sheet says", () => {
    expect(abilityModifier(sheeted({ dex: 3 }), "dex")).toBe(3);
    expect(abilityModifier(sheeted({ str: -1 }), "str")).toBe(-1);
  });

  it("is zero for every way of not having one", () => {
    // Four of them, and all four happen: a sheet is transcribed from a PDF and every field on it
    // is optional. A NaN here would reach a total and print "NaN".
    expect(abilityModifier(sheeted({ dex: 3 }), undefined)).toBe(0);
    expect(abilityModifier(emptyCharacter("c1"), "dex")).toBe(0);
    expect(abilityModifier({ ...emptyCharacter("c1"), sheet: {} }, "dex")).toBe(0);
    expect(abilityModifier(sheeted({ str: 2 }), "dex")).toBe(0);
    expect(abilityModifier(undefined, "dex")).toBe(0);
  });

  it("refuses a nonsense modifier rather than passing it on", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(abilityModifier(sheeted({ dex: bad }), "dex")).toBe(0);
    }
    expect(abilityModifier(sheeted({ dex: 2.7 }), "dex")).toBe(2);
  });

  it("offers all six abilities", () => {
    expect([...TRAY_ABILITIES]).toEqual(["str", "dex", "con", "int", "wis", "cha"]);
  });
});

describe("what the panel says", () => {
  it("names the handful in menu order", () => {
    expect(trayLabel({ 4: 1, 20: 2, 6: 3 })).toBe("2d20 + 3d6 + 1d4");
    expect(trayLabel({})).toBe("No dice");
    expect(trayLabel({ 6: 0 })).toBe("No dice");
  });

  it("says so before anything has been thrown", () => {
    expect(trayLine(undefined)).toBe("Nothing thrown yet.");
    expect(trayLine(rollTray({}, 1))).toBe("Nothing thrown yet.");
  });

  it("shows every die and not just the total", () => {
    // A bare 20 is a number you cannot check — the argument the initiative list already makes for
    // printing the modifier beside the roll.
    const line = trayLine(rollTray({ 6: 3 }, 12));
    const faces = rollTray({ 6: 3 }, 12).dice.map((die) => die.face);
    expect(line).toContain("3d6");
    for (const face of faces) expect(line).toContain(`${face}`);
    expect(line).toContain(`= ${faces.reduce((a, b) => a + b, 0)}`);
  });

  it("brackets the die an advantage roll threw away", () => {
    // "I rolled a 4 and kept the 17" is the whole point of having asked for Advantage. Leaving the
    // 4 out would show a roll that looks flat.
    const roll = rollTray({ 20: 1 }, 6, { mode: "advantage" });
    const dropped = roll.dice.find((die) => !die.kept)!.face;
    const kept = roll.dice.find((die) => die.kept)!.face;
    const line = trayLine(roll);
    expect(line).toContain(`(${dropped})`);
    expect(line).toContain(`${kept}`);
    expect(line).toContain("2d20");
  });

  it("writes the modifier signed, and leaves it out at zero", () => {
    expect(trayLine(rollTray({ 6: 1 }, 4, { modifier: 3 }))).toContain("+3");
    expect(trayLine(rollTray({ 6: 1 }, 4, { modifier: -2 }))).toContain("-2");
    expect(trayLine(rollTray({ 6: 1 }, 4))).not.toContain("+");
  });

  it("ends on the total the roll actually reported", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const roll = rollTray({ 20: 1, 6: 2 }, seed, { modifier: 1 });
      expect(trayLine(roll).endsWith(`= ${roll.total}`)).toBe(true);
    }
  });
});
