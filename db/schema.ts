import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const studySessions = sqliteTable(
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
    consentedAt: integer("consented_at").notNull(),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [index("study_sessions_balance_idx").on(table.studyPhase, table.status, table.sequence)],
);

export const studyTrials = sqliteTable(
  "study_trials",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    interfaceId: text("interface_id").notNull(),
    position: integer("position").notNull(),
    taskPack: integer("task_pack").notNull(),
    taskId: text("task_id").notNull(),
    isPractice: integer("is_practice", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("presented"),
    presentedAt: integer("presented_at").notNull(),
    firstInteractionAt: integer("first_interaction_at"),
    validRollAt: integer("valid_roll_at"),
    animationCompletedAt: integer("animation_completed_at"),
    elapsedMs: integer("elapsed_ms"),
    invalidAttempts: integer("invalid_attempts").notNull().default(0),
    helpOpened: integer("help_opened", { mode: "boolean" }).notNull().default(false),
    easeRating: integer("ease_rating"),
    confidenceRating: integer("confidence_rating"),
    comment: text("comment"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("study_trials_session_task_idx").on(table.sessionId, table.interfaceId, table.taskId),
    index("study_trials_session_idx").on(table.sessionId),
  ],
);

export const studyEvents = sqliteTable(
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
    occurredAt: integer("occurred_at").notNull(),
    payload: text("payload"),
  },
  (table) => [
    index("study_events_session_time_idx").on(table.sessionId, table.occurredAt),
    index("study_events_trial_time_idx").on(table.trialId, table.occurredAt),
  ],
);

export const studyContactOptIns = sqliteTable(
  "study_contact_opt_ins",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    email: text("email").notNull(),
    sessionId: text("session_id"),
    studyPhase: text("study_phase").notNull(),
    consentedAt: integer("consented_at").notNull(),
  },
  (table) => [
    index("study_contact_opt_ins_kind_idx").on(table.kind),
    index("study_contact_opt_ins_session_idx").on(table.sessionId),
  ],
);
