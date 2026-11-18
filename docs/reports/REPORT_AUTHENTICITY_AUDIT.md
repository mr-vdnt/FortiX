# FortiX B.Tech IT Project Report — Forensic Authenticity Audit (`FORTIX-REPORT-AUTH-001`)

- **Audited Document:** `docs/reports/FORTIX_BTECH_PROJECT_REPORT.docx` / `docs/reports/FORTIX_BTECH_PROJECT_REPORT.pdf` (81 pages)
- **Audited Repository:** `https://github.com/mr-vdnt/FortiX`
- **Audited Branch & Commit SHA:** `main` @ `a97c14fb53d0bd3c915016cfdfafe4524c288517`
- **Audit Execution Timestamp:** `2026-11-04T14:34:34Z` – `2026-11-04T14:44:00Z`
- **Source Code Modification Check:** `0` application files modified (`git diff -- src server.ts package.json drizzle tests Dockerfile docker-compose.yml` is empty).

---

## 1. Executive Verdict

The original 81-page B.Tech IT Project Report (`FORTIX_BTECH_PROJECT_REPORT.docx` / `.pdf`) is **genuinely grounded in the FortiX software repository**—it is not a generic or fabricated template. All five lifecycle stages (`PROTECT → BREAK → OBSERVE → PROVE → IMPROVE`), the 23-table Drizzle/PostgreSQL schema, `FTX-AUTH-001` session rotation and HMAC-SHA256 OTP recovery, `FTX-API-STUDIO-001` 100-product catalog, the three-phase chaos verification engine with telemetry barrier synchronization, and `FTX-LEARN-001` In-App Video Learning Center exist as real, working TypeScript modules backed by 35 passing Vitest suites (`269/269` tests) and 13 passing Playwright specifications (`13/13` tests).

However, **the original report could not be approved for academic submission without revision** because it conflated three distinct levels of truth and contained concrete technical discrepancies:

1. **Paraphrased "Verbatim" Code Excerpts (7 of 7 Samples Mismatched):** Section 4.2 claimed its seven code listings were *"taken directly from the FortiX TypeScript codebase"*, yet every single listing was condensed/paraphrased—altering function signatures (`rotateRefreshSession`, `verifyPasswordRecoveryOtp`, `verifyPolicy`, `handleStudioUpstreamRequest`, `validateVideoSource`), changing the Redis Lua script from 3 `ARGV` parameters to 5, inventing helper names (`computeNextExpiry`, `validateGatewayApiKey`, `persistVerification`, `summarizeMetrics`), and falsely claiming `minPrice`/`maxPrice` Studio filters.
2. **Undisclosed Sandbox vs. External Infrastructure Boundary:** In the audited container environment (`DATABASE_URL` unset, `REDIS_URL` unset, `docker`/`psql`/`redis-server` binaries absent), FortiX runs on **`pg-mem` (in-memory SQL)** and **`ioredis-mock` / in-process fallback queues**. While PostgreSQL 15 Row-Level Security (`drizzle/postgres_rls_policies.sql`), Redis 7 Lua scripting (`src/rate-limit/redis.ts`), Redis Streams (`src/lib/telemetry.ts`), BullMQ workers (`src/experiments/queue.ts`), and `docker-compose.yml` are **`SOURCE-CONFIRMED`**, their live external-service execution is **`BLOCKED` in the sandbox** (`src/db/rls.ts:17` skips RLS on `pg-mem`; `src/rate-limit/redis.ts:145` bypasses Lua via `evaluateLocalBucket()` when `!isRealRedisActive`).
3. **Artifact Storage Stub & PDF Integrity Terminology:** `S3StorageProvider` (`src/storage/s3-storage.ts:49`) is a **local-delegating stub** (`// In a full cloud environment, PutObjectCommand would be invoked here`; `@aws-sdk/client-s3` is not installed), `'gcs'` is an unimplemented type literal, and PDF reports (`src/api/reports.ts`) compute a **SHA-256 content checksum (`X-FortiX-Artifact-SHA256`)** rather than asymmetric digital signatures (PKCS#7/X.509) or WORM immutability.
4. **Endpoint Mount Path, Env Var, Enum & Constant Drift:**
   - Learning Center API is mounted at **`/api/learning/*`** (`src/api/index.ts:158`), not `/api/control/learning/*`.
   - Session management and phone OTP enrollment are mounted at **`/api/auth/sessions`** and **`/api/auth/phone/*`** (`src/api/auth.ts:535-652`), not `/api/control/account/sessions` or `/api/control/account/phone/*`.
   - Table 4.2 misnamed four environment variables (`SESSION_REMEMBER_TTL_DAYS`, `SESSION_SHORT_TTL_HOURS`, `AUTH_MAIL_WEBHOOK_URL`, `ALLOWED_ORIGINS`).
   - Experiment API enum uses `'traffic_burst'` (not `'rate_limit_burst'`), worker clamps active fault duration to `500–10,000 ms` (`src/experiments/worker.ts:282`), Redis rate-limit `PEXPIRE` is `60000 ms` (`60s`, not `120s`), Redis Stream cap is `MAXLEN ~ 10000` (not `100,000`), and webhook signature header is `t=<ts>,v1=<hex>` on queue `fortix-webhooks` (not `sha256=...` on `bull:webhooks:*`).
5. **Security Scope & Repository Documentation Drift:** Gateway WAF (`src/threat-detection/index.ts`) is a **13-pattern regex request inspector** (not a full OWASP ModSecurity CRS WAF), `drizzle/postgres_rls_policies.sql` includes a `COALESCE(current_setting('app.current_user_id', true), '') = ''` permissive clause when `withTenantContext()` is not active, and root repo files (`package.json` `"name": "react-example"`, `README.md`, `PROGRESS.md`, `RELEASE_BASELINE.md`) exhibit legacy documentation drift.

All 30 identified issues have been corrected in `docs/reports/FORTIX_BTECH_PROJECT_REPORT_REVISED.docx` and `docs/reports/FORTIX_BTECH_PROJECT_REPORT_REVISED.pdf`.

---

## 2. Three-Tier Evidence Taxonomy Applied Throughout Audit

| Evidence Tier | Strict Operational Definition | Examples in FortiX (`a97c14fb53d0bd3c915016cfdfafe4524c288517`) |
|---|---|---|
| **`SOURCE-CONFIRMED`** | Exact TypeScript, SQL, Dockerfile, or Compose implementation exists at verified file paths and line numbers in the repository. | All 23 Drizzle tables (`src/db/schema.ts`), 17-table Postgres RLS SQL (`drizzle/postgres_rls_policies.sql`), Redis Lua script (`src/rate-limit/redis.ts:149-182`), `Dockerfile`, `docker-compose.yml`. |
| **`RUNTIME-VERIFIED (Sandbox)`** | Executed and observed passing in the audited Node.js 22.23.3 + Chromium v1243 environment (`pg-mem` + `ioredis-mock` / local fallback), backed by saved raw logs in `docs/reports/evidence-logs/`. | `npm run lint` (`0` errors), `npm run build` (`0` errors), `npx vitest run` (`35/35` suites, `269/269` tests), `npx playwright test` (`13/13` E2E & security tests), `/api/health/live` & `/api/health/ready`. |
| **`BLOCKED` / `STUB` / `DOCUMENTED-ONLY`** | Cannot be executed in the sandbox without external daemons/credentials (`BLOCKED`), delegates to a local stub (`STUB`), or exists only in prose (`DOCUMENTED-ONLY`). | Live Docker Compose (`docker` absent), live PostgreSQL 15 `NOBYPASSRLS` enforcement (`psql` absent), external Redis 7 Lua/Streams/BullMQ (`redis-server` absent), `S3StorageProvider` (`STUB`), live SMTP/SMS carrier (`BLOCKED`). |

---

## 3. Resolution of Branch / Commit History Question (`FTX-LEARN-001`)

During initial external inspection, a discrepancy was noted regarding whether the Video Learning Center (`FTX-LEARN-001`) existed on `main`. Forensic git inspection resolves this completely:
- Earlier repository commit `a9ed5ab` predated the `FTX-LEARN-001` merge and report generation commits.
- On the current `main` branch (`HEAD = a97c14fb53d0bd3c915016cfdfafe4524c288517`), the complete `FTX-LEARN-001` implementation is **present, committed, and runtime-verified**, comprising:
  - Migration `drizzle/0007_learning_center.sql` (`learning_tutorials` and `learning_progress` tables)
  - Backend modules `src/learning/types.ts`, `src/learning/video-validator.ts`, `src/learning/catalog-seed.ts`, and `src/api/learning.ts` (mounted at `/api/learning` in `src/api/index.ts:158`)
  - Frontend components `src/pages/LearningCenter.tsx`, `src/pages/TutorialDetail.tsx`, and `src/components/ContextualTutorialDrawer.tsx`
  - Self-hosted WebM media and WebVTT caption tracks under `public/learning/videos/` and `public/learning/captions/`
  - Automated suites `tests/unit/learning-center.test.ts` and `tests/e2e/learning-center.spec.ts` (`23.8s` full 10-step Chromium E2E pass in `04-playwright.log`).
- **Actual Defects Found in Report's Coverage of `FTX-LEARN-001`:** (1) The report documented the API prefix as `/api/control/learning/*` instead of `/api/learning/*`; (2) Sample 7 paraphrased `validateVideoSource()` to accept full `youtube-nocookie.com/embed/*` URLs instead of exact 11-character video IDs; and (3) Table 3.23 used `/tutorials/...` example paths that would fail `SELF_HOSTED_VIDEO_RE` (`/learning/videos/...`). All three have been corrected.

---

## 4. Forensic Audit of All Seven Section 4.2 Code Excerpts

| Sample # | Target File | Defect in Original Report (`FORTIX_BTECH_PROJECT_REPORT`) | Actual Repository Implementation (`src/`) | Action Taken in Revised Report |
|---|---|---|---|---|
| **Sample 1** | `src/auth/sessions.ts` | Wrote `rotateRefreshSession(rawRefreshToken: string, meta?: SessionClientMetadata)` and called non-existent `computeNextExpiry(existing)` without per-token lock or conditional SQL update. | `rotateRefreshSession(params: { rawRefreshToken: string; userAgent?: string; ip?: string })` (lines 110–305): acquires `refreshRotationLocks`, checks `replacedById !== null \|\| revokedAt !== null`, enforces `absoluteExpiresAt`, runs atomic conditional `UPDATE ... returning({ id })`, inserts successor row, and calls `signAccessJwt()`. | Replaced with **verbatim lines 110–305** of `src/auth/sessions.ts`. |
| **Sample 2** | `src/auth/recovery.ts` | Paraphrased `verifyPasswordRecoveryOtp(challengeId, submittedOtp)` with invented identifiers (`expectedHex`, `actualHex`, `nextFailed`) and omitted synthetic challenge anti-enumeration. | `computeOtpHmac` (lines 108–121) & `verifyPasswordRecoveryOtp(params: { challengeId: string; otp: string; ip?: string })` (lines 600–791): enforces `checkMultiDimensionalOtpRateLimit`, constant-work `isSyntheticChallengeId` rejection, `withChallengeLock`, 5-attempt lockout, and 5-clause conditional `UPDATE`. | Replaced with **verbatim lines 108–121 & 600–791** of `src/auth/recovery.ts`. |
| **Sample 3** | `src/rate-limit/redis.ts` | Invented `const TOKEN_BUCKET_LUA` with 5 `ARGV` parameters (`capacity, refill_rate, now_ms, requested, ttl_ms`), floating-point per-second refill, and omitted `!isRealRedisActive` local fallback. | `checkRateLimit(projectId, routeId, identifier)` (lines 91–205): runs `evaluateLocalBucket()` when `redis.status !== 'ready'` (in fail-open/dev) or `!isRealRedisActive`; defines `const script` with **3 `ARGV` parameters** (`capacity, refillRate, now`), integer `math.floor(time_passed * (refillRate / 60000))`, and `PEXPIRE key 60000`. | Replaced with **verbatim lines 91–205** of `src/rate-limit/redis.ts`. |
| **Sample 4** | `src/gateway/index.ts` | Invented `isStudioInternalTarget()`, `validateGatewayApiKey()`, `if (threat.detected)`, and `delete proxyReq.headers['x-api-key']`. | `createSharedGatewayProxy` uses `proxyReq.removeHeader('x-api-key')` & `proxyReq.removeHeader('x-fortix-token')` (lines 147–162); `setupGateway` calls `isSafeTarget(route.targetUrl)`, `extractGatewayApiKey(req)`, `apiKeyCache.get(rawKey)`, `bcrypt.compare`, `const threats = detectThreats(req)` (`string[]`), and `checkRateLimit(...)` (lines 336–417, 498–565). | Replaced with **verbatim lines 147–162, 336–417 & 498–565** of `src/gateway/index.ts`. |
| **Sample 5** | `src/verification/engine.ts` | Wrote `verifyPolicy(experimentId: string, policyId?: string, windows?: PhaseWindows)` and non-existent helpers `persistVerification()` and `summarizeMetrics()`. | `verifyPolicy(experimentId, policyId, startTime, endTime, options?)` (lines 66–245): serializes via `activeVerificationLocks`, awaits `flushTelemetryBarrier`, partitions via `filterRowsForPhase` & `computePhaseMetrics`, calls `evaluateExperimentVerification`, and inserts via `db.insert(verifications)`. | Replaced with **verbatim lines 66–245** of `src/verification/engine.ts`. |
| **Sample 6** | `src/studio/target-handler.ts` | Wrote `handleStudioUpstreamRequest(params: StudioDispatchInput): Promise<StudioHttpResponse>`, `validation.valid`, and claimed `minPrice, maxPrice` query filters. | `handleStudioUpstreamRequest(req: Request, res: Response, ctx: StudioGatewayDispatchContext): Promise<number>` (lines 180–210, 301–391): checks `validation.ok` on `POST` and filters `GET /:slug` strictly by `category`, `status`, and `q`/`search` (`limit` 1–100, `offset` 0–10000) — **no `minPrice`/`maxPrice` exists**. | Replaced with **verbatim lines 180–210 & 301–391** of `src/studio/target-handler.ts` and removed `minPrice`/`maxPrice`. |
| **Sample 7** | `src/learning/video-validator.ts` | Wrote `validateVideoSource(provider, reference?)` accepting full `https://www.youtube-nocookie.com/embed/*` URLs and returning `sanitizedReference`. | `validateVideoSource(providerInput, referenceInput, env)` (lines 107–199): returns `{ valid, provider, reference }`, requires `/learning/videos/<file>.(webm\|mp4)` for `self_hosted`, requires exact 11-char ID (`YOUTUBE_VIDEO_ID_RE`) for `youtube_nocookie`, and checks `LEARNING_ALLOWED_VIDEO_ORIGINS` for `https_allowlist`. | Replaced with **verbatim lines 107–199** of `src/learning/video-validator.ts`. |

---

## 5. Deep-Dive Findings on Architecture, Storage, Security & Repository Drift

### 5.1 Storage Providers & PDF Compliance Reports (`src/storage/*`, `src/api/reports.ts`)
- **`LocalStorageProvider` (`src/storage/local-storage.ts`):** `SOURCE-CONFIRMED` and `RUNTIME-VERIFIED`. Writes binary PDFs under `storage/artifacts/` alongside `.meta.json` sidecars containing `projectId` and `sha256`, re-computing SHA-256 on every read (`get()`) to detect local file corruption or tampering.
- **`S3StorageProvider` (`src/storage/s3-storage.ts`):** **Stub / Local Fallback Only.** Line 49 explicitly states `// In a full cloud environment, PutObjectCommand would be invoked here`; `@aws-sdk/client-s3` is not in `package.json`, and `put()`, `get()`, `list()`, and `delete()` delegate to `LocalStorageProvider`. Meanwhile `'gcs'` appears only in the `StorageProviderName` union (`src/storage/artifact-storage.ts:3`) with zero implementation.
- **PDF Integrity Scope:** `src/api/reports.ts` generates a deterministic PDFKit report and stamps `X-FortiX-Artifact-SHA256`. It does **not** perform X.509/PKCS#7 digital signing, RFC 3161 trusted timestamping, or S3 Object Lock WORM storage.

### 5.2 PostgreSQL 15 Row-Level Security (`drizzle/postgres_rls_policies.sql` & `src/db/rls.ts`)
- `drizzle/postgres_rls_policies.sql` defines `ENABLE ROW LEVEL SECURITY` across 17 tables (`organizations`, `projects`, `project_settings`, `api_routes`, `api_keys`, `security_policies`, `experiments`, `verifications`, `webhooks`, `workflow_runs`, `studio_apis`, `studio_resources`, `studio_records`, `refresh_tokens`, `auth_action_tokens`, `recovery_challenges`, `learning_progress`) and provisions role `fortix_app` (`NOBYPASSRLS`).
- **Critical Audit Nuance #1 (Runtime):** In the sandbox (`DATABASE_URL` unset), `src/db/rls.ts:17` checks `if (!isPersistentStorage()) return fn(db);` because `pg-mem` does not implement PostgreSQL RLS session GUC policies. Thus `tests/unit/postgres-rls.test.ts` performs static SQL/schema verification rather than live cross-tenant SQL rejection under `fortix_app`.
- **Critical Audit Nuance #2 (Policy Predicate):** Every policy in `drizzle/postgres_rls_policies.sql` includes `COALESCE(current_setting('app.current_user_id', true), '') = '' OR ...` so background workers and legacy queries that do not wrap transactions in `withTenantContext(userId, ...)` continue functioning. Consequently, **application-layer project ownership middleware (`src/middleware/project.ts`) is the primary enforced isolation gate**, while RLS acts as opt-in transactional defense-in-depth when `withTenantContext()` is invoked on PostgreSQL 15.

### 5.3 Redis 7 Lua, Streams, Pub/Sub & BullMQ Fallback Behavior
- When `REDIS_URL` is unset (`!isRealRedisActive`), FortiX runs cleanly in single-process mode via:
  1. `evaluateLocalBucket()` (`src/rate-limit/redis.ts:108-128`) — bounded in-memory Map instead of Redis `EVAL` Lua script.
  2. `inMemoryStreams` + direct DB dual-write (`src/lib/telemetry.ts`) — instead of external Redis `XADD`/`XREADGROUP`.
  3. `dispatchFallbackExperimentRunner()` (`src/experiments/queue.ts`) & `dispatchFallbackWebhookRunner()` (`src/lib/webhooks.ts`) — `setTimeout`-dispatched in-process async runners instead of external Redis BullMQ workers.
- All sandbox tests (`03-vitest.log` and `04-playwright.log`) verify these in-process mechanics; multi-container Redis 7 cluster behavior requires external Docker/Redis deployment.

### 5.4 Gateway WAF & Security Positioning (`src/threat-detection/index.ts`)
- `detectThreats(req)` implements **13 regular-expression signatures** (`5` path traversal + `8` XSS/SQLi patterns) evaluated across 2-pass `decodeURIComponent` URL/query strings, recursively traversed JSON bodies (up to nesting depth `4`), and three headers (`user-agent`, `referer`, `x-forwarded-for`).
- While effective against common REST injection vectors (and verified in `tests/unit/threat-detection.test.ts`), it must be accurately described as a **lightweight 13-pattern signature request filter**, not an enterprise ModSecurity/OWASP CRS Web Application Firewall.

### 5.5 Repository Metadata & Root Documentation Drift
Because application and root repository files are strictly untouched during this audit (Rule 4), the revised report transparently discloses the following legacy drift present in the repository root:
- `package.json`: Retains scaffold `"name": "react-example"` and `"version": "0.0.0"`.
- `README.md`: Still mentions legacy Redis Lists (`LPUSH`/`LPOP` instead of Redis Streams `XADD`/`XREADGROUP`), old lifecycle phrasing `PROTECT → OBSERVE → BREAK → MEASURE → PROVE`, `/health/live` instead of `/api/health/live`, and *"cryptographic PDF report serving as immutable evidence"*.
- `docs/development/PROGRESS.md` & `docs/development/RELEASE_BASELINE.md`: Reflect earlier milestones (`230` Vitest tests / `9` Playwright tests) recorded prior to `FTX-AUTH-001` and `FTX-LEARN-001` (`269` Vitest tests / `13` Playwright tests).

---

## 6. Cross-Reference to Companion Deliverables

- **Feature-by-Feature Matrix (70 Rows):** `docs/reports/FEATURE_VERIFICATION_MATRIX.csv` & `docs/reports/FEATURE_VERIFICATION_MATRIX.xlsx`
- **Itemized Correction Ledger (30 Entries):** `docs/reports/FORTIX_REPORT_CORRECTION_LOG.md`
- **Raw Command & Test Execution Evidence:** `docs/reports/TEST_EVIDENCE.md` & `docs/reports/evidence-logs/01..04.log`
- **UI Screenshot Provenance & Final Capture Checklist:** `docs/reports/SCREENSHOT_REQUIREMENTS.md`
- **Revised Submission-Ready Report:** `docs/reports/FORTIX_BTECH_PROJECT_REPORT_REVISED.docx` & `docs/reports/FORTIX_BTECH_PROJECT_REPORT_REVISED.pdf`
