import type { Advantage } from "../engine/dice.js";
import type { DieSides, TrayPicks } from "../engine/tray.js";

export const INTERFACES = ["A", "B", "C"] as const;
export type InterfaceId = (typeof INTERFACES)[number];

export const STUDY_PHASE = "single-interface-balanced-v18";
export const LIVE_STUDY_PHASE = `${STUDY_PHASE}-live`;

export const STUDY_SEQUENCES = ["A-B-C", "A-C-B", "B-A-C", "B-C-A", "C-A-B", "C-B-A"] as const;
export type StudySequence = (typeof STUDY_SEQUENCES)[number];

export const VTT_TOOLS = ["dndbeyond", "roll20", "foundry", "owlbear", "other", "none"] as const;
export const VTT_COMFORT_LEVELS = [1, 2, 3, 4, 5] as const;
export const DICE_FAMILIARITY = ["unfamiliar", "somewhat", "familiar"] as const;

export interface StudyProfile {
  vttTools: (typeof VTT_TOOLS)[number][];
  vttOther: string | null;
  vttComfort: (typeof VTT_COMFORT_LEVELS)[number];
  diceFamiliarity: (typeof DICE_FAMILIARITY)[number];
}

export interface RollSelection {
  picks: TrayPicks;
  mode: Advantage;
  modifier: number;
}

export interface StudyTask {
  id: string;
  title: string;
  instruction: string;
  formula: string;
  isPractice: boolean;
  target: RollSelection;
  initial: RollSelection;
}

const empty: RollSelection = { picks: {}, mode: "flat", modifier: 0 };

const practice: StudyTask = {
  id: "practice-d20-str",
  title: "Build a d20 check",
  instruction: "Prepare one d20 with a +3 modifier, then roll the dice.",
  formula: "1d20 +3",
  isPractice: true,
  target: { picks: { 20: 1 }, mode: "flat", modifier: 3 },
  initial: empty,
};

const PACKS: readonly (readonly StudyTask[])[] = [
  [
    task("p1-damage", "Build a damage roll", "Prepare two d6 with a +2 modifier, then roll the dice.", "2d6 +2", { picks: { 6: 2 }, mode: "flat", modifier: 2 }),
    task("p1-advantage", "Roll with advantage", "Prepare one d20 with Advantage and a +1 modifier, then roll.", "1d20 (Adv) +1", { picks: { 20: 1 }, mode: "advantage", modifier: 1 }),
    recovery("p1-recovery", "Correct the prepared roll", "Change the prepared roll to one d8, Flat, and +0, then roll.", "1d8 +0", { picks: { 8: 1 }, mode: "flat", modifier: 0 }, { picks: { 20: 1 }, mode: "advantage", modifier: 1 }),
  ],
  [
    task("p2-damage", "Build a damage roll", "Prepare two d8 with a +3 modifier, then roll the dice.", "2d8 +3", { picks: { 8: 2 }, mode: "flat", modifier: 3 }),
    task("p2-advantage", "Roll with advantage", "Prepare one d20 with Advantage and a +0 modifier, then roll.", "1d20 (Adv) +0", { picks: { 20: 1 }, mode: "advantage", modifier: 0 }),
    recovery("p2-recovery", "Correct the prepared roll", "Change the prepared roll to one d12, Flat, and +2, then roll.", "1d12 +2", { picks: { 12: 1 }, mode: "flat", modifier: 2 }, { picks: { 20: 1 }, mode: "advantage", modifier: 0 }),
  ],
  [
    task("p3-damage", "Build a damage roll", "Prepare three d4 with a +1 modifier, then roll the dice.", "3d4 +1", { picks: { 4: 3 }, mode: "flat", modifier: 1 }),
    task("p3-advantage", "Roll with advantage", "Prepare one d20 with Advantage and a +2 modifier, then roll.", "1d20 (Adv) +2", { picks: { 20: 1 }, mode: "advantage", modifier: 2 }),
    recovery("p3-recovery", "Correct the prepared roll", "Change the prepared roll to one d10, Flat, and −1, then roll.", "1d10 −1", { picks: { 10: 1 }, mode: "flat", modifier: -1 }, { picks: { 20: 1 }, mode: "advantage", modifier: 2 }),
  ],
] as const;

function task(id: string, title: string, instruction: string, formula: string, target: RollSelection): StudyTask {
  return { id, title, instruction, formula, isPractice: false, target, initial: empty };
}

function recovery(
  id: string,
  title: string,
  instruction: string,
  formula: string,
  target: RollSelection,
  initial: RollSelection,
): StudyTask {
  return { id, title, instruction, formula, isPractice: false, target, initial };
}

export function sequenceInterfaces(sequence: StudySequence): readonly InterfaceId[] {
  return sequence.split("-") as InterfaceId[];
}

export function interfacePosition(sequence: StudySequence, interfaceId: InterfaceId): number {
  return sequenceInterfaces(sequence).indexOf(interfaceId);
}

export function tasksForInterface(sequence: StudySequence, interfaceId: InterfaceId): readonly StudyTask[] {
  const position = interfacePosition(sequence, interfaceId);
  if (position < 0) throw new Error(`Interface ${interfaceId} is missing from sequence ${sequence}.`);
  return [practice, ...PACKS[position]!];
}

export function isValidSelection(actual: RollSelection, target: RollSelection): boolean {
  if (actual.mode !== target.mode || actual.modifier !== target.modifier) return false;
  const sides = new Set<DieSides>([
    ...(Object.keys(actual.picks).map(Number) as DieSides[]),
    ...(Object.keys(target.picks).map(Number) as DieSides[]),
  ]);
  for (const side of sides) {
    if ((actual.picks[side] ?? 0) !== (target.picks[side] ?? 0)) return false;
  }
  return true;
}

export function isStudySequence(value: unknown): value is StudySequence {
  return STUDY_SEQUENCES.includes(value as StudySequence);
}

export function isStudyProfile(value: unknown): value is StudyProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  if (!Array.isArray(profile.vttTools) || profile.vttTools.length === 0) return false;
  const tools = profile.vttTools as unknown[];
  if (!tools.every((tool) => VTT_TOOLS.includes(tool as StudyProfile["vttTools"][number]))) return false;
  if (new Set(tools).size !== tools.length) return false;
  if (tools.includes("none") && tools.length !== 1) return false;

  const hasOther = tools.includes("other");
  const other = profile.vttOther;
  if (hasOther && (typeof other !== "string" || other.trim().length === 0 || other.trim().length > 120)) return false;
  if (!hasOther && other !== null) return false;

  return (
    VTT_COMFORT_LEVELS.includes(profile.vttComfort as StudyProfile["vttComfort"]) &&
    DICE_FAMILIARITY.includes(profile.diceFamiliarity as StudyProfile["diceFamiliarity"])
  );
}

export function balancedSequenceCandidates(
  assigned: Partial<Record<StudySequence, number>>,
): readonly StudySequence[] {
  const minimum = Math.min(...STUDY_SEQUENCES.map((sequence) => assigned[sequence] ?? 0));
  return STUDY_SEQUENCES.filter((sequence) => (assigned[sequence] ?? 0) === minimum);
}

export function balancedInterfaceSequenceCandidates(
  assigned: Partial<Record<InterfaceId, number>>,
): readonly StudySequence[] {
  const minimum = Math.min(...INTERFACES.map((interfaceId) => assigned[interfaceId] ?? 0));
  const leastAssigned = new Set(INTERFACES.filter((interfaceId) => (assigned[interfaceId] ?? 0) === minimum));
  return STUDY_SEQUENCES.filter((sequence) => leastAssigned.has(sequence[0] as InterfaceId));
}
