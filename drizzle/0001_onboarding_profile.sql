ALTER TABLE `study_sessions` ADD `vtt_tools` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `vtt_other` text;
--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `vtt_comfort` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `dice_familiarity` text DEFAULT 'not_collected' NOT NULL;
