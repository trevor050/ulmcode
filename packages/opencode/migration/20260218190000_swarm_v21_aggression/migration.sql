ALTER TABLE `swarm_task` ADD COLUMN `swarm_aggression` text NOT NULL DEFAULT 'balanced';
--> statement-breakpoint
ALTER TABLE `swarm_task` ADD COLUMN `aggression_source` text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE `swarm_task` ADD COLUMN `max_active_background` integer;
--> statement-breakpoint
ALTER TABLE `swarm_task` ADD COLUMN `max_delegation_depth` integer NOT NULL DEFAULT 2;
