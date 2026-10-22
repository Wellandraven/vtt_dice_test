import { bigint, check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Millisecond timestamps (Date.now()) exceed a 32-bit integer, so they are stored as bigint.
// Flags stay 0/1 integers because the routes query them with raw SQL.

export const studySessions = pgTable(
  "study_sessions",
  {
    id: text("id").primaryKey(),
    sequence: text("sequence").notNull(),
    studyPhase: text("study_phase").notNull().default("development"),
    status: text("status").notNull().default("active"),
    currentPosition: integer("current_position").notNull().default(0),
    vttTools: text("vtt_tools").notNull().default("[]"),
    vttOther: text("vtt_other"),
    vttComfort: integer("vtt_comfort").notNull().default(0),
    diceFamiliarity: text("dice_familiarity").notNull().default("not_collected"),
    vttExperience: text("vtt_experience").notNull(),
    notationFamiliarity: text("notation_familiarity").notNull(),
    viewportClass: text("device_class").notNull(),
    inputMethod: text("input_method").notNull(),
    consentedAt: bigint("consented_at", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    completedAt: bigint("completed_at", { mode: "number" }),
  },
  (table) => [index("study_sessions_balance_idx").on(table.studyPhase, table.status, table.sequence)],
);

export const studyTrials = pgTable(
  "study_trials",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    interfaceId: text("interface_id").notNull(),
    position: integer("position").notNull(),
    taskPack: integer("task_pack").notNull(),
    taskId: text("task_id").notNull(),
    isPractice: integer("is_practice").notNull().default(0),
    status: text("status").notNull().default("presented"),
    presentedAt: bigint("presented_at", { mode: "number" }).notNull(),
    firstInteractionAt: bigint("first_interaction_at", { mode: "number" }),
    validRollAt: bigint("valid_roll_at", { mode: "number" }),
    animationCompletedAt: bigint("animation_completed_at", { mode: "number" }),
    elapsedMs: integer("elapsed_ms"),
    invalidAttempts: integer("invalid_attempts").notNull().default(0),
    helpOpened: integer("help_opened").notNull().default(0),
    easeRating: integer("ease_rating"),
    confidenceRating: integer("confidence_rating"),
    comment: text("comment"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("study_trials_session_task_idx").on(table.sessionId, table.interfaceId, table.taskId),
    index("study_trials_session_idx").on(table.sessionId),
  ],
);

export const studyEvents = pgTable(
  "study_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    trialId: text("trial_id"),
    eventType: text("event_type").notNull(),
    interfaceId: text("interface_id"),
    position: integer("position"),
    taskPack: integer("task_pack"),
    taskId: text("task_id"),
    occurredAt: bigint("occurred_at", { mode: "number" }).notNull(),
    payload: text("payload"),
  },
  (table) => [
    index("study_events_session_time_idx").on(table.sessionId, table.occurredAt),
    index("study_events_trial_time_idx").on(table.trialId, table.occurredAt),
  ],
);

export const studyContactOptIns = pgTable(
  "study_contact_opt_ins",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    email: text("email").notNull(),
    sessionId: text("session_id"),
    studyPhase: text("study_phase").notNull(),
    consentedAt: bigint("consented_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("study_contact_opt_ins_kind_idx").on(table.kind),
    index("study_contact_opt_ins_session_idx").on(table.sessionId),
  ],
);

export const studyAdminState = pgTable(
  "study_admin_state",
  {
    id: integer("id").primaryKey(),
    isLive: integer("is_live").notNull().default(0),
    launchedAt: bigint("launched_at", { mode: "number" }),
  },
  (table) => [check("study_admin_state_singleton", sql`${table.id} = 1`)],
);
