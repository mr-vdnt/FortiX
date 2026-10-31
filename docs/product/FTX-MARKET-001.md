# FTX-MARKET-001 — Commercial Feasibility Assessment & Academic Scope Charter

**Document ID:** `FTX-MARKET-001`  
**Status:** Day 1 Competitive Analysis & Scope Audit Complete · Days 2–5 Human Interviews Pending  
**Created:** 30 October 2026  
**Academic Deadline:** 16 November 2026 (17 days remaining)  
**Core Product Positioning Under Test:** *Continuous API Control Verification — "One API. One security policy. One controlled experiment. One evidence-based result."*

---

## 0. Honest Engineering & Product Status (30 October 2026)

Before executing customer discovery or writing new code, this section separates **already-resolved engineering blockers**, **remaining infrastructure gaps**, and **newly identified weaknesses inside FortiX's Verification Engine itself**.

### 0.1 Resolved Runtime & Test Blockers (`FTX-REL-P0-P1-RUNTIME-001`, commit `799436e`)
Several defects cited in earlier baseline assessments are now **resolved and verified locally**:
- **Docker Worker Node 22 Crash (`D-01`)**: Fixed. `npm run build` bundles `dist/worker.cjs`; `docker-compose.yml` executes `["node", "dist/worker.cjs"]` without `tsx` or `--loader`.
- **Playwright / Vitest Collision & Stale E2E Specs (`D-02`, `D-03`)**: Fixed. `playwright.config.ts` isolates `**/*.spec.ts`, `expect(true).toBe(true)` is removed from `tests/security/ws.spec.ts`, and `10/10` Playwright E2E/security/chaos/report specs pass.
- **Vite Port `24678` Leak & Incomplete Shutdown (`D-04`, `D-05`)**: Fixed. Vite runs with `ws: false`, `listenWithBoundedRetry()` fails fast on occupied ports, and `executeGracefulShutdown()` closes HTTP, Socket.IO, Vite, `demo-api`, telemetry loops, BullMQ handles, Redis, and PostgreSQL cleanly.
- **Readiness & Queue Metadata Drift (`D-06`, `D-07`)**: Fixed. `/health/ready` and `/api/health/ready` share an identical contract; `test-results/vitest-summary.json` records `230/230` passing Vitest tests across `31` suites.

### 0.2 Genuine Remaining Gaps Blocking the Central Product Promise
1. **Infrastructure Gap (`FTX-REL-P2-PERSISTENCE-001`)**:
   - Automated tests in the preview sandbox still execute against `pg-mem` and `ioredis-mock`. Live PostgreSQL (`DATABASE_URL`, `FORCE ROW LEVEL SECURITY`), live Redis (`REDIS_URL`, `fail-closed` distributed token bucket, BullMQ worker durability), and `docker compose up --build` on a Docker host remain unverified.
2. **Verification Engine Rigor Gap (`FTX-CORE-VERIFY-001` — Critical Product Finding)**:
   - Code inspection of `src/verification/engine.ts` and `src/autonomous/engine.ts` reveals that FortiX's centerpiece **Verification Engine** currently contains weak/tautological pass conditions that would undermine a live technical defense if left unaddressed:
     - **Async Telemetry Race (`src/experiments/worker.ts` → `src/verification/engine.ts`)**: `verifyPolicy()` queries `metric_logs` immediately after `runProxyTrafficBurst()` without awaiting a Redis Stream telemetry flush (`processTelemetryBatch()`), risking `total = 0` observed samples.
     - **Vacuous Rate-Limit Pass (`src/verification/engine.ts:42–46`)**: `if (rejected >= expectedRejected - 10) verdict = 'PASSED'` evaluates to `PASSED` even when `total === 0` or `rejected === 0` if `total <= rateLimitRpm + 10`.
     - **Hardcoded / Tautological Checks (`src/autonomous/engine.ts:438–456`)**: `WAF & Injection Mitigation` hardcodes `passed: true`, and `Rate Limit Token Bucket Enforcement` checks `blockedRequests >= 0` (always true for any non-negative integer).
     - **Missing Explicit Baseline Stage**: `verifications` stores `{ expected, observed, verdict }` for the experiment window but does not yet record a pre-experiment **Baseline Window** (`baselineP50Ms`, `baselineP95Ms`, `baselineErrorRate`) alongside **Experiment Window** and **Post-Experiment Recovery Window** metrics.

> **Strategic Implication:** Fixing `FTX-CORE-VERIFY-001` (making the verification engine mathematically honest: *Configure → Baseline → Break → Observe → Verify → Evidence*) and `FTX-REL-P2-PERSISTENCE-001` (real PostgreSQL + Redis) is worth infinitely more before 16 November than adding any new UI surface or feature module.

---

## 1. Deliverable 1 — Competitor Feature & Positioning Comparison (Day 1 — Completed)

### 1.1 Seven-Dimension Competitive Matrix

| Dimension | 42Crunch | Escape.tech | StackHawk | Gremlin | Steadybit | FortiX (Target Niche) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Exact Problem Solved** | OpenAPI contract security auditing (SAST), conformance scanning, and schema-enforcing micro-firewall | Agentless API surface discovery (ASM) and automated business-logic DAST (BOLA/IDOR, GraphQL/REST) | Developer-first CI/CD DAST scanning (OWASP ZAP engine) to catch API/web vulnerabilities on PRs | Enterprise reliability management, host/container/network fault injection, and service reliability scoring | Architecture-aware resilience testing, dependency discovery, and automated chaos experiment templates | **Continuous verification that configured API security & resilience controls (rate limits, authz, WAF, timeouts, recovery) actually enforce policy under live load & faults** |
| **2. Primary Buyer** | AppSec architects & enterprise API platform leads | AppSec teams & security-conscious SaaS engineering leads | Engineering managers & DevSecOps teams shifting DAST into CI | VP Engineering, SRE directors, enterprise platform teams | Platform engineering & SRE teams in mid-to-large Kubernetes/cloud orgs | **Academic MVP:** Technical evaluators / SRE & AppSec reviewers<br>**Commercial Hypothesis:** SMB/Mid-market SaaS platform & AppSec leads |
| **3. How It Tests Security or Resilience** | Static scoring (0–100) of OpenAPI/GraphQL specs + live contract conformance fuzzing + runtime JSON schema allowlisting | Multi-session stateful crawling & AI-guided BOLA/BFLA/authz mutation probes against staging/prod APIs | Active HTTP security scanning configured via `stackhawk.yml` on build/PR pipelines | OS/container/network agents inject CPU, memory, DNS, packet-loss, latency, and host shutdowns against "Golden Signals" | Kubernetes/host agents inject container, network, and cloud faults mapped via Landscape Explorer | Dispatches authenticated baseline traffic, concurrent rate-limit bursts, security probes, and upstream latency/`5xx`/timeout faults, then verifies observed telemetry against policy thresholds |
| **4. Key Integrations** | VS Code, GitHub Actions, GitLab, Jenkins, Azure Marketplace, inline micro-firewall | GitHub Actions, GitLab CI, CircleCI, OpenAPI `/v3`, Postman, Jira/Slack | GitHub Actions, GitLab, Jenkins, CircleCI, Jira, Slack, OpenAPI, GraphQL, gRPC | AWS, Kubernetes, Datadog, Dynatrace, New Relic, PagerDuty, Prometheus | Kubernetes, AWS/GCP/Azure, Datadog, Prometheus, Grafana, GitHub Actions, MCP | Integrated Express proxy gateway (Academic MVP); OpenAPI export, Prometheus `/metrics`, signed webhooks |
| **5. Evidence Produced** | Contract audit score (0–100), SARIF/CI build gates, conformance violation logs | Vulnerability findings with request/response replay traces & remediation guidance | PR failure comments, cURL reproduction commands, compliance summaries | Service Reliability Score (0–100), GameDay run logs, Golden Signal pass/fail | Experiment execution reports, reliability gap advice, timeline logs | Deterministic pass/fail check table, P50/P90/P95/P99 latency & status distributions, SHA-256 hashed PDF & JSON evidence artifacts |
| **6. Pricing Model** | Individual: ~$9–$20/mo<br>Team: ~$349–$599/mo<br>Enterprise: Custom quote (required for runtime API Firewall) | Free developer tier (single API); custom sales-quoted tiers scaled by target/app count | Wingman: ~$10/dev/mo<br>Secure: ~$39–$49/contributor/mo<br>Scale/Enterprise: ~$59+/contributor/mo (annual) | Custom enterprise quote (historically agent/service/target-based; AWS Marketplace PoCs) | Custom Professional & Enterprise quotes (unlimited users/experiments; billed per network/environment layout) | Unvalidated (Day 5 pilot discovery required before setting commercial pricing) |
| **7. What It Does NOT Do** | Does **not** inject upstream latency/`5xx` chaos faults, test gateway timeout recovery, or prove token-bucket rate limiting under concurrent bursts | Focuses on vulnerability discovery (BOLA/injection); does **not** verify upstream failover, timeout enforcement, or post-fault recovery SLAs | Finds exploitable DAST bugs in app code; does **not** run chaos fault injection or prove operational resilience/rate-limit behavior under burst load | Infrastructure/SRE-heavy; requires installing host/container agents and external APM; does **not** verify API-layer WAF, BOLA, or API-key authz controls | Requires infrastructure agents & cluster integration; does **not** test API security controls (WAF, API key revocation, tenant authz, SSRF) | **Current Commercial Blocker:** Requires routing traffic through FortiX's proxy gateway rather than verifying policies against a customer's existing Kong / AWS API Gateway / NGINX / Envoy deployment |

### 1.2 Key Competitive Takeaway (The Honest Differentiation Boundary)
1. **Security tools (`42Crunch`, `Escape`, `StackHawk`)** test *vulnerabilities and schema conformance*, but they treat operational resilience controls (rate-limit accuracy under concurrency, upstream timeout enforcement, `5xx` circuit/recovery behavior) as out of scope.
2. **Chaos tools (`Gremlin`, `Steadybit`)** test *infrastructure & network failure modes*, but require heavy cluster/host agents, enterprise budgets, and external APM wiring—and ignore API-layer security controls (authz isolation, API key revocation, WAF/SSRF blocking).
3. **Where FortiX Can Win Academically vs. Commercially**:
   - **Academically (by 16 Nov)**: Demonstrating unified **Security + Resilience Control Verification** with reproducible cryptographic PDF/JSON evidence in one self-contained system is a clear `9/10` capstone narrative.
   - **Commercially (post-16 Nov)**: Requiring a SaaS company to replace Kong, AWS API Gateway, or Cloudflare with FortiX's gateway is a **non-starter** for adoption. A commercial FortiX product would need an **agentless/external runner mode** (pointing FortiX's verification runner + telemetry adapter at an *existing* staging API gateway) rather than forcing proxy migration.

---

## 2. Deliverables 2 & 3 — Customer Discovery Protocol & Ledger (Days 2–3 — Pending Human Execution)

> **Integrity Rule:** Zero interviews are fabricated in this document. All rows below remain `PENDING` until conducted with real practitioners between **31 October and 2 November 2026**.

### 2.1 Target Interview Quota (`0 / 12–15 Completed`)

| Cohort | Target Count | Completed | Target Profile | Primary Hypothesis to Test |
| :--- | :---: | :---: | :--- | :--- |
| **Backend / Platform Engineers** | 5 | 0 | Engineers operating REST/GraphQL APIs at 10–250 person SaaS companies | Do they manually write brittle `k6`/bash scripts—or skip testing altogether—when verifying rate limits, timeouts, and authz boundaries? |
| **CTOs / Engineering Leads** | 3 | 0 | Decision-makers at API-heavy startups (Fintech, B2B SaaS, HealthTech) | Have control regressions caused customer incidents or failed security questionnaires/SOC 2/CERT-In audits? |
| **AppSec / Security Consultants** | 3 | 0 | In-house AppSec engineers or external pentest/audit practitioners | Would automated, repeatable control-verification PDF/JSON evidence save manual engagement hours? |
| **SRE / DevOps Engineers** | 2–4 | 0 | Engineers managing Kong, AWS API Gateway, Envoy, NGINX, or Cloudflare | Why aren't they using Gremlin/Steadybit/StackHawk to verify gateway policies today (cost, setup friction, or low priority)? |

### 2.2 Non-Leading Interview Script ("Mom Test" Compliant)
*Never pitch FortiX during the first 15 minutes. Never ask "Would you use FortiX?" Ask only about past behavior, concrete incidents, current tooling, and actual spend.*

1. **Current Control Verification Reality**: *"Walk me through the last time your team changed an API rate limit, timeout, or authz middleware. How did you verify it actually worked before or after deploying?"*
2. **Past Failure Incident**: *"When was the last time you discovered in production or staging that a security control or timeout/retry setting wasn't behaving the way the config said it should? What happened?"*
3. **Concurrency & Upstream Failure Testing**: *"How do you currently test what happens to your API when an upstream dependency slows down to 2–5 seconds or returns `503`s while concurrent client traffic is hitting it?"*
4. **Current Workaround & Time Cost**: *"What exact tools or scripts (`Postman`, `k6`, `curl`, `OWASP ZAP`, custom CI jobs) did you stitch together for that? Roughly how many engineering hours per month or per release go into maintaining or running those checks?"*
5. **Audit & Evidence Pain**: *"Do customers, enterprise security reviews, or compliance auditors (SOC 2, ISO 27001, RBI/CERT-In) ever ask you for proof that rate limiting, tenant isolation, and failover controls were tested? What do you send them today?"*
6. **Budget & Adoption Friction**: *"Have you evaluated or paid for tools like StackHawk, Escape, 42Crunch, Gremlin, or Steadybit? What stopped you from adopting them—or what frustrates you about them? What would immediately disqualify a new verification tool (e.g., inline proxy requirement, production risk, pricing)?"*

### 2.3 Interview Recording Ledger (Template for Member 3)

| ID | Date | Role & Company Size (Anonymized OK) | Gateway / Stack Used | Described Recurring Problem? (Y/N) | Existing Workaround / Spend? | Proxy Replacement Blocker? | Open to Staging Pilot? (Y/N) | Key Verbatim Quote |
| :--- | :--- | :--- | :--- | :---: | :--- | :---: | :---: | :--- |
| `INT-01` | *Pending* | — | — | — | — | — | — | — |
| `INT-02` | *Pending* | — | — | — | — | — | — | — |
| `INT-03` | *Pending* | — | — | — | — | — | — | — |

---

## 3. Deliverable 4 — Day 4 Proof-of-Value Demonstration Runbook

When demonstrating FortiX (both for **Day 4 commercial pilot conversations** and the **16 November academic evaluation**), **do not tour 15 sidebar tabs**. Run one deterministic 3-minute proof:

### Scenario: *"Does this API actually enforce its rate limit and upstream timeout policy, and recover cleanly?"*

1. **Configure (`POST /api/control/routes` & `POST /api/control/policies`)**:
   - Register authorized target API route and attach explicit policy (`rateLimitRpm: 20`, `enableWaf: true`, `enableSsrf: true`, gateway upstream timeout `200ms`–`600ms`).
2. **Establish Baseline**:
   - Send 10 sequential authenticated requests (`X-API-Key`). Record baseline `200 OK` rate (`100%`) and baseline P50/P95 latency (`< 50ms`).
3. **Execute Controlled Experiment #1 — Concurrent Rate-Limit Burst**:
   - Dispatch 30 concurrent requests against `/proxy/:routeId`.
   - **Observe & Verify**: Confirm accepted count matches token-bucket burst allowance (`<= 20`) and excess requests are deterministically rejected with `429 Too Many Requests` (`>= 10`).
4. **Execute Controlled Experiment #2 — Bounded Upstream Latency / `503` Fault (`POST /api/control/experiments`)**:
   - Inject `800ms` upstream latency (or `error_5xx`) for `5000ms` on Route A while keeping sibling Route B untouched.
   - **Observe & Verify**: Confirm Route A enforces timeout/fault policy (`504`/`503` or bounded latency delta), sibling Route B remains isolated (`200 OK`, `< 100ms`), and Route A automatically resumes `200 OK` within `1s` after experiment completion/cleanup.
5. **Produce Evidence (`GET /api/control/verifications` & `POST /api/control/reports/:verificationId`)**:
   - Export the SHA-256 checksummed PDF/JSON verification artifact comparing **Configured Policy vs. Baseline vs. Experiment Observation vs. Recovery Verdict (`PASSED` / `FAILED`)**.

---

## 4. Deliverables 5 & 6 — Pilot Qualification & Go / Pivot / No-Go Decision Gates (Day 5)

### 4.1 Objective Commercial Scorecard (Evaluate on 4 November 2026)

| Metric | Target Threshold | Actual Result (Fill on Day 5) | Status |
| :--- | :---: | :---: | :---: |
| Qualified practitioner interviews completed | **12–15** | `0` *(Pending)* | `UNVERIFIED` |
| Interviewees independently describing a recurring control-verification pain | **8+** | `0` *(Pending)* | `UNVERIFIED` |
| Teams showing active workarounds (custom `k6`/CI scripts) or existing tool spend | **5+** | `0` *(Pending)* | `UNVERIFIED` |
| Prospects agreeing to a concrete staging pilot discussion | **3+** | `0` *(Pending)* | `UNVERIFIED` |
| Qualified prospect committing to a paid pilot or formal procurement evaluation | **1+** | `0` *(Pending)* | `UNVERIFIED` |

### 4.2 Binding Decision Matrix

- **GO (Investigate Commercial MVP *after* 16 Nov submission)**: All 5 thresholds met, **and** prospects confirm whether agentless external target testing (against Kong / AWS API Gateway / NGINX without proxy replacement) is required.
- **PIVOT POSITIONING / DELIVERY MODE**: `8+` confirm recurring pain, `0` will route production/staging traffic through a third-party gateway, **but** `3+` would run FortiX as an **agentless CI/staging verification CLI + evidence reporter** against their existing gateway.
- **NO-GO ON COMMERCIAL STARTUP (Complete Academic Capstone Only)**: `< 6` interviewees report recurring pain, or prospects confirm existing `k6` + `StackHawk` / `Postman` workflows already satisfy their needs at zero switching cost.

---

## 5. Binding Academic Scope Freeze (30 October – 16 November 2026)

To guarantee a **9.5+/10 B.Tech Capstone Defense** on **16 November 2026**, FortiX is under an **immediate feature freeze** outside the core Control Verification workflow:

| Capability | Codebase Surface | Binding Decision | Required Action Before 16 Nov |
| :--- | :--- | :--- | :--- |
| **API Gateway & SSRF Protection** | `src/gateway/index.ts`, `src/gateway/ssrf.ts` | **KEEP (Frozen)** | Maintain existing proxy, DNS-rebinding SSRF guard, and upstream timeout handling. |
| **Auth, RBAC, Tenant Isolation & API Keys** | `src/api/auth.ts`, `src/api/keys.ts`, `src/middleware/` | **KEEP (Frozen)** | Verify PostgreSQL `FORCE ROW LEVEL SECURITY` on live Postgres (`FTX-REL-P2-PERSISTENCE-001`). |
| **Distributed Rate Limiting & WAF** | `src/rate-limit/redis.ts`, `src/services/SecurityGuard.ts` | **KEEP (Frozen)** | Verify Lua token-bucket behavior against live Redis (`fail-closed`). |
| **Latency & HTTP `5xx` / Timeout Experiments** | `src/experiments/`, `src/worker.ts` | **PERFECT IT** | Verify BullMQ worker execution, cancellation, and automatic fault cleanup on live Redis. |
| **Verification Engine & Baseline Comparison** | `src/verification/engine.ts`, `src/autonomous/engine.ts` | **MAKE THIS THE CENTERPIECE** | **Fix `FTX-CORE-VERIFY-001`:** Flush telemetry before evaluation, capture pre-experiment baseline, remove hardcoded `passed: true` / `blockedRequests >= 0` tautologies, and verify post-fault recovery. |
| **Reproducible Evidence Reports (PDF/JSON)** | `src/api/reports.ts`, `src/storage/` | **KEEP & ALIGN** | Include Baseline vs. Experiment vs. Recovery measurements and SHA-256 integrity hash in generated evidence. |
| **AI Advisory Recommendations** | `src/ai/analyzer.ts` | **DEFER (No Expansion)** | Keep strictly read-only/optional; deterministic verification must succeed with zero LLM dependency. |
| **Public API Directory (814 entries), Topology, Kubernetes, Multi-Region, Extra Chaos Types** | `src/api/topology.ts`, `src/api/resources.ts`, UI extras | **DEFER / FREEZE** | Zero new engineering hours. Do not expand or showcase in primary demo flow. |
