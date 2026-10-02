import { pgTable, text, timestamp, boolean, jsonb, integer, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(), // Using uuid
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('DEVELOPER'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  orgId: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  environment: text('environment').notNull().default('development'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const apiRoutes = pgTable('api_routes', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  pathPattern: text('path_pattern').notNull(),
  targetUrl: text('target_url').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  keyPrefix: text('key_prefix').notNull(),
  secretHash: text('secret_hash').notNull(),
  name: text('name').notNull(),
  purpose: text('purpose'),
  scopes: jsonb('scopes'),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const securityPolicies = pgTable('security_policies', {
  id: text('id').primaryKey(),
  routeId: text('route_id').references(() => apiRoutes.id, { onDelete: 'cascade' }).notNull(),
  rateLimitRpm: integer('rate_limit_rpm'),
  enableWaf: boolean('enable_waf').default(false).notNull(),
  enableSsrf: boolean('enable_ssrf').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const experiments = pgTable('experiments', {
  id: text('id').primaryKey(),
  routeId: text('route_id').references(() => apiRoutes.id, { onDelete: 'cascade' }).notNull(),
  type: text('type').notNull(), // e.g., latency, timeout, error_5xx
  status: text('status').notNull(), // CREATED, QUEUED, RUNNING, OBSERVING, ANALYZING, COMPLETED, FAILED, CANCELLED
  config: jsonb('config').notNull(),
  scheduledFor: timestamp('scheduled_for'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  experimentId: text('experiment_id').references(() => experiments.id, { onDelete: 'cascade' }).notNull(),
  expected: jsonb('expected').notNull(),
  observed: jsonb('observed').notNull(),
  verdict: text('verdict').notNull(),
  pdfS3Url: text('pdf_s3_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const metricLogs = pgTable('metric_logs', {
  id: text('id').primaryKey(),
  routeId: text('route_id').references(() => apiRoutes.id, { onDelete: 'cascade' }).notNull(),
  experimentId: text('experiment_id').references(() => experiments.id, { onDelete: 'set null' }),
  requestId: text('request_id'),
  latencyMs: integer('latency_ms').notNull(),
  statusCode: integer('status_code').notNull(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (table) => {
  return {
    routeTimeIdx: index('route_time_idx').on(table.routeId, table.timestamp),
  };
});

export const securityEvents = pgTable('security_events', {
  id: text('id').primaryKey(),
  routeId: text('route_id').references(() => apiRoutes.id, { onDelete: 'cascade' }).notNull(),
  requestId: text('request_id'),
  threatType: text('threat_type').notNull(),
  payload: jsonb('payload'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (table) => {
  return {
    threatRouteTimeIdx: index('threat_route_time_idx').on(table.routeId, table.timestamp),
  };
});

export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret'),
  events: jsonb('events').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const projectSettings = pgTable('project_settings', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull().unique(),
  version: integer('version').default(1).notNull(),
  gatewayConfig: jsonb('gateway_config').notNull(),
  securityConfig: jsonb('security_config').notNull(),
  rateLimitConfig: jsonb('rate_limit_config').notNull(),
  experimentConfig: jsonb('experiment_config').notNull(),
  telemetryConfig: jsonb('telemetry_config').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  domain: text('domain').notNull(),
  previousVersion: integer('previous_version').notNull(),
  newVersion: integer('new_version').notNull(),
  diff: jsonb('diff').notNull(),
  metadata: jsonb('metadata'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (table) => {
  return {
    auditProjectTimeIdx: index('audit_project_time_idx').on(table.projectId, table.timestamp),
  };
});
