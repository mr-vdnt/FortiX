# FortiX API Reference

This document outlines the core API surface area of the FortiX platform.

## 1. Gateway Routing
- **`ANY /proxy/:routeId`**
  - **Description**: The primary ingress route. Proxies traffic to the configured target URL.
  - **Headers Required**: `x-api-key` (if the route enforces authentication).
  - **Security**: Protected by Rate Limiting, Threat Detection, and SSRF rules.

## 2. Authentication
- **`POST /api/auth/login`**: Authenticates a user and returns a JWT.
- **`POST /api/auth/register`**: Registers a new administrative user.

## 3. Control Plane (Requires JWT)
All endpoints require `Authorization: Bearer <token>`.

### Projects
- **`GET /api/control/projects`**: Lists projects owned by the authenticated user.
- **`POST /api/control/projects`**: Creates a new project.

### Routes
- **`GET /api/control/routes?projectId=...`**: Lists routes for a project.
- **`POST /api/control/routes`**: Registers a new API target mapping.

### API Keys
- **`GET /api/control/keys?projectId=...`**: Lists hashed keys.
- **`POST /api/control/keys`**: Generates a new cryptographically secure API key.

### Policies & Experiments
- **`POST /api/control/policies`**: Configures Rate Limits or timeouts.
- **`POST /api/control/experiments`**: Schedules a Chaos Experiment (handled by BullMQ).

### Metrics & Telemetry
- **`GET /api/control/metrics/scores`**: Returns the calculated 0-100 Security and Resilience scores.
