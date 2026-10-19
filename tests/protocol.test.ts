import { describe, expect, it } from "vitest";
import {
  INTERFACES,
  STUDY_SEQUENCES,
  balancedInterfaceSequenceCandidates,
  balancedSequenceCandidates,
  interfacePosition,
  isStudyProfile,
  isValidSelection,
  sequenceInterfaces,
  tasksForInterface,
} from "../study/protocol.js";

describe("study sequence balancing", () => {
  it("balances the first assigned interface for one-test visits", () => {
    expect(balancedInterfaceSequenceCandidates({ A: 4, B: 2, C: 3 })).toEqual(["B-A-C", "B-C-A"]);
  });

  it("places every interface exactly once in every sequence", () => {
    for (const sequence of STUDY_SEQUENCES) {
      expect([...sequenceInterfaces(sequence)].sort()).toEqual([...INTERFACES]);
    }
  });

  it("puts every interface in every position twice across a balanced block", () => {
    for (const interfaceId of INTERFACES) {
      expect(STUDY_SEQUENCES.map((sequence) => interfacePosition(sequence, interfaceId)).sort()).toEqual([0, 0, 1, 1, 2, 2]);
    }
  });

  it("balances every adjacent carryover direction", () => {
    const adjacentCounts = new Map<string, number>();
    for (const sequence of STUDY_SEQUENCES) {
      const interfaces = sequenceInterfaces(sequence);
      for (let index = 0; index < interfaces.length - 1; index += 1) {
        const pair = `${interfaces[index]}-${interfaces[index + 1]}`;
        adjacentCounts.set(pair, (adjacentCounts.get(pair) ?? 0) + 1);
      }
    }
    expect(Object.fromEntries([...adjacentCounts].sort())).toEqual({
      "A-B": 2,
      "A-C": 2,
      "B-A": 2,
      "B-C": 2,
      "C-A": 2,
      "C-B": 2,
    });
  });

  it("only assigns among the least represented sequences", () => {
    expect(balancedSequenceCandidates({})).toEqual(STUDY_SEQUENCES);
    expect(balancedSequenceCandidates({ "A-B-C": 3, "A-C-B": 2, "B-A-C": 2, "B-C-A": 4, "C-A-B": 3, "C-B-A": 5 })).toEqual([
      "A-C-B",
      "B-A-C",
    ]);
  });
});

describe("study task protocol", () => {
  it("gives each assigned position one practice and three scored tasks", () => {
    for (const sequence of STUDY_SEQUENCES) {
      const tasks = tasksForInterface(sequence, "A");
      expect(tasks).toHaveLength(4);
      expect(tasks[0]!.isPractice).toBe(true);
      expect(tasks.slice(1).every((task) => !task.isPractice)).toBe(true);
      expect(new Set(tasks.map((task) => task.id)).size).toBe(4);
    }
  });

  it("accepts only an exact dice, mode, and modifier match", () => {
    const target = { picks: { 20: 1 } as const, mode: "advantage" as const, modifier: 1 };
    expect(isValidSelection({ picks: { 20: 1 }, mode: "advantage", modifier: 1 }, target)).toBe(true);
    expect(isValidSelection({ picks: { 20: 2 }, mode: "advantage", modifier: 1 }, target)).toBe(false);
    expect(isValidSelection({ picks: { 20: 1, 6: 1 }, mode: "advantage", modifier: 1 }, target)).toBe(false);
    expect(isValidSelection({ picks: { 20: 1 }, mode: "flat", modifier: 1 }, target)).toBe(false);
    expect(isValidSelection({ picks: { 20: 1 }, mode: "advantage", modifier: -1 }, target)).toBe(false);
  });

  it("requires every anonymous segmentation field", () => {
    expect(isStudyProfile({ vttTools: ["roll20", "foundry"], vttOther: null, vttComfort: 4, diceFamiliarity: "familiar" })).toBe(true);
    expect(isStudyProfile({ vttTools: ["none"], vttOther: null, vttComfort: 1, diceFamiliarity: "unfamiliar" })).toBe(true);
    expect(isStudyProfile({ vttTools: ["other"], vttOther: "Alchemy", vttComfort: 3, diceFamiliarity: "somewhat" })).toBe(true);
    expect(isStudyProfile({ vttTools: [], vttOther: null, vttComfort: 3, diceFamiliarity: "somewhat" })).toBe(false);
    expect(isStudyProfile({ vttTools: ["none", "roll20"], vttOther: null, vttComfort: 3, diceFamiliarity: "somewhat" })).toBe(false);
    expect(isStudyProfile({ vttTools: ["other"], vttOther: "", vttComfort: 3, diceFamiliarity: "somewhat" })).toBe(false);
    expect(isStudyProfile({ vttTools: ["roll20"], vttOther: null, vttComfort: 6, diceFamiliarity: "familiar" })).toBe(false);
  });
});
