CREATE TYPE "public"."interview_mode" AS ENUM('meet', 'phone', 'in_person');--> statement-breakpoint
CREATE TYPE "public"."interview_status" AS ENUM('scheduled', 'cancelled', 'done', 'no_show');--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"stage_progress_id" text NOT NULL,
	"node_id" text NOT NULL,
	"round_name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"interviewer_ids" text[] NOT NULL,
	"mode" "interview_mode" NOT NULL,
	"location" text,
	"meet_url" text,
	"calendar_event_id" text,
	"status" "interview_status" DEFAULT 'scheduled' NOT NULL,
	"reschedule_count" integer DEFAULT 0 NOT NULL,
	"reminder_day_sent_at" timestamp with time zone,
	"reminder_hour_sent_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "oauth_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token_hash" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_grants_access_token_hash_unique" UNIQUE("access_token_hash"),
	CONSTRAINT "oauth_grants_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_stage_progress_id_stage_progress_id_fk" FOREIGN KEY ("stage_progress_id") REFERENCES "public"."stage_progress"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interviews_starts_idx" ON "interviews" USING btree ("status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "interviews_one_live" ON "interviews" USING btree ("stage_progress_id") WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "oauth_grants_user_idx" ON "oauth_grants" USING btree ("user_id");