# FortiX Defense Package & Viva Preparation

## 1. Presentation Structure (10-15 Minutes)

*   **Slide 1: Title & Abstract.** FortiX - Bridging WAF and Chaos Engineering.
*   **Slide 2: The Problem.** WAFs block, Chaos breaks, but nothing *proves* the overlap mathematically.
*   **Slide 3: The Philosophy.** Protect → Observe → Break → Measure → Prove.
*   **Slide 4: Architecture Diagram.** Node.js Gateway -> Redis Buffer -> Postgres Warehouse.
*   **Slide 5: Live Demo.** (See Checklist below).
*   **Slide 6: Engineering Highlights.** Asynchronous Telemetry & Strict Tenant Isolation.
*   **Slide 7: Verification.** The PDF evidence artifact.
*   **Slide 8: Limitations & Future Work.** Single-node worker MVP vs. multi-region Kubernetes.
*   **Slide 9: Q&A.**

---

## 2. Live Demo Checklist

1.  **Start Stack:** Run `docker compose up -d` in the terminal.
2.  **Verify Health:** Hit `http://localhost:3000/health/ready` to show DBs are connected.
3.  **Protect:** Create a Project and an API Route. Attach a Rate Limit policy.
4.  **Attack (WAF):** Send a request with `?id=1 UNION SELECT` -> Show 403 Forbidden.
5.  **Observe:** Open WebSocket dashboard. Show the `security_events` streaming in real-time.
6.  **Break:** Create a Chaos Experiment adding `+500ms` latency to the route.
7.  **Measure:** Send normal traffic. Show it now takes ~500ms.
8.  **Prove:** Trigger the verification endpoint. Download and open the generated PDF evidence showing the exact latency P50/P95 shifts.

---

## 3. Likely Viva Questions & Defensible Answers

**Q1: Why did you use Redis for the telemetry pipeline instead of inserting directly into PostgreSQL?**
> *Defensible Answer:* Node.js is single-threaded. If the gateway blocks on a slow PostgreSQL `INSERT` for every HTTP request, our proxy latency skyrockets. By using `LPUSH` into an in-memory Redis list, the gateway unblocks in microseconds. A background worker pulls from Redis and bulk-inserts into Postgres, achieving high throughput without impacting user-facing latency.

**Q2: How does FortiX prevent Insecure Direct Object Reference (IDOR) or BOLA?**
> *Defensible Answer:* Absolute deterministic isolation. Every control plane request passes through a JWT middleware extracting the `userId`. Before modifying any route, policy, or experiment, the database layer actively checks `WHERE project_id = X AND user_id = Y`. Furthermore, WebSockets require JWTs, and users can only subscribe to rooms they cryptographically own.

**Q3: How do you prevent SSRF (Server-Side Request Forgery) in your proxy?**
> *Defensible Answer:* Before `http-proxy-middleware` routes the traffic, FortiX intercepts the target URL. We parse the hostname and explicitly deny routing to internal loopback addresses (`127.0.0.1`, `localhost`, `169.254.169.254`), preventing external attackers from scanning our internal network interfaces.

**Q4: Why store API keys using `bcrypt`? Why not symmetric encryption?**
> *Defensible Answer:* API Keys are essentially passwords for machines. If our database is compromised, symmetric encryption is useless if the attacker also steals the encryption key (often stored in the same environment). By using a one-way `bcrypt` hash, even a full database dump does not allow the attacker to impersonate our clients. The raw key is shown only once at generation.

**Q5: What happens if Redis goes down?**
> *Defensible Answer:* FortiX is engineered to "fail-open" for telemetry but "fail-closed" for security. If Redis crashes, rate-limiting will fail (defaulting to allow traffic), and telemetry buffers will drop. However, core WAF rules and authentication (backed by Postgres) will continue to protect the downstream systems.

**Q6: What are the limitations of this system in a production enterprise environment?**
> *Defensible Answer:* As a deployable MVP, FortiX runs the telemetry worker inside the same Node.js process as the HTTP gateway, and utilizes a single Redis instance. For true enterprise scale, the worker should be a separate Kubernetes pod, and Redis should be upgraded to a highly available Redis Cluster or Sentinel setup to prevent single points of failure.

**Q7: How is the PDF evidence mathematically proven?**
> *Defensible Answer:* The Chaos engine stamps a unique `experimentId` on telemetry generated during its window. The Verification Engine queries PostgreSQL for `metric_logs` matching this ID, sorts the `latencyMs` array, and mathematically selects the middle value (P50) and the 95th percentile (P95). These exact metrics are embedded into the PDF, proving the data is derived from actual HTTP execution, not mocked estimates.

**Q8: Explain graceful shutdown in your architecture.**
> *Defensible Answer:* When the container receives a `SIGTERM`, it sets a flag causing `/health/live` to return 503, removing it from load balancers. It then signals the telemetry `while` loop to exit, allowing the final Redis batch to flush to Postgres. Finally, it closes the Redis connections and shuts down the Express HTTP server, preventing hanging sockets.
