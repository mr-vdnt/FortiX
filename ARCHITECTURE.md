# FortiX Architecture

FortiX is built as a unified, high-performance API Gateway and Chaos Engineering platform. The system is designed to securely route traffic while providing asynchronous fault injection capabilities for resilience testing.

## High-Level Components

### 1. The Gateway / Proxy Engine (Express.js + http-proxy-middleware)
Acts as the ingress point for all traffic. It intercepts requests, enforces security policies (Rate Limiting, Threat Detection, Authentication), and dynamically rewrites/forwards payloads to the upstream target API.

### 2. The Control Plane (Express.js REST API)
Provides the administrative interface for tenants. All routes under `/api/control/*` are secured with JWT authentication and strict Project-Level Authorization (preventing IDOR). It manages the configuration of Routes, Keys, Policies, and Chaos Experiments.

### 3. The Data Layer (PostgreSQL + Drizzle ORM)
A strictly typed relational database ensuring ACID compliance. Drizzle ORM is used for zero-overhead query generation. Crucially, analytical queries (like scoring) are executed directly at the database level to prevent Node.js Out-Of-Memory (OOM) errors.

### 4. The Rate Limiter (Redis + Lua)
Implements an atomic Token Bucket algorithm utilizing custom Lua scripts evaluated directly inside Redis. This ensures no race conditions occur during concurrent burst traffic. The integration explicitly features a **fail-closed** fallback if Redis connectivity is lost.

### 5. The Chaos Worker (BullMQ + Redis)
An asynchronous worker pool that monitors the experiment lifecycle. It executes deterministic fault injections (e.g., Latency, 5xx errors) without blocking the main event loop of the API Gateway.

### 6. Real-Time Telemetry (WebSockets)
A WebSocket server broadcasts security events (e.g., Path Traversal blocked) and real-time metric aggregates to connected, authenticated clients, strictly scoped to their active Project ID.

### 7. The Frontend (React + Vite + Tailwind)
A dynamic Single Page Application (SPA) providing visual topology, real-time metric graphs (Recharts), and a comprehensive audit UI for reviewing policy verifications.
