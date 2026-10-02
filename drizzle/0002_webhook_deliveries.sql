CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"project_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt_number" integer NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"status_code" integer,
	"response_body" text,
	"error_message" text,
	"latency_ms" integer,
	"success" boolean NOT NULL,
	"signature" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "webhook_deliveries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_delivery_webhook_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_delivery_project_idx" ON "webhook_deliveries" USING btree ("project_id","created_at");
