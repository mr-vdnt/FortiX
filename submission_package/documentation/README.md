# FortiX: Adversarial Chaos Engineering & WAF Platform

FortiX is an advanced web application firewall (WAF) and chaos engineering platform designed to deterministically test, observe, and enforce security policies across complex microservices. It bridges the gap between active threat defense (protect) and proactive resilience validation (break), allowing engineering teams to mathematically prove their security posture under duress.

## The Core FortiX Philosophy

> **PROTECT → OBSERVE → BREAK → MEASURE → PROVE**

1. **Protect**: FortiX sits in front of your applications as a reverse proxy, enforcing strict security controls including Rate Limiting, IP Denylists, SQLi/XSS inspection, and API Key Validation.
2. **Observe**: Every request and enforcement action is buffered through an asynchronous, high-throughput Redis pipeline and persisted to a PostgreSQL data warehouse.
3. **Break**: Using the Chaos Engine, engineers can schedule isolated latency, error (5xx), or timeout faults against specific API routes.
4. **Measure**: FortiX calculates P50/P95 latencies and error rates to determine the blast radius of chaotic experiments.
5. **Prove**: The deterministic Verification Engine compares the observed results against the expected policy baselines, generating a definitive PASS/FAIL score and a downloadable PDF evidence report.

---

## 🏛 Architecture

```text
Client
   ↓
FortiX Gateway (Node.js/Express)
   ├── Authentication (JWT)
   ├── API Key Validation (bcrypt)
   ├── Authorization (RBAC)
   ├── WAF / Threat Detection (SQLi, XSS, SSRF)
   ├── Rate Limiting
   ├── Fault Injection (Chaos Engine)
   └── Telemetry Buffer (Redis)
          ↓
       Redis
       ├── Rate-limit state
       └── Telemetry buffers
              ↓
        Background Worker (Async DB Flusher)
              ↓
          PostgreSQL (Drizzle ORM)
              ↓
     Verification Engine (Analysis)
              ↓
       Security/Resilience Score
              ↓
        Evidence Report (PDF Generation)
```

## 🛠 System Components & Data Flow

### 1. The Gateway
The gateway uses `http-proxy-middleware` to reverse-proxy traffic to downstream targets. Before routing, requests pass through a strict middleware chain:
* **Route Resolution**: Matches the incoming request path against the configured database schema.
* **Authentication/API Key Check**: Validates the `X-API-Key` using constant-time hash comparisons (bcrypt) against the database.
* **WAF Inspection**: Analyzes query parameters and payloads for SQL Injection or Cross-Site Scripting patterns.
* **SSRF Protection**: Verifies that the target proxy URL is not a local loopback (`127.0.0.1`, `localhost`), preventing internal network enumeration.

### 2. Telemetry Pipeline
To prevent the gateway's event loop from blocking under high load, FortiX uses an **Asynchronous Telemetry Pipeline**:
* Gateway events are immediately serialized and pushed to Redis Lists (`LPUSH`).
* A background telemetry worker continuously polls Redis (`LPOP`) in batches and performs bulk inserts into PostgreSQL.
* This guarantees that logging overhead does not impact proxy latency.

### 3. Chaos Engine
The Chaos Engine intercepts requests *after* security checks but *before* proxying to the downstream target. It applies rules defined in the `experiments` table:
* **Latency Injection**: Introduces artificial delays (e.g., +500ms).
* **Fault Injection**: Immediately returns HTTP 5xx errors to simulate downstream outages.

### 4. Verification Engine & Reporting
Post-experiment, the Verification Engine aggregates the telemetry. It calculates the P50 and P95 response times and error rates, comparing them against the expected baseline.
* It generates a PASS/FAIL verdict.
* The `/api/control/reports/:verificationId` endpoint generates a cryptographic PDF report serving as immutable evidence of the experiment's outcome.

---

## 🔒 Security Model

### Authentication & Authorization
* **JWT (JSON Web Tokens)**: Control plane operations (creating projects, routes, policies) require a valid JWT issued upon login.
* **Project Isolation**: All HTTP and WebSocket operations strictly verify that the authenticated user owns the target `projectId`. A user authenticated for Project A can **never** receive telemetry or modify configurations belonging to Project B (preventing IDOR/BOLA).
* **API Keys**: Stored solely as bcrypt hashes. The raw key is only shown once during creation.

### WebSocket Isolation
* WebSockets are used for real-time telemetry streaming and dashboard updates.
* The WebSocket handshake mandates a valid JWT token.
* Subscription to a specific project room (`subscribe:project`) executes a database lookup to confirm the socket user's ownership of the project before permitting the join operation.

---

## 🚀 Deployment Guide (Production)

FortiX is designed for production deployment using Docker and Docker Compose.

### Requirements
* Docker & Docker Compose
* PostgreSQL 15+
* Redis 7+

### Environment Variables
Configure the following in your production environment (never commit these):
```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://fortix:fortixpassword@postgres:5432/fortix_db
REDIS_URL=redis://redis:6379
JWT_SECRET=your-secure-jwt-secret
ENCRYPTION_KEY=32-byte-hex-string
```

### Running the Stack
The provided `docker-compose.yml` configures a complete production stack:
1. Multi-stage Docker build for the FortiX node app.
2. PostgreSQL database with persistent volume.
3. Redis cache with Append-Only File (AOF) persistence.
4. strict dependency checks (`depends_on: service_healthy`) ensuring the DB and Redis are up before the gateway starts.

```bash
docker compose up -d
```

### Graceful Shutdown & Health
* **Health Checks**: FortiX exposes `/health/live` (Liveness probe) and `/health/ready` (Readiness probe which actively pings Postgres and Redis).
* **Graceful Shutdown**: On receiving `SIGTERM`/`SIGINT`, the server stops accepting new connections, signals the background telemetry worker to flush its current batch and exit, closes the Redis connections, and exits cleanly.

---

## 🧪 Testing Strategy

FortiX employs rigorous Playwright-driven integration testing:
* **Security & Isolation (`tests/security/ws.spec.ts`, `tests/security/all.spec.ts`)**: Proves that tenants cannot cross project boundaries.
* **WAF Validation (`tests/security/auth.spec.ts`)**: Proves SQLi and API Key requirements are enforced and logged.
* **Evidence Generation (`tests/reports/report.spec.ts`)**: Proves PDF artifact generation accurately reflects the database state.

To run the full test suite locally:
```bash
npm run test:security
```

---

## ⚠️ Known Limitations & Future Work
* **Single Node Processing**: The telemetry worker currently runs in the same node process. For high-scale Kubernetes deployments, the worker should be detached into its own distinct container/pod pulling from the shared Redis cluster.
* **Redis High Availability**: The `docker-compose` setup uses a single Redis instance. Production multi-region deployments should utilize Redis Sentinel or Redis Cluster.
* **Advanced WAF Rules**: The current WAF engine uses regex-based pattern matching. A future iteration could integrate ML-based anomaly detection or deeper semantic analysis.
