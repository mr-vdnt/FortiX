# FortiX Release Baseline & Runtime Hardening Record

**Document ID:** `FTX-REL-P0-P1-RUNTIME-001`  
**Repository:** `https://github.com/mr-vdnt/FortiX.git` (`main`)  
**Previous Remote Checkpoint:** `2929866b0d092cf4afeab0f7637390f3230c85b6`

---

## 1. Test Suite Accounting (Disambiguated)

| Execution Scope | Command | Suite Count | Test Count | Notes |
| :--- | :--- | :---: | :---: | :--- |
| Startup / Port Subset | `npx vitest run tests/unit/port-resolution.test.ts tests/unit/security-redteam-regressions.test.ts` | 2 | 22 | Targeted startup + red-team regression subset |
| Unit Directory Only | `npx vitest run tests/unit` | 24 | 185 | Excludes 7 top-level `tests/gate*.test.ts` suites |
| **Complete Vitest Suite** | **`npm test`** | **31** | **230** | **Canonical release verification command (`test-results/vitest-summary.json`)** |
| Playwright E2E / Security / Chaos | `npx playwright test` | 5 | 9 | Restricted strictly to `**/*.spec.ts` via `playwright.config.ts` |

---

## 2. Remediated Runtime, Worker & Verification Defects (`D-01` – `D-07`)

1. **`D-01` — Node 22 Production Worker Packaging (`dist/worker.cjs`)**
   - `npm run build` bundles both `dist/server.cjs` and `dist/worker.cjs` via `esbuild`.
   - `docker-compose.yml` worker `command` executes `["node", "dist/worker.cjs"]` under `node:22-alpine` without `tsx` or `--loader`.
2. **`D-02` — Playwright / Vitest Test Runner Separation**
   - `playwright.config.ts` enforces `testMatch: '**/*.spec.ts'` so Vitest `.test.ts` files are never imported by Playwright.
3. **`D-03` — Playwright E2E & WebSocket Contract Alignment**
   - `tests/security/ws.spec.ts` validates cross-tenant subscription denial (`subscribe:project` unauthorized error) and tenant-isolated `security:event` delivery on WAF blocks with zero tautological assertions.
   - `tests/e2e/golden-demo.spec.ts` targets `http://fortix-demo-api:3001` and verifies protect, WAF block (`403`), rate-limit burst (`429`), chaos latency injection (`>= 750ms`), and sibling-route isolation.
   - `tests/security/all.spec.ts` sends schema-valid route creation payloads against `169.254.169.254` to verify `isSafeTarget` SSRF rejection (`400`).
4. **`D-04` — Vite Unintended WebSocket Listener Suppression (`*:24678`)**
   - `server.ts` configures Vite middleware with `middlewareMode: true`, `hmr: false`, `ws: false`, and `watch: null`, eliminating Vite's standalone WebSocket server on port `24678`.
5. **`D-05` — Bounded Port Retry & Complete Graceful Shutdown**
   - `listenWithBoundedRetry()` replaces infinite `EADDRINUSE` retry loops with bounded retries (`PORT_BIND_MAX_RETRIES`, default `2`) and an actionable startup error.
   - `executeGracefulShutdown()` deterministically closes Socket.IO, HTTP server, Vite middleware server, internal `demo-api` (`:3001`), telemetry loop, BullMQ workers/queues, Redis Pub/Sub clients, shared Redis connection, and PostgreSQL client/pool on `SIGTERM`/`SIGINT`.
6. **`D-06` — Standardized Readiness Contract & Queue Metadata**
   - `/health/ready` and `/api/health/ready` both return `buildReadinessPayload(...)` with identical schema and shared `uncaughtErrors` tracking.
   - `getDependenciesHealth()` reports `worker.queue: 'experiments'`, matching `src/experiments/queue.ts` and `src/worker.ts`.
7. **`D-07` — Git Metadata & Persisted Test Summary Artifact**
   - Workspace `.git` metadata reconciled cleanly against `origin/main` without losing workspace changes.
   - `npm test` writes `test-results/vitest-summary.json` consumed by `/api/control/system/test-status`.

---

## 3. Infrastructure Validation Boundary

- **Verified in Google AI Studio Sandbox (`Node v22.23.4`)**:
  - TypeScript compilation (`tsc --noEmit`), production Vite + `esbuild` bundles (`dist/server.cjs`, `dist/worker.cjs`), complete Vitest suite, Playwright E2E/security/failure specs, backup/restore drill, compiled worker `SIGTERM` lifecycle, and port/listener hygiene.
- **Requires External Staging Infrastructure Before Production Cutover (`FTX-REL-P2-PERSISTENCE-001`)**:
  - Live managed PostgreSQL (`DATABASE_URL`, `STRICT_PERSISTENT_DB=true`) migration + Row-Level Security (`FORCE ROW LEVEL SECURITY`) verification.
  - Live managed Redis (`REDIS_URL`, `REDIS_FAILURE_BEHAVIOR=fail-closed`) BullMQ queue/worker durability and distributed token-bucket verification.
  - Live `docker compose up --build` execution on a host with Docker Engine (Docker daemon is not available inside the Cloud Run gVisor preview container).
