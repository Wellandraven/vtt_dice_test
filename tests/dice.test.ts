import { describe, expect, it } from "vitest";
import { D20, d20Check, rerollSeed, rollDie } from "../engine/dice.js";

/** Every face a die of this many sides rolled across a long run of indices. */
function faces(sides: number, seed: number, count = 4000): Set<number> {
  const seen = new Set<number>();
  for (let i = 0; i < count; i += 1) seen.add(rollDie(sides, seed, i));
  return seen;
}

describe("rollDie", () => {
  it("stays on the die, over a long run", () => {
    // **The bug this is really guarding.** cellNoise returns [0, 1), so `1 + floor(n * 20)` can
    // only reach 21 on a floating-point boundary — which is exactly the kind of thing that happens
    // once in a hundred thousand rolls and gets reported as "the game crashed once".
    for (const sides of [4, 6, 8, 20, 100]) {
      for (const face of faces(sides, 7)) {
        expect(face, `d${sides}`).toBeGreaterThanOrEqual(1);
        expect(face, `d${sides}`).toBeLessThanOrEqual(sides);
      }
    }
  });

  it("actually rolls every face", () => {
    // A hash that never produced a 1 or a 20 would pass the bounds check above and be badly wrong.
    expect(faces(D20, 7).size).toBe(20);
    expect(faces(6, 11).size).toBe(6);
  });

  it("gives the same answer to the same question, always", () => {
    // The property the whole module exists for: an initiative order has to survive a redraw, a
    // rebuild and a reload, and it can only do that if the dice have no state to consume.
    expect(rollDie(D20, 3, 5)).toBe(rollDie(D20, 3, 5));
    expect(rollDie(D20, 3, 5)).toBe(rollDie(D20, 3, 5));
  });

  it("gives different answers to different seeds and different indices", () => {
    // Both halves matter. The index is what lets one seed serve a whole table; the seed is what
    // makes a re-roll a different fight.
    const bySeed = new Set(Array.from({ length: 40 }, (_, s) => rollDie(D20, s, 0)));
    const byIndex = new Set(Array.from({ length: 40 }, (_, i) => rollDie(D20, 9, i)));
    expect(bySeed.size).toBeGreaterThan(8);
    expect(byIndex.size).toBeGreaterThan(8);
  });

  it("refuses to roll a die that is not one", () => {
    // Returns a 1 rather than a NaN that would flow into an initiative total and sort chaotically.
    for (const sides of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rollDie(sides, 1, 1), String(sides)).toBe(1);
    }
  });
});

describe("d20Check", () => {
  it("adds the modifier to the die", () => {
    const bare = rollDie(D20, 4, 2);
    expect(d20Check(0, 4, 2)).toBe(bare);
    expect(d20Check(3, 4, 2)).toBe(bare + 3);
    expect(d20Check(-2, 4, 2)).toBe(bare - 2);
  });

  it("takes the higher of two with Advantage and the lower with Disadvantage", () => {
    // **Two rolls and keep one, not a bonus.** Advantage is worth about +3.3 on average but is
    // shaped quite differently from +3, which is why it is implemented rather than approximated —
    // and why this checks the actual pair rather than a distribution.
    for (let i = 0; i < 200; i += 1) {
      const up = d20Check(0, 5, i, "advantage");
      const down = d20Check(0, 5, i, "disadvantage");
      const flat = d20Check(0, 5, i, "flat");
      expect(up, `index ${i}`).toBeGreaterThanOrEqual(down);
      // The flat roll is the first of the two dice, so it always sits between them inclusive.
      expect(flat).toBeGreaterThanOrEqual(down);
      expect(flat).toBeLessThanOrEqual(up);
    }
  });

  it("makes Advantage and Disadvantage differ, rather than quietly rolling one die twice", () => {
    // What breaks if the second die comes from the same index: both dice are equal, so the higher
    // and the lower are the same number and neither mode does anything at all.
    const differ = Array.from({ length: 200 }, (_, i) => d20Check(0, 5, i, "advantage") !== d20Check(0, 5, i, "disadvantage"));
    expect(differ.filter(Boolean).length).toBeGreaterThan(150);
  });

  it("holds up to a modifier that is not a number", () => {
    expect(d20Check(Number.NaN, 2, 2)).toBe(rollDie(D20, 2, 2));
    expect(Number.isFinite(d20Check(Number.POSITIVE_INFINITY, 2, 2))).toBe(true);
  });
});

describe("rerollSeed", () => {
  it("gives a different seed, and keeps giving different ones", () => {
    // A hash step rather than +1, so successive re-rolls wander instead of marching — and so a
    // caller cannot guess at how seeds relate and write `seed + 1` themselves.
    let seed = 12;
    const seen = new Set([seed]);
    for (let i = 0; i < 50; i += 1) {
      seed = rerollSeed(seed);
      expect(seen.has(seed), `repeat at ${i}`).toBe(false);
      seen.add(seed);
    }
  });

  it("is deterministic, so a stored seed replays its fight", () => {
    expect(rerollSeed(7)).toBe(rerollSeed(7));
  });
});
