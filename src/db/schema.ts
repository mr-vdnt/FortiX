import { pgTable, text, timestamp, boolean, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(), // Using uuid
  email: text('email').notNull().unique(),
  phoneE164: text('phone_e164').unique(),
  phoneVerified: boolean('phone_verified').default(false).notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('DEVELOPER'),
  emailVerified: boolean('email_verified').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const authActionTokens = pgTable('auth_action_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  purpose: text('purpose').notNull(), // PASSWORD_RESET | EMAIL_VERIFICATION | RESET_AUTHORIZATION
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    userPurposeIdx: index('auth_action_tokens_user_purpose_idx').on(table.userId, table.purpose),
  };
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  familyId: text('family_id'),
  replacedById: text('replaced_by_id'),
  rememberMe: boolean('remember_me').default(false).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  absoluteExpiresAt: timestamp('absolute_expires_at'),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  reuseDetectedAt: timestamp('reuse_detected_at'),
  userAgentHash: text('user_agent_hash'),
  ipHash: text('ip_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    familyIdx: index('refresh_tokens_family_idx').on(table.familyId),
    userIdx: index('refresh_tokens_user_idx').on(table.userId),
  };
});

export const recoveryChallenges = pgTable('recovery_challenges', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  channel: text('channel').notNull(), // EMAIL | SMS
  purpose: text('purpose').notNull(), // PASSWORD_RESET | PHONE_VERIFICATION
  destinationMasked: text('destination_masked').notNull(),
  otpHmac: text('otp_hmac').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  failedAttempts: integer('failed_attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(5).notNull(),
  resendCount: integer('resend_count').default(0).notNull(),
  lastSentAt: timestamp('last_sent_at').defaultNow().notNull(),
  resendAvailableAt: timestamp('resend_available_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  invalidatedAt: timestamp('invalidated_at'),
  invalidationReason: text('invalidation_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    userPurposeIdx: index('recovery_challenges_user_purpose_idx').on(table.userId, table.purpose, table.createdAt),
  };
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

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').references(() => webhooks.id, { onDelete: 'cascade' }).notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  attemptNumber: integer('attempt_number').notNull(),
  maxAttempts: integer('max_attempts').default(5).notNull(),
  statusCode: integer('status_code'),
  responseBody: text('response_body'),
  errorMessage: text('error_message'),
  latencyMs: integer('latency_ms'),
  success: boolean('success').notNull(),
  signature: text('signature'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    webhookDeliveryWebhookIdx: index('webhook_delivery_webhook_idx').on(table.webhookId, table.createdAt),
    webhookDeliveryProjectIdx: index('webhook_delivery_project_idx').on(table.projectId, table.createdAt),
  };
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

export const workflowRuns = pgTable('workflow_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  routeId: text('route_id').references(() => apiRoutes.id, { onDelete: 'cascade' }).notNull(),
  profile: text('profile').notNull(),
  status: text('status').notNull(), // QUEUED, RUNNING, VERIFYING, COMPLETED, FAILED, CANCELLED, RECOVERY_REQUIRED
  params: jsonb('params').notNull(),
  timeline: jsonb('timeline').notNull(),
  deterministicVerdict: jsonb('deterministic_verdict'),
  aiAnalysis: jsonb('ai_analysis'),
  evidenceSummary: jsonb('evidence_summary'),
  cleanupStatus: text('cleanup_status').default('NOT_REQUIRED').notNull(),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    workflowRunProjectIdx: index('workflow_run_project_idx').on(table.projectId, table.createdAt),
  };
});

export const studioApis = pgTable('studio_apis', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  routeId: text('route_id').references(() => apiRoutes.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
  basePath: text('base_path').notNull(),
  version: text('version').default('v1').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    studioApiProjectIdx: index('studio_apis_project_idx').on(table.projectId, table.createdAt),
    studioApiPathVersionUnique: uniqueIndex('studio_apis_project_base_version_idx').on(
      table.projectId,
      table.basePath,
      table.version
    ),
  };
});

export const studioResources = pgTable('studio_resources', {
  id: text('id').primaryKey(),
  apiId: text('api_id').references(() => studioApis.id, { onDelete: 'cascade' }).notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  fields: jsonb('fields').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
  return {
    studioResourceApiIdx: index('studio_resources_api_idx').on(table.apiId),
    studioResourceSlugUnique: uniqueIndex('studio_resources_api_slug_idx').on(table.apiId, table.slug),
  };
});

export const studioRecords = pgTable('studio_records', {
  id: text('id').primaryKey(),
  resourceId: text('resource_id').references(() => studioResources.id, { onDelete: 'cascade' }).notNull(),
  apiId: text('api_id').references(() => studioApis.id, { onDelete: 'cascade' }).notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  recordId: text('record_id').notNull(),
  data: jsonb('data').notNull(),
  version: integer('version').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    studioRecordResourceIdx: index('studio_records_resource_idx').on(table.resourceId, table.recordId),
    studioRecordUnique: uniqueIndex('studio_records_resource_record_id_idx').on(
      table.resourceId,
      table.recordId
    ),
  };
});

export const learningTutorials = pgTable('learning_tutorials', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  moduleName: text('module_name').notNull(),
  lifecycleStage: text('lifecycle_stage').notNull(), // PROTECT | BREAK | OBSERVE | PROVE | IMPROVE
  category: text('category').notNull(),
  difficulty: text('difficulty').notNull(), // Beginner | Intermediate | Advanced
  videoProvider: text('video_provider').default('none').notNull(), // self_hosted | https_allowlist | youtube_nocookie | none
  videoReference: text('video_reference'),
  videoSourceNote: text('video_source_note'),
  thumbnailUrl: text('thumbnail_url'),
  captionsUrl: text('captions_url'),
  durationSeconds: integer('duration_seconds').notNull(),
  learningObjectives: jsonb('learning_objectives').notNull(),
  prerequisites: jsonb('prerequisites').notNull(),
  steps: jsonb('steps').notNull(),
  warnings: jsonb('warnings').notNull(),
  relatedSlugs: jsonb('related_slugs').notNull(),
  docLinks: jsonb('doc_links').notNull(),
  featured: boolean('featured').default(false).notNull(),
  published: boolean('published').default(true).notNull(),
  sortOrder: integer('sort_order').default(100).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    publishedSortIdx: index('learning_tutorials_published_sort_idx').on(table.published, table.sortOrder),
    categorySortIdx: index('learning_tutorials_category_sort_idx').on(table.category, table.sortOrder),
    lifecycleSortIdx: index('learning_tutorials_lifecycle_idx').on(table.lifecycleStage, table.sortOrder),
  };
});

export const learningProgress = pgTable('learning_progress', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tutorialId: text('tutorial_id').references(() => learningTutorials.id, { onDelete: 'cascade' }).notNull(),
  lastPositionSeconds: integer('last_position_seconds').default(0).notNull(),
  maxWatchedSeconds: integer('max_watched_seconds').default(0).notNull(),
  completed: boolean('completed').default(false).notNull(),
  completedAt: timestamp('completed_at'),
  lastWatchedAt: timestamp('last_watched_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
  return {
    userTutorialUnique: uniqueIndex('learning_progress_user_tutorial_idx').on(table.userId, table.tutorialId),
    userWatchedIdx: index('learning_progress_user_watched_idx').on(table.userId, table.lastWatchedAt),
  };
});

