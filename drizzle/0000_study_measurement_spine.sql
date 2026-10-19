CREATE TABLE `study_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`trial_id` text,
	`event_type` text NOT NULL,
	`interface_id` text,
	`position` integer,
	`task_pack` integer,
	`task_id` text,
	`occurred_at` integer NOT NULL,
	`payload` text
);
--> statement-breakpoint
CREATE INDEX `study_events_session_time_idx` ON `study_events` (`session_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `study_events_trial_time_idx` ON `study_events` (`trial_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `study_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence` text NOT NULL,
	`study_phase` text DEFAULT 'development' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`current_position` integer DEFAULT 0 NOT NULL,
	`vtt_experience` text NOT NULL,
	`notation_familiarity` text NOT NULL,
	`device_class` text NOT NULL,
	`input_method` text NOT NULL,
	`consented_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `study_sessions_balance_idx` ON `study_sessions` (`study_phase`,`status`,`sequence`);--> statement-breakpoint
CREATE TABLE `study_trials` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`interface_id` text NOT NULL,
	`position` integer NOT NULL,
	`task_pack` integer NOT NULL,
	`task_id` text NOT NULL,
	`is_practice` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'presented' NOT NULL,
	`presented_at` integer NOT NULL,
	`first_interaction_at` integer,
	`valid_roll_at` integer,
	`animation_completed_at` integer,
	`elapsed_ms` integer,
	`invalid_attempts` integer DEFAULT 0 NOT NULL,
	`help_opened` integer DEFAULT false NOT NULL,
	`ease_rating` integer,
	`confidence_rating` integer,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_trials_session_task_idx` ON `study_trials` (`session_id`,`interface_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `study_trials_session_idx` ON `study_trials` (`session_id`);