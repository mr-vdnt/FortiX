-- PostgreSQL Defense-in-Depth Row-Level Security (RLS) & Least-Privilege Role Policies for FortiX
-- 1. Creates non-superuser role `fortix_app` (NOBYPASSRLS) for runtime connections when supported.
-- 2. Enforces tenant isolation across all tenant-owned tables when `app.current_user_id` is set via
--    transaction-local `SELECT set_config('app.current_user_id', '<uuid>', true)`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fortix_app') THEN
    CREATE ROLE fortix_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping fortix_app role creation (managed Postgres role lacks CREATEROLE).';
END
$$;

DO $$
BEGIN
  EXECUTE 'GRANT USAGE ON SCHEMA public TO fortix_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fortix_app';
EXCEPTION
  WHEN undefined_object OR insufficient_privilege THEN
    NULL;
END
$$;

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fortix_organizations_tenant_isolation" ON "organizations";
CREATE POLICY "fortix_organizations_tenant_isolation" ON "organizations"
  USING (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR "owner_id" = current_setting('app.current_user_id', true)
  )
  WITH CHECK (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR "owner_id" = current_setting('app.current_user_id', true)
  );

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fortix_projects_tenant_isolation" ON "projects";
CREATE POLICY "fortix_projects_tenant_isolation" ON "projects"
  USING (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "organizations" o
      WHERE o."id" = "projects"."org_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "organizations" o
      WHERE o."id" = "projects"."org_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  );

ALTER TABLE "project_settings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fortix_project_settings_tenant_isolation" ON "project_settings";
CREATE POLICY "fortix_project_settings_tenant_isolation" ON "project_settings"
  USING (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "projects" p
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE p."id" = "project_settings"."project_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "projects" p
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE p."id" = "project_settings"."project_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  );

ALTER TABLE "api_routes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fortix_api_routes_tenant_isolation" ON "api_routes";
CREATE POLICY "fortix_api_routes_tenant_isolation" ON "api_routes"
  USING (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "projects" p
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE p."id" = "api_routes"."project_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "projects" p
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE p."id" = "api_routes"."project_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  );

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fortix_api_keys_tenant_isolation" ON "api_keys";
CREATE POLICY "fortix_api_keys_tenant_isolation" ON "api_keys"
  USING (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "projects" p
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE p."id" = "api_keys"."project_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "projects" p
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE p."id" = "api_keys"."project_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  );

ALTER TABLE "security_policies" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fortix_security_policies_tenant_isolation" ON "security_policies";
CREATE POLICY "fortix_security_policies_tenant_isolation" ON "security_policies"
  USING (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "api_routes" r
      JOIN "projects" p ON p."id" = r."project_id"
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE r."id" = "security_policies"."route_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "api_routes" r
      JOIN "projects" p ON p."id" = r."project_id"
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE r."id" = "security_policies"."route_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  );

ALTER TABLE "experiments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fortix_experiments_tenant_isolation" ON "experiments";
CREATE POLICY "fortix_experiments_tenant_isolation" ON "experiments"
  USING (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "api_routes" r
      JOIN "projects" p ON p."id" = r."project_id"
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE r."id" = "experiments"."route_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "api_routes" r
      JOIN "projects" p ON p."id" = r."project_id"
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE r."id" = "experiments"."route_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  );

ALTER TABLE "verifications" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fortix_verifications_tenant_isolation" ON "verifications";
CREATE POLICY "fortix_verifications_tenant_isolation" ON "verifications"
  USING (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "experiments" e
      JOIN "api_routes" r ON r."id" = e."route_id"
      JOIN "projects" p ON p."id" = r."project_id"
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE e."id" = "verifications"."experiment_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "experiments" e
      JOIN "api_routes" r ON r."id" = e."route_id"
      JOIN "projects" p ON p."id" = r."project_id"
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE e."id" = "verifications"."experiment_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  );

ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fortix_webhooks_tenant_isolation" ON "webhooks";
CREATE POLICY "fortix_webhooks_tenant_isolation" ON "webhooks"
  USING (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "projects" p
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE p."id" = "webhooks"."project_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "projects" p
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE p."id" = "webhooks"."project_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  );

ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fortix_workflow_runs_tenant_isolation" ON "workflow_runs";
CREATE POLICY "fortix_workflow_runs_tenant_isolation" ON "workflow_runs"
  USING (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "projects" p
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE p."id" = "workflow_runs"."project_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.current_user_id', true), '') = ''
    OR EXISTS (
      SELECT 1 FROM "projects" p
      JOIN "organizations" o ON o."id" = p."org_id"
      WHERE p."id" = "workflow_runs"."project_id"
        AND o."owner_id" = current_setting('app.current_user_id', true)
    )
  );
