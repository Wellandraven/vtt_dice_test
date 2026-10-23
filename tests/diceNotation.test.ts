import { describe, expect, it } from "vitest";
import { formatNotation, parseNotation, type NotationRoll } from "../app/diceNotation.js";
import { INTERFACES, STUDY_SEQUENCES, isValidSelection, tasksForInterface, type StudyTask } from "../study/protocol.js";

function roll(text: string): NotationRoll {
  const result = parseNotation(text);
  if (!result.ok) throw new Error(`expected "${text}" to parse, got: ${result.error}`);
  const { picks, modifier, mode } = result;
  return { picks, modifier, mode };
}

function error(text: string): string {
  const result = parseNotation(text);
  if (result.ok) throw new Error(`expected "${text}" to be rejected`);
  return result.error;
}

describe("parseNotation: accepted rolls", () => {
  it("reads a bare die as one of it", () => {
    expect(roll("d20")).toEqual({ picks: { 20: 1 }, modifier: 0, mode: "flat" });
  });

  it("reads dice with a modifier", () => {
    expect(roll("1d20+5")).toEqual({ picks: { 20: 1 }, modifier: 5, mode: "flat" });
    expect(roll("2d6-1")).toEqual({ picks: { 6: 2 }, modifier: -1, mode: "flat" });
  });

  it("mixes dice and sums every modifier into one", () => {
    expect(roll("2d6+1d4-1")).toEqual({ picks: { 6: 2, 4: 1 }, modifier: -1, mode: "flat" });
    expect(roll("1d20+5-2")).toEqual({ picks: { 20: 1 }, modifier: 3, mode: "flat" });
    expect(roll("3+1d8")).toEqual({ picks: { 8: 1 }, modifier: 3, mode: "flat" });
  });

  it("adds repeated sizes together", () => {
    expect(roll("1d6+2d6")).toEqual({ picks: { 6: 3 }, modifier: 0, mode: "flat" });
  });

  it("reads d% as d100", () => {
    expect(roll("d%")).toEqual({ picks: { 100: 1 }, modifier: 0, mode: "flat" });
  });

  it("ignores case and spaces", () => {
    expect(roll("  2 D6 + 3 ")).toEqual({ picks: { 6: 2 }, modifier: 3, mode: "flat" });
    expect(roll("D20 + 5 ADV")).toEqual({ picks: { 20: 1 }, modifier: 5, mode: "advantage" });
  });

  it("reads advantage and disadvantage words", () => {
    expect(roll("1d20+5 adv").mode).toBe("advantage");
    expect(roll("1d20 advantage").mode).toBe("advantage");
    expect(roll("1d20-1 dis").mode).toBe("disadvantage");
    expect(roll("d20 disadvantage").mode).toBe("disadvantage");
  });

  it("reads 2d20kh1 / 2d20kl1 as one d20 with advantage / disadvantage", () => {
    expect(roll("2d20kh1+5")).toEqual({ picks: { 20: 1 }, modifier: 5, mode: "advantage" });
    expect(roll("2d20kl1")).toEqual({ picks: { 20: 1 }, modifier: 0, mode: "disadvantage" });
  });

  it("reads targets exactly as the study tasks print them", () => {
    expect(roll("1d20 (Adv) +1")).toEqual({ picks: { 20: 1 }, modifier: 1, mode: "advantage" });
    expect(roll("1d20 (Dis) +2")).toEqual({ picks: { 20: 1 }, modifier: 2, mode: "disadvantage" });
    expect(roll("1d10 −1")).toEqual({ picks: { 10: 1 }, modifier: -1, mode: "flat" });
    expect(roll("1d8 +0")).toEqual({ picks: { 8: 1 }, modifier: 0, mode: "flat" });
  });

  it("allows the modifier limit itself", () => {
    expect(roll("1d20+20").modifier).toBe(20);
    expect(roll("1d20-20").modifier).toBe(-20);
  });
});

describe("parseNotation: rejected rolls", () => {
  it("rejects empty input", () => {
    expect(error("   ")).toMatch(/Type a roll/);
  });

  it("rejects unsupported dice", () => {
    expect(error("1d7")).toMatch(/Supported dice: d4, d6, d8, d10, d12, d20, d100/);
    expect(error("d3+1")).toMatch(/Supported dice/);
  });

  it("rejects zero dice and rolls with no dice", () => {
    expect(error("0d6")).toMatch(/at least one/);
    expect(error("+5")).toMatch(/at least one die/);
    expect(error("adv")).toMatch(/at least one die/);
  });

  it("rejects a modifier beyond the limit", () => {
    expect(error("1d20+21")).toMatch(/between -20 and \+20/);
    expect(error("1d20+50")).toMatch(/between -20 and \+20/);
  });

  it("rejects advantage on anything but a single d20", () => {
    expect(error("2d6 adv")).toMatch(/single d20/);
    expect(error("1d20+1d4 dis")).toMatch(/single d20/);
    expect(error("2d20 adv")).toMatch(/single d20/);
  });

  it("rejects keep rules other than 2d20kh1 / 2d20kl1", () => {
    expect(error("4d6kh3")).toMatch(/Only 2d20kh1/);
    expect(error("3d20kh1")).toMatch(/Only 2d20kh1/);
    expect(error("2d20kh1 dis")).toMatch(/only one advantage/);
  });

  it("rejects subtracted dice", () => {
    expect(error("1d20-1d4")).toMatch(/not subtracted/);
  });

  it("rejects more than the engine can count of one die", () => {
    expect(error("101d6")).toMatch(/At most 100/);
    expect(error("60d6+60d6")).toMatch(/At most 100/);
  });

  it("rejects text it does not understand instead of guessing", () => {
    expect(error("2d6 3")).toMatch(/Couldn't read/);
    expect(error("fireball")).toMatch(/Couldn't read/);
    expect(error("1d20*2")).toMatch(/Couldn't read/);
  });

  it("rejects input over the length limit", () => {
    expect(error(`1d6${"+1".repeat(40)}`)).toMatch(/under 60 characters/);
  });
});

describe("every study task's printed formula", () => {
  it("types to exactly the roll the task checks for", () => {
    // A participant who types what the task shows must pass `isValidSelection` — otherwise the typed
    // field would be measured as slower or more error-prone for a reason that is only formatting.
    const tasks = new Map<string, StudyTask>();
    for (const sequence of STUDY_SEQUENCES) for (const id of INTERFACES) for (const task of tasksForInterface(sequence, id)) tasks.set(task.id, task);
    expect(tasks.size).toBeGreaterThan(5);
    for (const task of tasks.values()) {
      const typed = roll(task.formula);
      expect(isValidSelection(typed, task.target), `${task.id}: "${task.formula}"`).toBe(true);
    }
  });
});

describe("formatNotation", () => {
  it("writes dice in panel order with a signed modifier and mode", () => {
    expect(formatNotation({ picks: { 4: 1, 6: 2 }, modifier: -1, mode: "flat" })).toBe("2d6+1d4-1");
    expect(formatNotation({ picks: { 20: 1 }, modifier: 5, mode: "advantage" })).toBe("1d20+5 adv");
    expect(formatNotation({ picks: { 20: 1 }, modifier: 0, mode: "disadvantage" })).toBe("1d20 dis");
  });

  it("round-trips through parseNotation", () => {
    for (const text of ["d20", "2d6+1d4-1", "D20 + 5 ADV", "2d20kl1+3", "d%+2", "1d12+1d10+1d8"]) {
      const parsed = roll(text);
      expect(roll(formatNotation(parsed))).toEqual(parsed);
    }
  });
});
