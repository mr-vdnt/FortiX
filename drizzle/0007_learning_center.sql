CREATE TABLE IF NOT EXISTS "learning_tutorials" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"module_name" text NOT NULL,
	"lifecycle_stage" text NOT NULL,
	"category" text NOT NULL,
	"difficulty" text NOT NULL,
	"video_provider" text DEFAULT 'none' NOT NULL,
	"video_reference" text,
	"video_source_note" text,
	"thumbnail_url" text,
	"captions_url" text,
	"duration_seconds" integer NOT NULL,
	"learning_objectives" jsonb NOT NULL,
	"prerequisites" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"related_slugs" jsonb NOT NULL,
	"doc_links" jsonb NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_tutorials_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tutorial_id" text NOT NULL,
	"last_position_seconds" integer DEFAULT 0 NOT NULL,
	"max_watched_seconds" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"last_watched_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_progress_user_tutorial_unique" UNIQUE("user_id","tutorial_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_tutorial_id_learning_tutorials_id_fk" FOREIGN KEY ("tutorial_id") REFERENCES "public"."learning_tutorials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_tutorials_published_sort_idx" ON "learning_tutorials" USING btree ("published","sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_tutorials_category_sort_idx" ON "learning_tutorials" USING btree ("category","sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_tutorials_lifecycle_idx" ON "learning_tutorials" USING btree ("lifecycle_stage","sort_order");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "learning_progress_user_tutorial_idx" ON "learning_progress" USING btree ("user_id","tutorial_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_progress_user_watched_idx" ON "learning_progress" USING btree ("user_id","last_watched_at");
