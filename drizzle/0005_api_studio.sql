CREATE TABLE IF NOT EXISTS "studio_apis" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"route_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"base_path" text NOT NULL,
	"version" text DEFAULT 'v1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "studio_apis_project_base_version_unique" UNIQUE("project_id","base_path","version"),
	CONSTRAINT "studio_apis_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "studio_apis_route_id_api_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "api_routes"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_apis_project_idx" ON "studio_apis" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "studio_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"api_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"fields" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "studio_resources_api_slug_unique" UNIQUE("api_id","slug"),
	CONSTRAINT "studio_resources_api_id_studio_apis_id_fk" FOREIGN KEY ("api_id") REFERENCES "studio_apis"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "studio_resources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_resources_api_idx" ON "studio_resources" USING btree ("api_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "studio_records" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"api_id" text NOT NULL,
	"project_id" text NOT NULL,
	"record_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "studio_records_resource_record_id_unique" UNIQUE("resource_id","record_id"),
	CONSTRAINT "studio_records_resource_id_studio_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "studio_resources"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "studio_records_api_id_studio_apis_id_fk" FOREIGN KEY ("api_id") REFERENCES "studio_apis"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "studio_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "studio_records_resource_idx" ON "studio_records" USING btree ("resource_id","record_id");
