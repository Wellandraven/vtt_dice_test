CREATE TABLE `study_contact_opt_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`email` text NOT NULL,
	`session_id` text,
	`study_phase` text NOT NULL,
	`consented_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `study_contact_opt_ins_kind_idx` ON `study_contact_opt_ins` (`kind`);
--> statement-breakpoint
CREATE INDEX `study_contact_opt_ins_session_idx` ON `study_contact_opt_ins` (`session_id`);
