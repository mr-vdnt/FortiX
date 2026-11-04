import { ReportBlock, ReportChapter } from './types';

function dictTable(
  tableNum: string,
  sqlTableName: string,
  purpose: string,
  indexesAndRelations: string,
  columns: Array<[string, string, string, string, string]>
): ReportBlock[] {
  return [
    {
      kind: 'p',
      text: `Table Purpose (${sqlTableName}): ${purpose} Indexes & Relationships: ${indexesAndRelations}`,
    },
    {
      kind: 'table',
      tableNumber: tableNum,
      caption: `PostgreSQL Data Dictionary — ${sqlTableName}`,
      colWidths: [20, 14, 24, 14, 28],
      headers: ['Column Name', 'SQL Type', 'PK / FK / Constraints', 'Default', 'Synthetic Example / Notes'],
      rows: columns,
    },
  ];
}

export const CHAPTERS_PART2: ReportChapter[] = [
  {
    id: 'chapter-3',
    chapterLabel: 'CHAPTER 3',
    number: '3',
    title: 'DATA DICTIONARY',
    sections: [
      {
        number: '3.1',
        title: 'Database Tables SQL/NoSQL (PostgreSQL 15 Relational Schema & Redis 7 Keyspace)',
        blocks: [
          {
            kind: 'p',
            text: 'FortiX employs a polyglot persistence architecture with strict separation of responsibilities: PostgreSQL 15 serves as the authoritative ACID relational database storing all 23 application tables defined in src/db/schema.ts and versioned through eight Drizzle ORM migrations (drizzle/0000_dizzy_moon_knight.sql through drizzle/0007_learning_center.sql), whereas Redis 7 is used strictly for atomic Lua token-bucket state, high-throughput telemetry stream buffering, multi-replica Pub/Sub invalidation, and BullMQ job queues—never as a substitute for durable relational records.',
          },
          {
            kind: 'figure',
            figureNumber: '3.1',
            caption: 'Entity-Relationship (ER) Diagram of the Complete 23-Table PostgreSQL Schema Grouped Across Five Domains',
            imagePath: 'docs/reports/diagrams/fig16_er_diagram.png',
            sourceNote: 'Generated directly from src/db/schema.ts and migrations 0000_dizzy_moon_knight.sql through 0007_learning_center.sql.',
          },
          {
            kind: 'table',
            tableNumber: '3.1',
            caption: 'Master Inventory of the 23 PostgreSQL Tables in FortiX',
            colWidths: [6, 22, 19, 23, 30],
            headers: ['#', 'Table Name', 'Domain Subsystem', 'Primary / Foreign Keys', 'Isolation & RLS Policy Scope'],
            rows: [
              ['1', 'users', 'Identity & Auth', 'PK: id', 'Identity lookup root; unique email & phone_e164'],
              ['2', 'auth_action_tokens', 'Identity & Auth', 'PK: id; FK: user_id -> users', 'RLS enabled: user_id = app.current_user_id'],
              ['3', 'refresh_tokens', 'Session Rotation', 'PK: id; FK: user_id -> users', 'RLS enabled: user_id = app.current_user_id'],
              ['4', 'recovery_challenges', 'OTP Account Recovery', 'PK: id; FK: user_id -> users', 'RLS enabled: user_id = app.current_user_id'],
              ['5', 'organizations', 'Tenant Hierarchy', 'PK: id; FK: owner_id -> users', 'RLS enabled: owner_id = app.current_user_id'],
              ['6', 'projects', 'Tenant Anchor', 'PK: id; FK: org_id -> organizations', 'RLS enabled: via organizations.owner_id'],
              ['7', 'project_settings', 'Governance', 'PK: id; UQ FK: project_id -> projects', 'RLS enabled: tenant-scoped via project_id'],
              ['8', 'audit_logs', 'Compliance Audit', 'PK: id; FK: project_id, user_id', 'Append-only log; query-scoped by project_id'],
              ['9', 'api_routes', 'Gateway Routing', 'PK: id; FK: project_id -> projects', 'RLS enabled: tenant-scoped via project_id'],
              ['10', 'api_keys', 'Gateway Auth', 'PK: id; FK: project_id -> projects', 'RLS enabled: tenant-scoped via project_id'],
              ['11', 'security_policies', 'Policy Enforcement', 'PK: id; FK: route_id -> api_routes', 'RLS enabled: route -> project ownership chain'],
              ['12', 'experiments', 'Chaos Engine', 'PK: id; FK: route_id -> api_routes', 'RLS enabled: route -> project ownership chain'],
              ['13', 'verifications', 'Verification Engine', 'PK: id; FK: experiment_id -> experiments', 'RLS enabled: experiment -> route -> project'],
              ['14', 'metric_logs', 'Observability', 'PK: id; FK: route_id, experiment_id', 'Worker batch sink; query-scoped via route_id'],
              ['15', 'security_events', 'WAF & Threat Log', 'PK: id; FK: route_id -> api_routes', 'Worker batch sink; query-scoped via route_id'],
              ['16', 'webhooks', 'Outbound Integrations', 'PK: id; FK: project_id -> projects', 'RLS enabled: tenant-scoped via project_id'],
              ['17', 'webhook_deliveries', 'Webhook Audit', 'PK: id; FK: webhook_id, project_id', 'Worker delivery log; query-scoped via project_id'],
              ['18', 'workflow_runs', 'Autonomous Workflows', 'PK: id; FK: project_id, route_id', 'RLS enabled: tenant-scoped via project_id'],
              ['19', 'studio_apis', 'API Studio', 'PK: id; FK: project_id, route_id', 'RLS enabled: tenant-scoped via project_id'],
              ['20', 'studio_resources', 'API Studio', 'PK: id; FK: api_id, project_id', 'RLS enabled: tenant-scoped via project_id'],
              ['21', 'studio_records', 'API Studio Dataset', 'PK: id; FK: resource_id, api_id, project_id', 'RLS enabled: tenant-scoped via project_id'],
              ['22', 'learning_tutorials', 'Learning Center', 'PK: id; UQ: slug', 'Shared platform catalog; ADMIN-only mutations'],
              ['23', 'learning_progress', 'Learning Center', 'PK: id; FK: user_id, tutorial_id', 'RLS enabled: user_id = app.current_user_id'],
            ],
          },
          ...dictTable(
            '3.2',
            'users',
            'Stores operator credentials, RBAC role assignments, normalized E.164 phone numbers, and verification flags.',
            'Unique constraints on email and phone_e164 (nullable PostgreSQL UNIQUE allows multiple NULL rows); referenced by organizations, refresh_tokens, recovery_challenges, auth_action_tokens, and learning_progress.',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"550e8400-e29b-41d4-a716-446655440000"'],
              ['email', 'TEXT', 'UNIQUE, NOT NULL', 'None', '"operator@example.edu" (lowercased)'],
              ['phone_e164', 'TEXT', 'UNIQUE, NULLABLE', 'NULL', '"+919876543210" (normalized E.164)'],
              ['phone_verified', 'BOOLEAN', 'NOT NULL', 'false', 'true (required before SMS OTP recovery)'],
              ['password_hash', 'TEXT', 'NOT NULL', 'None', '"$2b$10$N9qo8uLOickgx2ZMRZoMye..."'],
              ['role', 'TEXT', 'NOT NULL', "'DEVELOPER'", "'ADMIN' | 'DEVELOPER' | 'VIEWER'"],
              ['email_verified', 'BOOLEAN', 'NOT NULL', 'false', 'true'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:15:00"'],
            ]
          ),
          ...dictTable(
            '3.3',
            'auth_action_tokens',
            'Stores SHA-256 digests of single-use email verification, password reset, and OTP-issued RESET_AUTHORIZATION tokens.',
            'FK user_id -> users.id ON DELETE CASCADE; UNIQUE(token_hash); composite index auth_action_tokens_user_purpose_idx(user_id, purpose).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"6d9c1f10-31c2-4a0e-9e21-88a120001122"'],
              ['user_id', 'TEXT (UUID)', 'FK -> users.id (CASCADE), NOT NULL', 'None', '"550e8400-e29b-41d4-a716-446655440000"'],
              ['purpose', 'TEXT', 'NOT NULL', 'None', "'RESET_AUTHORIZATION' | 'EMAIL_VERIFICATION'"],
              ['token_hash', 'TEXT (64-hex)', 'UNIQUE, NOT NULL', 'None', '"9f86d081884c7d659a2feaa0c55ad015..."'],
              ['expires_at', 'TIMESTAMP', 'NOT NULL', 'None', '"2026-11-03 10:25:00" (10m TTL for reset auth)'],
              ['used_at', 'TIMESTAMP', 'NULLABLE', 'NULL', '"2026-11-03 10:18:14" (atomic single-use mark)'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:15:00"'],
            ]
          ),
          ...dictTable(
            '3.4',
            'refresh_tokens',
            'Tracks rotating Remember-Me (30d) and standard (12h) refresh session families, device metadata hashes, and token reuse detection.',
            'FK user_id -> users.id ON DELETE CASCADE; UNIQUE(token_hash); indexes refresh_tokens_family_idx(family_id) and refresh_tokens_user_idx(user_id).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"8b11e240-90a1-4b51-a111-223344556677"'],
              ['user_id', 'TEXT (UUID)', 'FK -> users.id (CASCADE), NOT NULL', 'None', '"550e8400-e29b-41d4-a716-446655440000"'],
              ['token_hash', 'TEXT (64-hex)', 'UNIQUE, NOT NULL', 'None', '"e3b0c44298fc1c149afbf4c8996fb924..."'],
              ['family_id', 'TEXT (UUID)', 'NULLABLE (Indexed)', 'NULL', '"fam-91a4b2c8-1122-4333-8444-556677889900"'],
              ['replaced_by_id', 'TEXT (UUID)', 'NULLABLE', 'NULL', '"9c22f351-a1b2-4c62-b222-334455667788"'],
              ['remember_me', 'BOOLEAN', 'NOT NULL', 'false', 'true (30-day persistent cookie policy)'],
              ['expires_at', 'TIMESTAMP', 'NOT NULL', 'None', '"2026-12-03 10:15:00"'],
              ['absolute_expires_at', 'TIMESTAMP', 'NULLABLE', 'NULL', '"2026-12-03 10:15:00" (hard family cap)'],
              ['last_used_at', 'TIMESTAMP', 'NULLABLE', 'NULL', '"2026-11-03 11:02:19"'],
              ['revoked_at', 'TIMESTAMP', 'NULLABLE', 'NULL', 'NULL (active) or revocation timestamp'],
              ['reuse_detected_at', 'TIMESTAMP', 'NULLABLE', 'NULL', 'Populated if rotated token is replayed'],
              ['user_agent_hash', 'TEXT', 'NULLABLE', 'NULL', '"a41c92e1b8d03f77" (privacy-preserving digest)'],
              ['ip_hash', 'TEXT', 'NULLABLE', 'NULL', '"7c89f012e4b1192a"'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:15:00"'],
            ]
          ),
          ...dictTable(
            '3.5',
            'recovery_challenges',
            'Stores time-limited 6-digit OTP verification challenges using keyed HMAC-SHA256 digests, attempt counters, and resend cooldown timestamps.',
            'FK user_id -> users.id ON DELETE CASCADE; composite index recovery_challenges_user_purpose_idx(user_id, purpose, created_at).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"ch-71f0a211-44d2-48b9-9f01-aa22bb33cc44"'],
              ['user_id', 'TEXT (UUID)', 'FK -> users.id (CASCADE), NOT NULL', 'None', '"550e8400-e29b-41d4-a716-446655440000"'],
              ['channel', 'TEXT', 'NOT NULL', 'None', "'EMAIL' | 'SMS'"],
              ['purpose', 'TEXT', 'NOT NULL', 'None', "'PASSWORD_RESET' | 'PHONE_VERIFICATION'"],
              ['destination_masked', 'TEXT', 'NOT NULL', 'None', '"op***@example.edu" or "+91******3210"'],
              ['otp_hmac', 'TEXT (64-hex)', 'NOT NULL', 'None', 'HMAC-SHA256(key, challengeId:purpose:otp)'],
              ['expires_at', 'TIMESTAMP', 'NOT NULL', 'None', '"2026-11-03 10:25:00" (10-minute window)'],
              ['failed_attempts', 'INTEGER', 'NOT NULL', '0', '0..5 (locked when failed_attempts >= max_attempts)'],
              ['max_attempts', 'INTEGER', 'NOT NULL', '5', '5'],
              ['resend_count', 'INTEGER', 'NOT NULL', '0', '1 (max 5 resends per challenge)'],
              ['last_sent_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:15:00"'],
              ['resend_available_at', 'TIMESTAMP', 'NOT NULL', 'None', '"2026-11-03 10:16:00" (60s cooldown)'],
              ['consumed_at', 'TIMESTAMP', 'NULLABLE', 'NULL', 'Timestamp when valid OTP consumed challenge'],
              ['invalidated_at', 'TIMESTAMP', 'NULLABLE', 'NULL', 'Set on lockout, supersede, or provider 5xx'],
              ['invalidation_reason', 'TEXT', 'NULLABLE', 'NULL', "'MAX_ATTEMPTS_EXCEEDED' | 'DELIVERY_FAILED'"],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:15:00"'],
            ]
          ),
          ...dictTable(
            '3.6',
            'organizations',
            'Top-level tenant container owned by an operator account.',
            'FK owner_id -> users.id ON DELETE CASCADE; 1:N parent of projects.',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"org-10293847-56a1-4b2c-9d3e-0f1e2d3c4b5a"'],
              ['name', 'TEXT', 'NOT NULL', 'None', '"Academic Evaluation Org"'],
              ['owner_id', 'TEXT (UUID)', 'FK -> users.id (CASCADE), NOT NULL', 'None', '"550e8400-e29b-41d4-a716-446655440000"'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:15:00"'],
            ]
          ),
          ...dictTable(
            '3.7',
            'projects',
            'Primary operational isolation boundary scoping routes, API keys, Studio APIs, experiments, webhooks, and settings.',
            'FK org_id -> organizations.id ON DELETE CASCADE; 1:N parent of api_routes, api_keys, studio_apis, webhooks, audit_logs, workflow_runs.',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"proj-dd7b1eb5-6d4d-4a4b-b313-8646128537b1"'],
              ['org_id', 'TEXT (UUID)', 'FK -> organizations.id (CASCADE), NOT NULL', 'None', '"org-10293847-56a1-4b2c-9d3e-0f1e2d3c4b5a"'],
              ['name', 'TEXT', 'NOT NULL', 'None', '"Default Project"'],
              ['environment', 'TEXT', 'NOT NULL', "'development'", "'development' | 'staging' | 'production'"],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:15:00"'],
            ]
          ),
          ...dictTable(
            '3.8',
            'api_routes',
            'Maps external gateway path patterns (/proxy/:routeId/*) to external HTTPS targets or internal FortiX API Studio targets.',
            'FK project_id -> projects.id ON DELETE CASCADE; 1:N parent of security_policies, experiments, metric_logs, security_events.',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"rt-7a88c112-3f44-4d91-8122-9900aabbccdd"'],
              ['project_id', 'TEXT (UUID)', 'FK -> projects.id (CASCADE), NOT NULL', 'None', '"proj-dd7b1eb5-6d4d-4a4b-b313-8646128537b1"'],
              ['path_pattern', 'TEXT', 'NOT NULL', 'None', '"/api/store/*"'],
              ['target_url', 'TEXT', 'NOT NULL', 'None', '"http://fortix-studio.internal/studio/91c0..." or "https://api.example.org"'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:16:00"'],
            ]
          ),
          ...dictTable(
            '3.9',
            'api_keys',
            'Stores hashed gateway client credentials, visible lookup prefixes, route scopes, expiration timestamps, and revocation markers.',
            'FK project_id -> projects.id ON DELETE CASCADE; secret_hash stores bcrypt digest only—raw key is returned once at creation.',
            [
              ['id', 'TEXT (16-hex)', 'PRIMARY KEY, NOT NULL', 'None', '"410b67148f2d5e53"'],
              ['project_id', 'TEXT (UUID)', 'FK -> projects.id (CASCADE), NOT NULL', 'None', '"proj-dd7b1eb5-6d4d-4a4b-b313-8646128537b1"'],
              ['key_prefix', 'TEXT', 'NOT NULL', 'None', '"fx_live_410b67148f2d5e53"'],
              ['secret_hash', 'TEXT', 'NOT NULL', 'None', '"$2b$10$w8Q9zP3xV1..." (bcrypt hash of secret)'],
              ['name', 'TEXT', 'NOT NULL', 'None', '"Store API Gateway Key"'],
              ['purpose', 'TEXT', 'NULLABLE', 'NULL', '"FortiX API Studio Key"'],
              ['scopes', 'JSONB', 'NULLABLE', 'NULL', '["gateway:proxy"]'],
              ['expires_at', 'TIMESTAMP', 'NULLABLE', 'NULL', 'NULL or 15m TTL for ephemeral worker keys'],
              ['revoked_at', 'TIMESTAMP', 'NULLABLE', 'NULL', 'NULL (active) or revocation timestamp'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:16:02"'],
            ]
          ),
          ...dictTable(
            '3.10',
            'security_policies',
            'Defines per-route rate-limiting RPM ceilings and boolean toggles for WAF payload inspection and SSRF enforcement.',
            'FK route_id -> api_routes.id ON DELETE CASCADE.',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"pol-31b9e442-11c0-4a88-9e10-112233445566"'],
              ['route_id', 'TEXT (UUID)', 'FK -> api_routes.id (CASCADE), NOT NULL', 'None', '"rt-7a88c112-3f44-4d91-8122-9900aabbccdd"'],
              ['rate_limit_rpm', 'INTEGER', 'NULLABLE', 'NULL', '30 (tokens replenished per minute)'],
              ['enable_waf', 'BOOLEAN', 'NOT NULL', 'false', 'true (blocks SQLi, XSS, path traversal)'],
              ['enable_ssrf', 'BOOLEAN', 'NOT NULL', 'false', 'true (blocks RFC1918, loopback, metadata IPs)'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:16:02"'],
            ]
          ),
          ...dictTable(
            '3.11',
            'experiments',
            'Stores controlled chaos and resilience experiment definitions, lifecycle states, and bounded fault parameters.',
            'FK route_id -> api_routes.id ON DELETE CASCADE; 1:N parent of verifications and optional FK target of metric_logs.',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"exp-99c1d220-77a4-4e11-b009-445566778899"'],
              ['route_id', 'TEXT (UUID)', 'FK -> api_routes.id (CASCADE), NOT NULL', 'None', '"rt-7a88c112-3f44-4d91-8122-9900aabbccdd"'],
              ['type', 'TEXT', 'NOT NULL', 'None', "'latency' | 'error_5xx' | 'timeout' | 'rate_limit_burst'"],
              ['status', 'TEXT', 'NOT NULL', 'None', "'QUEUED' | 'OBSERVING' | 'RUNNING' | 'ANALYZING' | 'COMPLETED' | 'CANCELLED'"],
              ['config', 'JSONB', 'NOT NULL', 'None', '{"latencyMs": 200, "durationMs": 2000}'],
              ['scheduled_for', 'TIMESTAMP', 'NULLABLE', 'NULL', 'NULL (immediate) or scheduled UTC time'],
              ['started_at', 'TIMESTAMP', 'NULLABLE', 'NULL', '"2026-11-03 10:17:00"'],
              ['completed_at', 'TIMESTAMP', 'NULLABLE', 'NULL', '"2026-11-03 10:17:04"'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:16:59"'],
            ]
          ),
          ...dictTable(
            '3.12',
            'verifications',
            'Stores deterministic SLA evaluation contracts, three-phase observed telemetry summaries, PASS/FAIL/INCONCLUSIVE verdicts, and PDF artifact URIs.',
            'FK experiment_id -> experiments.id ON DELETE CASCADE.',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"ver-51d2e330-88b5-4f22-a110-556677889900"'],
              ['experiment_id', 'TEXT (UUID)', 'FK -> experiments.id (CASCADE), NOT NULL', 'None', '"exp-99c1d220-77a4-4e11-b009-445566778899"'],
              ['expected', 'JSONB', 'NOT NULL', 'None', '{"minBaselineSamples":5,"expectedInjectedLatencyMs":200}'],
              ['observed', 'JSONB', 'NOT NULL', 'None', '{"baseline":{"count":5,"p95Ms":8},"injection":{"count":12,"p95Ms":211},"recovery":{"count":5,"errorRate":0}}'],
              ['verdict', 'TEXT', 'NOT NULL', 'None', "'PASS' | 'FAIL' | 'INCONCLUSIVE'"],
              ['pdf_s3_url', 'TEXT', 'NULLABLE', 'NULL', '"projects/proj-dd7b.../ver-51d2....pdf"'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:17:05"'],
            ]
          ),
          ...dictTable(
            '3.13',
            'metric_logs',
            'Time-series request telemetry capturing per-request latency, HTTP status code, correlation request_id, and optional experiment association.',
            'FK route_id -> api_routes.id (CASCADE); FK experiment_id -> experiments.id (SET NULL); composite index route_time_idx(route_id, timestamp).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"met-10a2b3c4-d5e6-4f78-9012-3456789abcde"'],
              ['route_id', 'TEXT (UUID)', 'FK -> api_routes.id (CASCADE), NOT NULL', 'None', '"rt-7a88c112-3f44-4d91-8122-9900aabbccdd"'],
              ['experiment_id', 'TEXT (UUID)', 'FK -> experiments.id (SET NULL), NULLABLE', 'NULL', '"exp-99c1d220-77a4-4e11-b009-445566778899"'],
              ['request_id', 'TEXT', 'NULLABLE', 'NULL', '"inj_exp-99c1d220_4" (probe correlation tag)'],
              ['latency_ms', 'INTEGER', 'NOT NULL', 'None', '209'],
              ['status_code', 'INTEGER', 'NOT NULL', 'None', '200 (or 401, 403, 429, 503, 504)'],
              ['timestamp', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:17:02"'],
            ]
          ),
          ...dictTable(
            '3.14',
            'security_events',
            'Immutable log of blocked WAF attacks (SQLi, XSS, path traversal) and SSRF violations.',
            'FK route_id -> api_routes.id ON DELETE CASCADE; composite index threat_route_time_idx(route_id, timestamp).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"sec-77e8f901-23a4-4b56-8c7d-9e0f1a2b3c4d"'],
              ['route_id', 'TEXT (UUID)', 'FK -> api_routes.id (CASCADE), NOT NULL', 'None', '"rt-7a88c112-3f44-4d91-8122-9900aabbccdd"'],
              ['request_id', 'TEXT', 'NULLABLE', 'NULL', '"req-88112233-4455-4666-8777-889900aabbcc"'],
              ['threat_type', 'TEXT', 'NOT NULL', 'None', "'SQL_INJECTION' | 'XSS' | 'PATH_TRAVERSAL' | 'SSRF'"],
              ['payload', 'JSONB', 'NULLABLE', 'NULL', '{"method":"GET","matchedRule":"SQLI_UNION_OR"}'],
              ['timestamp', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:16:40"'],
            ]
          ),
          ...dictTable(
            '3.15',
            'webhooks',
            'Stores tenant-registered outbound HTTP webhook endpoints, HMAC signing secrets, and subscribed event types.',
            'FK project_id -> projects.id ON DELETE CASCADE; 1:N parent of webhook_deliveries.',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"wh-12345678-90ab-4cde-8f01-234567890abc"'],
              ['project_id', 'TEXT (UUID)', 'FK -> projects.id (CASCADE), NOT NULL', 'None', '"proj-dd7b1eb5-6d4d-4a4b-b313-8646128537b1"'],
              ['name', 'TEXT', 'NOT NULL', 'None', '"SecOps Incident Receiver"'],
              ['url', 'TEXT', 'NOT NULL', 'None', '"https://hooks.example.org/fortix-events"'],
              ['secret', 'TEXT', 'NULLABLE', 'NULL', '"[REDACTED_WEBHOOK_SIGNING_SECRET]"'],
              ['events', 'JSONB', 'NOT NULL', 'None', '["verification.completed","security.threat_blocked"]'],
              ['is_active', 'BOOLEAN', 'NOT NULL', 'true', 'true'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:18:00"'],
            ]
          ),
          ...dictTable(
            '3.16',
            'webhook_deliveries',
            'Records every outbound webhook delivery attempt, HTTP status, latency, failure reason, and X-FortiX-Signature digest.',
            'FK webhook_id -> webhooks.id (CASCADE), FK project_id -> projects.id (CASCADE); indexes on (webhook_id, created_at) and (project_id, created_at).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"whd-90ab12cd-34ef-4567-8901-abcdef123456"'],
              ['webhook_id', 'TEXT (UUID)', 'FK -> webhooks.id (CASCADE), NOT NULL', 'None', '"wh-12345678-90ab-4cde-8f01-234567890abc"'],
              ['project_id', 'TEXT (UUID)', 'FK -> projects.id (CASCADE), NOT NULL', 'None', '"proj-dd7b1eb5-6d4d-4a4b-b313-8646128537b1"'],
              ['event_type', 'TEXT', 'NOT NULL', 'None', '"verification.completed"'],
              ['payload', 'JSONB', 'NOT NULL', 'None', '{"verdict":"PASS","experimentId":"exp-99c1..."}'],
              ['attempt_number', 'INTEGER', 'NOT NULL', 'None', '1'],
              ['max_attempts', 'INTEGER', 'NOT NULL', '5', '5'],
              ['status_code', 'INTEGER', 'NULLABLE', 'NULL', '200'],
              ['response_body', 'TEXT', 'NULLABLE', 'NULL', '{"ok":true}'],
              ['error_message', 'TEXT', 'NULLABLE', 'NULL', 'NULL'],
              ['latency_ms', 'INTEGER', 'NULLABLE', 'NULL', '84'],
              ['success', 'BOOLEAN', 'NOT NULL', 'None', 'true'],
              ['signature', 'TEXT', 'NULLABLE', 'NULL', '"sha256=6f4e2a9c..."'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:18:02"'],
            ]
          ),
          ...dictTable(
            '3.17',
            'project_settings',
            '1:1 versioned configuration document per project governing default gateway timeouts, WAF sensitivity, rate-limit defaults, and telemetry retention.',
            'UNIQUE FK project_id -> projects.id (CASCADE); FK updated_by -> users.id (SET NULL); optimistic locking via version integer.',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"ps-22334455-6677-4888-9999-aabbccddeeff"'],
              ['project_id', 'TEXT (UUID)', 'UQ FK -> projects.id (CASCADE), NOT NULL', 'None', '"proj-dd7b1eb5-6d4d-4a4b-b313-8646128537b1"'],
              ['version', 'INTEGER', 'NOT NULL', '1', '2 (incremented atomically on update)'],
              ['gateway_config', 'JSONB', 'NOT NULL', 'None', '{"upstreamTimeoutMs":5000,"stripAuthHeaders":true}'],
              ['security_config', 'JSONB', 'NOT NULL', 'None', '{"defaultEnableWaf":true,"defaultEnableSsrf":true}'],
              ['rate_limit_config', 'JSONB', 'NOT NULL', 'None', '{"defaultRpm":60,"burstMultiplier":1}'],
              ['experiment_config', 'JSONB', 'NOT NULL', 'None', '{"maxDurationMs":60000,"requireCleanup":true}'],
              ['telemetry_config', 'JSONB', 'NOT NULL', 'None', '{"retentionDays":30,"realtimePush":true}'],
              ['updated_by', 'TEXT (UUID)', 'FK -> users.id (SET NULL), NULLABLE', 'NULL', '"550e8400-e29b-41d4-a716-446655440000"'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:15:00"'],
              ['updated_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:19:00"'],
            ]
          ),
          ...dictTable(
            '3.18',
            'audit_logs',
            'Append-only governance log recording before/after configuration diffs, version transitions, and operator attribution.',
            'FK project_id -> projects.id (CASCADE), FK user_id -> users.id (SET NULL); composite index audit_project_time_idx(project_id, timestamp).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"aud-66778899-aabb-4ccd-8eef-001122334455"'],
              ['project_id', 'TEXT (UUID)', 'FK -> projects.id (CASCADE), NOT NULL', 'None', '"proj-dd7b1eb5-6d4d-4a4b-b313-8646128537b1"'],
              ['user_id', 'TEXT (UUID)', 'FK -> users.id (SET NULL), NULLABLE', 'NULL', '"550e8400-e29b-41d4-a716-446655440000"'],
              ['action', 'TEXT', 'NOT NULL', 'None', "'SETTINGS_UPDATED' | 'SETTINGS_RESET'"],
              ['domain', 'TEXT', 'NOT NULL', 'None', "'security' | 'gateway' | 'rateLimit'"],
              ['previous_version', 'INTEGER', 'NOT NULL', 'None', '1'],
              ['new_version', 'INTEGER', 'NOT NULL', 'None', '2'],
              ['diff', 'JSONB', 'NOT NULL', 'None', '{"defaultRpm":{"from":60,"to":30}}'],
              ['metadata', 'JSONB', 'NULLABLE', 'NULL', '{"requestId":"req-991a..."}'],
              ['timestamp', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:19:00"'],
            ]
          ),
          ...dictTable(
            '3.19',
            'workflow_runs',
            'Tracks orchestrated multi-step verification workflow runs, execution timelines, deterministic verdicts, and cleanup status.',
            'FK project_id -> projects.id (CASCADE), FK route_id -> api_routes.id (CASCADE); index workflow_run_project_idx(project_id, created_at).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"wfr-44556677-8899-4aab-bccd-ddeeff001122"'],
              ['project_id', 'TEXT (UUID)', 'FK -> projects.id (CASCADE), NOT NULL', 'None', '"proj-dd7b1eb5-6d4d-4a4b-b313-8646128537b1"'],
              ['route_id', 'TEXT (UUID)', 'FK -> api_routes.id (CASCADE), NOT NULL', 'None', '"rt-7a88c112-3f44-4d91-8122-9900aabbccdd"'],
              ['profile', 'TEXT', 'NOT NULL', 'None', "'rate_limit_verification' | 'latency_resilience'"],
              ['status', 'TEXT', 'NOT NULL', 'None', "'COMPLETED' | 'FAILED' | 'CANCELLED'"],
              ['params', 'JSONB', 'NOT NULL', 'None', '{"targetRpm":30,"burstCount":45}'],
              ['timeline', 'JSONB', 'NOT NULL', 'None', '[{"step":"BASELINE","status":"DONE"}]'],
              ['deterministic_verdict', 'JSONB', 'NULLABLE', 'NULL', '{"verdict":"PASS","throttledCount":15}'],
              ['ai_analysis', 'JSONB', 'NULLABLE', 'NULL', '{"available":false} (optional post-run advisory; deterministic_verdict is authoritative)'],
              ['evidence_summary', 'JSONB', 'NULLABLE', 'NULL', '{"coverage":1.0,"sampleCount":45}'],
              ['cleanup_status', 'TEXT', 'NOT NULL', "'NOT_REQUIRED'", "'COMPLETED' | 'NOT_REQUIRED'"],
              ['error_message', 'TEXT', 'NULLABLE', 'NULL', 'NULL'],
              ['started_at', 'TIMESTAMP', 'NULLABLE', 'NULL', '"2026-11-03 10:20:00"'],
              ['completed_at', 'TIMESTAMP', 'NULLABLE', 'NULL', '"2026-11-03 10:20:06"'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:20:00"'],
              ['updated_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:20:06"'],
            ]
          ),
          ...dictTable(
            '3.20',
            'studio_apis',
            'Defines user-created APIs inside FortiX API Studio, binding base paths and versions to gateway api_routes.',
            'FK project_id -> projects.id (CASCADE), FK route_id -> api_routes.id (SET NULL); unique index (project_id, base_path, version).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"sapi-91c0d2e3-f4a5-4678-9012-abcdef987654"'],
              ['project_id', 'TEXT (UUID)', 'FK -> projects.id (CASCADE), NOT NULL', 'None', '"proj-dd7b1eb5-6d4d-4a4b-b313-8646128537b1"'],
              ['route_id', 'TEXT (UUID)', 'FK -> api_routes.id (SET NULL), NULLABLE', 'NULL', '"rt-7a88c112-3f44-4d91-8122-9900aabbccdd"'],
              ['name', 'TEXT', 'NOT NULL', 'None', '"Store Products API"'],
              ['description', 'TEXT', 'NOT NULL', "''", '"Self-contained e-commerce catalog API"'],
              ['base_path', 'TEXT', 'NOT NULL', 'None', '"/api/store"'],
              ['version', 'TEXT', 'NOT NULL', "'v1'", "'v1'"],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:16:00"'],
              ['updated_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:16:00"'],
            ]
          ),
          ...dictTable(
            '3.21',
            'studio_resources',
            'Defines typed REST collections (e.g., products, customers, orders) and field validation rules within a Studio API.',
            'FK api_id -> studio_apis.id (CASCADE), FK project_id -> projects.id (CASCADE); unique index (api_id, slug).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"sres-33445566-7788-4999-aaaa-bbbbccccdddd"'],
              ['api_id', 'TEXT (UUID)', 'FK -> studio_apis.id (CASCADE), NOT NULL', 'None', '"sapi-91c0d2e3-f4a5-4678-9012-abcdef987654"'],
              ['project_id', 'TEXT (UUID)', 'FK -> projects.id (CASCADE), NOT NULL', 'None', '"proj-dd7b1eb5-6d4d-4a4b-b313-8646128537b1"'],
              ['name', 'TEXT', 'NOT NULL', 'None', '"Products"'],
              ['slug', 'TEXT', 'NOT NULL', 'None', '"products" (mounted at /api/store/products)'],
              ['fields', 'JSONB', 'NOT NULL', 'None', '[{"name":"sku","type":"string","required":true},{"name":"price","type":"number"}]'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:16:00"'],
            ]
          ),
          ...dictTable(
            '3.22',
            'studio_records',
            'Stores individual JSONB entity rows (such as prod_0001..prod_0100) served by FortiX API Studio CRUD endpoints.',
            'FK resource_id -> studio_resources.id (CASCADE), FK api_id -> studio_apis.id (CASCADE), FK project_id -> projects.id (CASCADE); unique index (resource_id, record_id).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"srec-77889900-1122-4333-8444-5566778899aa"'],
              ['resource_id', 'TEXT (UUID)', 'FK -> studio_resources.id (CASCADE), NOT NULL', 'None', '"sres-33445566-7788-4999-aaaa-bbbbccccdddd"'],
              ['api_id', 'TEXT (UUID)', 'FK -> studio_apis.id (CASCADE), NOT NULL', 'None', '"sapi-91c0d2e3-f4a5-4678-9012-abcdef987654"'],
              ['project_id', 'TEXT (UUID)', 'FK -> projects.id (CASCADE), NOT NULL', 'None', '"proj-dd7b1eb5-6d4d-4a4b-b313-8646128537b1"'],
              ['record_id', 'TEXT', 'NOT NULL', 'None', '"prod_0001"'],
              ['data', 'JSONB', 'NOT NULL', 'None', '{"id":"prod_0001","sku":"ELEC-1001","name":"Wireless ANC Headphones","price":4999,"currency":"INR","stock":42}'],
              ['version', 'INTEGER', 'NOT NULL', '1', '1 (incremented on PATCH)'],
              ['created_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:16:01"'],
              ['updated_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:16:01"'],
            ]
          ),
          ...dictTable(
            '3.23',
            'learning_tutorials',
            'Stores structured tutorial metadata, lifecycle stage mappings (PROTECT through IMPROVE), allowlisted video references, objectives, steps, and documentation links for the In-App Video Learning Center (FTX-LEARN-001).',
            'UNIQUE(slug); composite B-tree indexes learning_tutorials_published_sort_idx(published, sort_order), learning_tutorials_category_sort_idx(category, sort_order), and learning_tutorials_lifecycle_idx(lifecycle_stage, sort_order).',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"tut-01-getting-started"'],
              ['slug', 'TEXT', 'UNIQUE, NOT NULL', 'None', '"getting-started-with-fortix"'],
              ['title', 'TEXT', 'NOT NULL', 'None', '"Getting Started: Protect & Verify Your First API"'],
              ['description', 'TEXT', 'NOT NULL', 'None', '"Guided walkthrough of the five-stage FortiX lifecycle."'],
              ['module_name', 'TEXT', 'NOT NULL', 'None', '"API Studio" | "Security Policies" | "Experiments"'],
              ['lifecycle_stage', 'TEXT', 'NOT NULL', 'None', "'PROTECT' | 'BREAK' | 'OBSERVE' | 'PROVE' | 'IMPROVE'"],
              ['category', 'TEXT', 'NOT NULL', 'None', '"Onboarding" | "Gateway Security" | "Resilience"'],
              ['difficulty', 'TEXT', 'NOT NULL', 'None', "'Beginner' | 'Intermediate' | 'Advanced'"],
              ['video_provider', 'TEXT', 'NOT NULL', "'none'", "'self_hosted' | 'https_allowlist' | 'youtube_nocookie' | 'none'"],
              ['video_reference', 'TEXT', 'NULLABLE', 'NULL', '"/tutorials/fortix-overview.mp4" or allowlisted URL'],
              ['video_source_note', 'TEXT', 'NULLABLE', 'NULL', '"Interactive step-by-step guided simulation"'],
              ['thumbnail_url', 'TEXT', 'NULLABLE', 'NULL', 'NULL or validated HTTPS asset path'],
              ['captions_url', 'TEXT', 'NULLABLE', 'NULL', '"/captions/getting-started.vtt"'],
              ['duration_seconds', 'INTEGER', 'NOT NULL', 'None', '240'],
              ['learning_objectives', 'JSONB', 'NOT NULL', 'None', '["Create Store API","Enforce 30 RPM policy"]'],
              ['prerequisites', 'JSONB', 'NOT NULL', 'None', '["Active FortiX project workspace"]'],
              ['steps', 'JSONB', 'NOT NULL', 'None', '[{"stepNumber":1,"title":"Open API Studio","actionRoute":"/studio"}]'],
              ['warnings', 'JSONB', 'NOT NULL', 'None', '["Chaos probes run post-authentication only."]'],
              ['related_slugs', 'JSONB', 'NOT NULL', 'None', '["token-bucket-rate-limiting"]'],
              ['doc_links', 'JSONB', 'NOT NULL', 'None', '[{"label":"Security Policies","href":"/security"}]'],
              ['featured', 'BOOLEAN', 'NOT NULL', 'false', 'true'],
              ['published', 'BOOLEAN', 'NOT NULL', 'true', 'true'],
              ['sort_order', 'INTEGER', 'NOT NULL', '100', '10'],
              ['created_at / updated_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:15:00"'],
            ]
          ),
          ...dictTable(
            '3.24',
            'learning_progress',
            'Tracks per-operator video playback resume timestamps, monotonic maximum watched duration, and completion state across sessions.',
            'FK user_id -> users.id (CASCADE), FK tutorial_id -> learning_tutorials.id (CASCADE); UNIQUE(user_id, tutorial_id); index learning_progress_user_watched_idx(user_id, last_watched_at); RLS isolated per user.',
            [
              ['id', 'TEXT (UUID)', 'PRIMARY KEY, NOT NULL', 'None', '"lprog-8812a3b4-c5d6-4e7f-8901-23456789abcd"'],
              ['user_id', 'TEXT (UUID)', 'FK -> users.id (CASCADE), NOT NULL', 'None', '"550e8400-e29b-41d4-a716-446655440000"'],
              ['tutorial_id', 'TEXT (UUID)', 'FK -> learning_tutorials.id (CASCADE), NOT NULL', 'None', '"tut-01-getting-started"'],
              ['last_position_seconds', 'INTEGER', 'NOT NULL', '0', '145 (resume playback cursor)'],
              ['max_watched_seconds', 'INTEGER', 'NOT NULL', '0', '180 (monotonic high-water mark)'],
              ['completed', 'BOOLEAN', 'NOT NULL', 'false', 'true'],
              ['completed_at', 'TIMESTAMP', 'NULLABLE', 'NULL', '"2026-11-03 10:24:12"'],
              ['last_watched_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:24:12"'],
              ['updated_at', 'TIMESTAMP', 'NOT NULL', 'now()', '"2026-11-03 10:24:12"'],
            ]
          ),
        ],
        subsections: [
          {
            number: '3.1.1',
            title: 'Normalization, JSONB Trade-Offs, Indexing, Transactions, and Row-Level Security (RLS)',
            blocks: [
              {
                kind: 'bullets',
                items: [
                  'First, Second, and Third Normal Form (1NF–3NF): Core relational entities—users, organizations, projects, api_routes, api_keys, security_policies, experiments, verifications, refresh_tokens, recovery_challenges, learning_tutorials, and learning_progress—satisfy 3NF. Every non-key attribute depends solely on the table UUID primary key without transitive dependencies between non-key attributes. Controlled denormalization of project_id onto studio_resources, studio_records, and webhook_deliveries is deliberately employed so PostgreSQL Row-Level Security (RLS) policies and B-tree indexes can filter tenant rows in O(log N) without three-table joins on every request.',
                  'Justified JSONB Columns: PostgreSQL JSONB is used strictly where schemas are inherently polymorphic or structured arrays: Studio dynamic resource payloads (studio_records.data), experiment fault configurations (experiments.config), verification phase histograms (verifications.observed), tutorial step checklists (learning_tutorials.steps), and audit diffs (audit_logs.diff). All JSONB writes are validated beforehand by Zod schemas or validateStudioRecordPayload().',
                  'Composite B-Tree Indexing Strategy: Hot read paths use targeted composite indexes—route_time_idx(route_id, timestamp) for time-windowed verification queries, threat_route_time_idx(route_id, timestamp) for WAF dashboards, refresh_tokens_family_idx(family_id) for instant token-family revocation, recovery_challenges_user_purpose_idx(user_id, purpose, created_at) for OTP cooldown checks, studio_records_resource_record_id_idx(resource_id, record_id) for O(log N) CRUD lookups, and learning_progress_user_tutorial_idx(user_id, tutorial_id) for idempotent progress upserts.',
                  'Referential Integrity & Atomic Transactions: Deleting a project cascades cleanly across routes, keys, policies, Studio APIs, experiments, and logs, whereas deleting an experiment sets metric_logs.experiment_id to NULL (ON DELETE SET NULL) so historical route traffic metrics remain intact. Single-use token consumption (consumeAuthActionToken and verifyPasswordRecoveryOtp) uses atomic conditional UPDATE ... WHERE consumed_at IS NULL RETURNING * statements to prevent race conditions under concurrent requests.',
                  'Engine-Level Tenant Isolation (PostgreSQL RLS): In drizzle/postgres_rls_policies.sql and withTenantContext() (src/db/index.ts), FortiX creates non-superuser role fortix_app (NOBYPASSRLS), binds set_config(\'app.current_user_id\', userId, true) inside transactions, and enforces ENABLE ROW LEVEL SECURITY across all 17 tenant-owned and user-owned tables as defense-in-depth behind application-level project ownership guards.',
                ],
              },
              {
                kind: 'code',
                title: 'Representative SQL Migration Excerpt — Auth Sessions & OTP Recovery',
                filePath: 'drizzle/0006_auth_sessions_and_recovery.sql',
                language: 'sql',
                code: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_e164" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_verified" boolean DEFAULT false NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_e164_unique" ON "users" ("phone_e164");

ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "family_id" text;
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "replaced_by_id" text;
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "remember_me" boolean DEFAULT false NOT NULL;
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "absolute_expires_at" timestamp;
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "reuse_detected_at" timestamp;
CREATE INDEX IF NOT EXISTS "refresh_tokens_family_idx" ON "refresh_tokens" ("family_id");

CREATE TABLE IF NOT EXISTS "recovery_challenges" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "channel" text NOT NULL,
  "purpose" text NOT NULL,
  "destination_masked" text NOT NULL,
  "otp_hmac" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "resend_count" integer DEFAULT 0 NOT NULL,
  "resend_available_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "invalidated_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);`,
              },
              {
                kind: 'table',
                tableNumber: '3.25',
                caption: 'Redis 7 Operational Keyspace, Data Structures, and TTL Lifecycle',
                colWidths: [28, 14, 18, 40],
                headers: ['Redis Key / Channel Pattern', 'Redis Type', 'TTL / Retention', 'Operational Role & Lifecycle'],
                rows: [
                  ['ratelimit:{routeId}:{identifier}', 'HASH', 'PEXPIRE ~120s idle', 'Stores tokens and last_refill mutated atomically by the Lua token-bucket script in src/rate-limit/redis.ts.'],
                  ['fortix:stream:metrics & fortix:stream:security', 'STREAM', 'MAXLEN ~100,000', 'Buffers high-frequency gateway metrics and security events via XADD; drained by consumer group fortix:telemetry_group into PostgreSQL.'],
                  ['fortix:revoked-jwt:{jtiOrHash}', 'STRING', 'Remaining JWT exp', 'Distributed revocation denylist checked on control-plane JWT authentication across API replicas.'],
                  ['fortix:revoked-sid:{familyId}', 'STRING', '30 days max', 'Invalidates active access JWTs immediately when a refresh session family is revoked or reuse is detected.'],
                  ['fortix:api-key:revoked:v1', 'PUB/SUB', 'Transient broadcast', 'Broadcasts key invalidation events (src/lib/key-invalidation.ts) so every gateway replica evicts HashedApiKeyCache entries immediately.'],
                  ['bull:experiments:* / bull:webhooks:*', 'LIST / ZSET / HASH', 'Removed on completion; DLQ retained', 'BullMQ job queues, active locks, retry schedules, and failed job metadata for background workers.'],
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];
