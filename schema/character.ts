// A deliberately tiny stand-in for the VTT project's `schema/character.ts`.
//
// **This is the one file in dice-lab that is not a verbatim copy, and the reason is worth knowing.**
// The real file is 238 lines describing a whole player character — hit points, senses, movement,
// carried magic items, the transcribed PDF sheet. It imports `schema/item.ts`, which in turn
// imports `LightSource` from `schema/types.ts`: the entire map data model, walls, terrain, lights
// and all. Copying it faithfully would have dragged in the very thing this package exists to be
// free of.
//
// So what is here is exactly what the dice path reads and nothing else. `abilityModifier` in
// app/diceTray.ts follows one path — `character?.sheet?.abilities?.modifier?.[ability]` — and
// `TRAY_ABILITIES` is `ABILITY_NAMES`. That is the whole surface.
//
// **If you need a field that isn't here, add it here.** Do not go and fetch the real file; it will
// bring the map with it.

export type AbilityName = "str" | "dex" | "con" | "int" | "wis" | "cha";

/** The six ability names in sheet order, so a display cannot invent its own. */
export const ABILITY_NAMES: readonly AbilityName[] = ["str", "dex", "con", "int", "wis", "cha"];

export interface AbilityBlock {
  score: Partial<Record<AbilityName, number>>;
  /** Written on the sheet as well as derivable from the score; taken as written. */
  modifier: Partial<Record<AbilityName, number>>;
}

/**
 * The paper.
 *
 * Every field on a real sheet is optional, because it is transcribed from a PDF and people leave
 * boxes blank. Only `abilities` is kept here — it is the only thing the dice tray asks for.
 */
export interface CharacterSheet {
  playerName?: string;
  classLevel?: string;
  abilities?: AbilityBlock;
}

export interface Character {
  id: string;
  name: string;
  level: number;
  /**
   * Optional, and the absence means something: a hand-built character has no sheet behind it. That
   * is one of the four ways of having no modifier that `abilityModifier` answers zero for.
   */
  sheet?: CharacterSheet;
}

export function emptyCharacter(id: string): Character {
  return { id, name: "Unnamed", level: 1 };
}
