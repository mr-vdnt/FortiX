# FortiX B.Tech IT Project Report — Empirical Test & Runtime Verification Evidence

- **Repository:** `https://github.com/mr-vdnt/FortiX`
- **Branch & Commit Verified:** `main` @ `a97c14fb53d0bd3c915016cfdfafe4524c288517`
- **Execution Window (UTC):** `2026-11-04T14:34:34Z` – `2026-11-04T14:43:57Z`
- **Host Runtime:** Linux container, Node.js `v22.23.3`, npm `10.9.9`, Python `3.10.12`, Playwright Headless Chromium `v1243` (`Chrome for Testing 153.0.8010.12`)
- **Raw Evidence Logs Directory:** `docs/reports/evidence-logs/` (`01-env-and-git.log` through `04-playwright.log`, sanitized of any raw ephemeral test keys)

---

## 1. Environment & Persistence Mode Snapshot (`01-env-and-git.log`)

Before executing any test suite, the active runtime environment and binary availability were probed and logged verbatim:

- **Present Binaries:** `node` (`v22.23.3`), `npm` (`10.9.9`), `python3` (`3.10.12`), `gs` (`/usr/bin/gs`), Playwright `chromium_headless_shell-1243`.
- **Absent External Infrastructure Binaries:** `docker` (`ABSENT`), `docker-compose` (`ABSENT`), `psql` (`ABSENT`), `postgres` (`ABSENT`), `redis-server` (`ABSENT`), `redis-cli` (`ABSENT`).
- **Configured Persistence Environment Variables:** `DATABASE_URL` = unset; `REDIS_URL` = unset; `FORTIX_STORAGE_PROVIDER` = unset (defaults to `LocalStorageProvider`).
- **Live Server Readiness Probe (`GET http://127.0.0.1:3000/api/health/ready` -> HTTP `200`):**
  ```json
  {
    "status": "ephemeral_ready",
    "deploymentMode": "ephemeral-sandbox",
    "persistenceVerified": false,
    "postgres": "healthy",
    "postgresStorageMode": "in-memory",
    "postgresMigrationStatus": "verified",
    "postgresLatencyMs": 0,
    "redis": "healthy",
    "redisStorageMode": "in-memory",
    "redisLatencyMs": 1,
    "warnings": [
      "PostgreSQL is running in ephemeral sandbox mode (pg-mem). Configure DATABASE_URL for durable persistence across restarts.",
      "Redis is running in ephemeral in-memory mode. Configure REDIS_URL for multi-instance queues and distributed rate limits."
    ],
    "uncaughtErrors": 0
  }
  ```

---

## 2. Master Execution Matrix (Executed & Passed, Failed, Statically Audited, and Blocked)

| Test / Verification Check | Command | Environment | Result | Evidence |
|---|---|---|---|---|
| **1. Runtime Health & Readiness Probes** | `curl -s http://127.0.0.1:3000/api/health/live` & `/api/health/ready` | Live Express + Gateway server (`ephemeral-sandbox`: `pg-mem` + `ioredis-mock`) | **EXECUTED & PASSED** (`HTTP 200` on both; `postgresMigrationStatus: "verified"`, `uncaughtErrors: 0`) | `docs/reports/evidence-logs/01-env-and-git.log` |
| **2. TypeScript Full-Project Static Typecheck** | `npm run lint` (`tsc --noEmit`) | Node.js `v22.23.3`, TypeScript `5.8.2` | **EXECUTED & PASSED** (`0` type errors, `EXIT_CODE_LINT=0`) | `docs/reports/evidence-logs/02-typecheck-and-build.log` |
| **3. Production Frontend + Server + Worker Build** | `npm run build` (`vite build` + `esbuild server.ts` + `esbuild src/worker.ts`) | Vite `v6.4.3` + `esbuild` on Linux | **EXECUTED & PASSED** (`2753` modules transformed; `dist/server.cjs` `840.2 KB`; `dist/worker.cjs` `169.1 KB`; `EXIT_CODE_BUILD=0`) | `docs/reports/evidence-logs/02-typecheck-and-build.log` |
| **4. Vitest Unit & Integration Test Suite** | `npx vitest run` | 35 isolated workers on `pg-mem` (auto-migrated `0000`–`0007`) + `ioredis-mock` + local filesystem | **EXECUTED & PASSED** (`35 / 35` test files passed; **`269 / 269` tests passed** in `122.23s`; `EXIT_CODE_VITEST=0`) | `docs/reports/evidence-logs/03-vitest.log` |
| **5. Playwright Browser E2E & API Security Suite** | `npx playwright test --reporter=list` | Headless Chromium `v1243` + HTTP/WS client against live sandbox server (`127.0.0.1:3000`) | **EXECUTED & PASSED** (**`13 / 13` tests passed** across `8` spec files in `48.2s`; `EXIT_CODE_PLAYWRIGHT=0`) *(Note: initial pre-install run failed 2 browser specs before `npx playwright install chromium` installed missing `v1243` shell; post-install run passed 13/13)* | `docs/reports/evidence-logs/04-playwright.log` |
| **6. PostgreSQL 15 Row-Level Security (RLS) DDL Audit** | `npx vitest run tests/unit/postgres-rls.test.ts` | Static SQL & schema policy verification (`drizzle/postgres_rls_policies.sql`) | **STATICALLY VERIFIED / LIVE DB BLOCKED** (`postgres-rls.test.ts` passed SQL structure checks; live `fortix_app` `NOBYPASSRLS` enforcement NOT executed because `pg-mem` skips `set_config` and `postgres` binary is absent) | `docs/reports/evidence-logs/03-vitest.log`, `src/db/rls.ts:17` |
| **7. Multi-Container Docker Compose Orchestration** | `docker compose up --build -d` | External Docker Engine 24+ (`api`, `worker`, `postgres:15-alpine`, `redis:7-alpine`) | **BLOCKED BY INFRASTRUCTURE** (`docker` and `docker-compose` binaries absent in sandbox container) | `docs/reports/evidence-logs/01-env-and-git.log`, `docker-compose.yml` |
| **8. External Redis 7 Lua Token Bucket, Streams & BullMQ** | Live Redis `EVAL`, `XADD`/`XREADGROUP`, and multi-process BullMQ worker | External Redis 7 daemon (`REDIS_URL=redis://...`) | **BLOCKED BY INFRASTRUCTURE** (`redis-server` absent; sandbox verified `evaluateLocalBucket()`, `inMemoryStreams`, and in-process fallback runners) | `docs/reports/evidence-logs/01-env-and-git.log`, `src/rate-limit/redis.ts:145` |
| **9. Cloud Object Storage Upload (`S3` / `GCS`)** | `FORTIX_STORAGE_PROVIDER=s3` against AWS S3 bucket | External AWS S3 + SDK | **NOT IMPLEMENTED AS CLOUD CALL (STUB)** (`src/storage/s3-storage.ts` lacks `@aws-sdk/client-s3` and delegates to `LocalStorageProvider`; `'gcs'` has no provider class) | `src/storage/s3-storage.ts:45-62` |
| **10. External Transactional Email & Carrier SMS OTP Delivery** | Live SMTP / SMS gateway webhook delivery to real inbox/handset | External HTTPS provider (`AUTH_MAIL_WEBHOOK_URL` / `AUTH_SMS_WEBHOOK_URL`) | **BLOCKED BY EXTERNAL CREDENTIALS** (Local mock HTTP `200`/`500` webhook contracts verified in `ftx-auth-001.test.ts`; live carrier delivery not executed) | `src/auth/providers.ts:74-168`, `03-vitest.log` |
| **11. PostgreSQL Backup & Restore Drill** | `npm run db:backup-drill` | External PostgreSQL `pg_dump` / `psql` | **BLOCKED BY INFRASTRUCTURE** (`psql` / `pg_dump` binaries absent in sandbox container) | `scripts/backup-restore-drill.ts`, `01-env-and-git.log` |

---

## 3. Breakdown of Executed Passing Suites

### 3.1 Vitest Unit & Integration Coverage (`35` Suites, `269` Passing Assertions — `03-vitest.log`)
Key verified suites include:
- **Authentication, Session Rotation & OTP Recovery (`tests/unit/ftx-auth-001.test.ts`):** Dual-identifier login, Remember-Me `30d` vs `12h` TTLs, `rotateRefreshSession()` rotation and `REFRESH_TOKEN_REUSED` family revocation, 6-digit HMAC-SHA256 OTP generation, 5-attempt lockout, 60s resend cooldown, 10-way concurrent single-use `verifyPasswordRecoveryOtp()` race safety, synthetic challenge anti-enumeration, and webhook `2xx`/`5xx` failure handling.
- **Database Migrations & Schema Integrity (`tests/unit/migrations.test.ts`):** Applies all 8 Drizzle SQL migrations (`0000`–`0007`) cleanly on `pg-mem` and verifies loud failure on unreachable PostgreSQL sockets (`ECONNREFUSED`).
- **Gateway, SSRF, WAF & Security Guards (`tests/unit/ssrf.test.ts` [26 tests], `tests/unit/security-guard.test.ts` [26 tests], `tests/unit/threat-detection.test.ts`, `tests/unit/rate-limit.test.ts`):** RFC 1918 / loopback / `169.254.169.254` / IPv6-mapped IPv4 SSRF blocking, double-submit CSRF, RBAC entitlements, 13-pattern multi-decoded SQLi/XSS/path-traversal detection, and token-bucket rate limiting + fail-closed error handling.
- **Verification Engine & Artifact Storage (`tests/unit/verification-defects.test.ts`, `tests/unit/artifact-storage.test.ts` [9 tests], `tests/unit/capstone-e2e.test.ts` [6 tests]):** Telemetry flush barrier synchronization, rejection of vacuous 0-sample passes (`INCONCLUSIVE`), `BASELINE`/`INJECTION`/`RECOVERY` percentile calculations, and `LocalStorageProvider` PDF persistence with `.meta.json` SHA-256 verification on read.
- **API Studio, Learning Center, OpenAPI, Topology, Metrics & Webhooks (`tests/unit/api-studio.test.ts`, `tests/unit/learning-center.test.ts`, `tests/unit/openapi.test.ts` [6 tests], `tests/unit/topology.test.ts` [5 tests], `tests/unit/metrics.test.ts` [3 tests], `tests/unit/webhooks.test.ts`, `tests/unit/ai-analysis.test.ts` [3 tests]).**

### 3.2 Playwright Browser & Security E2E Coverage (`8` Spec Files, `13` Passing Tests — `04-playwright.log`)
1. `tests/e2e/api-studio.spec.ts` (`4.7s`) — Provisions 100-record Store Products API, enforces Auth (`401`), WAF (`403`), and Rate Limiting (`429`), runs live experiment verification, and exports OpenAPI 3.0.3.
2. `tests/e2e/auth-recovery.spec.ts` (`6.4s`) — Real Chromium browser walkthrough of `/login` -> `/forgot-password` -> `/verify-reset` -> `/reset-password` -> Remember-Me sign-in while asserting zero password persistence in `localStorage`/`sessionStorage`/cookies.
3. `tests/e2e/golden-demo.spec.ts` (`9.1s`) — End-to-end lifecycle verification from route creation and policy enforcement through fault injection and SLA verdict persistence.
4. `tests/e2e/learning-center.spec.ts` (`23.8s`) — Complete 10-step Chromium journey across `/learning-center` and `/learning-center/:slug`: catalog filtering, video playback, progress saving, navigation away, resume cursor restoration, completion marking, contextual help drawer, and responsive viewport checks.
5. `tests/failure/worker.spec.ts` (`2` tests, `34ms`) — Rejects malformed experiment types and negative latency durations (`HTTP 400`).
6. `tests/reports/report.spec.ts` (`40ms`) — Generates verification PDF artifact and validates HTTP response headers (`application/pdf`, `X-FortiX-Artifact-SHA256`).
7. `tests/security/all.spec.ts` (`3` tests, `60ms`) — Verifies `401` on unauthenticated control-plane calls, `403`/`404` BOLA tenant isolation across projects, and SSRF rejection of private metadata IPs.
8. `tests/security/auth.spec.ts` (`2` tests, `26ms`) & `tests/security/ws.spec.ts` (`1` test, `649ms`) — Verifies gateway `401` on missing/invalid `X-API-Key` and Socket.IO room isolation across tenants.

---

## 4. Zero-Failure & Blocker Summary

- **Currently Failing Automated Tests in Sandbox:** **`0`** (`0` lint errors, `0` build errors, `0` Vitest failures out of `269`, `0` Playwright failures out of `13`).
- **Tests Blocked by External Infrastructure:** **`5` operational verification categories** (Docker Compose multi-container startup, live PostgreSQL 15 `NOBYPASSRLS` enforcement, live Redis 7 Lua/Streams/BullMQ execution, cloud object storage SDK persistence, and live external SMTP/SMS carrier delivery). None of these blocked items are claimed as runtime-verified in the revised report.
