import {
  sequenceInterfaces,
  tasksForInterface,
  type InterfaceId,
  type StudySequence,
} from "./protocol.js";

export const DEVELOPMENT_INTERFACES = ["A", "B", "C"] as const;
export type DevelopmentInterfaceId = (typeof DEVELOPMENT_INTERFACES)[number];

export interface InterfaceRating {
  ease: number;
  confidence: number;
  comment: string;
}

export interface InterfaceProgress {
  completedTaskIds: readonly string[];
  rating: InterfaceRating | null;
}

export type StudyProgress = Partial<Record<DevelopmentInterfaceId, InterfaceProgress>>;

export type DevelopmentStep =
  | { kind: "task"; interfaceId: DevelopmentInterfaceId; taskIndex: number }
  | { kind: "rating"; interfaceId: DevelopmentInterfaceId }
  | { kind: "complete" };

/** Resume at the first unfinished task or rating, following the participant's assigned sequence. */
export function nextDevelopmentStep(sequence: StudySequence, progress: StudyProgress): DevelopmentStep {
  const enabled = new Set<InterfaceId>(DEVELOPMENT_INTERFACES);
  for (const interfaceId of sequenceInterfaces(sequence)) {
    if (!enabled.has(interfaceId)) continue;
    const developmentInterface = interfaceId as DevelopmentInterfaceId;
    const completed = new Set(progress[developmentInterface]?.completedTaskIds ?? []);
    const taskIndex = tasksForInterface(sequence, developmentInterface).findIndex((task) => !completed.has(task.id));
    if (taskIndex >= 0) return { kind: "task", interfaceId: developmentInterface, taskIndex };
    if (!progress[developmentInterface]?.rating) return { kind: "rating", interfaceId: developmentInterface };
  }
  return { kind: "complete" };
}

/** Resume within the visitor's one randomly assigned interface. */
export function nextSingleInterfaceStep(sequence: StudySequence, progress: StudyProgress): DevelopmentStep {
  const assignedInterface = sequenceInterfaces(sequence)[0] as DevelopmentInterfaceId;
  const completed = new Set(progress[assignedInterface]?.completedTaskIds ?? []);
  const taskIndex = tasksForInterface(sequence, assignedInterface).findIndex((task) => !completed.has(task.id));
  if (taskIndex >= 0) return { kind: "task", interfaceId: assignedInterface, taskIndex };
  if (!progress[assignedInterface]?.rating) return { kind: "rating", interfaceId: assignedInterface };
  return { kind: "complete" };
}
