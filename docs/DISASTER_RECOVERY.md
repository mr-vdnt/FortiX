# FortiX Platform — Disaster Recovery & Operational Runbook

## 1. Overview & Architecture Scope
FortiX is an API Security & Resilience Verification Platform operating as a modular monolith with isolated background workers, backed by PostgreSQL (Core System DB) and Redis (Distributed Rate Limiting, Stream Telemetry, and Pub/Sub).

---

## 2. Infrastructure Incident Response & Recovery Matrix

| Component | Failure Mode | Impact | Automated Fallback | Recovery Procedure |
|---|---|---|---|---|
| **Redis** | Crash / Network Drop | Distributed token bucket, key invalidation Pub/Sub, live stream | In-memory token bucket degrades locally to maintain security rate limits. Telemetry worker pauses stream ingestion without dropping API traffic. | 1. Restart Redis container (`docker compose restart redis`).<br>2. Redis auto-reconnects in `src/redis.ts`.<br>3. Pub/Sub key revocation channel auto-resubscribes. |
| **PostgreSQL** | Storage exhaustion / Process down | Auth, policy lookup, new metric writes fail | Health endpoints (`/api/health/ready`) return degraded state. API proxy denies unauthorized requests (fails safe). | 1. Check storage and restart PostgreSQL.<br>2. Run migration check `npm run db:migrate`.<br>3. Verify connection pool restored via `/api/health`. |
| **BullMQ Worker** | Unhandled job crash / OOM | Background experiment or webhook jobs stall | Stalled jobs auto-recovered by BullMQ active lock renewers. Exhausted attempts (>5) routed to Dead-Letter Queue. | 1. Inspect DLQ records via `/api/control/dlq`.<br>2. Resolve upstream endpoint issue.<br>3. Trigger authorized DLQ replay via `POST /api/control/dlq/replay/:id`. |
| **API Gateway** | Process crash | Ingress traffic dropped | Process supervisor (Docker / PM2 / K8s) restarts server container. Health probe `/api/health/live` restores traffic. | 1. Container auto-restart.<br>2. In-memory API key cache repopulated on-demand from DB. |
| **Artifact Storage** | Local Disk / S3 outage | PDF reports cannot be downloaded | Report generator logs error and queues notification. Database keeps SHA-256 hash. | 1. Reconnect S3/Local volume.<br>2. Trigger regeneration from verification metadata. |

---

## 3. Database Backup & Restore Procedures

### 3.1 Point-in-Time Backup
```bash
# Execute compressed PostgreSQL dump with custom format
pg_dump -U fortix -h localhost -F c -b -v -f "/backups/fortix_db_$(date +%Y%m%d_%H%M%S).dump" fortix_db
```

### 3.2 Database Restore
```bash
# 1. Stop active worker and API traffic
docker compose stop worker api

# 2. Restore schema and data from backup
pg_restore -U fortix -h localhost -d fortix_db -v -c "/backups/fortix_db_<TIMESTAMP>.dump"

# 3. Run migrations to reconcile any delta
npm run db:migrate

# 4. Restart services
docker compose start api worker
```

---

## 4. Dead-Letter Queue (DLQ) Operational Protocol
1. **Audit Failed Jobs:** Query `/api/control/dlq` with project bearer token.
2. **Inspect Failure Reason:** Inspect `failedReason`, `stacktrace`, and `attemptsMade`.
3. **Replay Job:** Issue `POST /api/control/dlq/replay/:id` once remote endpoint is restored.
4. **Purge Resolved Jobs:** Issue `DELETE /api/control/dlq/:id` to clear resolved entries.

---

## 5. Security Emergency Runbook: API Key Revocation
In the event of a compromised API key:
1. Revoke key via `DELETE /api/control/keys/:id` or Control Plane UI.
2. The system publishes an invalidation event to Redis Pub/Sub channel `fortix:key-revocation`.
3. All distributed gateway nodes immediately evict the key from their local in-memory caches within < 10 milliseconds.
4. Verify rejection by sending test request with revoked key (receives `HTTP 401 Unauthorized`).
