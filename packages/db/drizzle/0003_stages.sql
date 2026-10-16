CREATE TYPE "public"."content_source" AS ENUM('human', 'claude');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."integrity_event_type" AS ENUM('blur', 'visibility_hidden', 'fullscreen_exit', 'paste_attempt', 'copy_attempt');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('draft', 'approved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('mcq', 'multi', 'short', 'long');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('pending', 'clean', 'infected', 'error');--> statement-breakpoint
CREATE TYPE "public"."stage_state" AS ENUM('unlocked', 'in_progress', 'submitted', 'reviewed', 'passed', 'failed', 'missed', 'skipped');--> statement-breakpoint
CREATE TABLE "assessment_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"stage_progress_id" text NOT NULL,
	"question_ids" text[] NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"auto_submitted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "assessment_sessions_stage_progress_id_unique" UNIQUE("stage_progress_id")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_candidate_id" text,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"scan_status" "scan_status" DEFAULT 'pending' NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "integrity_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"type" "integrity_event_type" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "question_type" NOT NULL,
	"body" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correct" text[] DEFAULT '{}' NOT NULL,
	"explanation" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"difficulty" "difficulty" DEFAULT 'medium' NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"status" "question_status" DEFAULT 'draft' NOT NULL,
	"source" "content_source" DEFAULT 'human' NOT NULL,
	"created_by" text,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"node_id" text NOT NULL,
	"state" "stage_state" DEFAULT 'unlocked' NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"extended_until" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"auto_score_pct" numeric(6, 2),
	"draft" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_progress_unique" UNIQUE("application_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"stage_progress_id" text NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"file_ids" text[] DEFAULT '{}' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"late_by_minutes" integer,
	CONSTRAINT "submissions_version_unique" UNIQUE("stage_progress_id","version")
);
--> statement-breakpoint
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_stage_progress_id_stage_progress_id_fk" FOREIGN KEY ("stage_progress_id") REFERENCES "public"."stage_progress"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_candidate_id_candidates_id_fk" FOREIGN KEY ("owner_candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_events" ADD CONSTRAINT "integrity_events_session_id_assessment_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assessment_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_progress" ADD CONSTRAINT "stage_progress_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_stage_progress_id_stage_progress_id_fk" FOREIGN KEY ("stage_progress_id") REFERENCES "public"."stage_progress"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_candidate_id");--> statement-breakpoint
CREATE INDEX "integrity_session_idx" ON "integrity_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "questions_status_idx" ON "questions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stage_progress_due_idx" ON "stage_progress" USING btree ("state","due_at");