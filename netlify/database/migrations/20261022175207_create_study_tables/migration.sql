CREATE TABLE "study_admin_state" (
	"id" integer PRIMARY KEY,
	"is_live" integer DEFAULT 0 NOT NULL,
	"launched_at" bigint,
	CONSTRAINT "study_admin_state_singleton" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "study_contact_opt_ins" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"session_id" text,
	"study_phase" text NOT NULL,
	"consented_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_events" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"trial_id" text,
	"event_type" text NOT NULL,
	"interface_id" text,
	"position" integer,
	"task_pack" integer,
	"task_id" text,
	"occurred_at" bigint NOT NULL,
	"payload" text
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" text PRIMARY KEY,
	"sequence" text NOT NULL,
	"study_phase" text DEFAULT 'development' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_position" integer DEFAULT 0 NOT NULL,
	"vtt_tools" text DEFAULT '[]' NOT NULL,
	"vtt_other" text,
	"vtt_comfort" integer DEFAULT 0 NOT NULL,
	"dice_familiarity" text DEFAULT 'not_collected' NOT NULL,
	"vtt_experience" text NOT NULL,
	"notation_familiarity" text NOT NULL,
	"device_class" text NOT NULL,
	"input_method" text NOT NULL,
	"consented_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"completed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "study_trials" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"interface_id" text NOT NULL,
	"position" integer NOT NULL,
	"task_pack" integer NOT NULL,
	"task_id" text NOT NULL,
	"is_practice" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'presented' NOT NULL,
	"presented_at" bigint NOT NULL,
	"first_interaction_at" bigint,
	"valid_roll_at" bigint,
	"animation_completed_at" bigint,
	"elapsed_ms" integer,
	"invalid_attempts" integer DEFAULT 0 NOT NULL,
	"help_opened" integer DEFAULT 0 NOT NULL,
	"ease_rating" integer,
	"confidence_rating" integer,
	"comment" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "study_contact_opt_ins_kind_idx" ON "study_contact_opt_ins" ("kind");--> statement-breakpoint
CREATE INDEX "study_contact_opt_ins_session_idx" ON "study_contact_opt_ins" ("session_id");--> statement-breakpoint
CREATE INDEX "study_events_session_time_idx" ON "study_events" ("session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "study_events_trial_time_idx" ON "study_events" ("trial_id","occurred_at");--> statement-breakpoint
CREATE INDEX "study_sessions_balance_idx" ON "study_sessions" ("study_phase","status","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "study_trials_session_task_idx" ON "study_trials" ("session_id","interface_id","task_id");--> statement-breakpoint
CREATE INDEX "study_trials_session_idx" ON "study_trials" ("session_id");