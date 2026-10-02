# Architectural Design Decisions

### 1. Redis + Lua for Rate Limiting
**Decision**: Execute Token Bucket logic via atomic Lua scripts evaluated in Redis.
**Rationale**: Eliminates race conditions inherent in typical `GET -> Modify -> SET` operations under high-concurrency burst traffic.

### 2. BullMQ for Chaos Injection
**Decision**: Use an asynchronous worker queue (BullMQ) for experiment execution.
**Rationale**: Keeps the Express.js main event loop unblocked. Chaos experiments require exact timing and state management (e.g., scheduled start times, automatic recovery). A worker queue handles retries, stalling, and exact delays gracefully.

### 3. Database-Level Filtering (OOM Mitigation)
**Decision**: Execute aggregation and filtering via SQL (`inArray`) rather than fetching collections into Node.js arrays.
**Rationale**: Early prototypes loaded `SELECT * FROM metric_logs` to filter in-memory. This introduced an O(N) memory scaling vulnerability, jeopardizing the Control Plane during high-traffic load. Pushing operations to PostgreSQL resolved this entirely.

### 4. Drizzle ORM
**Decision**: Use Drizzle over Prisma or TypeORM.
**Rationale**: Drizzle offers zero-abstraction SQL generation, providing absolute predictability in performance and minimal bundle size.

### 5. Single-Process Gateway
**Decision**: Run the Control Plane and Gateway on the same Express application for the MVP.
**Rationale**: Simplifies deployment and demonstration while retaining the architectural capability to decouple them into microservices (sharing the same Postgres/Redis backend) for a production Kubernetes deployment.
