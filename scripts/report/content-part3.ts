import { ReportChapter } from './types';

export const CHAPTERS_PART3: ReportChapter[] = [
  {
    id: 'chapter-4',
    chapterLabel: 'CHAPTER 4',
    number: '4',
    title: 'IMPLEMENTATION',
    sections: [
      {
        number: '4.1',
        title: 'Screen Layouts with Validations',
        blocks: [
          {
            kind: 'p',
            text: 'All user interface screenshots in this chapter were captured programmatically via Playwright Chromium from the live running FortiX application on port 3000 (scripts/report/capture-assets.ts) after redacting raw API keys, session tokens, OTP digits, and personal email addresses. Table 4.1 summarizes all operator screens, input validations, error/success states, and backend API integrations.',
          },
          {
            kind: 'table',
            tableNumber: '4.1',
            caption: 'Screen Inventory, Client/Server Validation Rules, and Backend Endpoint Bindings',
            colWidths: [18, 16, 36, 30],
            headers: ['Screen / Route', 'React Component', 'Input Validations & Error/Success States', 'Backend API Endpoints'],
            rows: [
              ['Sign In & Register (/login)', 'src/components/Login.tsx', 'Validates non-empty email or E.164 phone, password >= 8 chars on register, Remember-Me toggle; shows generic 401 anti-enumeration banner on invalid credentials; zero password persistence in browser storage.', 'POST /api/auth/login, POST /api/auth/register'],
              ['Forgot Password (/forgot-password)', 'src/pages/PasswordRecovery.tsx', 'Accepts email or E.164 phone (max 254 chars); always displays neutral confirmation notice regardless of account existence to prevent user enumeration.', 'POST /api/auth/forgot-password'],
              ['Verify Reset OTP (/verify-reset)', 'src/pages/PasswordRecovery.tsx', 'Strips non-digits, enforces exact 6-digit numeric OTP (/^\\d{6}$/), displays remaining attempts (max 5) and 60s resend countdown timer.', 'POST /api/auth/verify-reset-otp, POST /api/auth/resend-reset-otp'],
              ['New Password (/reset-password)', 'src/pages/PasswordRecovery.tsx', 'Requires 8–128 chars and exact newPassword === confirmPassword match; revokes all sessions on success and redirects to /login.', 'POST /api/auth/reset-password'],
              ['Command Dashboard (/)', 'src/pages/Dashboard.tsx', 'Displays project-scoped request volume, P50/P95/P99 latency charts, error ratios, active routes, and live Socket.IO event feed.', 'GET /api/control/telemetry, Socket.IO subscribe:project'],
              ['FortiX API Studio (/studio)', 'src/pages/ApiStudio.tsx', 'Validates basePath (/^\\/[a-zA-Z0-9/_-]+$/), resource slug, typed field rules; supports 100-Product seed, live CRUD playground, and OpenAPI 3.0.3 JSON export.', 'GET/POST /api/control/studio/apis, ALL /proxy/:routeId/*'],
              ['Protected APIs (/apis)', 'src/pages/ProtectedApis.tsx', 'Validates route pathPattern and HTTPS/Studio targetUrl (rejects SSRF private/loopback/metadata IPs with 400/403); issues one-time fx_live_* keys.', 'GET/POST/DELETE /api/control/routes, /api/control/keys'],
              ['Security Policies (/security)', 'src/pages/SecurityPolicies.tsx', 'Validates positive integer rateLimitRpm and boolean enableWaf / enableSsrf toggles per route; persists immediately to gateway policy cache.', 'GET/POST/PUT /api/control/policies, /api/control/threats'],
              ['Chaos Experiments (/experiments)', 'src/pages/Experiments.tsx', 'Enforces Zod caps (latencyMs 1–10,000 ms, durationMs 500–60,000 ms); supports live status badges (QUEUED -> OBSERVING -> RUNNING -> COMPLETED) and Abort action.', 'GET/POST /api/control/experiments, POST /:id/cancel'],
              ['Verifications & PDF (/verifications)', 'src/pages/Verifications.tsx', 'Renders PASS / FAIL / INCONCLUSIVE badges, Baseline vs Injection vs Recovery metrics, and one-click SHA-256 PDF compliance report download.', 'GET /api/control/verifications, GET /api/control/reports/:id/pdf'],
              ['Account & Governance (/settings)', 'src/pages/Settings.tsx', 'Validates E.164 phone enrollment + 6-digit SMS OTP, lists active refresh session families with Revoke buttons, and enforces optimistic version locking on project settings.', 'GET/DELETE /api/control/account/sessions, /phone/*, /settings'],
            ],
          },
          {
            kind: 'figure',
            figureNumber: '4.1',
            caption: 'FortiX Sign-In Screen (/login) Showing Dual Email/Phone Identifier Input, Remember-Me Toggle, Forgot Password Link, and Account Creation Entry',
            imagePath: 'docs/reports/screenshots/scr01_login.png',
            sourceNote: 'Captured live from src/components/Login.tsx (Dev Sandbox helper removed; zero password storage).',
          },
          {
            kind: 'figure',
            figureNumber: '4.2',
            caption: 'Password Recovery Initiation Screen (/forgot-password) Accepting Registered Email or Verified E.164 Phone Number',
            imagePath: 'docs/reports/screenshots/scr02_forgot_password.png',
            sourceNote: 'Captured live from src/pages/PasswordRecovery.tsx with redacted demo email.',
          },
          {
            kind: 'figure',
            figureNumber: '4.3',
            caption: 'Identity Verification OTP Screen (/verify-reset) Displaying Masked Destination, 6-Digit Numeric Input, and 60-Second Resend Cooldown',
            imagePath: 'docs/reports/screenshots/scr03_verify_otp.png',
            sourceNote: 'Captured live from src/pages/PasswordRecovery.tsx with OTP digits redacted (••••••).',
          },
          {
            kind: 'figure',
            figureNumber: '4.4',
            caption: 'FortiX Command Overview Dashboard (/) Showing Real Gateway Traffic Telemetry, Latency Distribution, and Active Route Status',
            imagePath: 'docs/reports/screenshots/scr04_dashboard.png',
            sourceNote: 'Captured live after executing Store Products API gateway requests and SQLi WAF block.',
          },
          {
            kind: 'figure',
            figureNumber: '4.5',
            caption: 'FortiX API Studio Workspace (/studio) Showing Provisioned Store Products API (100 Records), Resource Schema, Playground, and OpenAPI Export',
            imagePath: 'docs/reports/screenshots/scr05_api_studio.png',
            sourceNote: 'Captured live from src/pages/ApiStudio.tsx.',
          },
          {
            kind: 'figure',
            figureNumber: '4.6',
            caption: 'Protected APIs & Gateway Route Registry (/apis) Showing Route Bindings and Scoped API-Key Management',
            imagePath: 'docs/reports/screenshots/scr06_protected_apis.png',
            sourceNote: 'Captured live from src/pages/ProtectedApis.tsx with raw API keys redacted.',
          },
          {
            kind: 'figure',
            figureNumber: '4.7',
            caption: 'Security Policies Screen (/security) Configuring Per-Route Token-Bucket RPM Limits, WAF Inspection, and SSRF Guards',
            imagePath: 'docs/reports/screenshots/scr07_security_policies.png',
            sourceNote: 'Captured live from src/pages/SecurityPolicies.tsx.',
          },
          {
            kind: 'figure',
            figureNumber: '4.8',
            caption: 'Chaos & Resilience Experiments Screen (/experiments) Showing Bounded Fault Injection Configuration and Execution History',
            imagePath: 'docs/reports/screenshots/scr08_experiments.png',
            sourceNote: 'Captured live from src/pages/Experiments.tsx after completing a bounded 200ms latency experiment.',
          },
          {
            kind: 'figure',
            figureNumber: '4.9',
            caption: 'Verification Results & Evidence Reports Screen (/verifications) Displaying Deterministic SLA Verdicts and PDF Export',
            imagePath: 'docs/reports/screenshots/scr09_verifications.png',
            sourceNote: 'Captured live from src/pages/Verifications.tsx.',
          },
          {
            kind: 'figure',
            figureNumber: '4.10',
            caption: 'Account Security Settings (/settings?tab=account) Showing Verified Phone Enrollment and Active Refresh Session Revocation',
            imagePath: 'docs/reports/screenshots/scr10_settings_account.png',
            sourceNote: 'Captured live from src/pages/Settings.tsx.',
          },
        ],
      },
      {
        number: '4.2',
        title: 'Sample Coding (with Security Tasks)',
        blocks: [
          {
            kind: 'p',
            text: 'This section presents eight core implementation excerpts taken directly from the FortiX TypeScript codebase. Each excerpt is accompanied by its file path, engineering purpose, logical block walkthrough, inputs/outputs, error handling, security considerations, module interactions, and automated test coverage.',
          },
          {
            kind: 'code',
            title: 'Sample 1 — Rotating Remember-Me Refresh Sessions & Reuse Detection',
            filePath: 'src/auth/sessions.ts',
            language: 'typescript',
            code: `export async function rotateRefreshSession(
  rawRefreshToken: string,
  meta?: SessionClientMetadata
): Promise<RotateRefreshResult> {
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const [existing] = await db.select().from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);
  if (!existing) return { ok: false, reason: 'INVALID_TOKEN' };

  const familyId = existing.familyId || existing.id;
  // Reuse detection: if an already-rotated token is presented again, revoke entire family!
  if (existing.replacedById || existing.revokedAt) {
    const now = new Date();
    await db.update(refreshTokens)
      .set({ revokedAt: now, reuseDetectedAt: now })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
    await revokeSessionFamilySid(familyId);
    return { ok: false, reason: 'REFRESH_TOKEN_REUSED', userId: existing.userId, familyId };
  }
  if (existing.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'EXPIRED_TOKEN' };

  const nextId = uuidv4();
  const nextRaw = crypto.randomBytes(32).toString('hex');
  await db.insert(refreshTokens).values({
    id: nextId, userId: existing.userId, tokenHash: hashRefreshToken(nextRaw),
    familyId, rememberMe: existing.rememberMe, expiresAt: computeNextExpiry(existing),
  });
  await db.update(refreshTokens).set({ replacedById: nextId, revokedAt: new Date() })
    .where(eq(refreshTokens.id, existing.id));
  return { ok: true, userId: existing.userId, familyId, rawRefreshToken: nextRaw };
}`,
          },
          {
            kind: 'p',
            text: 'Walkthrough & Security Analysis (src/auth/sessions.ts): (1) Purpose: Rotates opaque refresh tokens across browser restarts while detecting stolen token replay. (2) Logical Blocks: Hashes incoming cookie value with SHA-256; checks whether replacedById or revokedAt is already set; if replayed, revokes every row in familyId and calls revokeSessionFamilySid() in src/lib/jwt-security.ts; otherwise inserts a successor token and links replacedById. (3) I/O: Accepts 64-hex raw token; returns rotated token or typed failure reason. (4) Error/Security: Raw refresh tokens never touch PostgreSQL; replay compromises zero future sessions. (5) Tests: Verified in tests/unit/ftx-auth-001.test.ts (REFRESH_TOKEN_REUSED assertion).',
          },
          {
            kind: 'code',
            title: 'Sample 2 — Keyed HMAC-SHA256 OTP Verification & Atomic Single-Use Consumption',
            filePath: 'src/auth/recovery.ts',
            language: 'typescript',
            code: `export function computeOtpHmac(challengeId: string, userId: string, purpose: string, otp: string): string {
  const key = process.env.OTP_HMAC_SECRET || getJwtSecret();
  return crypto.createHmac('sha256', key)
    .update(\`\${challengeId}:\${userId}:\${purpose}:\${otp.trim()}\`).digest('hex');
}

// Inside verifyPasswordRecoveryOtp(challengeId, submittedOtp):
const expectedBuf = Buffer.from(challenge.otpHmac, 'hex');
const actualBuf = Buffer.from(computeOtpHmac(challenge.id, challenge.userId, challenge.purpose, otp), 'hex');
const matches = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);

if (!matches) {
  const nextFailed = challenge.failedAttempts + 1;
  await db.update(recoveryChallenges).set({
    failedAttempts: nextFailed,
    invalidatedAt: nextFailed >= challenge.maxAttempts ? now : null,
  }).where(eq(recoveryChallenges.id, challenge.id));
  return { ok: false, error: 'Invalid verification code.', remainingAttempts: Math.max(0, challenge.maxAttempts - nextFailed) };
}
const [consumed] = await db.update(recoveryChallenges).set({ consumedAt: now })
  .where(and(eq(recoveryChallenges.id, challenge.id), isNull(recoveryChallenges.consumedAt))).returning();`,
          },
          {
            kind: 'p',
            text: 'Walkthrough & Security Analysis (src/auth/recovery.ts): (1) Purpose: Verifies 6-digit account recovery OTPs without storing plaintext codes or permitting brute-force/race attacks. (2) Logical Blocks: Binds challengeId, userId, and purpose into a keyed HMAC-SHA256 digest; compares digests in constant time via crypto.timingSafeEqual; increments failedAttempts and locks after 5 misses; executes atomic conditional UPDATE ... WHERE consumed_at IS NULL RETURNING * so 10 concurrent identical POST requests yield exactly one resetAuthorization token. (3) Tests: Verified by 10-way Promise.all concurrency test in tests/unit/ftx-auth-001.test.ts.',
          },
          {
            kind: 'code',
            title: 'Sample 3 — Atomic Redis Lua Token-Bucket Rate Limiter',
            filePath: 'src/rate-limit/redis.ts',
            language: 'typescript',
            code: `const TOKEN_BUCKET_LUA = \`
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local ttl_ms = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1])
local last_refill = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  last_refill = now_ms
else
  local elapsed = math.max(0, now_ms - last_refill) / 1000.0
  tokens = math.min(capacity, tokens + (elapsed * refill_rate))
  last_refill = now_ms
end
if tokens >= requested then
  tokens = tokens - requested
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('PEXPIRE', key, ttl_ms)
  return {1, math.floor(tokens)}
else
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('PEXPIRE', key, ttl_ms)
  return {0, 0}
end\`;`,
          },
          {
            kind: 'p',
            text: 'Walkthrough & Security Analysis (src/rate-limit/redis.ts): (1) Purpose: Enforces exact per-route RPM limits across concurrent gateway workers without read-modify-write race conditions. (2) Logical Blocks: Redis executes the entire HMGET -> fractional token replenishment -> conditional decrement -> HMSET -> PEXPIRE sequence atomically on its single command thread. (3) Fail-Closed Behavior: In production mode, if Redis is unreachable, checkRateLimit() throws/denies with HTTP 503 rather than silently allowing unlimited traffic. (4) Tests: Verified in tests/unit/rate-limit.test.ts and tests/e2e/api-studio.spec.ts.',
          },
          {
            kind: 'code',
            title: 'Sample 4 — Gateway Pre-Auth Enforcement Ordering & Header Sanitization',
            filePath: 'src/gateway/index.ts',
            language: 'typescript',
            code: `// 1. Validate SSRF safety & API Key STRICTLY BEFORE any chaos fault injection
if (policy?.enableSsrf && !isStudioInternalTarget(route.targetUrl)) {
  const safe = await isSafeTarget(route.targetUrl);
  if (!safe) return res.status(403).json({ error: 'SSRF protection blocked target URL' });
}
const keyAuth = await validateGatewayApiKey(req, route.projectId);
if (!keyAuth.valid) {
  enqueueMetric({ routeId: route.id, latencyMs: Date.now() - start, statusCode: 401, requestId });
  return res.status(401).json({ error: keyAuth.reason || 'Invalid or missing API key' });
}
// 2. WAF Inspection (URI-decoded SQLi / XSS / Path Traversal)
if (policy?.enableWaf) {
  const threat = inspectRequestForThreats(req);
  if (threat.blocked) {
    await recordSecurityEvent(route.id, requestId, threat.type, threat.evidence);
    return res.status(403).json({ error: 'Blocked by FortiX WAF', threatType: threat.type });
  }
}
// 3. Atomic Rate Limit -> 4. Post-Auth Fault Injection -> 5. Strip FortiX Credentials
delete proxyReq.headers['x-api-key'];
if (/^Bearer\\s+fx_(live|test)_/i.test(String(proxyReq.headers['authorization'] || ''))) {
  delete proxyReq.headers['authorization'];
}`,
          },
          {
            kind: 'p',
            text: 'Walkthrough & Security Analysis (src/gateway/index.ts): (1) Purpose: Ensures unauthenticated or malicious requests are rejected immediately (401/403/429) without consuming upstream sockets or triggering chaos delays, and prevents credential leakage to external servers. (2) Interactions: Coordinates src/lib/ssrf.ts, src/gateway/key-cache.ts, src/security/waf.ts, src/rate-limit/redis.ts, and src/studio/target-handler.ts. (3) Tests: Verified in tests/security/auth.spec.ts and tests/security/all.spec.ts.',
          },
          {
            kind: 'code',
            title: 'Sample 5 — Telemetry Flush Barrier & Non-Vacuous Three-Phase Verification',
            filePath: 'src/verification/engine.ts',
            language: 'typescript',
            code: `export async function verifyPolicy(experimentId: string, policyId?: string, windows?: PhaseWindows) {
  // Defect #1 Fix: Synchronize buffered Redis Stream / memory telemetry BEFORE querying metric_logs
  const syncResult = await flushTelemetryBarrier(3000);

  const rows = await db.select().from(metricLogs)
    .where(eq(metricLogs.experimentId, experimentId));

  const baselineRows = filterRowsForPhase(rows, 'base_', windows?.baseline);
  const injectionRows = filterRowsForPhase(rows, 'inj_', windows?.injection);
  const recoveryRows = filterRowsForPhase(rows, 'rec_', windows?.recovery);

  // Defect #2 & #3 Fix: Reject vacuous 0-sample runs instead of emitting tautological PASS
  if (injectionRows.length === 0 || coverageRatio < 0.8) {
    return persistVerification(experimentId, expectedContract, observedSummary, 'INCONCLUSIVE');
  }
  const evaluation = evaluateExperimentVerification(experiment, policy, {
    baseline: summarizeMetrics(baselineRows),
    injection: summarizeMetrics(injectionRows),
    recovery: summarizeMetrics(recoveryRows),
  });
  return persistVerification(experimentId, evaluation.expected, evaluation.observed, evaluation.verdict);
}`,
          },
          {
            kind: 'p',
            text: 'Walkthrough & Security Analysis (src/verification/engine.ts): (1) Purpose: Eliminates all four critical verification defects—telemetry flush races, vacuous zero-request rate-limit passes, hardcoded verdicts, and missing baseline/recovery windows. (2) Logical Blocks: Awaits flushTelemetryBarrier(); splits persisted metric_logs into BASELINE, INJECTION, and RECOVERY cohorts; enforces >=80% sample sufficiency (returning INCONCLUSIVE if starved); and evaluates deterministic SLA deltas. (3) Tests: Verified in tests/unit/verification-defects.test.ts and tests/e2e/golden-demo.spec.ts.',
          },
          {
            kind: 'code',
            title: 'Sample 6 — FortiX API Studio Tenant-Isolated CRUD & Schema Validator',
            filePath: 'src/studio/target-handler.ts',
            language: 'typescript',
            code: `export async function handleStudioUpstreamRequest(params: StudioDispatchInput): Promise<StudioHttpResponse> {
  const [api] = await db.select().from(studioApis)
    .where(and(eq(studioApis.id, params.studioApiId), eq(studioApis.projectId, params.projectId))).limit(1);
  if (!api) return { status: 404, body: { error: 'Studio API not found for project' } };

  const [resource] = await db.select().from(studioResources)
    .where(and(eq(studioResources.apiId, api.id), eq(studioResources.slug, parsed.resourceSlug))).limit(1);
  if (!resource) return { status: 404, body: { error: \`Unknown resource '\${parsed.resourceSlug}'\` } };

  if (params.method === 'POST') {
    const validation = validateStudioRecordPayload(resource.fields, params.body, { partial: false });
    if (!validation.valid) return { status: 400, body: { error: 'Validation failed', details: validation.errors } };
    // Persist validated JSONB record scoped to projectId, apiId, and resourceId...
  }
  // Supports GET collection (q, category, status, minPrice, maxPrice, limit, offset), GET/:id, PATCH/:id, DELETE/:id
}`,
          },
          {
            kind: 'p',
            text: 'Walkthrough & Security Analysis (src/studio/target-handler.ts): (1) Purpose: Executes dynamic REST CRUD endpoints inside FortiX for API Studio resources while enforcing strict project-level tenant isolation and field-type schema validation. (2) Tests: Verified in tests/unit/api-studio.test.ts and tests/e2e/api-studio.spec.ts.',
          },
        ],
        subsections: [
          {
            number: '4.2.1',
            title: 'Comprehensive 16-Domain Security Implementation Audit',
            blocks: [
              {
                kind: 'bullets',
                items: [
                  '1. Authentication: Dual-identifier login (email or verified E.164 phone) with dummy bcrypt comparison on unknown users to mitigate timing enumeration.',
                  '2. Authorization & RBAC: Role hierarchy (ADMIN, OPERATOR, DEVELOPER, VIEWER) enforced server-side via requireRole() and verifyProjectAccess() BOLA guards.',
                  '3. Password Handling: Hashed exclusively with bcryptjs (cost factor 10); never stored in localStorage, sessionStorage, cookies, or logs.',
                  '4. API-Key Protection: Raw fx_live_<id>_<secret> shown once; DB stores bcrypt secret_hash; gateway caches SHA-256 digest with secretHash stripped and Redis Pub/Sub eviction.',
                  '5. Session Management: Short-lived access JWT in HttpOnly cookie + rotating refresh token families (12h standard / 30d Remember Me) with reuse detection and global revocation on password reset.',
                  '6. Input Validation: Strict Zod schemas on every REST route plus Studio dynamic field validation.',
                  '7. Rate Limiting: Express auth rate limiter on /api/auth/* and atomic Redis Lua token bucket on /proxy/:routeId/*.',
                  '8. SQL Injection Prevention: 100% parameterized queries via Drizzle ORM plus gateway WAF SQLi signature blocking.',
                  '9. SSRF Protection: Blocks private RFC 1918, loopback, link-local/cloud metadata (169.254.169.254), and DNS-rebinding resolutions via safeDnsLookup.',
                  '10. CORS & CSRF: Strict origin allowlist with credentials support and double-submit CSRF validation (fortix_csrf cookie matched against X-CSRF-Token header) on cookie-authenticated mutations.',
                  '11. Multi-Tenant Isolation: Dual-layer enforcement combining application-level project ownership checks and PostgreSQL Row-Level Security (RLS) policies.',
                  '12. Secret Management: Fail-fast startup checks in production requiring cryptographic JWT_SECRET, OTP_HMAC_SECRET, DATABASE_URL, and REDIS_URL.',
                  '13. Logging & Redaction: Pino logger configured with explicit redact paths stripping authorization headers, cookies, password fields, OTPs, and raw keys.',
                  '14. Experiment Authorization & Blast Radius: Experiments execute only against routes owned by the caller project, post-authentication, with hard duration caps (<=60s) and guaranteed cleanup.',
                  '15. Resource Limits: JSON body size caps (1 MB), bounded in-memory caches (max 5,000 API keys), and upstream proxy socket timeouts.',
                  '16. Error Handling & Known Security Boundaries: Central error middleware suppresses stack traces in production. Honest Limitation Disclosure: FortiX does not yet implement hardware WebAuthn/FIDO2 MFA, kernel-level L3/L4 DDoS mitigation, or external KMS envelope encryption; SMS/Email OTP delivery in production depends on configuring external HTTPS provider webhooks.',
                ],
              },
            ],
          },
        ],
      },
      {
        number: '4.3',
        title: 'Steps of the Execution Project and Navigation',
        blocks: [
          {
            kind: 'p',
            text: 'FortiX supports two execution topologies verified in package.json and docker-compose.yml: (A) Zero-external-dependency local sandbox development (using automatic pg-mem PostgreSQL migration bootstrap and local queue fallback) and (B) Full multi-container production orchestration with PostgreSQL 15, Redis 7, API server, and dedicated BullMQ worker.',
          },
          {
            kind: 'code',
            title: 'Verified Repository Setup, Build, Execution, and Test Commands',
            filePath: 'package.json / docker-compose.yml',
            language: 'bash',
            code: `# 1. Install dependencies & configure environment variables (copy template, never commit .env)
npm install
cp .env.example .env

# 2. Local Development Mode (Express + Gateway + Vite Middleware on http://localhost:3000)
npm run dev

# 3. Type-Check, Production Bundle, and Multi-Container Docker Compose Execution
npm run lint          # Executes tsc --noEmit
npm run build         # Builds Vite SPA + bundles dist/server.cjs & dist/worker.cjs
docker compose up --build -d
curl -s http://localhost:8080/api/health/ready

# 4. Automated Verification Suites
npm test              # Runs 34 Vitest unit & integration suites (261 tests)
npm run test:e2e      # Runs 12 Playwright browser & security E2E tests`,
          },
          {
            kind: 'table',
            tableNumber: '4.2',
            caption: 'Environment Configuration Variables Reference (.env.example — Variable Names Only)',
            colWidths: [28, 16, 56],
            headers: ['Variable Name', 'Requirement', 'Operational Purpose (No Secret Values Shown)'],
            rows: [
              ['PORT / NODE_ENV', 'Required', 'HTTP listener port (3000 in dev) and runtime mode (development | test | production).'],
              ['DATABASE_URL', 'Prod Required', 'PostgreSQL 15 connection URI; uses migrated pg-mem sandbox in local dev if omitted.'],
              ['ENABLE_POSTGRES_RLS', 'Optional (true)', 'Activates PostgreSQL Row-Level Security tenant context binding per transaction.'],
              ['REDIS_URL', 'Prod Required', 'Redis 7 connection URI for Lua rate limiter, Streams, Pub/Sub, and BullMQ.'],
              ['JWT_SECRET', 'Prod Required', '64-byte cryptographic secret signing short-lived operator session JWTs.'],
              ['OTP_HMAC_SECRET', 'Prod Recommended', 'Dedicated secret key for HMAC-SHA256 hashing of 6-digit recovery and phone OTPs.'],
              ['REMEMBER_ME_DAYS / SHORT_SESSION_HOURS', 'Optional (30 / 12)', 'Configures persistent Remember-Me refresh family lifetime vs standard session lifetime.'],
              ['AUTH_EMAIL_WEBHOOK_URL / AUTH_SMS_WEBHOOK_URL', 'Prod Optional', 'HTTPS provider endpoints for transactional Email and E.164 SMS OTP dispatch.'],
              ['CORS_ALLOWED_ORIGINS', 'Prod Required', 'Comma-separated allowlist of origins permitted to send credentialed requests.'],
            ],
          },
        ],
        subsections: [
          {
            number: '4.3.1',
            title: 'End-to-End Evaluation Walkthrough: PROTECT → BREAK → OBSERVE → PROVE → IMPROVE',
            blocks: [
              {
                kind: 'numbered',
                items: [
                  'Authenticate (/login): Register an operator account or sign in with Remember Me enabled; observe HttpOnly session cookie establishment without any credentials stored in localStorage.',
                  'Provision Self-Contained API (/studio): Open FortiX API Studio, select the "Store Products API (100 INR Records)" template, set rateLimitRpm = 30, enableWaf = true, enableSsrf = true, and copy the one-time scoped fx_live_* API key.',
                  'PROTECT — Verify Live Enforcement: In the API Studio Playground, send GET /proxy/:routeId/api/store/products with X-API-Key -> inspect HTTP 200 JSON (100 seeded products). Omit X-API-Key -> observe HTTP 401. Append ?q=\' OR 1=1-- -> observe HTTP 403 WAF block recorded in Threats.',
                  'BREAK — Execute Controlled Experiment (/experiments): Launch a bounded Latency Injection (latencyMs = 200, durationMs = 2000) or Rate-Limit Burst experiment on the Store Products route.',
                  'OBSERVE — Inspect Three-Phase Telemetry (/): Watch real-time Socket.IO updates as the worker records 5 clean BASELINE probes, active INJECTION probes, and 5 post-fault RECOVERY probes.',
                  'PROVE — Audit Verdict & Export SHA-256 PDF (/verifications): Inspect the deterministic PASS/FAIL/INCONCLUSIVE verdict comparing expected policy thresholds against observed P50/P95 latency and 429 ratios, then download the SHA-256 stamped PDF compliance report.',
                  'IMPROVE — Harden Policy (/security): Adjust RPM quotas or upstream timeout thresholds based on observed P95/429 evidence and re-run verification to confirm remediation.',
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'chapter-5',
    chapterLabel: 'CHAPTER 5',
    number: '5',
    title: 'CONCLUSION',
    sections: [
      {
        number: '5.1',
        title: 'Importance of the Worked-Out Tasks',
        blocks: [
          {
            kind: 'p',
            text: 'FortiX demonstrates that API security and service resilience become trustworthy only when gateway enforcement, controlled fault injection, synchronized telemetry, and deterministic SLA verification operate as a single closed-loop system. Rather than building fifteen disconnected dashboard widgets, engineering effort was concentrated on hardening the critical path from authentication and request proxying to non-vacuous evidence generation.',
          },
          {
            kind: 'table',
            tableNumber: '5.1',
            caption: 'Summary of Completed Engineering Objectives and Verification Outcomes',
            colWidths: [28, 22, 50],
            headers: ['Project Objective', 'Final Status', 'Empirical Evidence in Repository'],
            rows: [
              ['Hardened Auth, Remember-Me & OTP Recovery (FTX-AUTH-001)', 'Completed & Verified', 'HttpOnly session + rotating refresh families, reuse detection, 6-digit HMAC OTP recovery, verified phone SMS gate; 7 unit + browser E2E tests passing.'],
              ['Multi-Layered Reverse-Proxy Protection', 'Completed & Verified', 'Pre-auth ordering, SHA-256 key cache + Pub/Sub revocation, URI-decoded WAF, SSRF/DNS-rebind guard, and Redis Lua token bucket.'],
              ['Zero-Friction API Studio (100-Product Seed)', 'Completed & Verified', 'Instant Store Products CRUD API, schema validation, gateway binding, and OpenAPI 3.0.3 export verified in api-studio.spec.ts.'],
              ['Defect-Free Deterministic Verification Engine', 'Completed & Verified', 'Eliminated telemetry flush races, vacuous 0-sample passes, tautological verdicts, and missing baseline/recovery windows.'],
              ['Tamper-Evident Compliance Reporting', 'Completed & Verified', 'Server-side PDFKit generation with SHA-256 artifact integrity verification and HMAC-signed webhooks.'],
            ],
          },
        ],
      },
      {
        number: '5.2',
        title: 'Further Enhancement in Future',
        blocks: [
          {
            kind: 'p',
            text: 'The following capabilities are explicitly classified as planned future enhancements beyond the current B.Tech submission and are not claimed as implemented features:',
          },
          {
            kind: 'bullets',
            items: [
              'Hardware-Backed Multi-Factor Authentication (WebAuthn / Passkeys): Extending FTX-AUTH-001 with FIDO2 passkey challenges for privileged ADMIN and OPERATOR accounts.',
              'Distributed W3C OpenTelemetry Tracing: Propagating traceparent headers across gateway hops to visualize downstream microservice flamegraphs.',
              'Mutual TLS (mTLS) Upstream Client Certificates: Authenticating gateway-to-upstream hops using per-project X.509 client certificates managed via an external KMS.',
              'Additional Chaos Primitives: Controlled response-body schema corruption, bandwidth throttling, and selective DNS failure simulation.',
              'Kubernetes Operator & Horizontal Pod Autoscaling (HPA): Packaging stateless api and worker deployments as Custom Resource Definitions (CRDs) for automated CI/CD regression gating.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'chapter-6',
    chapterLabel: 'CHAPTER 6',
    number: '6',
    title: 'REFERENCES',
    sections: [
      {
        number: '6.1',
        title: 'Books, Research Papers, Experts, Technology, Web Resources (IEEE Format)',
        blocks: [
          {
            kind: 'numbered',
            items: [
              'M. Kleppmann, Designing Data-Intensive Applications: The Big Ideas Behind Reliable, Scalable, and Maintainable Systems, 1st ed. Sebastopol, CA, USA: O\'Reilly Media, 2017.',
              'M. T. Nygard, Release It!: Design and Deploy Production-Ready Software, 2nd ed. Raleigh, NC, USA: Pragmatic Bookshelf, 2018.',
              'I. Sommerville, Software Engineering, 10th ed. Boston, MA, USA: Pearson, 2015.',
              'A. Silberschatz, H. F. Korth, and S. Sudarshan, Database System Concepts, 7th ed. New York, NY, USA: McGraw-Hill, 2019.',
              'E. Gamma, R. Helm, R. Johnson, and J. Vlissides, Design Patterns: Elements of Reusable Object-Oriented Software. Reading, MA, USA: Addison-Wesley, 1994.',
              'A. Basiri et al., "Chaos Engineering," IEEE Software, vol. 33, no. 3, pp. 35–41, May–Jun. 2016, doi: 10.1109/MS.2016.60.',
              'R. Natella, D. Cotroneo, and H. S. Madeira, "Assessing Dependability with Software Fault Injection: A Survey," ACM Computing Surveys, vol. 48, no. 3, Art. no. 44, Feb. 2016, doi: 10.1145/2841425.',
              'V. Heorhiadi, S. Rajagopalan, H. Jamjoom, M. K. Reiter, and V. Sekar, "Gremlin: Systematic Resilience Testing of Microservices," in Proc. IEEE 36th Int. Conf. Distributed Computing Systems (ICDCS), Nara, Japan, 2016, pp. 57–66, doi: 10.1109/ICDCS.2016.11.',
              'OWASP Foundation, "OWASP API Security Top 10 — 2023," OWASP.org, 2023. [Online]. Available: https://owasp.org/API-Security/editions/2023/en/0x11-t10/. [Accessed: Nov. 03, 2026].',
              'OWASP Foundation, "OWASP Application Security Verification Standard (ASVS) v4.0.3," OWASP.org, 2021. [Online]. Available: https://owasp.org/www-project-application-security-verification-standard/. [Accessed: Nov. 03, 2026].',
              'OWASP Foundation, "Authentication, Session Management, Forgot Password, and SSRF Prevention Cheat Sheets," OWASP Cheat Sheet Series. [Online]. Available: https://cheatsheetseries.owasp.org/. [Accessed: Nov. 03, 2026].',
              'R. Fielding, M. Nottingham, and J. Reschke, "HTTP Semantics," Internet Engineering Task Force (IETF), RFC 9110, Jun. 2022. [Online]. Available: https://www.rfc-editor.org/rfc/rfc9110.',
              'M. Jones, J. Bradley, and N. Sakimura, "JSON Web Token (JWT)," Internet Engineering Task Force (IETF), RFC 7519, May 2015. [Online]. Available: https://www.rfc-editor.org/rfc/rfc7519.',
              'OpenJS Foundation, "Node.js v22 LTS Documentation (crypto, http, stream)," Nodejs.org. [Online]. Available: https://nodejs.org/docs/latest-v22.x/api/. [Accessed: Nov. 03, 2026].',
              'Microsoft Corp., "TypeScript 5.8 Handbook and Compiler Specification," TypeScriptlang.org. [Online]. Available: https://www.typescriptlang.org/docs/. [Accessed: Nov. 03, 2026].',
              'OpenJS Foundation, "Express 4.x API Reference," Expressjs.com. [Online]. Available: https://expressjs.com/en/4x/api.html. [Accessed: Nov. 03, 2026].',
              'Meta Platforms, Inc., "React 19 Official Documentation," React.dev. [Online]. Available: https://react.dev/. [Accessed: Nov. 03, 2026].',
              'PostgreSQL Global Development Group, "PostgreSQL 15 Documentation — Chapter 5.8 Row Security Policies & JSONB Types," Postgresql.org. [Online]. Available: https://www.postgresql.org/docs/15/ddl-rowsecurity.html. [Accessed: Nov. 03, 2026].',
              'Drizzle Team, "Drizzle ORM PostgreSQL & Drizzle Kit Migration Documentation," Orm.drizzle.team. [Online]. Available: https://orm.drizzle.team/docs/overview. [Accessed: Nov. 03, 2026].',
              'Redis Ltd., "Redis 7 Commands: EVAL (Lua Scripting), Streams (XADD/XREADGROUP), and Pub/Sub," Redis.io. [Online]. Available: https://redis.io/docs/latest/develop/. [Accessed: Nov. 03, 2026].',
              'Taskforce.sh Inc., "BullMQ Distributed Queue & Worker Documentation," Docs.bullmq.io. [Online]. Available: https://docs.bullmq.io/. [Accessed: Nov. 03, 2026].',
              'OpenAPI Initiative, "OpenAPI Specification v3.0.3," Spec.openapis.org. [Online]. Available: https://spec.openapis.org/oas/v3.0.3. [Accessed: Nov. 03, 2026].',
              'Vitest Team and Microsoft Corp., "Vitest Testing Framework & Playwright End-to-End Testing Documentation," Vitest.dev / Playwright.dev. [Online]. Available: https://playwright.dev/docs/intro. [Accessed: Nov. 03, 2026].',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'appendix-a',
    chapterLabel: 'APPENDIX A',
    number: 'Appendix A',
    title: 'API DOCUMENTATION',
    isAppendix: true,
    sections: [
      {
        number: 'A.1',
        title: 'Implemented Control-Plane, Authentication, Studio, and Gateway REST Endpoints',
        blocks: [
          {
            kind: 'table',
            tableNumber: 'A.1',
            caption: 'Master FortiX HTTP API Specification (Verified from src/api/* and src/gateway/index.ts)',
            colWidths: [10, 30, 18, 42],
            headers: ['Method', 'Endpoint Path', 'Auth / Guard', 'Request Contract, Status Codes & Behavior'],
            rows: [
              ['POST', '/api/auth/register', 'Public (Rate Limited)', 'Body: {email, password, name?, phone?}. Returns 201 {user, token} + HttpOnly cookies; 409 on duplicate.'],
              ['POST', '/api/auth/login', 'Public (Rate Limited)', 'Body: {identifier, password, rememberMe?}. Returns 200 {user, token, rememberMe} + session/refresh/csrf cookies; 401 on invalid.'],
              ['POST', '/api/auth/refresh', 'Cookie fortix_refresh', 'Rotates refresh token within family_id; returns 200 {token} or 401 on expiry/reuse (revokes family).'],
              ['POST', '/api/auth/forgot-password', 'Public (Rate Limited)', 'Body: {identifier}. Generates 6-digit HMAC OTP; returns 200 generic anti-enumeration response + challengeId.'],
              ['POST', '/api/auth/verify-reset-otp', 'Public (Rate Limited)', 'Body: {challengeId, otp}. Enforces <=5 attempts; returns 200 {resetAuthorization} (single-use, 10m TTL).'],
              ['POST', '/api/auth/reset-password', 'Single-Use Token', 'Body: {resetAuthorization, newPassword, confirmPassword}. Updates hash & revokes all sessions; returns 200.'],
              ['GET/DELETE', '/api/control/account/sessions', 'JWT + CSRF', 'Lists active refresh session families or revokes a specific familyId / all other sessions.'],
              ['POST', '/api/control/account/phone/*', 'JWT + CSRF', '/phone/request-otp & /phone/confirm-otp enroll and verify unique E.164 phone numbers for SMS recovery.'],
              ['GET/POST', '/api/control/projects', 'JWT Session', 'Lists tenant-owned projects or creates an isolated project workspace (201).'],
              ['GET/POST/DELETE', '/api/control/routes', 'JWT + Project BOLA', 'Registers or deletes gateway routes; validates targetUrl against SSRF rules.'],
              ['GET/POST/DELETE', '/api/control/keys', 'JWT + Project BOLA', 'Issues scoped fx_live_* API keys (rawKey returned once) or revokes keys with Redis Pub/Sub broadcast.'],
              ['GET/POST/PUT', '/api/control/policies', 'JWT + Project BOLA', 'Configures rateLimitRpm, enableWaf, and enableSsrf per route.'],
              ['GET/POST', '/api/control/studio/apis', 'JWT + Project BOLA', 'Creates self-contained API Studio APIs (including 100-record Store Products template) & exports /openapi.'],
              ['POST', '/api/control/experiments', 'JWT + DEVELOPER+', 'Queues bounded latency, error_5xx, timeout, or rate_limit_burst experiment (201 QUEUED); /:id/cancel aborts.'],
              ['GET', '/api/control/verifications', 'JWT + Project BOLA', 'Returns deterministic PASS / FAIL / INCONCLUSIVE verdicts with 3-phase telemetry summaries.'],
              ['GET', '/api/control/reports/:id/pdf', 'JWT + Project BOLA', 'Streams server-generated PDFKit compliance report verified against SHA-256 digest.'],
              ['ALL', '/proxy/:routeId/*', 'X-API-Key (Gateway)', 'Enforces SSRF, Key Auth (401), WAF (403), Lua Rate Limit (429), Post-Auth Faults, and Upstream/Studio Proxy.'],
              ['GET', '/api/health/ready', 'Public Readiness', 'Verifies PostgreSQL and Redis liveness; returns 200 healthy or 503 degraded in strict mode.'],
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'appendix-b',
    chapterLabel: 'APPENDIX B',
    number: 'Appendix B',
    title: 'DATABASE SCHEMA & MIGRATION HISTORY',
    isAppendix: true,
    sections: [
      {
        number: 'B.1',
        title: 'Versioned Drizzle SQL Migrations and Constraint Summary',
        blocks: [
          {
            kind: 'table',
            tableNumber: 'B.1',
            caption: 'Chronological Drizzle SQL Migration Ledger (drizzle/meta/_journal.json)',
            colWidths: [10, 34, 56],
            headers: ['Idx', 'Migration SQL File', 'Schema Objects & Constraints Introduced'],
            rows: [
              ['0', '0000_ambitious_rhino.sql', 'Bootstraps core tables: users, organizations, projects, api_routes, api_keys, security_policies, experiments, verifications, metric_logs, security_events.'],
              ['1', '0001_production_hardening.sql', 'Adds refresh_tokens, webhooks, webhook_deliveries, and composite telemetry/threat indexes.'],
              ['2', '0002_settings_and_audit.sql', 'Adds project_settings (1:1 versioned JSONB) and append-only audit_logs with diff tracking.'],
              ['3', '0003_auth_verification_and_reset.sql', 'Adds email_verified on users and single-use auth_action_tokens table with UNIQUE(token_hash).'],
              ['4', '0004_autonomous_workflows.sql', 'Adds workflow_runs for multi-step verification timeline tracking and cleanup status auditing.'],
              ['5', '0005_api_studio.sql', 'Adds studio_apis, studio_resources, and studio_records with composite unique constraints for API Studio.'],
              ['6', '0006_auth_sessions_and_recovery.sql', 'FTX-AUTH-001: Adds phone_e164/phone_verified on users, family rotation & reuse detection columns on refresh_tokens, and recovery_challenges OTP table.'],
              ['RLS', 'postgres_rls_policies.sql', 'Enables and forces PostgreSQL Row-Level Security (RLS) policies across all 21 tables bound to app.current_user_id.'],
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'appendix-c',
    chapterLabel: 'APPENDIX C',
    number: 'Appendix C',
    title: 'TESTING AND VALIDATION',
    isAppendix: true,
    sections: [
      {
        number: 'C.1',
        title: 'Verified Automated Test Execution Evidence (Vitest, Playwright, and TypeScript Build)',
        blocks: [
          {
            kind: 'p',
            text: 'All test figures reported below come strictly from actual command executions performed against the current FortiX branch during release verification on November 03, 2026.',
          },
          {
            kind: 'table',
            tableNumber: 'C.1',
            caption: 'Actual Executed Validation Summary Across Type-Checking, Unit/Integration, and Browser E2E Suites',
            colWidths: [24, 24, 18, 34],
            headers: ['Validation Tier', 'Command Executed', 'Actual Result', 'Verified Coverage Scope'],
            rows: [
              ['TypeScript Static Analysis', 'npm run lint (tsc --noEmit)', '0 Errors (PASS)', 'Full backend, gateway, verification, Studio, and React 19 TSX type safety.'],
              ['Production Build Bundle', 'npm run build', 'PASS (SPA + CJS)', 'Vite production bundle + esbuild dist/server.cjs & dist/worker.cjs.'],
              ['Vitest Unit & Integration', 'npm test (vitest run)', '34 / 34 Suites Passed (261 / 261 Tests)', 'Auth/OTP concurrency (ftx-auth-001.test.ts), migrations (21 tables), WAF, SSRF, Lua rate limit, verification defects, API Studio, tenant isolation, webhooks.'],
              ['Playwright E2E & Security', 'npx playwright test', '12 / 12 Tests Passed (25.4s)', 'Browser Login + Remember Me + OTP Reset (auth-recovery.spec.ts), 100-Product API Studio lifecycle, Golden Demo, Worker bounds, PDF report, BOLA/SSRF, WebSocket isolation.'],
              ['External Live SMTP / Carrier SMS', 'N/A (Webhook Mock Verified)', 'Not Run Against Paid Carrier', 'HTTP 2xx/500 provider contract verified locally; live carrier delivery requires external deployment credentials.'],
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'appendix-d',
    chapterLabel: 'APPENDIX D',
    number: 'Appendix D',
    title: 'PROJECT DIRECTORY STRUCTURE',
    isAppendix: true,
    sections: [
      {
        number: 'D.1',
        title: 'Curated Repository Tree and Architectural Module Map',
        blocks: [
          {
            kind: 'code',
            title: 'FortiX Repository Structure (Verified Workspace Layout)',
            filePath: '/',
            language: 'text',
            code: `FortiX/
├── server.ts                       # Express + HTTP Proxy + Socket.IO + Vite dev/prod entrypoint
├── Dockerfile / docker-compose.yml # Multi-stage non-root Alpine image & 4-service compose stack
├── drizzle/                        # Versioned SQL migrations (0000..0006) & postgres_rls_policies.sql
├── src/
│   ├── api/                        # Control-plane routers (auth, account, studio, routes, keys, policies, experiments, verifications, reports, settings)
│   ├── auth/                       # FTX-AUTH-001 session rotation (sessions.ts), HMAC OTP (recovery.ts), providers.ts
│   ├── db/                         # 21-table Drizzle schema (schema.ts) & PostgreSQL/pg-mem + RLS connector
│   ├── gateway/                    # /proxy/:routeId/* enforcement pipeline & SHA-256 HashedApiKeyCache
│   ├── security/ & lib/            # WAF SQLi/XSS inspector, SSRF + safeDnsLookup, RBAC, CSRF/CORS, JWT security, Pino logger
│   ├── rate-limit/                 # Atomic Redis Lua token-bucket script (redis.ts)
│   ├── studio/                     # FortiX API Studio 100-Product seed, CRUD target-handler & OpenAPI 3.0 generator
│   ├── experiments/ & telemetry/   # BullMQ 3-phase probe worker & Redis Stream telemetry batcher + flush barrier
│   ├── verification/ & reports/    # Deterministic PASS/FAIL/INCONCLUSIVE engine & PDFKit SHA-256 report generator
│   ├── components/ & pages/        # React 19 UI (Login, PasswordRecovery, Dashboard, ApiStudio, ProtectedApis, SecurityPolicies, Experiments, Verifications, Settings)
├── tests/                          # 34 Vitest unit/integration suites + Playwright E2E/security specs
└── docs/                           # Security ADRs (FTX-AUTH-001-ADR.md) & B.Tech Project Report deliverables`,
          },
        ],
      },
    ],
  },
  {
    id: 'appendix-e',
    chapterLabel: 'APPENDIX E',
    number: 'Appendix E',
    title: 'GLOSSARY',
    isAppendix: true,
    sections: [
      {
        number: 'E.1',
        title: 'Definitions of Core Security, Gateway, and Resilience Terms',
        blocks: [
          {
            kind: 'table',
            tableNumber: 'E.1',
            caption: 'Technical Glossary of FortiX Domain Concepts',
            colWidths: [24, 76],
            headers: ['Term', 'Technical Definition in FortiX'],
            rows: [
              ['API Gateway & Reverse Proxy', 'Intermediary HTTP enforcement server (/proxy/:routeId/*) that authenticates, inspects, rate-limits, and sanitizes client requests before forwarding to upstream services.'],
              ['JSON Web Token (JWT)', 'Compact HMAC-SHA256 signed session claim token stored in HttpOnly cookies and bound to a refresh session family (sid).'],
              ['Scoped API Key', 'Client credential formatted as fx_live_<id>_<secret> whose secret is verified via bcrypt and restricted to explicit project routes and scopes.'],
              ['Role-Based Access Control (RBAC)', 'Permission model restricting control-plane operations across ADMIN, OPERATOR, DEVELOPER, and VIEWER roles.'],
              ['Multi-Tenancy & RLS', 'Isolation architecture ensuring one organization/project cannot read or mutate another tenant\'s routes, keys, or logs at both API and PostgreSQL Row-Level Security layers.'],
              ['Token-Bucket Rate Limiting', 'Traffic-policing algorithm executed atomically via Redis Lua script that replenishes capacity at a fixed RPM rate and rejects excess bursts with HTTP 429.'],
              ['Controlled Fault Injection', 'Deliberate, bounded introduction of latency, HTTP 5xx errors, or upstream timeouts on authorized routes after authentication to test resilience.'],
              ['Baseline & Recovery Windows', 'Pre-fault (5 probes) and post-fault (5 probes) observation intervals used to establish normal behavior and prove clean recovery after chaos stops.'],
              ['Telemetry Flush Barrier', 'Synchronization step (flushTelemetryBarrier) draining asynchronous Redis Stream metrics into PostgreSQL before verification queries execute.'],
              ['P50 / P95 / P99 Percentiles', 'Response latency thresholds below which 50%, 95%, and 99% of observed gateway requests complete.'],
              ['PASS / FAIL / INCONCLUSIVE', 'Deterministic verification outcomes: PASS (SLA satisfied with >=80% sample coverage), FAIL (SLA breached), INCONCLUSIVE (insufficient telemetry samples—preventing vacuous passes).'],
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'appendix-f',
    chapterLabel: 'APPENDIX F',
    number: 'Appendix F',
    title: 'PROJECT LIMITATIONS',
    isAppendix: true,
    sections: [
      {
        number: 'F.1',
        title: 'Known Operational Constraints and Honest Engineering Boundaries',
        blocks: [
          {
            kind: 'table',
            tableNumber: 'F.1',
            caption: 'Documented Limitations of the Current FortiX Implementation',
            colWidths: [26, 74],
            headers: ['Limitation Area', 'Current Boundary & Operational Implication'],
            rows: [
              ['External Email / SMS Gateways', 'OTP delivery providers (src/auth/providers.ts) implement production HTTPS webhook adapters with local outbox fallback in development; real inbox/SMS delivery requires configuring external SMTP/SMS webhook credentials.'],
              ['Signature-Based WAF Scope', 'Gateway WAF inspects URI-decoded SQLi, XSS, and path-traversal signatures effectively for REST JSON APIs, but is not a full OWASP ModSecurity CRS behavioral anomaly engine.'],
              ['Single-Region Persistence', 'Docker Compose deploys single-primary PostgreSQL 15 and Redis 7 instances; active-active multi-region replication and automated failover are outside current scope.'],
              ['Protocol Coverage', 'Gateway proxying and API Studio target HTTP/1.1 REST/JSON workloads; gRPC (HTTP/2 trailers) and GraphQL AST depth limiting are not currently implemented.'],
              ['In-Memory Sandbox Mode', 'When DATABASE_URL or REDIS_URL are omitted in local demos, pg-mem and local rate-limit fallbacks do not persist across process restarts; production deployments must set STRICT_PERSISTENT_DB=true.'],
            ],
          },
        ],
      },
    ],
  },
];
