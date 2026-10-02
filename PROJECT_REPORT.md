# FortiX: A Production-Engineered, Deployable MVP for API Security and Resilience Verification

## Abstract
Modern microservice architectures face a dual challenge: defending against active malicious threats (security) and surviving unpredictable transient failures (resilience). Traditional tools treat Web Application Firewalls (WAF) and Chaos Engineering as separate disciplines, leading to unverified assumptions about system behavior under duress. This project introduces **FortiX**, a unified platform that bridges active threat defense and proactive resilience validation. Engineered as a production-deployable MVP, FortiX sits as a reverse-proxy gateway, enforcing strict security policies (JWT authentication, bcrypt-hashed API keys, SSRF protection, regex-based WAF, and Redis-backed rate limiting) while simultaneously exposing a deterministic Chaos Engine. Telemetry is streamed asynchronously via a high-throughput Redis pipeline to a PostgreSQL data warehouse, where a Verification Engine computes P50/P95 latencies and error rates against expected baselines. The outcome is a mathematically sound, immutable PDF evidence report demonstrating the exact blast radius and recovery behavior of the API, proving the system's security and resilience posture.

---

## 1. Introduction

### 1.1 Problem Statement
In distributed systems, engineering teams often write security policies but lack the tooling to mathematically prove those policies hold up during infrastructure degradation. WAFs block attacks, but do they fail-open or fail-closed when their backing database slows down? Chaos tools break things, but do they provide cryptographic proof of the security matrix during the outage? 

### 1.2 Objectives
*   Develop a secure, multi-tenant API Gateway.
*   Implement strict security controls (Auth, SSRF, Rate Limiting, WAF).
*   Engineer a non-blocking, asynchronous telemetry pipeline.
*   Develop a Chaos Engine to deterministically inject latency and HTTP 5xx faults.
*   Build a Verification Engine to evaluate telemetry and produce immutable PDF evidence.

---

## 2. Existing System Analysis
*   **Traditional WAFs (e.g., AWS WAF, Cloudflare):** Excellent at edge protection but disconnected from application-level resilience testing.
*   **Traditional Chaos Tools (e.g., Gremlin, Chaos Mesh):** Excellent at infrastructure breaking, but rarely integrated directly into the L7 request pipeline to immediately verify authentication/WAF boundaries during faults.
*   **The Gap:** Lack of unified, evidence-based reporting that mathematically proves "Policy X held firm when Dependency Y failed."

---

## 3. Proposed System
FortiX operates on a five-pillar philosophy:
1.  **PROTECT:** Guard downstream APIs via strict, stateful proxy middleware.
2.  **OBSERVE:** Buffer request telemetry in memory (Redis) and flush asynchronously to disk (PostgreSQL).
3.  **BREAK:** Introduce targeted, scheduled faults via the Chaos Engine.
4.  **MEASURE:** Calculate P50, P95, and error rates (Blast Radius).
5.  **PROVE:** Generate immutable PDF reports comparing observed metrics against expected baselines.

---

## 4. System Architecture

FortiX is designed as a standalone, multi-tenant Node.js application.

```text
Client Request
      │
      ▼
┌──────────────────────────────────────────────┐
│ FortiX Gateway (Express.js)                  │
│  ├─ Auth Middleware (JWT/Bcrypt)             │
│  ├─ WAF / SSRF Filters                       │
│  ├─ Rate Limiter (Redis Lua Scripts)         │
│  ├─ Chaos Engine (Fault Injection)           │
│  └─ http-proxy-middleware ──► [Target API]   │
└────────────┬─────────────────────────────────┘
             │ (Async Push)
             ▼
┌──────────────────────────────────────────────┐
│ Redis Buffer (Lists)                         │
└────────────┬─────────────────────────────────┘
             │ (Background Worker LPOP)
             ▼
┌──────────────────────────────────────────────┐
│ PostgreSQL Data Warehouse (Drizzle ORM)      │
└────────────┬─────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────┐
│ Verification Engine & PDFKit Reporter        │
└──────────────────────────────────────────────┘
```

---

## 5. Detailed Module Architecture

### 5.1 API Gateway
Built on `express` and `http-proxy-middleware`, the gateway intercepts all incoming traffic to registered routes. It parses headers, enforces policies, proxies the request, and calculates the exact `latencyMs` upon the response `finish` event.

### 5.2 Security & Threat Detection
*   **Authentication:** JWT validation ensures control plane isolation.
*   **API Keys:** Client tokens are hashed via `bcrypt` and stored in PostgreSQL. Raw keys are never stored.
*   **SSRF Protection:** Middleware intercepts the target URL and statically denies resolution to loopback addresses (`127.0.0.1`, `localhost`, `169.254.169.254`).
*   **WAF:** Regex-based payload and query inspection to detect and block common SQLi (`UNION SELECT`, `OR 1=1`) and XSS (`<script>`) vectors.

### 5.3 Asynchronous Telemetry
To prevent Node.js event-loop exhaustion, telemetry is not written directly to PostgreSQL.
1.  Request finishes -> Metadata pushed to Redis via `LPUSH`.
2.  A local asynchronous worker runs `setInterval`, pulling chunks via `LPOP`.
3.  The worker bulk-inserts into PostgreSQL via Drizzle ORM.

### 5.4 Chaos Engine
Executes predefined experiments against specific routes:
*   **Latency:** `await new Promise(r => setTimeout(r, ms))` before proxying.
*   **Errors:** Immediately terminates the request with a `503 Service Unavailable`.

### 5.5 Verification & Reporting
Upon experiment completion, the engine aggregates `metric_logs`. It sorts latencies to determine the 50th (P50) and 95th (P95) percentiles. It compares these against the `security_policies` baseline to generate a definitive `PASS/FAIL` verdict, finalized via a `pdfkit` generated PDF stream.

---

## 6. Database Design (PostgreSQL Schema)

*   `users`: ID, Email, PasswordHash, Role.
*   `projects`: Tenant isolation boundary (Foreign Key to users).
*   `api_routes`: Registered downstream endpoints.
*   `api_keys`: Hashed access keys mapped to projects.
*   `security_policies`: Configured constraints (Rate Limit, IP Deny).
*   `experiments`: Chaos engineering schedules.
*   `metric_logs`: High-volume request telemetry.
*   `security_events`: High-priority WAF blocks and limit triggers.

---

## 7. Real-Time Observability
FortiX utilizes `socket.io` to stream `security:event` payloads to the frontend dashboard.
*   **Tenant Isolation:** Clients must emit `subscribe:project`. The server validates the user's JWT against the `projects` table ownership records before allowing the socket to join the room, eliminating BOLA/IDOR vulnerabilities.

---

## 8. Deployment & Graceful Shutdown
FortiX is deployed via Docker Compose:
*   Multi-stage Dockerfile ensures minimal production image size.
*   `depends_on` conditions ensure PostgreSQL and Redis are ready before the Gateway starts.
*   **Graceful Shutdown:** `SIGTERM` signals cause the server to return `503` on `/health/live`, instructs the telemetry worker to flush final Redis batches, and cleanly terminates database connections.

---

## 9. Limitations & Future Scope
As a "production-engineered, deployable MVP," FortiX makes calculated trade-offs:
1.  **Single-Process Worker:** The telemetry worker currently runs inside the Node.js Express process. *Future Scope:* Detach into a standalone microservice to scale independently of HTTP traffic.
2.  **Single-Node Redis:** Uses a standard Redis instance with AOF persistence. *Future Scope:* Upgrade to Redis Cluster for high availability.
3.  **Regex WAF:** Signature-based WAFs are susceptible to bypass. *Future Scope:* Semantic analysis or ML-based payload anomaly detection.

---

## 10. Conclusion
FortiX successfully demonstrates that security enforcement and chaos engineering can be unified. By strictly separating the synchronous blocking path (Gateway) from the asynchronous observability path (Redis/PostgreSQL), it maintains high throughput. The ultimate deliverable—immutable PDF evidence—provides undeniable proof of a system's resilience posture, fulfilling the mandate of modern adversarial engineering.
