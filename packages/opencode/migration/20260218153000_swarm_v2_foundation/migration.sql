CREATE TABLE `swarm_team` (
  `id` text PRIMARY KEY NOT NULL,
  `root_session_id` text NOT NULL,
  `title` text NOT NULL,
  `status` text NOT NULL,
  `topology` text NOT NULL,
  `autonomy_mode` text NOT NULL,
  `tmux_enabled` integer NOT NULL DEFAULT 1,
  `metadata` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`root_session_id`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `swarm_team_root_session_idx` ON `swarm_team` (`root_session_id`);

--> statement-breakpoint
CREATE TABLE `swarm_member` (
  `team_id` text NOT NULL,
  `session_id` text NOT NULL,
  `agent_name` text NOT NULL,
  `role` text NOT NULL,
  `lane` text,
  `state` text NOT NULL,
  `metadata` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  PRIMARY KEY(`team_id`, `session_id`),
  FOREIGN KEY (`team_id`) REFERENCES `swarm_team`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `swarm_member_team_idx` ON `swarm_member` (`team_id`);
--> statement-breakpoint
CREATE INDEX `swarm_member_session_idx` ON `swarm_member` (`session_id`);

--> statement-breakpoint
CREATE TABLE `swarm_task` (
  `id` text PRIMARY KEY NOT NULL,
  `team_id` text,
  `session_id` text NOT NULL,
  `parent_session_id` text NOT NULL,
  `caller_id` text,
  `caller_chain` text,
  `delegation_depth` integer NOT NULL DEFAULT 0,
  `description` text NOT NULL,
  `prompt` text NOT NULL,
  `subagent_type` text NOT NULL,
  `provider_id` text,
  `model_id` text,
  `teammate_targets` text,
  `coordination_scope` text,
  `expected_output_schema` text NOT NULL,
  `isolation_mode` text NOT NULL DEFAULT 'shared',
  `retry_policy` text NOT NULL DEFAULT 'none',
  `retry_count` integer NOT NULL DEFAULT 0,
  `scheduler_lane` text,
  `claim_ids` text,
  `status` text NOT NULL,
  `stale_timeout_ms` integer NOT NULL,
  `output` text,
  `error` text,
  `time_started` integer,
  `time_ended` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`team_id`) REFERENCES `swarm_team`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE,
  FOREIGN KEY (`parent_session_id`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `swarm_task_team_idx` ON `swarm_task` (`team_id`);
--> statement-breakpoint
CREATE INDEX `swarm_task_parent_session_idx` ON `swarm_task` (`parent_session_id`);
--> statement-breakpoint
CREATE INDEX `swarm_task_session_idx` ON `swarm_task` (`session_id`);
--> statement-breakpoint
CREATE INDEX `swarm_task_status_idx` ON `swarm_task` (`status`);

--> statement-breakpoint
CREATE TABLE `swarm_message` (
  `id` text PRIMARY KEY NOT NULL,
  `team_id` text NOT NULL,
  `type` text NOT NULL,
  `from_session_id` text,
  `to_session_id` text,
  `payload` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`team_id`) REFERENCES `swarm_team`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE,
  FOREIGN KEY (`from_session_id`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL,
  FOREIGN KEY (`to_session_id`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `swarm_message_team_idx` ON `swarm_message` (`team_id`);
--> statement-breakpoint
CREATE INDEX `swarm_message_to_session_idx` ON `swarm_message` (`to_session_id`);

--> statement-breakpoint
CREATE TABLE `swarm_claim` (
  `id` text PRIMARY KEY NOT NULL,
  `team_id` text NOT NULL,
  `task_id` text,
  `scope` text NOT NULL,
  `owner_session_id` text NOT NULL,
  `status` text NOT NULL,
  `metadata` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`team_id`) REFERENCES `swarm_team`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE,
  FOREIGN KEY (`task_id`) REFERENCES `swarm_task`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL,
  FOREIGN KEY (`owner_session_id`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `swarm_claim_team_idx` ON `swarm_claim` (`team_id`);
--> statement-breakpoint
CREATE INDEX `swarm_claim_scope_idx` ON `swarm_claim` (`scope`);
--> statement-breakpoint
CREATE INDEX `swarm_claim_owner_idx` ON `swarm_claim` (`owner_session_id`);

--> statement-breakpoint
CREATE TABLE `swarm_event` (
  `id` text PRIMARY KEY NOT NULL,
  `team_id` text,
  `task_id` text,
  `session_id` text,
  `event_type` text NOT NULL,
  `payload` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  FOREIGN KEY (`team_id`) REFERENCES `swarm_team`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL,
  FOREIGN KEY (`task_id`) REFERENCES `swarm_task`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL,
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `swarm_event_team_idx` ON `swarm_event` (`team_id`);
--> statement-breakpoint
CREATE INDEX `swarm_event_task_idx` ON `swarm_event` (`task_id`);
--> statement-breakpoint
CREATE INDEX `swarm_event_session_idx` ON `swarm_event` (`session_id`);
