import type { Character } from "../schema/character.js";

// The character the Modifier row reads from.
//
// **In the real app this is whoever you have loaded** — a sheet transcribed from a PDF, or a
// character built by hand. There is no character system in this package, and a tray handed no
// character is not broken: `abilityModifier` answers zero for every way of not having one, which
// is the honest answer and the same one the app gives before you load anybody.
//
// But zero is a bad thing to *test* against. A tester clicking WIS and watching the total not move
// cannot tell a working modifier from a dead button, and would rightly report it as a bug. So the
// package ships one character with a spread of modifiers — a positive, a negative and a zero — and
// names her in the panel, so where the bonus comes from is visible rather than mysterious.
//
// The zero on WIS is deliberate and is the interesting case: picking it *should* leave the total
// alone, and that is correct behaviour rather than a fault.
export const SAMPLE_CHARACTER: Character = {
  id: "sample",
  name: "Brenna Stonehelm",
  level: 5,
  sheet: {
    playerName: "Sample sheet",
    classLevel: "Fighter 5",
    abilities: {
      score: { str: 16, dex: 12, con: 14, int: 9, wis: 10, cha: 14 },
      modifier: { str: 3, dex: 1, con: 2, int: -1, wis: 0, cha: 2 },
    },
  },
};
