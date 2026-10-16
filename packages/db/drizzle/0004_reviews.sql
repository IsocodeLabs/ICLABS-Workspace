CREATE TYPE "public"."assignment_reason" AS ENUM('primary', 'borderline_second', 'manual');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'submitted', 'released');--> statement-breakpoint
CREATE TYPE "public"."decision_action" AS ENUM('advance', 'reject', 'hold', 'reopen', 'complete');--> statement-breakpoint
CREATE TYPE "public"."recommendation" AS ENUM('strong_yes', 'yes', 'no', 'strong_no');--> statement-breakpoint
CREATE TYPE "public"."review_kind" AS ENUM('human', 'ai_suggestion');--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"from_node_id" text,
	"action" "decision_action" NOT NULL,
	"target_node_id" text,
	"by_user_id" text,
	"via" text DEFAULT 'ui' NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"stage_progress_id" text NOT NULL,
	"application_id" text NOT NULL,
	"node_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"reason" "assignment_reason" DEFAULT 'primary' NOT NULL,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"stage_progress_id" text NOT NULL,
	"assignment_id" text,
	"reviewer_id" text,
	"kind" "review_kind" NOT NULL,
	"scores" jsonb NOT NULL,
	"total_pct" numeric(6, 2),
	"recommendation" "recommendation",
	"notes" text,
	"evidence" jsonb,
	"accepted_from_ai" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_stage_progress_id_stage_progress_id_fk" FOREIGN KEY ("stage_progress_id") REFERENCES "public"."stage_progress"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_reviewer_id_team_members_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_stage_progress_id_stage_progress_id_fk" FOREIGN KEY ("stage_progress_id") REFERENCES "public"."stage_progress"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_assignment_id_review_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."review_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_team_members_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_application_idx" ON "decisions" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "review_assignments_reviewer_idx" ON "review_assignments" USING btree ("reviewer_id","status");--> statement-breakpoint
CREATE INDEX "review_assignments_progress_idx" ON "review_assignments" USING btree ("stage_progress_id");--> statement-breakpoint
CREATE INDEX "reviews_progress_idx" ON "reviews" USING btree ("stage_progress_id");