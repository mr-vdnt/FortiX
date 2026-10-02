# FortiX Security Architecture

Security is a foundational tenet of the FortiX platform, both for the traffic it proxies and its own control plane.

## Control Plane Security

### 1. Authentication (JWT)
All administrative routes (`/api/control/*`) require a valid JSON Web Token (JWT). Tokens are signed with a strong cryptographic secret and carry the user's core identity.

### 2. Authorization & IDOR/BOLA Protection
To prevent Insecure Direct Object Reference (IDOR) and Broken Object Level Authorization (BOLA), FortiX enforces a strict `requireProjectOwnership` middleware. 
Furthermore, for relationships (e.g., attaching an experiment to a route), the platform explicitly queries the database to guarantee that the provided `routeId` natively belongs to the authenticated `projectId`.

### 3. API Key Cryptography
API Keys are never stored in plaintext. They are hashed using `bcrypt` before storage. FortiX only returns the raw key once during generation.

## Gateway Security

### 4. Fail-Closed Rate Limiting
If the Redis cache (which maintains the Token Bucket) experiences an outage, the system intentionally "fails closed" (returns 429 Too Many Requests). This prevents unthrottled traffic from overwhelming upstream infrastructure during internal system faults.

### 5. Threat Interception
- **Path Traversal**: Regex pattern matching immediately intercepts `../` or `%2e%2e%2f` patterns.
- **SSRF Mitigation**: The gateway statically blocks proxies pointing to internal AWS metadata (`169.254.169.254`), loopbacks (`127.0.0.1`), or private IP spaces unless explicitly whitelisted in development.
