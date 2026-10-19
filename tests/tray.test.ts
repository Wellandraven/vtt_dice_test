import { describe, expect, it } from "vitest";
import { DICE, DIE_BLOCK, allowsAdvantage, rollTray, total, type TrayPicks } from "../engine/tray.js";
import { SECOND_DIE_OFFSET } from "../engine/dice.js";

/** Every face rolled by one tray over many seeds, per die type. */
function faces(picks: TrayPicks, seeds = 300): Map<number, Set<number>> {
  const seen = new Map<number, Set<number>>();
  for (let seed = 0; seed < seeds; seed += 1) {
    for (const die of rollTray(picks, seed).dice) {
      const set = seen.get(die.sides) ?? new Set<number>();
      set.add(die.face);
      seen.set(die.sides, set);
    }
  }
  return seen;
}

describe("the tray", () => {
  it("offers every interface the seven dice in the approved display order", () => {
    expect(DICE).toEqual([20, 12, 100, 10, 8, 6, 4]);
    expect(new Set(DICE).size).toBe(DICE.length);
  });

  it("keeps every die on its own faces", () => {
    const picks: TrayPicks = { 4: 1, 6: 1, 8: 1, 10: 1, 12: 1, 20: 1, 100: 1 };
    for (const [sides, rolled] of faces(picks)) {
      for (const face of rolled) {
        expect(face, `d${sides} rolled ${face}`).toBeGreaterThanOrEqual(1);
        expect(face, `d${sides} rolled ${face}`).toBeLessThanOrEqual(sides);
      }
    }
  });

  it("actually reaches every face, over a long run", () => {
    // A die that never rolls its top face is the shape of an off-by-one nobody notices — see the
    // `Math.min` clamp in rollDie, which exists because of exactly that.
    const seen = faces({ 4: 1, 6: 1, 20: 1 }, 1500);
    expect(seen.get(4)!.size).toBe(4);
    expect(seen.get(6)!.size).toBe(6);
    expect(seen.get(20)!.size).toBe(20);
  });

  it("gives dice of one kind their own answers", () => {
    // **The bug the index blocks exist to prevent, as a test.** rollDie is stateless, so five d6
    // asked the same question give one answer five times — a tray that could never roll a pair or
    // a run, only five of a kind, and no error anywhere to say so.
    let varied = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const rolled = rollTray({ 6: 5 }, seed).dice.map((die) => die.face);
      if (new Set(rolled).size > 1) varied += 1;
    }
    expect(varied).toBeGreaterThan(190);
  });

  it("gives dice of different kinds their own answers too", () => {
    // The other half of the same bug: two blocks that overlapped would have a d20 and a d12 walking
    // in step, which is much harder to see than five identical d6.
    let varied = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const rolled = rollTray({ 20: 1, 12: 1 }, seed).dice;
      if (rolled[0]!.face !== rolled[1]!.face) varied += 1;
    }
    expect(varied).toBeGreaterThan(180);
  });

  it("leaves the whole index run clear of the second-die offset", () => {
    // Arithmetic rather than a promise. An Advantage roll puts its second die at
    // `index + SECOND_DIE_OFFSET`; if the blocks reached that far, one die type's dice would be
    // another type's Advantage dice, and the correlation would be invisible.
    expect(DICE.length * DIE_BLOCK).toBeLessThan(SECOND_DIE_OFFSET);
  });

  it("rolls the same tray the same way twice", () => {
    const picks: TrayPicks = { 20: 2, 6: 3 };
    expect(rollTray(picks, 77)).toEqual(rollTray(picks, 77));
    expect(rollTray(picks, 77).total).not.toBe(rollTray(picks, 78).total);
  });

  it("returns dice in menu order rather than in the order they were added", () => {
    const rolled = rollTray({ 4: 1, 20: 1, 6: 1 }, 5).dice.map((die) => die.sides);
    expect(rolled).toEqual([20, 6, 4]);
  });

  it("adds the modifier once, to the handful", () => {
    // Per die, 3d6+2 becomes 3d6+6 — a different roll that reads as a typo.
    for (let seed = 0; seed < 50; seed += 1) {
      const bare = rollTray({ 6: 3 }, seed);
      const bonused = rollTray({ 6: 3 }, seed, { modifier: 2 });
      expect(bonused.total).toBe(bare.total + 2);
      expect(bonused.modifier).toBe(2);
    }
  });

  it("takes a negative modifier and refuses a nonsense one", () => {
    const bare = rollTray({ 6: 1 }, 3).total;
    expect(rollTray({ 6: 1 }, 3, { modifier: -2 }).total).toBe(bare - 2);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(rollTray({ 6: 1 }, 3, { modifier: bad as number }).modifier).toBe(0);
    }
    expect(rollTray({ 6: 1 }, 3, { modifier: 2.9 }).modifier).toBe(2);
  });

  it("totals an empty tray at nothing, modifier and all", () => {
    // A modifier with no dice under it is not a roll of +3; it is somebody who has not picked a die
    // yet, and showing them a total would say the opposite.
    expect(rollTray({}, 4, { modifier: 3 })).toEqual({ dice: [], modifier: 3, total: 0 });
    expect(rollTray({ 6: 0 }, 4).total).toBe(0);
  });

  it("ignores a nonsense count rather than looping on it", () => {
    for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rollTray({ 6: bad }, 1).dice).toEqual([]);
    }
    // Capped rather than trusted: a count past the block would reach into the next die's indices.
    expect(rollTray({ 6: 5000 }, 1).dice.length).toBe(DIE_BLOCK);
  });
});

describe("advantage", () => {
  it("is offered for one d20 and nothing else", () => {
    expect(allowsAdvantage({ 20: 1 })).toBe(true);
    expect(allowsAdvantage({ 20: 2 })).toBe(false);
    expect(allowsAdvantage({ 20: 1, 6: 1 })).toBe(false);
    expect(allowsAdvantage({ 6: 1 })).toBe(false);
    expect(allowsAdvantage({})).toBe(false);
  });

  it("throws two dice and keeps one", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const rolled = rollTray({ 20: 1 }, seed, { mode: "advantage" });
      expect(rolled.dice.length).toBe(2);
      expect(rolled.dice.filter((die) => die.kept).length).toBe(1);
      const kept = rolled.dice.find((die) => die.kept)!.face;
      const dropped = rolled.dice.find((die) => !die.kept)!.face;
      expect(kept).toBeGreaterThanOrEqual(dropped);
      expect(rolled.total).toBe(kept);
    }
  });

  it("keeps the lower one on disadvantage", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const rolled = rollTray({ 20: 1 }, seed, { mode: "disadvantage" });
      const kept = rolled.dice.find((die) => die.kept)!.face;
      const dropped = rolled.dice.find((die) => !die.kept)!.face;
      expect(kept).toBeLessThanOrEqual(dropped);
    }
  });

  it("marks exactly one die kept even when both rolled the same", () => {
    // Marked against the other die rather than against the kept value: compared to `kept`, two
    // dice showing 14 would both be marked kept and a total of 14 would look like a bug.
    let ties = 0;
    for (let seed = 0; seed < 4000 && ties < 5; seed += 1) {
      const rolled = rollTray({ 20: 1 }, seed, { mode: "advantage" });
      if (rolled.dice[0]!.face !== rolled.dice[1]!.face) continue;
      ties += 1;
      expect(rolled.dice.filter((die) => die.kept).length).toBe(1);
    }
    expect(ties, "no tie ever came up, so the case went unchecked").toBeGreaterThan(0);
  });

  it("carries the modifier through the kept die", () => {
    const bare = rollTray({ 20: 1 }, 9, { mode: "advantage" });
    const bonused = rollTray({ 20: 1 }, 9, { mode: "advantage", modifier: 4 });
    expect(bonused.total).toBe(bare.total + 4);
  });

  it("rolls flat where the rule does not apply, whatever the caller asked for", () => {
    // A panel that offered the toggle and forgot to grey it out should get a legal roll rather than
    // a rule this game does not have.
    const asked = rollTray({ 6: 2 }, 12, { mode: "advantage" });
    expect(asked).toEqual(rollTray({ 6: 2 }, 12));
    expect(asked.dice.every((die) => die.kept)).toBe(true);
  });

  it("is better than flat and worse than disadvantage, over a run", () => {
    let up = 0;
    let down = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      const flat = rollTray({ 20: 1 }, seed).total;
      up += rollTray({ 20: 1 }, seed, { mode: "advantage" }).total - flat;
      down += rollTray({ 20: 1 }, seed, { mode: "disadvantage" }).total - flat;
    }
    expect(up).toBeGreaterThan(0);
    expect(down).toBeLessThan(0);
  });
});

describe("total", () => {
  it("counts the whole handful", () => {
    expect(total({})).toBe(0);
    expect(total({ 6: 3 })).toBe(3);
    expect(total({ 20: 1, 6: 3, 4: 2 })).toBe(6);
    expect(total({ 6: -2 })).toBe(0);
  });
});
