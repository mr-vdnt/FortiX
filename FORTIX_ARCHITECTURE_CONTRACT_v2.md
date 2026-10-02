# FORTIX ARCHITECTURE CONTRACT V2
**Document Status:** FROZEN / AUTHORITATIVE
**Purpose:** Single source of truth for the production-grade FortiX platform architecture. All future backend, frontend, and infrastructure implementation MUST adhere strictly to this contract.

---

## 1. THE FIVE PLANES (SERVICE BOUNDARIES)

FortiX is logically divided into five isolated execution planes.

### 1.1 Control Plane (API & Dashboard)
*   **Responsibility:** Authentication, tenant management, policy configuration, credential generation.
*   **Data Access:** Read/Write to PostgreSQL.
*   **Security Domain:** Developer Authentication (JWT).

### 1.2 Data Plane (Gateway)
*   **Responsibility:** Request proxying, policy enforcement, rate limiting, threat interception, chaos injection.
*   **Data Access:** Read-only from local cache/Redis. **No synchronous PostgreSQL reads in the critical path.**
*   **Security Domain:** API Consumer Authentication (Hashed API Keys).

### 1.3 Observation Plane (Telemetry)
*   **Responsibility:** Asynchronous buffering, metrics aggregation, system logs.
*   **Data Access:** Write to Redis (Gateway) -> Read from Redis / Write to Postgres (Worker).

### 1.4 Experiment Plane (Chaos Engine)
*   **Responsibility:** Fault scheduling, blast radius execution, state management.
*   **Data Access:** Redis Pub/Sub for coordination, Postgres for configuration.

### 1.5 Verification Plane (Analytics)
*   **Responsibility:** Differential analysis (Baseline vs Experiment), P50/P95 math, PDF evidence generation.
*   **Data Access:** Read-heavy from PostgreSQL.

---

## 2. DATABASE ERD & DATA OWNERSHIP (POSTGRESQL)

PostgreSQL is the absolute system of record. 

### Core Entities & Relationships
*   **Users** (id, email, password_hash, created_at)
*   **Organizations** (id, name, owner_id -> Users)
*   **Projects** (id, org_id -> Organizations, name, environment)
*   **ApiRoutes** (id, project_id -> Projects, target_url, path_pattern)
*   **ApiKeys** (id, project_id -> Projects, key_prefix, secret_hash, name, purpose, scopes, expires_at, revoked_at)
*   **SecurityPolicies** (id, route_id -> ApiRoutes, rate_limit_rpm, enable_waf, enable_ssrf)
*   **Experiments** (id, route_id -> ApiRoutes, type, config, status, scheduled_for)
*   **MetricLogs** (id, route_id -> ApiRoutes, experiment_id [nullable], request_id, latency_ms, status_code, timestamp)
*   **SecurityEvents** (id, route_id -> ApiRoutes, request_id, threat_type, payload, timestamp)
*   **Verifications** (id, experiment_id -> Experiments, expected, observed, verdict, pdf_s3_url)

---

## 3. AUTHENTICATION & CREDENTIAL LIFECYCLE

There are TWO strictly separated security domains.

### 3.1 Developer Auth (Control Plane)
*   **Mechanism:** Email/Password -> Access Token (JWT) + Refresh Token.
*   **Access Token:** 15-minute expiration. Stateless.
*   **Refresh Token:** 7-day expiration. Stored in Postgres as an opaque hashed string. Can be explicitly revoked on logout or security breach.

### 3.2 Consumer Auth (Data Plane API Keys)
*   **Format:** \`fx_[env]_[key_id]_[random_secret]\` (e.g., \`fx_live_abc123_xYz789\`)
*   **Storage:** The database stores \`key_id\` in plaintext and a \`bcrypt\` hash of \`random_secret\`. The raw secret is NEVER stored and NEVER retrievable after initial creation.
*   **Lifecycle:**
    1.  **CREATE:** Raw secret displayed once to the user.
    2.  **ACTIVE:** Gateway executes \`bcrypt.compare(incoming_secret, db_hash)\`.
    3.  **ROTATE:** New key generated. Old key enters a 7-day grace period.
    4.  **REVOKE:** Status flipped to revoked. Gateway immediately blocks.

---

## 4. THE DATA FLOW (ASYNCHRONOUS PIPELINE)

**Rule:** PostgreSQL must NEVER block the Gateway's critical path.

### 4.1 Synchronous Path (Gateway Enforcement)
1. Request arrives.
2. Gateway verifies API Key (via Redis cache or fast DB lookup).
3. Rate Limiter (Redis Lua script via Token Bucket) evaluated.
4. WAF / SSRF analyzed in memory.
5. Experiment faults injected (if active in Redis).
6. Request proxied. Response received. Latency measured.
7. Gateway responds to client.

### 4.2 Asynchronous Path (Telemetry)
1. Gateway executes \`LPUSH fortix:telemetry:buffer { metric_data }\`.
2. Dedicated **Worker Container** executes \`LPOP\` in batches.
3. Worker bulk inserts into PostgreSQL.
4. PostgreSQL aggregates data via native SQL (\`date_trunc\`) for the UI.

---

## 5. EXPERIMENT STATE MACHINE

An experiment must follow a strict, immutable lifecycle:

1.  **CREATED:** Configured but not yet scheduled.
2.  **QUEUED:** Passed to Redis/BullMQ.
3.  **RUNNING:** Faults are actively being injected at the Gateway.
4.  **OBSERVING:** Faults stopped; system is recovering. Telemetry collected.
5.  **ANALYZING:** Verification Engine calculates Baseline vs. Attack metrics (P50/P95).
6.  **COMPLETED:** PASS/FAIL verdict rendered. PDF generated.
*   *(Alternative: **FAILED** if worker crashes, **CANCELLED** if aborted by user).*

---

## 6. ENGINEERING RULES FOR NEW FEATURES

Before any developer commits a line of code to FortiX v2, the feature must answer:
1.  **Where is the data stored?** (Postgres for Truth, Redis for Speed/Queue).
2.  **Who owns the data?** (Organization / Project boundary).
3.  **Who is allowed to access it?** (RBAC / Scopes).
4.  **What happens when the operation fails?** (Redis down = Fail Open or Closed? Worker crash = Retry?).
5.  **How do we test it?** (Playwright isolation).
6.  **How do we prove it worked?** (Verification / PDF Evidence).
