import { describe, expect, it } from "vitest";
import { tasksForInterface } from "../study/protocol.js";
import { nextDevelopmentStep, nextSingleInterfaceStep, type StudyProgress } from "../study/progress.js";

const SEQUENCE = "B-C-A" as const;

describe("three-interface development progress", () => {
  it("completes a one-interface visit after the assigned interface is rated", () => {
    const completedTaskIds = tasksForInterface(SEQUENCE, "B").map((task) => task.id);
    const progress = { B: { completedTaskIds, rating: { ease: 4, confidence: 4, comment: "Clear" } } };
    expect(nextSingleInterfaceStep(SEQUENCE, progress)).toEqual({ kind: "complete" });
  });

  it("starts with the first enabled interface in the assigned sequence", () => {
    expect(nextDevelopmentStep(SEQUENCE, {})).toEqual({ kind: "task", interfaceId: "B", taskIndex: 0 });
  });

  it("resumes at the first incomplete task for that interface", () => {
    const first = tasksForInterface(SEQUENCE, "B")[0]!;
    expect(nextDevelopmentStep(SEQUENCE, { B: { completedTaskIds: [first.id], rating: null } })).toEqual({
      kind: "task",
      interfaceId: "B",
      taskIndex: 1,
    });
  });

  it("asks for a rating before advancing to the next interface", () => {
    const completedTaskIds = tasksForInterface(SEQUENCE, "B").map((task) => task.id);
    expect(nextDevelopmentStep(SEQUENCE, { B: { completedTaskIds, rating: null } })).toEqual({
      kind: "rating",
      interfaceId: "B",
    });
  });

  it("advances in sequence and completes only after all three ratings", () => {
    const rating = { ease: 4, confidence: 4, comment: "Clear." };
    const progress: StudyProgress = {
      B: { completedTaskIds: tasksForInterface(SEQUENCE, "B").map((task) => task.id), rating },
      C: { completedTaskIds: tasksForInterface(SEQUENCE, "C").map((task) => task.id), rating },
      A: { completedTaskIds: tasksForInterface(SEQUENCE, "A").map((task) => task.id), rating },
    };
    expect(nextDevelopmentStep(SEQUENCE, { B: progress.B })).toEqual({ kind: "task", interfaceId: "C", taskIndex: 0 });
    expect(nextDevelopmentStep(SEQUENCE, { B: progress.B, C: progress.C })).toEqual({ kind: "task", interfaceId: "A", taskIndex: 0 });
    expect(nextDevelopmentStep(SEQUENCE, progress)).toEqual({ kind: "complete" });
  });
});
