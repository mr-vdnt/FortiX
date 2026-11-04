import fs from 'fs';
import path from 'path';
import { chromium, Page } from 'playwright';

const ROOT_DIR = process.cwd();
const DIAGRAMS_DIR = path.join(ROOT_DIR, 'docs/reports/diagrams');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'docs/reports/screenshots');
const BASE_URL = process.env.REPORT_BASE_URL || 'http://127.0.0.1:3000';

interface DiagramSpec {
  id: string;
  title: string;
  subtitle: string;
  mermaid: string;
  svgBody: string;
  width?: number;
  height?: number;
}

const DIAGRAM_SPECS: DiagramSpec[] = [
  {
    id: 'fig01_architecture',
    title: 'Figure 1.1: FortiX Multi-Plane System Architecture',
    subtitle: 'Control Plane, Reverse-Proxy Enforcement Plane, Asynchronous Workers, Verification Engine & Storage Tier',
    width: 1200,
    height: 700,
    mermaid: `flowchart TB
  subgraph Clients["External Actors & Traffic Sources"]
    OP["Operator Browser (React 19 SPA)"]
    CON["External API Consumer"]
  end
  subgraph FortiX["FortiX Runtime Platform (Node.js 22 / TypeScript)"]
    CP["Control Plane API (/api/auth, /api/control/*)"]
    GW["Gateway Enforcement Plane (/proxy/:routeId/*)"]
    ST["FortiX API Studio Target Handler"]
    WK["BullMQ Experiment Worker"]
    TW["Telemetry Stream Consumer"]
    VE["Deterministic Verification Engine"]
  end
  subgraph Data["Persistence & State Tier"]
    PG[("PostgreSQL 15 (23 Tables + RLS)")]
    RD[("Redis 7 (Lua Bucket, Streams, Pub/Sub, BullMQ)")]
    FS[("Artifact Store (SHA-256 PDFs)")]
  end
  UP["External Upstream Target API"]
  OP -->|HTTPS + HttpOnly Cookie + CSRF| CP
  CON -->|HTTP/S + X-API-Key| GW
  CP --> PG
  CP --> RD
  GW -->|1. SSRF + Key + WAF + Lua Bucket| RD
  GW -->|2a. Internal Studio Route| ST
  GW -->|2b. External Proxy Route| UP
  ST --> PG
  GW -->|XADD fortix:stream:metrics| RD
  TW -->|XREADGROUP + Batch Insert| PG
  WK -->|3-Phase Probes| GW
  WK --> VE
  VE -->|Flush Barrier + Evaluate| PG
  VE --> FS`,
    svgBody: `
      <!-- Tier 1: Actors -->
      <rect x="40" y="30" width="520" height="86" rx="10" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="2"/>
      <text x="300" y="58" text-anchor="middle" font-weight="700" font-size="15" fill="#1E3A8A">API Operator / Security Engineer (React 19 Control Plane SPA)</text>
      <text x="300" y="80" text-anchor="middle" font-size="12" fill="#334155">HttpOnly Session + Rotating Refresh Cookie + Double-Submit CSRF + Socket.IO Live Stream</text>
      <text x="300" y="99" text-anchor="middle" font-family="monospace" font-size="9.4" fill="#1D4ED8">Routes: /login · /studio · /apis · /security · /experiments · /learning-center</text>

      <rect x="640" y="30" width="520" height="86" rx="10" fill="#F0FDF4" stroke="#15803D" stroke-width="2"/>
      <text x="900" y="58" text-anchor="middle" font-weight="700" font-size="15" fill="#14532D">External API Consumer &amp; Automated Resilience Probes</text>
      <text x="900" y="80" text-anchor="middle" font-size="12" fill="#334155">Sends Authenticated REST Traffic Through FortiX Reverse-Proxy Gateway</text>
      <text x="900" y="99" text-anchor="middle" font-family="monospace" font-size="11" fill="#15803D">Headers: X-API-Key: fx_live_... | X-Experiment-Id | X-Request-ID</text>

      <!-- Arrows from Actors -->
      <line x1="300" y1="116" x2="300" y2="168" stroke="#1D4ED8" stroke-width="2.2" marker-end="url(#arrowBlue)"/>
      <line x1="900" y1="116" x2="900" y2="168" stroke="#15803D" stroke-width="2.2" marker-end="url(#arrowGreen)"/>

      <!-- Tier 2: Control Plane vs Data Plane -->
      <rect x="40" y="170" width="520" height="190" rx="12" fill="#F8FAFC" stroke="#0F172A" stroke-width="2"/>
      <rect x="40" y="170" width="520" height="34" rx="10" fill="#0F172A"/>
      <text x="300" y="192" text-anchor="middle" font-weight="700" font-size="14" fill="#FFFFFF">CONTROL PLANE API (/api/auth/* &amp; /api/control/*)</text>
      <rect x="60" y="218" width="230" height="58" rx="7" fill="#FFFFFF" stroke="#64748B"/>
      <text x="175" y="240" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">Auth, Sessions &amp; OTP Recovery</text>
      <text x="175" y="259" text-anchor="middle" font-size="11" fill="#475569">bcrypt · JWT · HMAC-SHA256 OTP</text>
      <rect x="310" y="218" width="230" height="58" rx="7" fill="#FFFFFF" stroke="#64748B"/>
      <text x="425" y="240" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">Tenant &amp; Policy Governance</text>
      <text x="425" y="259" text-anchor="middle" font-size="11" fill="#475569">RBAC · BOLA Guard · Zod Schemas</text>
      <rect x="60" y="288" width="230" height="58" rx="7" fill="#FFFFFF" stroke="#64748B"/>
      <text x="175" y="310" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">API Studio &amp; Learning Center</text>
      <text x="175" y="329" text-anchor="middle" font-size="11" fill="#475569">100-Product Seed · Guided Tutorials</text>
      <rect x="310" y="288" width="230" height="58" rx="7" fill="#FFFFFF" stroke="#64748B"/>
      <text x="425" y="310" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">Reports, Audit &amp; Webhooks</text>
      <text x="425" y="329" text-anchor="middle" font-size="11" fill="#475569">PDFKit · SHA-256 · HMAC Hooks</text>

      <rect x="640" y="170" width="520" height="190" rx="12" fill="#FFFBEB" stroke="#B45309" stroke-width="2"/>
      <rect x="640" y="170" width="520" height="34" rx="10" fill="#B45309"/>
      <text x="900" y="192" text-anchor="middle" font-weight="700" font-size="14" fill="#FFFFFF">GATEWAY ENFORCEMENT PLANE (/proxy/:routeId/*)</text>
      <rect x="660" y="218" width="230" height="58" rx="7" fill="#FFFFFF" stroke="#D97706"/>
      <text x="775" y="240" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">1. SSRF + Hashed API-Key Auth</text>
      <text x="775" y="259" text-anchor="middle" font-size="11" fill="#475569">DNS Rebind Guard · SHA-256 Cache</text>
      <rect x="910" y="218" width="230" height="58" rx="7" fill="#FFFFFF" stroke="#D97706"/>
      <text x="1025" y="240" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">2. WAF &amp; Lua Token Bucket</text>
      <text x="1025" y="259" text-anchor="middle" font-size="11" fill="#475569">SQLi/XSS/Traversal · Atomic RPM</text>
      <rect x="660" y="288" width="230" height="58" rx="7" fill="#FFFFFF" stroke="#D97706"/>
      <text x="775" y="310" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">3. Bounded Fault Injector</text>
      <text x="775" y="329" text-anchor="middle" font-size="11" fill="#475569">Post-Auth Latency / 5xx / Timeout</text>
      <rect x="910" y="288" width="230" height="58" rx="7" fill="#FFFFFF" stroke="#D97706"/>
      <text x="1025" y="310" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">4. Upstream Dispatcher</text>
      <text x="1025" y="329" text-anchor="middle" font-size="11" fill="#475569">Studio CRUD Handler | HTTP Proxy</text>

      <!-- Tier 3: Workers & Verification Engine -->
      <rect x="40" y="398" width="350" height="110" rx="10" fill="#F5F3FF" stroke="#6D28D9" stroke-width="2"/>
      <text x="215" y="424" text-anchor="middle" font-weight="700" font-size="13.5" fill="#4C1D95">BullMQ Experiment &amp; Webhook Workers</text>
      <text x="215" y="446" text-anchor="middle" font-size="11.5" fill="#334155">Executes BASELINE → INJECTION → RECOVERY</text>
      <text x="215" y="466" text-anchor="middle" font-size="11.5" fill="#334155">Enforces Cancellation, TTL Cleanup &amp; DLQ</text>
      <text x="215" y="488" text-anchor="middle" font-family="monospace" font-size="10.5" fill="#6D28D9">src/experiments/worker.ts · src/worker.ts</text>

      <rect x="425" y="398" width="350" height="110" rx="10" fill="#ECFEFF" stroke="#0E7490" stroke-width="2"/>
      <text x="600" y="424" text-anchor="middle" font-weight="700" font-size="13.5" fill="#155E75">Deterministic Verification Engine</text>
      <text x="600" y="446" text-anchor="middle" font-size="11.5" fill="#334155">Awaits Telemetry Flush Barrier Before Query</text>
      <text x="600" y="466" text-anchor="middle" font-size="11.5" fill="#334155">Evaluates Coverage, Sample Sufficiency &amp; SLA</text>
      <text x="600" y="488" text-anchor="middle" font-family="monospace" font-size="10.5" fill="#0E7490">src/verification/engine.ts · domain.ts</text>

      <rect x="810" y="398" width="350" height="110" rx="10" fill="#FEF2F2" stroke="#B91C1C" stroke-width="2"/>
      <text x="985" y="424" text-anchor="middle" font-weight="700" font-size="13.5" fill="#7F1D1D">Upstream Targets (Studio &amp; External)</text>
      <text x="985" y="446" text-anchor="middle" font-size="11" fill="#334155">Internal: fortix-studio.internal/studio/&lt;id&gt;</text>
      <text x="985" y="466" text-anchor="middle" font-size="11.5" fill="#334155">External: Public HTTPS Microservices</text>
      <text x="985" y="488" text-anchor="middle" font-family="monospace" font-size="10.5" fill="#B91C1C">Credentials Stripped Before Forwarding</text>

      <!-- Connecting Lines Tier 2 <-> Tier 3 -->
      <line x1="215" y1="360" x2="215" y2="396" stroke="#6D28D9" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="390" y1="452" x2="423" y2="452" stroke="#0E7490" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="985" y1="360" x2="985" y2="396" stroke="#B91C1C" stroke-width="2" marker-end="url(#arrowSlate)"/>

      <!-- Tier 4: Persistence -->
      <rect x="40" y="548" width="440" height="112" rx="10" fill="#F1F5F9" stroke="#0F172A" stroke-width="2"/>
      <text x="260" y="576" text-anchor="middle" font-weight="700" font-size="14" fill="#0F172A">PostgreSQL 15 Relational Store (Drizzle ORM)</text>
      <text x="260" y="598" text-anchor="middle" font-size="11.5" fill="#334155">23 Normalized Tables · Foreign Key Cascades · Optimistic Versioning</text>
      <text x="260" y="618" text-anchor="middle" font-size="11.5" fill="#334155">Row-Level Security (RLS) Tenant Isolation · pg-mem Sandbox Fallback</text>
      <text x="260" y="640" text-anchor="middle" font-family="monospace" font-size="9.2" fill="#1E40AF">users · refresh_tokens · api_routes · experiments · studio_* · learning_*</text>

      <rect x="510" y="548" width="400" height="112" rx="10" fill="#FFF1F2" stroke="#BE123C" stroke-width="2"/>
      <text x="710" y="576" text-anchor="middle" font-weight="700" font-size="14" fill="#881337">Redis 7 State, Streams &amp; Queues</text>
      <text x="710" y="598" text-anchor="middle" font-size="11.5" fill="#334155">Atomic Lua Token-Bucket Rate Limiter (Fail-Closed)</text>
      <text x="710" y="618" text-anchor="middle" font-size="11.5" fill="#334155">Redis Streams Telemetry · Key-Revocation Pub/Sub · BullMQ</text>
      <text x="710" y="640" text-anchor="middle" font-family="monospace" font-size="9.8" fill="#BE123C">ratelimit:* · fortix:stream:metrics · fortix:api-key:revoked:v1</text>

      <rect x="940" y="548" width="220" height="112" rx="10" fill="#ECFDF5" stroke="#047857" stroke-width="2"/>
      <text x="1050" y="576" text-anchor="middle" font-weight="700" font-size="14" fill="#065F46">Evidence Artifact Store</text>
      <text x="1050" y="598" text-anchor="middle" font-size="11.5" fill="#334155">Server-Side PDF Compliance</text>
      <text x="1050" y="618" text-anchor="middle" font-size="11.5" fill="#334155">SHA-256 Integrity Digest</text>
      <text x="1050" y="640" text-anchor="middle" font-family="monospace" font-size="10.5" fill="#047857">LocalStorage / S3 Adapter</text>

      <line x1="260" y1="508" x2="260" y2="546" stroke="#0F172A" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="600" y1="508" x2="600" y2="546" stroke="#BE123C" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="740" y1="508" x2="1020" y2="546" stroke="#047857" stroke-width="2" marker-end="url(#arrowGreen)"/>
    `,
  },
  {
    id: 'fig02_dfd_level0',
    title: 'Figure 2.1: Level 0 Context Data Flow Diagram (DFD)',
    subtitle: 'Top-Level System Boundary, External Entities, and Balanced Input/Output Data Flows',
    width: 1180,
    height: 600,
    mermaid: `flowchart LR
  OP["API Operator / Developer"] -->|Auth Credentials, Routes, Policies, Studio Specs, Experiments| SYS(("0.0 FortiX Platform"))
  SYS -->|Session Cookies, Live Telemetry, Verdicts, PDF Reports, OpenAPI, Tutorials| OP
  ADM["Platform Administrator"] -->|Role Governance, Tutorial Catalog Mgmt, DLQ Replay| SYS
  SYS -->|Audit Logs, User Roster, Readiness Status| ADM
  CLI["External API Consumer"] -->|API Requests + X-API-Key| SYS
  SYS -->|Proxied JSON Responses / 401 / 403 / 429 / 504| CLI
  SYS -->|Sanitized Upstream HTTP Requests| UP["External Upstream API"]
  UP -->|Upstream HTTP Status, Headers & Payload| SYS
  SYS -->|OTP / Verification / Alert Webhooks| NOTIF["Notification & Webhook Endpoint"]`,
    svgBody: `
      <!-- Central Process 0.0 -->
      <circle cx="590" cy="300" r="128" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="3"/>
      <text x="590" y="266" text-anchor="middle" font-weight="800" font-size="16" fill="#1E3A8A">PROCESS 0.0</text>
      <text x="590" y="292" text-anchor="middle" font-weight="700" font-size="15" fill="#0F172A">FortiX API Security &amp;</text>
      <text x="590" y="313" text-anchor="middle" font-weight="700" font-size="15" fill="#0F172A">Resilience Verification</text>
      <text x="590" y="334" text-anchor="middle" font-weight="700" font-size="15" fill="#0F172A">Platform</text>
      <text x="590" y="360" text-anchor="middle" font-family="monospace" font-size="11" fill="#1D4ED8">Protect · Break · Observe · Prove</text>

      <!-- External Entity 1: Operator -->
      <rect x="45" y="70" width="250" height="92" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
      <text x="170" y="106" text-anchor="middle" font-weight="700" font-size="14" fill="#0F172A">API Operator / Developer</text>
      <text x="170" y="128" text-anchor="middle" font-size="11.5" fill="#475569">External Entity E1</text>

      <!-- External Entity 2: Administrator -->
      <rect x="45" y="420" width="250" height="92" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
      <text x="170" y="456" text-anchor="middle" font-weight="700" font-size="14" fill="#0F172A">Platform Administrator</text>
      <text x="170" y="478" text-anchor="middle" font-size="11.5" fill="#475569">External Entity E2</text>

      <!-- External Entity 3: API Consumer -->
      <rect x="885" y="60" width="250" height="92" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
      <text x="1010" y="96" text-anchor="middle" font-weight="700" font-size="14" fill="#0F172A">External API Consumer</text>
      <text x="1010" y="118" text-anchor="middle" font-size="11.5" fill="#475569">External Entity E3</text>

      <!-- External Entity 4: Upstream Target API -->
      <rect x="885" y="254" width="250" height="92" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
      <text x="1010" y="290" text-anchor="middle" font-weight="700" font-size="14" fill="#0F172A">Upstream Target API</text>
      <text x="1010" y="312" text-anchor="middle" font-size="11.5" fill="#475569">External Entity E4</text>

      <!-- External Entity 5: Notification / Webhook Sink -->
      <rect x="885" y="438" width="250" height="92" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="2.2"/>
      <text x="1010" y="472" text-anchor="middle" font-weight="700" font-size="14" fill="#0F172A">Notification &amp; Webhook</text>
      <text x="1010" y="492" text-anchor="middle" font-weight="700" font-size="14" fill="#0F172A">Receiver</text>
      <text x="1010" y="512" text-anchor="middle" font-size="11.5" fill="#475569">External Entity E5</text>

      <!-- Flows E1 <-> 0.0 -->
      <path d="M 295 102 L 478 232" stroke="#1D4ED8" stroke-width="2" fill="none" marker-end="url(#arrowBlue)"/>
      <text x="385" y="148" text-anchor="middle" font-size="11" font-weight="600" fill="#1E3A8A">Auth, Routes, Policies, Studio, Experiments</text>
      <path d="M 465 256 L 295 138" stroke="#0F172A" stroke-width="1.8" stroke-dasharray="5,3" fill="none" marker-end="url(#arrowSlate)"/>
      <text x="355" y="218" text-anchor="middle" font-size="11" fill="#334155">Sessions, Telemetry, Verdicts, PDF Evidence</text>

      <!-- Flows E2 <-> 0.0 -->
      <path d="M 295 450 L 472 355" stroke="#1D4ED8" stroke-width="2" fill="none" marker-end="url(#arrowBlue)"/>
      <text x="366" y="388" text-anchor="middle" font-size="11" font-weight="600" fill="#1E3A8A">RBAC, Tutorial Catalog, DLQ Retry</text>
      <path d="M 484 378 L 295 482" stroke="#0F172A" stroke-width="1.8" stroke-dasharray="5,3" fill="none" marker-end="url(#arrowSlate)"/>
      <text x="398" y="452" text-anchor="middle" font-size="11" fill="#334155">Audit Trail, Health &amp; Queue Diagnostics</text>

      <!-- Flows E3 <-> 0.0 -->
      <path d="M 885 95 L 702 232" stroke="#15803D" stroke-width="2" fill="none" marker-end="url(#arrowGreen)"/>
      <text x="795" y="142" text-anchor="middle" font-size="11" font-weight="600" fill="#14532D">HTTP Request + X-API-Key</text>
      <path d="M 714 254 L 885 132" stroke="#0F172A" stroke-width="1.8" stroke-dasharray="5,3" fill="none" marker-end="url(#arrowSlate)"/>
      <text x="822" y="212" text-anchor="middle" font-size="11" fill="#334155">JSON Payload / 401 / 403 / 429 / 504</text>

      <!-- Flows 0.0 <-> E4 -->
      <line x1="718" y1="288" x2="883" y2="288" stroke="#B45309" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <text x="800" y="279" text-anchor="middle" font-size="11" font-weight="600" fill="#92400E">Sanitized Proxy Request</text>
      <line x1="883" y1="316" x2="718" y2="316" stroke="#0F172A" stroke-width="1.8" stroke-dasharray="5,3" marker-end="url(#arrowSlate)"/>
      <text x="800" y="334" text-anchor="middle" font-size="11" fill="#334155">Upstream Status &amp; Response</text>

      <!-- Flows 0.0 -> E5 -->
      <path d="M 698 368 L 885 472" stroke="#6D28D9" stroke-width="2" fill="none" marker-end="url(#arrowSlate)"/>
      <text x="808" y="408" text-anchor="middle" font-size="11" font-weight="600" fill="#5B21B6">Signed Webhooks &amp; Email/SMS OTP</text>
      <path d="M 885 498 L 684 388" stroke="#0F172A" stroke-width="1.6" stroke-dasharray="4,3" fill="none" marker-end="url(#arrowSlate)"/>
      <text x="772" y="468" text-anchor="middle" font-size="10.5" fill="#475569">HTTP 2xx Delivery Ack</text>
    `,
  },
  {
    id: 'fig03_dfd_level1',
    title: 'Figure 2.2: Level 1 Data Flow Diagram — Core FortiX Subsystems & Data Stores',
    subtitle: 'Decomposition of Context Process 0.0 into Seven Balanced Processes (1.0–7.0) and Three Data Stores (D1–D3)',
    width: 1200,
    height: 720,
    mermaid: `flowchart TB
  E1["E1: API Operator"] --> P1(("1.0 Auth & OTP Recovery"))
  E1 --> P2(("2.0 Route, Key & Policy Mgmt"))
  E1 --> P3(("3.0 API Studio & Learning"))
  E1 --> P5(("5.0 Chaos Experiment Worker"))
  E3["E3: API Consumer"] --> P4(("4.0 Gateway Enforcement"))
  P4 --> E4["E4: Upstream API"]
  P4 --> P6(("6.0 Telemetry & Verification"))
  P5 --> P4
  P5 --> P6
  P6 --> P7(("7.0 Evidence PDF & Webhooks"))
  P7 --> E1
  P7 --> E5["E5: Webhook / Mail / SMS"]
  P1 <--> D1[("D1: PostgreSQL 23 Tables")]
  P2 <--> D1
  P3 <--> D1
  P4 <--> D2[("D2: Redis 7")]
  P6 <--> D1
  P7 <--> D3[("D3: Artifact Store")]`,
    svgBody: `
      <!-- External Entities Left/Right -->
      <rect x="30" y="55" width="175" height="62" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
      <text x="117" y="83" text-anchor="middle" font-weight="700" font-size="12.5" fill="#0F172A">E1: API Operator</text>
      <text x="117" y="101" text-anchor="middle" font-size="10.5" fill="#475569">Admin / Developer / Viewer</text>

      <rect x="30" y="310" width="175" height="62" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
      <text x="117" y="338" text-anchor="middle" font-weight="700" font-size="12.5" fill="#0F172A">E3: API Consumer</text>
      <text x="117" y="356" text-anchor="middle" font-size="10.5" fill="#475569">External Client Traffic</text>

      <rect x="995" y="310" width="175" height="62" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
      <text x="1082" y="338" text-anchor="middle" font-weight="700" font-size="12.5" fill="#0F172A">E4: Upstream API</text>
      <text x="1082" y="356" text-anchor="middle" font-size="10.5" fill="#475569">Target Service</text>

      <rect x="995" y="545" width="175" height="62" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
      <text x="1082" y="573" text-anchor="middle" font-weight="700" font-size="12.5" fill="#0F172A">E5: Notification Sink</text>
      <text x="1082" y="591" text-anchor="middle" font-size="10.5" fill="#475569">Email / SMS / Webhook</text>

      <!-- Processes 1.0 - 7.0 -->
      <rect x="260" y="40" width="210" height="84" rx="18" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="2"/>
      <text x="365" y="68" text-anchor="middle" font-weight="700" font-size="12.5" fill="#1E3A8A">1.0 Identity, Session &amp;</text>
      <text x="365" y="86" text-anchor="middle" font-weight="700" font-size="12.5" fill="#1E3A8A">OTP Account Recovery</text>
      <text x="365" y="106" text-anchor="middle" font-size="10.5" fill="#475569">JWT · Refresh Rotation · OTP HMAC</text>

      <rect x="510" y="40" width="210" height="84" rx="18" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="2"/>
      <text x="615" y="68" text-anchor="middle" font-weight="700" font-size="12.5" fill="#1E3A8A">2.0 Project, Route, Key &amp;</text>
      <text x="615" y="86" text-anchor="middle" font-weight="700" font-size="12.5" fill="#1E3A8A">Security Policy Governance</text>
      <text x="615" y="106" text-anchor="middle" font-size="10.5" fill="#475569">Tenant Isolation · Key Hashing</text>

      <rect x="760" y="40" width="210" height="84" rx="18" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="2"/>
      <text x="865" y="68" text-anchor="middle" font-weight="700" font-size="12.5" fill="#1E3A8A">3.0 API Studio &amp; Guided</text>
      <text x="865" y="86" text-anchor="middle" font-weight="700" font-size="12.5" fill="#1E3A8A">Learning Center Engine</text>
      <text x="865" y="106" text-anchor="middle" font-size="10.5" fill="#475569">100-Product Seed · Tutorials</text>

      <!-- Data Store D1 PostgreSQL -->
      <line x1="260" y1="185" x2="970" y2="185" stroke="#0F172A" stroke-width="2.5"/>
      <line x1="260" y1="225" x2="970" y2="225" stroke="#0F172A" stroke-width="2.5"/>
      <rect x="260" y="186" width="710" height="38" fill="#F8FAFC"/>
      <text x="615" y="210" text-anchor="middle" font-weight="700" font-size="12.4" fill="#0F172A">D1: PostgreSQL Store (23 Tables: users, refresh_tokens, recovery_challenges, api_routes, studio_*, verifications, learning_*)</text>

      <!-- Process 4.0 & 5.0 -->
      <rect x="500" y="295" width="250" height="92" rx="18" fill="#FFFBEB" stroke="#B45309" stroke-width="2.2"/>
      <text x="625" y="325" text-anchor="middle" font-weight="700" font-size="13" fill="#92400E">4.0 Reverse-Proxy Gateway</text>
      <text x="625" y="344" text-anchor="middle" font-weight="700" font-size="13" fill="#92400E">Enforcement Pipeline</text>
      <text x="625" y="366" text-anchor="middle" font-size="10.5" fill="#475569">SSRF · Key Auth · WAF · Lua Bucket · Faults</text>

      <rect x="235" y="425" width="230" height="86" rx="18" fill="#F5F3FF" stroke="#6D28D9" stroke-width="2"/>
      <text x="350" y="454" text-anchor="middle" font-weight="700" font-size="12.5" fill="#4C1D95">5.0 Chaos &amp; Resilience</text>
      <text x="350" y="472" text-anchor="middle" font-weight="700" font-size="12.5" fill="#4C1D95">Experiment Orchestrator</text>
      <text x="350" y="492" text-anchor="middle" font-size="10.5" fill="#475569">Baseline · Injection · Recovery Probes</text>

      <!-- Data Store D2 Redis -->
      <line x1="500" y1="440" x2="960" y2="440" stroke="#BE123C" stroke-width="2.5"/>
      <line x1="500" y1="480" x2="960" y2="480" stroke="#BE123C" stroke-width="2.5"/>
      <rect x="500" y="441" width="460" height="38" fill="#FFF1F2"/>
      <text x="730" y="465" text-anchor="middle" font-weight="700" font-size="12" fill="#881337">D2: Redis 7 (Lua Token Bucket · fortix:stream:metrics · Key Pub/Sub · BullMQ)</text>

      <!-- Process 6.0 & 7.0 -->
      <rect x="235" y="555" width="250" height="88" rx="18" fill="#ECFEFF" stroke="#0E7490" stroke-width="2"/>
      <text x="360" y="584" text-anchor="middle" font-weight="700" font-size="12.5" fill="#155E75">6.0 Telemetry Flush Barrier &amp;</text>
      <text x="360" y="602" text-anchor="middle" font-weight="700" font-size="12.5" fill="#155E75">Deterministic Verification</text>
      <text x="360" y="622" text-anchor="middle" font-size="10.5" fill="#475569">Sample Sufficiency · SLA Verdict</text>

      <rect x="535" y="555" width="230" height="88" rx="18" fill="#ECFDF5" stroke="#047857" stroke-width="2"/>
      <text x="650" y="584" text-anchor="middle" font-weight="700" font-size="12.5" fill="#065F46">7.0 Evidence Report &amp;</text>
      <text x="650" y="602" text-anchor="middle" font-weight="700" font-size="12.5" fill="#065F46">Notification Dispatcher</text>
      <text x="650" y="622" text-anchor="middle" font-size="10.5" fill="#475569">PDFKit · SHA-256 · Signed Webhooks</text>

      <!-- Data Store D3 Artifact Store -->
      <line x1="805" y1="640" x2="1165" y2="640" stroke="#047857" stroke-width="2.5"/>
      <line x1="805" y1="680" x2="1165" y2="680" stroke="#047857" stroke-width="2.5"/>
      <rect x="805" y="641" width="360" height="38" fill="#ECFDF5"/>
      <text x="985" y="665" text-anchor="middle" font-weight="700" font-size="12" fill="#065F46">D3: Evidence Artifact Store (SHA-256 PDFs)</text>

      <!-- Arrows -->
      <line x1="205" y1="82" x2="258" y2="82" stroke="#1D4ED8" stroke-width="2" marker-end="url(#arrowBlue)"/>
      <path d="M 120 117 L 120 155 L 615 155 L 615 126" stroke="#1D4ED8" stroke-width="1.8" fill="none" marker-end="url(#arrowBlue)"/>
      <path d="M 150 117 L 150 145 L 865 145 L 865 126" stroke="#1D4ED8" stroke-width="1.8" fill="none" marker-end="url(#arrowBlue)"/>
      <path d="M 85 117 L 85 468 L 233 468" stroke="#6D28D9" stroke-width="1.8" fill="none" marker-end="url(#arrowSlate)"/>

      <line x1="365" y1="124" x2="365" y2="183" stroke="#0F172A" stroke-width="1.8" marker-end="url(#arrowSlate)"/>
      <line x1="615" y1="124" x2="615" y2="183" stroke="#0F172A" stroke-width="1.8" marker-end="url(#arrowSlate)"/>
      <line x1="865" y1="124" x2="865" y2="183" stroke="#0F172A" stroke-width="1.8" marker-end="url(#arrowSlate)"/>

      <line x1="205" y1="341" x2="498" y2="341" stroke="#15803D" stroke-width="2.2" marker-end="url(#arrowGreen)"/>
      <line x1="750" y1="341" x2="993" y2="341" stroke="#B45309" stroke-width="2.2" marker-end="url(#arrowSlate)"/>
      <line x1="625" y1="226" x2="625" y2="293" stroke="#0F172A" stroke-width="1.8" marker-end="url(#arrowSlate)"/>
      <line x1="665" y1="387" x2="665" y2="438" stroke="#BE123C" stroke-width="1.8" marker-end="url(#arrowSlate)"/>

      <path d="M 465 445 L 545 388" stroke="#6D28D9" stroke-width="1.8" fill="none" marker-end="url(#arrowSlate)"/>
      <line x1="350" y1="511" x2="350" y2="553" stroke="#0E7490" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="485" y1="599" x2="533" y2="599" stroke="#047857" stroke-width="2" marker-end="url(#arrowGreen)"/>
      <line x1="765" y1="576" x2="993" y2="576" stroke="#6D28D9" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <path d="M 765 618 L 860 638" stroke="#047857" stroke-width="1.8" fill="none" marker-end="url(#arrowGreen)"/>
    `,
  },
  {
    id: 'fig04_dfd_level2',
    title: 'Figure 2.3: Level 2 Data Flow Diagram — Gateway Pipeline (4.0) & Verification Engine (6.0)',
    subtitle: 'Granular Stage-by-Stage Request Enforcement, Pre-Auth Isolation, Stream Flush Barrier, and Three-Phase Evaluation',
    width: 1200,
    height: 620,
    mermaid: `flowchart LR
  REQ["Incoming /proxy/:routeId"] --> P41("4.1 Route & SSRF Guard")
  P41 --> P42("4.2 SHA-256 API-Key Auth")
  P42 --> P43("4.3 WAF SQLi/XSS Guard")
  P43 --> P44("4.4 Redis Lua Token Bucket")
  P44 --> P45("4.5 Post-Auth Fault Injector")
  P45 --> P46("4.6 Studio / Upstream Proxy")
  P46 --> P61("6.1 fortix:stream:metrics")
  P61 --> P62("6.2 Flush Barrier & Phase Split")
  P62 --> P63("6.3 Deterministic Verdict Engine")`,
    svgBody: `
      <!-- Top Pipeline: 4.1 -> 4.6 -->
      <text x="60" y="45" font-weight="700" font-size="13.5" fill="#92400E">SUBSYSTEM 4.0 — GATEWAY ENFORCEMENT PIPELINE (STRICT PRE-AUTH BEFORE FAULT INJECTION)</text>
      <rect x="40" y="65" width="165" height="95" rx="10" fill="#FFFBEB" stroke="#D97706" stroke-width="2"/>
      <text x="122" y="92" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">4.1 Route &amp; SSRF</text>
      <text x="122" y="110" text-anchor="middle" font-size="10.5" fill="#475569">Validate routeId,</text>
      <text x="122" y="126" text-anchor="middle" font-size="10.5" fill="#475569">block RFC1918/Metadata</text>
      <text x="122" y="146" text-anchor="middle" font-family="monospace" font-size="10" fill="#B45309">Reject → 403/404</text>

      <rect x="235" y="65" width="165" height="95" rx="10" fill="#FFFBEB" stroke="#D97706" stroke-width="2"/>
      <text x="317" y="92" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">4.2 API-Key Auth</text>
      <text x="317" y="110" text-anchor="middle" font-size="10.5" fill="#475569">SHA-256 Cache +</text>
      <text x="317" y="126" text-anchor="middle" font-size="10.5" fill="#475569">bcrypt + Expiry Check</text>
      <text x="317" y="146" text-anchor="middle" font-family="monospace" font-size="10" fill="#B45309">Reject → 401</text>

      <rect x="430" y="65" width="165" height="95" rx="10" fill="#FFFBEB" stroke="#D97706" stroke-width="2"/>
      <text x="512" y="92" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">4.3 WAF Inspector</text>
      <text x="512" y="110" text-anchor="middle" font-size="10.5" fill="#475569">Multi-decode URI,</text>
      <text x="512" y="126" text-anchor="middle" font-size="10.5" fill="#475569">SQLi, XSS, Traversal</text>
      <text x="512" y="146" text-anchor="middle" font-family="monospace" font-size="10" fill="#B45309">Reject → 403 + Event</text>

      <rect x="625" y="65" width="165" height="95" rx="10" fill="#FFFBEB" stroke="#D97706" stroke-width="2"/>
      <text x="707" y="92" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">4.4 Lua Rate Limit</text>
      <text x="707" y="110" text-anchor="middle" font-size="10.5" fill="#475569">Atomic Redis HMGET/</text>
      <text x="707" y="126" text-anchor="middle" font-size="10.5" fill="#475569">HMSET Token Bucket</text>
      <text x="707" y="146" text-anchor="middle" font-family="monospace" font-size="10" fill="#B45309">Reject → 429</text>

      <rect x="820" y="65" width="165" height="95" rx="10" fill="#F5F3FF" stroke="#6D28D9" stroke-width="2"/>
      <text x="902" y="92" text-anchor="middle" font-weight="700" font-size="12" fill="#4C1D95">4.5 Fault Injector</text>
      <text x="902" y="110" text-anchor="middle" font-size="10.5" fill="#475569">Active RUNNING exp:</text>
      <text x="902" y="126" text-anchor="middle" font-size="10.5" fill="#475569">Latency / 5xx / Timeout</text>
      <text x="902" y="146" text-anchor="middle" font-family="monospace" font-size="10" fill="#6D28D9">Post-Auth Only</text>

      <rect x="1015" y="65" width="150" height="95" rx="10" fill="#ECFDF5" stroke="#047857" stroke-width="2"/>
      <text x="1090" y="92" text-anchor="middle" font-weight="700" font-size="12" fill="#065F46">4.6 Proxy / Studio</text>
      <text x="1090" y="110" text-anchor="middle" font-size="10.5" fill="#475569">Strip fx_ headers,</text>
      <text x="1090" y="126" text-anchor="middle" font-size="10.5" fill="#475569">dispatch &amp; time hop</text>
      <text x="1090" y="146" text-anchor="middle" font-family="monospace" font-size="10" fill="#047857">200 / 502 / 504</text>

      <line x1="205" y1="112" x2="233" y2="112" stroke="#0F172A" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="400" y1="112" x2="428" y2="112" stroke="#0F172A" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="595" y1="112" x2="623" y2="112" stroke="#0F172A" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="790" y1="112" x2="818" y2="112" stroke="#0F172A" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="985" y1="112" x2="1013" y2="112" stroke="#0F172A" stroke-width="2" marker-end="url(#arrowSlate)"/>

      <!-- Middle Shared Stores -->
      <rect x="95" y="220" width="465" height="54" rx="6" fill="#FFF1F2" stroke="#BE123C" stroke-width="2"/>
      <text x="327" y="252" text-anchor="middle" font-weight="700" font-size="12" fill="#881337">D2: Redis Streams (fortix:stream:metrics &amp; security) + Lua Bucket</text>

      <rect x="640" y="220" width="455" height="54" rx="6" fill="#F8FAFC" stroke="#0F172A" stroke-width="2"/>
      <text x="867" y="252" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">D1: PostgreSQL (metric_logs, security_events, experiments, verifications)</text>

      <path d="M 1090 160 L 1090 195 L 330 195 L 330 218" stroke="#BE123C" stroke-width="1.8" fill="none" marker-end="url(#arrowSlate)"/>
      <line x1="560" y1="247" x2="638" y2="247" stroke="#0F172A" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <text x="599" y="239" text-anchor="middle" font-size="10" font-weight="600" fill="#334155">Batch XACK</text>

      <!-- Bottom Pipeline: 6.1 -> 6.4 -->
      <text x="60" y="340" font-weight="700" font-size="13.5" fill="#155E75">SUBSYSTEM 6.0 — DETERMINISTIC VERIFICATION ENGINE (ZERO VACUOUS OR TAUTOLOGICAL PASSES)</text>

      <rect x="40" y="365" width="250" height="125" rx="10" fill="#ECFEFF" stroke="#0E7490" stroke-width="2"/>
      <text x="165" y="395" text-anchor="middle" font-weight="700" font-size="12.5" fill="#0F172A">6.1 Telemetry Flush Barrier</text>
      <text x="165" y="418" text-anchor="middle" font-size="11" fill="#334155">Drains pending in-memory &amp;</text>
      <text x="165" y="436" text-anchor="middle" font-size="11" fill="#334155">Redis Stream queue entries</text>
      <text x="165" y="454" text-anchor="middle" font-size="11" fill="#334155">before querying metric_logs</text>
      <text x="165" y="476" text-anchor="middle" font-family="monospace" font-size="10" fill="#0E7490">flushTelemetryBarrier()</text>

      <rect x="330" y="365" width="260" height="125" rx="10" fill="#ECFEFF" stroke="#0E7490" stroke-width="2"/>
      <text x="460" y="395" text-anchor="middle" font-weight="700" font-size="12.5" fill="#0F172A">6.2 Three-Phase Partitioner</text>
      <text x="460" y="418" text-anchor="middle" font-size="11" fill="#334155">Splits observations by probeId</text>
      <text x="460" y="436" text-anchor="middle" font-size="11" fill="#334155">&amp; window: BASELINE (5),</text>
      <text x="460" y="454" text-anchor="middle" font-size="11" fill="#334155">INJECTION (N), RECOVERY (5)</text>
      <text x="460" y="476" text-anchor="middle" font-family="monospace" font-size="10" fill="#0E7490">filterRowsForPhase()</text>

      <rect x="630" y="365" width="265" height="125" rx="10" fill="#ECFEFF" stroke="#0E7490" stroke-width="2"/>
      <text x="762" y="395" text-anchor="middle" font-weight="700" font-size="12.5" fill="#0F172A">6.3 Sufficiency &amp; Rule Engine</text>
      <text x="762" y="418" text-anchor="middle" font-size="11" fill="#334155">Checks coverage ≥ 80%, min</text>
      <text x="762" y="436" text-anchor="middle" font-size="11" fill="#334155">samples, 429 ratio / p95 delta</text>
      <text x="762" y="454" text-anchor="middle" font-size="11" fill="#334155">&amp; post-fault recovery health</text>
      <text x="762" y="476" text-anchor="middle" font-family="monospace" font-size="10" fill="#0E7490">evaluateExperimentVerification()</text>

      <rect x="935" y="365" width="230" height="125" rx="10" fill="#ECFDF5" stroke="#047857" stroke-width="2"/>
      <text x="1050" y="395" text-anchor="middle" font-weight="700" font-size="12.5" fill="#065F46">6.4 Evidence Persistence</text>
      <text x="1050" y="418" text-anchor="middle" font-size="11" fill="#334155">Stores expected vs observed</text>
      <text x="1050" y="436" text-anchor="middle" font-size="11" fill="#334155">JSONB, PASS/FAIL/INCONCLUSIVE</text>
      <text x="1050" y="454" text-anchor="middle" font-size="11" fill="#334155">&amp; SHA-256 PDF report</text>
      <text x="1050" y="476" text-anchor="middle" font-family="monospace" font-size="10" fill="#047857">verifications + artifacts</text>

      <line x1="290" y1="427" x2="328" y2="427" stroke="#0E7490" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="590" y1="427" x2="628" y2="427" stroke="#0E7490" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="895" y1="427" x2="933" y2="427" stroke="#047857" stroke-width="2" marker-end="url(#arrowGreen)"/>
      <path d="M 860 274 L 860 315 L 460 315 L 460 363" stroke="#0F172A" stroke-width="1.8" fill="none" marker-end="url(#arrowSlate)"/>
      <path d="M 1050 365 L 1050 276" stroke="#047857" stroke-width="1.8" fill="none" marker-end="url(#arrowGreen)"/>
    `,
  },
  {
    id: 'fig04b_dfd_level2_auth_exp',
    title: 'Figure 2.4: Level 2 Data Flow Diagram — Auth/OTP Recovery (1.0) & Chaos Worker Cleanup (5.0)',
    subtitle: 'Granular Session Rotation, HMAC-SHA256 OTP Verification, and Bounded Three-Phase Probe Orchestration',
    width: 1200,
    height: 600,
    mermaid: `flowchart LR
  LOGIN["/api/auth/*"] --> P11("1.1 Identifier & Bcrypt")
  P11 --> P12("1.2 Refresh Family Rotator")
  P12 --> P13("1.3 HMAC-SHA256 OTP Verifier")
  P13 --> P14("1.4 Global Session Revoker")
  EXP["/api/control/experiments"] --> P51("5.1 BOLA & Bounds Check")
  P51 --> P52("5.2 Ephemeral fx_test_* Mint")
  P52 --> P53("5.3 Baseline/Inject/Recover")
  P53 --> P54("5.4 Guaranteed Finally Cleanup")`,
    svgBody: `
      <text x="50" y="45" font-weight="700" font-size="13.5" fill="#1E3A8A">SUBSYSTEM 1.0 — AUTHENTICATION, ROTATING REFRESH SESSIONS &amp; OTP RECOVERY (FTX-AUTH-001)</text>
      <rect x="40" y="65" width="255" height="115" rx="10" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="2"/>
      <text x="167" y="92" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">1.1 Identifier &amp; Bcrypt Guard</text>
      <text x="167" y="112" text-anchor="middle" font-size="10.8" fill="#334155">Normalize email / E.164 phone;</text>
      <text x="167" y="129" text-anchor="middle" font-size="10.8" fill="#334155">constant-time bcrypt.compare()</text>
      <text x="167" y="154" text-anchor="middle" font-family="monospace" font-size="10" fill="#1D4ED8">users (phone_verified check)</text>

      <rect x="330" y="65" width="255" height="115" rx="10" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="2"/>
      <text x="457" y="92" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">1.2 Refresh Family Rotator</text>
      <text x="457" y="112" text-anchor="middle" font-size="10.8" fill="#334155">Issue 12h or 30d Remember-Me;</text>
      <text x="457" y="129" text-anchor="middle" font-size="10.8" fill="#334155">detect replay → revoke family</text>
      <text x="457" y="154" text-anchor="middle" font-family="monospace" font-size="10" fill="#1D4ED8">refresh_tokens + sid denylist</text>

      <rect x="620" y="65" width="255" height="115" rx="10" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="2"/>
      <text x="747" y="92" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">1.3 HMAC-OTP Verifier</text>
      <text x="747" y="112" text-anchor="middle" font-size="10.8" fill="#334155">6-digit CSPRNG OTP, 10m TTL,</text>
      <text x="747" y="129" text-anchor="middle" font-size="10.8" fill="#334155">≤5 attempts, atomic consume</text>
      <text x="747" y="154" text-anchor="middle" font-family="monospace" font-size="10" fill="#1D4ED8">recovery_challenges</text>

      <rect x="910" y="65" width="250" height="115" rx="10" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="2"/>
      <text x="1035" y="92" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">1.4 Password &amp; Session Reset</text>
      <text x="1035" y="112" text-anchor="middle" font-size="10.8" fill="#334155">Consume RESET_AUTHORIZATION,</text>
      <text x="1035" y="129" text-anchor="middle" font-size="10.8" fill="#334155">revoke all user tokens &amp; sockets</text>
      <text x="1035" y="154" text-anchor="middle" font-family="monospace" font-size="10" fill="#1D4ED8">auth_action_tokens</text>

      <line x1="295" y1="122" x2="328" y2="122" stroke="#1D4ED8" stroke-width="2" marker-end="url(#arrowBlue)"/>
      <line x1="585" y1="122" x2="618" y2="122" stroke="#1D4ED8" stroke-width="2" marker-end="url(#arrowBlue)"/>
      <line x1="875" y1="122" x2="908" y2="122" stroke="#1D4ED8" stroke-width="2" marker-end="url(#arrowBlue)"/>

      <!-- Shared Stores -->
      <rect x="140" y="230" width="920" height="52" rx="6" fill="#F8FAFC" stroke="#0F172A" stroke-width="2"/>
      <text x="600" y="261" text-anchor="middle" font-weight="700" font-size="12.2" fill="#0F172A">D1 &amp; D2: PostgreSQL (users, refresh_tokens, recovery_challenges, experiments, api_keys) + Redis BullMQ / PubSub</text>

      <line x1="457" y1="180" x2="457" y2="228" stroke="#0F172A" stroke-width="1.8" marker-end="url(#arrowSlate)"/>
      <line x1="747" y1="180" x2="747" y2="228" stroke="#0F172A" stroke-width="1.8" marker-end="url(#arrowSlate)"/>

      <text x="50" y="345" font-weight="700" font-size="13.5" fill="#4C1D95">SUBSYSTEM 5.0 — CHAOS EXPERIMENT EXECUTION &amp; GUARANTEED EPHEMERAL CLEANUP</text>
      <rect x="40" y="368" width="255" height="125" rx="10" fill="#F5F3FF" stroke="#6D28D9" stroke-width="2"/>
      <text x="167" y="396" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">5.1 Ownership &amp; Bounds</text>
      <text x="167" y="418" text-anchor="middle" font-size="10.8" fill="#334155">Verify route belongs to project,</text>
      <text x="167" y="435" text-anchor="middle" font-size="10.8" fill="#334155">enforce DEVELOPER+ &amp; ≤60s cap</text>
      <text x="167" y="465" text-anchor="middle" font-family="monospace" font-size="10" fill="#6D28D9">status = QUEUED (BullMQ)</text>

      <rect x="330" y="368" width="255" height="125" rx="10" fill="#F5F3FF" stroke="#6D28D9" stroke-width="2"/>
      <text x="457" y="396" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">5.2 Ephemeral Key Mint</text>
      <text x="457" y="418" text-anchor="middle" font-size="10.8" fill="#334155">Create temporary 15m TTL</text>
      <text x="457" y="435" text-anchor="middle" font-size="10.8" fill="#334155">fx_test_* scoped probe key</text>
      <text x="457" y="465" text-anchor="middle" font-family="monospace" font-size="10" fill="#6D28D9">api_keys (expires_at +15m)</text>

      <rect x="620" y="368" width="255" height="125" rx="10" fill="#F5F3FF" stroke="#6D28D9" stroke-width="2"/>
      <text x="747" y="396" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">5.3 3-Phase Probe Runner</text>
      <text x="747" y="418" text-anchor="middle" font-size="10.8" fill="#334155">5 BASELINE → RUNNING Fault</text>
      <text x="747" y="435" text-anchor="middle" font-size="10.8" fill="#334155">Waves → 5 RECOVERY probes</text>
      <text x="747" y="465" text-anchor="middle" font-family="monospace" font-size="10" fill="#6D28D9">Polls isExperimentCancelled()</text>

      <rect x="910" y="368" width="250" height="125" rx="10" fill="#ECFDF5" stroke="#047857" stroke-width="2"/>
      <text x="1035" y="396" text-anchor="middle" font-weight="700" font-size="12" fill="#065F46">5.4 Finally Block Cleanup</text>
      <text x="1035" y="418" text-anchor="middle" font-size="10.8" fill="#334155">Delete ephemeral fx_test_* key,</text>
      <text x="1035" y="435" text-anchor="middle" font-size="10.8" fill="#334155">evict key &amp; fault caches, verify</text>
      <text x="1035" y="465" text-anchor="middle" font-family="monospace" font-size="10" fill="#047857">Zero Zombie Faults</text>

      <line x1="295" y1="430" x2="328" y2="430" stroke="#6D28D9" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="585" y1="430" x2="618" y2="430" stroke="#6D28D9" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="875" y1="430" x2="908" y2="430" stroke="#047857" stroke-width="2" marker-end="url(#arrowGreen)"/>
      <line x1="457" y1="368" x2="457" y2="284" stroke="#6D28D9" stroke-width="1.8" marker-end="url(#arrowSlate)"/>
      <line x1="1035" y1="368" x2="1035" y2="284" stroke="#047857" stroke-width="1.8" marker-end="url(#arrowGreen)"/>
    `,
  },
  {
    id: 'fig05_use_case',
    title: 'Figure 2.5: FortiX UML Use Case Diagram',
    subtitle: 'Actors, System Boundary, Core Use Cases, and <<include>> Dependencies',
    width: 1180,
    height: 680,
    mermaid: `flowchart LR
  VIS["Actor: Unauthenticated User"] --> UC1(["Register / Sign In (Remember Me)"])
  VIS --> UC2(["Recover Password via 6-Digit OTP"])
  DEV["Actor: API Operator (DEVELOPER)"] --> UC3(["Create API Studio Store API (100 Products)"])
  DEV --> UC4(["Configure Route, Scoped API Key & Policy"])
  DEV --> UC5(["Execute Chaos / Rate-Limit Experiment"])
  DEV --> UC6(["Inspect Verification Verdict & Export PDF"])
  DEV --> UC7(["Manage Sessions, Phone & Guided Tutorials"])
  ADM["Actor: Platform Admin (ADMIN)"] --> UC8(["Manage User Roles, Tutorials & DLQ"])
  CLI["Actor: External API Consumer"] --> UC9(["Invoke Protected Gateway Endpoint"])`,
    svgBody: `
      <!-- System Boundary -->
      <rect x="250" y="25" width="680" height="620" rx="14" fill="#F8FAFC" stroke="#0F172A" stroke-width="2.5"/>
      <text x="590" y="55" text-anchor="middle" font-weight="800" font-size="15" fill="#0F172A">&lt;&lt;System&gt;&gt; FortiX API Security &amp; Resilience Platform</text>

      <!-- Left Actors -->
      <circle cx="95" cy="115" r="16" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="2"/>
      <line x1="95" y1="131" x2="95" y2="170" stroke="#1D4ED8" stroke-width="2"/>
      <line x1="70" y1="145" x2="120" y2="145" stroke="#1D4ED8" stroke-width="2"/>
      <line x1="95" y1="170" x2="75" y2="198" stroke="#1D4ED8" stroke-width="2"/>
      <line x1="95" y1="170" x2="115" y2="198" stroke="#1D4ED8" stroke-width="2"/>
      <text x="95" y="218" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">Unauthenticated</text>
      <text x="95" y="234" text-anchor="middle" font-size="11" fill="#475569">Operator</text>

      <circle cx="95" cy="345" r="16" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="2"/>
      <line x1="95" y1="361" x2="95" y2="400" stroke="#1D4ED8" stroke-width="2"/>
      <line x1="70" y1="375" x2="120" y2="375" stroke="#1D4ED8" stroke-width="2"/>
      <line x1="95" y1="400" x2="75" y2="428" stroke="#1D4ED8" stroke-width="2"/>
      <line x1="95" y1="400" x2="115" y2="428" stroke="#1D4ED8" stroke-width="2"/>
      <text x="95" y="448" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">API Operator</text>
      <text x="95" y="464" text-anchor="middle" font-size="11" fill="#475569">(DEVELOPER / VIEWER)</text>

      <circle cx="95" cy="545" r="16" fill="#F5F3FF" stroke="#6D28D9" stroke-width="2"/>
      <line x1="95" y1="561" x2="95" y2="595" stroke="#6D28D9" stroke-width="2"/>
      <line x1="70" y1="575" x2="120" y2="575" stroke="#6D28D9" stroke-width="2"/>
      <line x1="95" y1="595" x2="75" y2="620" stroke="#6D28D9" stroke-width="2"/>
      <line x1="95" y1="595" x2="115" y2="620" stroke="#6D28D9" stroke-width="2"/>
      <text x="95" y="640" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">Platform Admin (ADMIN)</text>

      <!-- Right Actors -->
      <circle cx="1075" cy="220" r="16" fill="#F0FDF4" stroke="#15803D" stroke-width="2"/>
      <line x1="1075" y1="236" x2="1075" y2="275" stroke="#15803D" stroke-width="2"/>
      <line x1="1050" y1="250" x2="1100" y2="250" stroke="#15803D" stroke-width="2"/>
      <line x1="1075" y1="275" x2="1055" y2="302" stroke="#15803D" stroke-width="2"/>
      <line x1="1075" y1="275" x2="1095" y2="302" stroke="#15803D" stroke-width="2"/>
      <text x="1075" y="322" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">API Consumer</text>

      <circle cx="1075" cy="465" r="16" fill="#FFFBEB" stroke="#B45309" stroke-width="2"/>
      <line x1="1075" y1="481" x2="1075" y2="520" stroke="#B45309" stroke-width="2"/>
      <line x1="1050" y1="495" x2="1100" y2="495" stroke="#B45309" stroke-width="2"/>
      <line x1="1075" y1="520" x2="1055" y2="547" stroke="#B45309" stroke-width="2"/>
      <line x1="1075" y1="520" x2="1095" y2="547" stroke="#B45309" stroke-width="2"/>
      <text x="1075" y="567" text-anchor="middle" font-weight="700" font-size="12" fill="#0F172A">BullMQ Worker</text>

      <!-- Use Case Ellipses -->
      <ellipse cx="445" cy="100" rx="145" ry="26" fill="#FFFFFF" stroke="#1D4ED8" stroke-width="1.8"/>
      <text x="445" y="104" text-anchor="middle" font-weight="600" font-size="11.2" fill="#0F172A">UC-01: Register &amp; Sign In (Remember Me)</text>

      <ellipse cx="445" cy="164" rx="145" ry="26" fill="#FFFFFF" stroke="#1D4ED8" stroke-width="1.8"/>
      <text x="445" y="168" text-anchor="middle" font-weight="600" font-size="11.2" fill="#0F172A">UC-02: Reset Password via OTP</text>

      <ellipse cx="775" cy="164" rx="125" ry="25" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="1.5" stroke-dasharray="4,2"/>
      <text x="775" y="168" text-anchor="middle" font-size="11" fill="#1E3A8A">Verify 6-Digit OTP HMAC</text>

      <ellipse cx="445" cy="234" rx="150" ry="26" fill="#FFFFFF" stroke="#0F172A" stroke-width="1.8"/>
      <text x="445" y="238" text-anchor="middle" font-weight="600" font-size="11.2" fill="#0F172A">UC-03: Create API Studio API &amp; Seed Data</text>

      <ellipse cx="445" cy="302" rx="150" ry="26" fill="#FFFFFF" stroke="#0F172A" stroke-width="1.8"/>
      <text x="445" y="306" text-anchor="middle" font-weight="600" font-size="11.2" fill="#0F172A">UC-04: Manage Routes, Keys &amp; Policies</text>

      <ellipse cx="775" cy="302" rx="125" ry="26" fill="#FFFBEB" stroke="#B45309" stroke-width="1.8"/>
      <text x="775" y="306" text-anchor="middle" font-weight="600" font-size="11" fill="#92400E">UC-09: Proxy Protected API</text>

      <ellipse cx="445" cy="370" rx="150" ry="26" fill="#FFFFFF" stroke="#0F172A" stroke-width="1.8"/>
      <text x="445" y="374" text-anchor="middle" font-weight="600" font-size="11.2" fill="#0F172A">UC-05: Run Chaos / Rate-Limit Experiment</text>

      <ellipse cx="775" cy="420" rx="125" ry="26" fill="#ECFEFF" stroke="#0E7490" stroke-width="1.8"/>
      <text x="775" y="424" text-anchor="middle" font-weight="600" font-size="11" fill="#155E75">UC-06: Verify SLA &amp; Evidence</text>

      <ellipse cx="445" cy="438" rx="150" ry="26" fill="#FFFFFF" stroke="#0F172A" stroke-width="1.8"/>
      <text x="445" y="442" text-anchor="middle" font-weight="600" font-size="11.2" fill="#0F172A">UC-07: Export PDF &amp; OpenAPI 3.0 Spec</text>

      <ellipse cx="445" cy="504" rx="150" ry="26" fill="#FFFFFF" stroke="#0F172A" stroke-width="1.8"/>
      <text x="445" y="508" text-anchor="middle" font-weight="600" font-size="11.2" fill="#0F172A">UC-08: Revoke Sessions &amp; Verify Phone</text>

      <ellipse cx="445" cy="570" rx="150" ry="25" fill="#ECFDF5" stroke="#047857" stroke-width="1.8"/>
      <text x="445" y="574" text-anchor="middle" font-weight="600" font-size="11" fill="#065F46">UC-11: Follow Guided Video Tutorials</text>

      <ellipse cx="765" cy="585" rx="135" ry="26" fill="#F5F3FF" stroke="#6D28D9" stroke-width="1.8"/>
      <text x="765" y="589" text-anchor="middle" font-weight="600" font-size="11" fill="#4C1D95">UC-10: RBAC, Catalog &amp; DLQ</text>

      <!-- Associations -->
      <line x1="130" y1="135" x2="300" y2="100" stroke="#1D4ED8" stroke-width="1.6"/>
      <line x1="130" y1="150" x2="300" y2="164" stroke="#1D4ED8" stroke-width="1.6"/>
      <line x1="590" y1="164" x2="648" y2="164" stroke="#1D4ED8" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrowBlue)"/>
      <text x="619" y="156" text-anchor="middle" font-size="9.5" fill="#1E3A8A">&lt;&lt;include&gt;&gt;</text>

      <line x1="130" y1="360" x2="295" y2="234" stroke="#0F172A" stroke-width="1.5"/>
      <line x1="130" y1="370" x2="295" y2="302" stroke="#0F172A" stroke-width="1.5"/>
      <line x1="130" y1="380" x2="295" y2="370" stroke="#0F172A" stroke-width="1.5"/>
      <line x1="130" y1="390" x2="295" y2="438" stroke="#0F172A" stroke-width="1.5"/>
      <line x1="130" y1="400" x2="295" y2="504" stroke="#0F172A" stroke-width="1.5"/>
      <line x1="130" y1="410" x2="295" y2="570" stroke="#047857" stroke-width="1.5"/>

      <line x1="595" y1="378" x2="650" y2="412" stroke="#0E7490" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrowSlate)"/>
      <text x="624" y="388" text-anchor="middle" font-size="9.5" fill="#155E75">&lt;&lt;include&gt;&gt;</text>

      <line x1="130" y1="585" x2="630" y2="585" stroke="#6D28D9" stroke-width="1.6"/>
      <line x1="1040" y1="255" x2="900" y2="300" stroke="#15803D" stroke-width="1.8"/>
      <line x1="1040" y1="490" x2="900" y2="425" stroke="#B45309" stroke-width="1.8"/>
      <line x1="1040" y1="478" x2="880" y2="322" stroke="#B45309" stroke-width="1.5" stroke-dasharray="4,2"/>
    `,
  },
  {
    id: 'fig06_class_diagram',
    title: 'Figure 2.6: FortiX Core Domain & Service UML Class Diagram',
    subtitle: 'Principal TypeScript Domain Entities, Security Enforcement Services, and Multiplicities',
    width: 1200,
    height: 700,
    mermaid: `classDiagram
  class User { +string id +string email +string phoneE164 +boolean phoneVerified +string role }
  class RefreshSessionService { +createRefreshSession() +rotateRefreshSession() +revokeUserSessionFamily() }
  class RecoveryService { +requestPasswordRecoveryOtp() +verifyPasswordRecoveryOtp() +computeOtpHmac() }
  class Project { +string id +string orgId +string name +string environment }
  class ApiRoute { +string id +string projectId +string pathPattern +string targetUrl }
  class SecurityPolicy { +string id +int rateLimitRpm +boolean enableWaf +boolean enableSsrf }
  class GatewayPipeline { +validateGatewayApiKey() +detectThreats() +checkRateLimit() +injectFault() }
  class StudioTargetHandler { +handleStudioUpstreamRequest() +validateStudioRecordPayload() }
  class VerificationEngine { +verifyPolicy() +flushTelemetryBarrier() +evaluateExperimentVerification() }
  User "1" --> "*" Project
  Project "1" --> "*" ApiRoute
  ApiRoute "1" --> "0..1" SecurityPolicy
  GatewayPipeline --> ApiRoute
  GatewayPipeline --> StudioTargetHandler
  VerificationEngine --> ApiRoute`,
    svgBody: `
      <!-- Row 1 Classes -->
      <g transform="translate(35,30)">
        <rect width="260" height="150" rx="6" fill="#FFFFFF" stroke="#1D4ED8" stroke-width="2"/>
        <rect width="260" height="30" rx="6" fill="#1D4ED8"/>
        <text x="130" y="20" text-anchor="middle" font-weight="700" font-size="12.5" fill="#FFFFFF">User &amp; AuthSession</text>
        <text x="12" y="50" font-family="monospace" font-size="10.5" fill="#0F172A">+ id: UUID (PK)</text>
        <text x="12" y="66" font-family="monospace" font-size="10.5" fill="#0F172A">+ email: string (UNIQUE)</text>
        <text x="12" y="82" font-family="monospace" font-size="10.5" fill="#0F172A">+ phoneE164: string? (UNIQUE)</text>
        <text x="12" y="98" font-family="monospace" font-size="10.5" fill="#0F172A">+ role: ADMIN|DEVELOPER|VIEWER</text>
        <line x1="0" y1="108" x2="260" y2="108" stroke="#CBD5E1"/>
        <text x="12" y="126" font-family="monospace" font-size="10.5" fill="#1E40AF">+ rotateRefreshSession()</text>
        <text x="12" y="142" font-family="monospace" font-size="10.5" fill="#1E40AF">+ revokeUserSessionFamily()</text>
      </g>

      <g transform="translate(335,30)">
        <rect width="260" height="150" rx="6" fill="#FFFFFF" stroke="#1D4ED8" stroke-width="2"/>
        <rect width="260" height="30" rx="6" fill="#1D4ED8"/>
        <text x="130" y="20" text-anchor="middle" font-weight="700" font-size="12.5" fill="#FFFFFF">RecoveryService</text>
        <text x="12" y="50" font-family="monospace" font-size="10.5" fill="#0F172A">+ challengeId: UUID</text>
        <text x="12" y="66" font-family="monospace" font-size="10.5" fill="#0F172A">- otpHmac: hex(HMAC-SHA256)</text>
        <text x="12" y="82" font-family="monospace" font-size="10.5" fill="#0F172A">+ failedAttempts: int (max 5)</text>
        <line x1="0" y1="96" x2="260" y2="96" stroke="#CBD5E1"/>
        <text x="12" y="114" font-family="monospace" font-size="10.5" fill="#1E40AF">+ requestPasswordRecoveryOtp()</text>
        <text x="12" y="130" font-family="monospace" font-size="10.5" fill="#1E40AF">+ verifyPasswordRecoveryOtp()</text>
        <text x="12" y="145" font-family="monospace" font-size="10.5" fill="#1E40AF">+ consumeAuthActionToken()</text>
      </g>

      <g transform="translate(635,30)">
        <rect width="250" height="150" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
        <rect width="250" height="30" rx="6" fill="#0F172A"/>
        <text x="125" y="20" text-anchor="middle" font-weight="700" font-size="12.5" fill="#FFFFFF">Project &amp; Organization</text>
        <text x="12" y="50" font-family="monospace" font-size="10.5" fill="#0F172A">+ id: UUID (PK)</text>
        <text x="12" y="66" font-family="monospace" font-size="10.5" fill="#0F172A">+ orgId: UUID (FK)</text>
        <text x="12" y="82" font-family="monospace" font-size="10.5" fill="#0F172A">+ environment: string</text>
        <line x1="0" y1="96" x2="250" y2="96" stroke="#CBD5E1"/>
        <text x="12" y="116" font-family="monospace" font-size="10.5" fill="#0F172A">+ requireProjectAccess()</text>
        <text x="12" y="134" font-family="monospace" font-size="10.5" fill="#0F172A">+ withTenantContext(rls)</text>
      </g>

      <g transform="translate(920,30)">
        <rect width="245" height="150" rx="6" fill="#FFFFFF" stroke="#047857" stroke-width="2"/>
        <rect width="245" height="30" rx="6" fill="#047857"/>
        <text x="122" y="20" text-anchor="middle" font-weight="700" font-size="12.5" fill="#FFFFFF">StudioApi &amp; Learning</text>
        <text x="12" y="50" font-family="monospace" font-size="10.5" fill="#0F172A">+ id: UUID (PK)</text>
        <text x="12" y="66" font-family="monospace" font-size="10.5" fill="#0F172A">+ basePath: /api/store</text>
        <text x="12" y="82" font-family="monospace" font-size="10.5" fill="#0F172A">+ fields: StudioFieldDef[]</text>
        <line x1="0" y1="96" x2="245" y2="96" stroke="#CBD5E1"/>
        <text x="12" y="116" font-family="monospace" font-size="10.5" fill="#065F46">+ handleStudioUpstreamReq()</text>
        <text x="12" y="134" font-family="monospace" font-size="10.5" fill="#065F46">+ generateStudioOpenApiSpec()</text>
      </g>

      <!-- Row 2 Classes -->
      <g transform="translate(35,250)">
        <rect width="260" height="160" rx="6" fill="#FFFFFF" stroke="#B45309" stroke-width="2"/>
        <rect width="260" height="30" rx="6" fill="#B45309"/>
        <text x="130" y="20" text-anchor="middle" font-weight="700" font-size="12.5" fill="#FFFFFF">HashedApiKeyCache &amp; ApiKey</text>
        <text x="12" y="50" font-family="monospace" font-size="10.5" fill="#0F172A">+ keyPrefix: fx_live_&lt;id&gt;</text>
        <text x="12" y="66" font-family="monospace" font-size="10.5" fill="#0F172A">- secretHash: bcrypt(secret)</text>
        <text x="12" y="82" font-family="monospace" font-size="10.5" fill="#0F172A">+ scopes: string[]</text>
        <text x="12" y="98" font-family="monospace" font-size="10.5" fill="#0F172A">+ expiresAt / revokedAt: Date?</text>
        <line x1="0" y1="110" x2="260" y2="110" stroke="#CBD5E1"/>
        <text x="12" y="128" font-family="monospace" font-size="10.5" fill="#92400E">+ invalidateApiKeyCache()</text>
        <text x="12" y="145" font-family="monospace" font-size="10.5" fill="#92400E">+ publishApiKeyInvalidation()</text>
      </g>

      <g transform="translate(345,250)">
        <rect width="280" height="160" rx="6" fill="#FFFFFF" stroke="#B45309" stroke-width="2"/>
        <rect width="280" height="30" rx="6" fill="#B45309"/>
        <text x="140" y="20" text-anchor="middle" font-weight="700" font-size="12.5" fill="#FFFFFF">GatewayEnforcementPipeline</text>
        <text x="12" y="50" font-family="monospace" font-size="10.5" fill="#0F172A">+ routeId: UUID</text>
        <text x="12" y="66" font-family="monospace" font-size="10.5" fill="#0F172A">+ targetUrl: string</text>
        <text x="12" y="82" font-family="monospace" font-size="10.5" fill="#0F172A">+ policy: SecurityPolicy</text>
        <line x1="0" y1="96" x2="280" y2="96" stroke="#CBD5E1"/>
        <text x="12" y="114" font-family="monospace" font-size="10.5" fill="#92400E">+ isSafeTarget() / safeDnsLookup()</text>
        <text x="12" y="130" font-family="monospace" font-size="10.5" fill="#92400E">+ detectThreats() / checkRateLimit()</text>
        <text x="12" y="146" font-family="monospace" font-size="10.5" fill="#92400E">+ enqueueMetric()</text>
      </g>

      <g transform="translate(675,250)">
        <rect width="240" height="160" rx="6" fill="#FFFFFF" stroke="#6D28D9" stroke-width="2"/>
        <rect width="240" height="30" rx="6" fill="#6D28D9"/>
        <text x="120" y="20" text-anchor="middle" font-weight="700" font-size="12.5" fill="#FFFFFF">Experiment &amp; Worker</text>
        <text x="12" y="50" font-family="monospace" font-size="10.5" fill="#0F172A">+ id: UUID (PK)</text>
        <text x="12" y="66" font-family="monospace" font-size="10.5" fill="#0F172A">+ type: latency|error_5xx|burst</text>
        <text x="12" y="82" font-family="monospace" font-size="10.5" fill="#0F172A">+ status: ExperimentState</text>
        <line x1="0" y1="96" x2="240" y2="96" stroke="#CBD5E1"/>
        <text x="12" y="116" font-family="monospace" font-size="10.5" fill="#5B21B6">+ runFixedProbeBatch()</text>
        <text x="12" y="134" font-family="monospace" font-size="10.5" fill="#5B21B6">+ runInjectionWorkload()</text>
      </g>

      <!-- Row 3 Classes -->
      <g transform="translate(260,475)">
        <rect width="340" height="165" rx="6" fill="#FFFFFF" stroke="#0E7490" stroke-width="2"/>
        <rect width="340" height="30" rx="6" fill="#0E7490"/>
        <text x="170" y="20" text-anchor="middle" font-weight="700" font-size="12.5" fill="#FFFFFF">VerificationEngine &amp; Verdict</text>
        <text x="12" y="50" font-family="monospace" font-size="10.5" fill="#0F172A">+ experimentId: UUID (FK)</text>
        <text x="12" y="66" font-family="monospace" font-size="10.5" fill="#0F172A">+ expected: PolicySLAContract</text>
        <text x="12" y="82" font-family="monospace" font-size="10.5" fill="#0F172A">+ observed: PhaseTelemetrySummary</text>
        <text x="12" y="98" font-family="monospace" font-size="10.5" fill="#0F172A">+ verdict: PASS | FAIL | INCONCLUSIVE</text>
        <line x1="0" y1="110" x2="340" y2="110" stroke="#CBD5E1"/>
        <text x="12" y="128" font-family="monospace" font-size="10.5" fill="#155E75">+ flushTelemetryBarrier()</text>
        <text x="12" y="146" font-family="monospace" font-size="10.5" fill="#155E75">+ verifyPolicy() / computePhaseMetrics()</text>
      </g>

      <g transform="translate(675,475)">
        <rect width="290" height="165" rx="6" fill="#FFFFFF" stroke="#047857" stroke-width="2"/>
        <rect width="290" height="30" rx="6" fill="#047857"/>
        <text x="145" y="20" text-anchor="middle" font-weight="700" font-size="12.5" fill="#FFFFFF">ArtifactStorageProvider</text>
        <text x="12" y="50" font-family="monospace" font-size="10.5" fill="#0F172A">+ artifactId: UUID</text>
        <text x="12" y="66" font-family="monospace" font-size="10.5" fill="#0F172A">+ projectId: UUID (Tenant Bound)</text>
        <text x="12" y="82" font-family="monospace" font-size="10.5" fill="#0F172A">+ sha256: string (64-hex)</text>
        <line x1="0" y1="100" x2="290" y2="100" stroke="#CBD5E1"/>
        <text x="12" y="122" font-family="monospace" font-size="10.5" fill="#065F46">+ put(pdfBuffer, metadata)</text>
        <text x="12" y="140" font-family="monospace" font-size="10.5" fill="#065F46">+ get(artifactId, projectId)</text>
      </g>

      <!-- Connectors -->
      <line x1="295" y1="105" x2="335" y2="105" stroke="#1D4ED8" stroke-width="1.8"/>
      <line x1="595" y1="105" x2="635" y2="105" stroke="#0F172A" stroke-width="1.8"/>
      <line x1="885" y1="105" x2="920" y2="105" stroke="#047857" stroke-width="1.8"/>
      <line x1="760" y1="180" x2="485" y2="250" stroke="#0F172A" stroke-width="1.8"/>
      <line x1="295" y1="330" x2="345" y2="330" stroke="#B45309" stroke-width="1.8"/>
      <line x1="625" y1="330" x2="675" y2="330" stroke="#6D28D9" stroke-width="1.8"/>
      <line x1="795" y1="410" x2="520" y2="475" stroke="#0E7490" stroke-width="1.8" marker-end="url(#arrowSlate)"/>
      <line x1="600" y1="555" x2="675" y2="555" stroke="#047857" stroke-width="1.8" marker-end="url(#arrowGreen)"/>
    `,
  },
];

function buildSequenceSvg(
  actors: string[],
  messages: Array<{ from: number; to: number; label: string; dashed?: boolean; note?: string }>
): { svgBody: string; height: number } {
  const width = 1180;
  const marginX = 95;
  const span = width - marginX * 2;
  const stepX = actors.length > 1 ? span / (actors.length - 1) : span;
  const startY = 88;
  const rowH = 44;
  const totalHeight = Math.max(460, startY + messages.length * rowH + 80);

  const parts: string[] = [];

  actors.forEach((actor, idx) => {
    const cx = Math.round(marginX + idx * stepX);
    parts.push(
      `<line x1="${cx}" y1="62" x2="${cx}" y2="${totalHeight - 35}" stroke="#94A3B8" stroke-width="1.6" stroke-dasharray="5,4"/>`
    );
    parts.push(
      `<rect x="${cx - 82}" y="20" width="164" height="42" rx="7" fill="#0F172A" stroke="#1E293B" stroke-width="1.5"/>`
    );
    parts.push(
      `<text x="${cx}" y="45" text-anchor="middle" font-weight="700" font-size="11.5" fill="#FFFFFF">${actor}</text>`
    );
  });

  messages.forEach((m, idx) => {
    const y = startY + idx * rowH;
    const x1 = Math.round(marginX + m.from * stepX);
    const x2 = Math.round(marginX + m.to * stepX);
    const dash = m.dashed ? 'stroke-dasharray="5,3"' : '';
    const color = m.dashed ? '#475569' : '#1D4ED8';
    const marker = m.dashed ? 'url(#arrowSlate)' : 'url(#arrowBlue)';

    if (m.from === m.to) {
      parts.push(
        `<path d="M ${x1} ${y - 6} L ${x1 + 42} ${y - 6} L ${x1 + 42} ${y + 12} L ${x1 + 4} ${y + 12}" fill="none" stroke="${color}" stroke-width="1.8" marker-end="${marker}"/>`
      );
      parts.push(
        `<rect x="${x1 + 48}" y="${y - 14}" width="315" height="22" rx="4" fill="#EFF6FF"/>`
      );
      parts.push(
        `<text x="${x1 + 54}" y="${y + 1}" font-size="10.5" font-weight="600" fill="#1E3A8A">${m.label}</text>`
      );
    } else {
      const midX = Math.round((x1 + x2) / 2);
      const dir = x2 > x1 ? -4 : 4;
      parts.push(
        `<line x1="${x1}" y1="${y}" x2="${x2 + dir}" y2="${y}" stroke="${color}" stroke-width="1.9" ${dash} marker-end="${marker}"/>`
      );
      const labelW = Math.min(410, Math.max(150, m.label.length * 6.2 + 16));
      parts.push(
        `<rect x="${midX - labelW / 2}" y="${y - 18}" width="${labelW}" height="15" rx="3" fill="#FFFFFF" opacity="0.95"/>`
      );
      parts.push(
        `<text x="${midX}" y="${y - 7}" text-anchor="middle" font-size="10.6" font-weight="${m.dashed ? '500' : '600'}" fill="${m.dashed ? '#334155' : '#0F172A'}">${m.label}</text>`
      );
    }
  });

  return { svgBody: parts.join('\n'), height: totalHeight };
}

const SEQUENCE_SPECS: Array<{
  id: string;
  title: string;
  subtitle: string;
  mermaid: string;
  actors: string[];
  messages: Array<{ from: number; to: number; label: string; dashed?: boolean }>;
}> = [
  {
    id: 'fig07_seq_auth_recovery',
    title: 'Figure 2.7: Sequence Diagram 1 — Registration, Remember-Me Rotation & OTP Password Recovery',
    subtitle: 'End-to-End FTX-AUTH-001 Lifecycle: HttpOnly Session + Refresh Family Rotation + HMAC-SHA256 OTP Reset',
    actors: ['Browser SPA', 'Auth Router', 'Session / OTP Svc', 'PostgreSQL', 'Mail/SMS Outbox'],
    mermaid: `sequenceDiagram
  Browser SPA->>Auth Router: POST /api/auth/login {identifier, password, rememberMe:true}
  Auth Router->>PostgreSQL: SELECT user + bcrypt.compare()
  Auth Router->>Session / OTP Svc: createRefreshSession(rememberMe:true)
  Session / OTP Svc->>PostgreSQL: INSERT refresh_tokens (family_id, SHA-256)
  Auth Router-->>Browser SPA: 200 + Set-Cookie fortix_session, fortix_refresh, fortix_csrf
  Browser SPA->>Auth Router: POST /api/auth/forgot-password {identifier}
  Auth Router->>Session / OTP Svc: requestPasswordRecoveryOtp()
  Session / OTP Svc->>PostgreSQL: INSERT recovery_challenges (otp_hmac)
  Session / OTP Svc->>Mail/SMS Outbox: Deliver 6-digit OTP (verify 2xx)
  Browser SPA->>Auth Router: POST /api/auth/verify-reset-otp {challengeId, otp}
  Session / OTP Svc->>PostgreSQL: Atomic UPDATE consumed_at + INSERT RESET_AUTHORIZATION
  Auth Router-->>Browser SPA: 200 {resetAuthorization}
  Browser SPA->>Auth Router: POST /api/auth/reset-password {resetAuthorization, newPassword, confirmPassword}
  Auth Router->>PostgreSQL: Consume token + UPDATE password_hash + Revoke all refresh_tokens`,
    messages: [
      { from: 0, to: 1, label: '1. POST /api/auth/login {identifier, password, rememberMe: true}' },
      { from: 1, to: 3, label: '2. Lookup user (email / verified phoneE164) + bcrypt.compare()' },
      { from: 1, to: 2, label: '3. createRefreshSession(30d) + signAccessJwt(sid)' },
      { from: 2, to: 3, label: '4. INSERT refresh_tokens (family_id, SHA-256 token_hash)' },
      { from: 1, to: 0, label: '5. 200 OK + Set-Cookie: fortix_session, fortix_refresh, fortix_csrf', dashed: true },
      { from: 0, to: 1, label: '6. POST /api/auth/forgot-password {identifier}' },
      { from: 1, to: 2, label: '7. Generate CSPRNG 6-digit OTP + keyed HMAC-SHA256' },
      { from: 2, to: 3, label: '8. INSERT recovery_challenges (10m TTL, max 5 attempts)' },
      { from: 2, to: 4, label: '9. Dispatch OTP via Email/SMS Provider & assert HTTP 2xx' },
      { from: 1, to: 0, label: '10. 200 Generic Notice + challengeId + destinationMasked', dashed: true },
      { from: 0, to: 1, label: '11. POST /api/auth/verify-reset-otp {challengeId, otp}' },
      { from: 1, to: 3, label: '12. Atomic UPDATE recovery_challenges SET consumed_at=NOW()' },
      { from: 1, to: 0, label: '13. 200 OK {resetAuthorization (single-use, 10m)}', dashed: true },
      { from: 0, to: 1, label: '14. POST /api/auth/reset-password {resetAuthorization, new, confirm}' },
      { from: 1, to: 3, label: '15. Consume token + UPDATE password_hash + Revoke ALL sessions' },
      { from: 1, to: 0, label: '16. 200 Password Reset Confirmed (Clear Cookies & Sockets)', dashed: true },
    ],
  },
  {
    id: 'fig08_seq_gateway_proxy',
    title: 'Figure 2.8: Sequence Diagram 2 — Gateway Reverse-Proxy Request & Sanitized Forwarding',
    subtitle: 'Full Request Hop Through /proxy/:routeId/* with Credential Stripping, Upstream Timeout, and Telemetry',
    actors: ['API Client', 'FortiX Gateway', 'SSRF & WAF Guard', 'Upstream API', 'Redis Stream'],
    mermaid: `sequenceDiagram
  API Client->>FortiX Gateway: GET /proxy/:routeId/v1/orders (X-API-Key)
  FortiX Gateway->>SSRF & WAF Guard: Validate targetUrl + safeDnsLookup + detectThreats
  SSRF & WAF Guard-->>FortiX Gateway: SAFE (No SQLi/XSS/Private IP)
  FortiX Gateway->>Upstream API: Forward GET /v1/orders (Strip X-API-Key, Set Timeout)
  Upstream API-->>FortiX Gateway: 200 OK + JSON Payload
  FortiX Gateway->>Redis Stream: XADD fortix:stream:metrics {routeId, latencyMs, 200}
  FortiX Gateway-->>API Client: 200 OK + X-Request-ID`,
    messages: [
      { from: 0, to: 1, label: '1. GET /proxy/:routeId/v1/orders (Header: X-API-Key: fx_live_...)' },
      { from: 1, to: 1, label: '2. Resolve routeId & assign distributed X-Request-ID' },
      { from: 1, to: 2, label: '3. Verify API-key hash, SSRF target safety & WAF payload rules' },
      { from: 2, to: 1, label: '4. Policy Passed (Authorized, Public Target, Clean URI/Body)', dashed: true },
      { from: 1, to: 1, label: '5. Strip X-API-Key / Bearer fx_* & attach upstream timeout' },
      { from: 1, to: 3, label: '6. Proxied HTTP Request via safeDnsLookup Agent' },
      { from: 3, to: 1, label: '7. HTTP 200 OK + Upstream JSON Response', dashed: true },
      { from: 1, to: 4, label: '8. Non-blocking enqueueMetric() -> fortix:stream:metrics + Socket.IO' },
      { from: 1, to: 0, label: '9. HTTP 200 OK + X-Request-ID Header', dashed: true },
    ],
  },
  {
    id: 'fig09_seq_apikey_authz',
    title: 'Figure 2.9: Sequence Diagram 3 — Scoped API-Key Validation & Distributed Pub/Sub Revocation',
    subtitle: 'SHA-256 Digest Caching, Bcrypt Secret Verification, and Instant Multi-Replica Eviction',
    actors: ['API Client', 'Gateway Auth', 'HashedKeyCache', 'PostgreSQL', 'Redis Pub/Sub'],
    mermaid: `sequenceDiagram
  API Client->>Gateway Auth: Request with X-API-Key: fx_live_<id>_<secret>
  Gateway Auth->>HashedKeyCache: Lookup SHA-256(rawKey)
  HashedKeyCache-->>Gateway Auth: Cache Miss
  Gateway Auth->>PostgreSQL: SELECT api_keys WHERE id = <id>
  Gateway Auth->>Gateway Auth: bcrypt.compare(secret, secret_hash) + check scopes/expiry
  Gateway Auth->>HashedKeyCache: Store SHA-256(rawKey) (strip secretHash)
  Redis Pub/Sub->>HashedKeyCache: Channel fortix:api-key:revoked:v1 -> Evict keyId immediately`,
    messages: [
      { from: 0, to: 1, label: '1. Request with X-API-Key: fx_live_<keyId>_<secret>' },
      { from: 1, to: 2, label: '2. Lookup SHA-256(rawApiKey) in bounded HashedApiKeyCache' },
      { from: 2, to: 1, label: '3. Cache Miss (first request or post-TTL)', dashed: true },
      { from: 1, to: 3, label: '4. SELECT * FROM api_keys WHERE id = keyId AND projectId = route.projectId' },
      { from: 3, to: 1, label: '5. Return key metadata + bcrypt secret_hash', dashed: true },
      { from: 1, to: 1, label: '6. Verify revoked_at IS NULL, expires_at > NOW(), bcrypt.compare()' },
      { from: 1, to: 2, label: '7. Cache safe metadata under SHA-256 digest (secretHash stripped)' },
      { from: 4, to: 2, label: '8. On Operator Revoke: PUBLISH fortix:api-key:revoked:v1 -> Evict' },
      { from: 0, to: 1, label: '9. Subsequent Request with Revoked Key' },
      { from: 1, to: 0, label: '10. Immediate HTTP 401 Unauthorized (Pre-Fault)', dashed: true },
    ],
  },
  {
    id: 'fig10_seq_ratelimit',
    title: 'Figure 2.10: Sequence Diagram 4 — Atomic Redis Lua Token-Bucket Rate-Limit Enforcement',
    subtitle: 'Single-Roundtrip Atomic HMGET/HMSET Refill & Decrement with Production Fail-Closed Guard',
    actors: ['API Client', 'Gateway Pipeline', 'RateLimit Service', 'PostgreSQL', 'Redis 7 (Lua)'],
    mermaid: `sequenceDiagram
  API Client->>Gateway Pipeline: Concurrent Burst Traffic (/proxy/:routeId)
  Gateway Pipeline->>RateLimit Service: checkRateLimit(routeId, identifier, rpm)
  RateLimit Service->>PostgreSQL: Fetch route security_policies.rate_limit_rpm
  RateLimit Service->>Redis 7 (Lua): EVAL token_bucket.lua ratelimit:routeId:id capacity refill now
  Redis 7 (Lua)-->>RateLimit Service: {allowed: 1, remaining: 19} or {allowed: 0, remaining: 0}
  Gateway Pipeline-->>API Client: 200 OK (Allowed) or 429 Too Many Requests (Throttled)`,
    messages: [
      { from: 0, to: 1, label: '1. Burst HTTP Request (/proxy/:routeId)' },
      { from: 1, to: 2, label: '2. checkRateLimit(routeId, keyOrIpIdentifier, rpm)' },
      { from: 2, to: 3, label: '3. Read configured rate_limit_rpm from security_policies' },
      { from: 3, to: 2, label: '4. Return capacity & refillRate (e.g., 30 RPM)', dashed: true },
      { from: 2, to: 4, label: '5. EVAL Lua Script on ratelimit:{routeId}:{id} (HMGET -> refill -> HMSET)' },
      { from: 4, to: 2, label: '6a. Tokens > 0: Return {allowed: 1, remaining: N-1}', dashed: true },
      { from: 1, to: 0, label: '7a. Forward Request -> 200 OK', dashed: true },
      { from: 0, to: 1, label: '8. Excess Concurrent Request Exceeding Bucket Capacity' },
      { from: 2, to: 4, label: '9. EVAL Lua Script -> Tokens == 0' },
      { from: 4, to: 2, label: '10. Return {allowed: 0, remaining: 0}', dashed: true },
      { from: 1, to: 0, label: '11. Reject HTTP 429 Too Many Requests + Record MetricLog(429)', dashed: true },
    ],
  },
  {
    id: 'fig11_seq_experiment_exec',
    title: 'Figure 2.11: Sequence Diagram 5 — Experiment Creation, BullMQ Queuing & Three-Phase Execution',
    subtitle: 'Controlled Execution Across BASELINE (5 Probes) → INJECTION (Active Fault) → RECOVERY (5 Probes)',
    actors: ['Operator UI', 'Experiments API', 'BullMQ Queue', 'Experiment Worker', 'FortiX Gateway'],
    mermaid: `sequenceDiagram
  Operator UI->>Experiments API: POST /api/control/experiments {routeId, type, config}
  Experiments API->>BullMQ Queue: INSERT experiment (QUEUED) + queue.add('run-experiment')
  BullMQ Queue->>Experiment Worker: Dequeue job
  Experiment Worker->>FortiX Gateway: Phase 1 BASELINE: 5 normal probes (status=OBSERVING)
  Experiment Worker->>FortiX Gateway: Phase 2 INJECTION: Set RUNNING + send workload probes
  Experiment Worker->>FortiX Gateway: Phase 3 RECOVERY: Clear fault + send 5 recovery probes`,
    messages: [
      { from: 0, to: 1, label: '1. POST /api/control/experiments {routeId, type: "latency", latencyMs: 250}' },
      { from: 1, to: 2, label: '2. Persist status=QUEUED & enqueue BullMQ job (exponential backoff)' },
      { from: 1, to: 0, label: '3. 201 Created {experimentId, status: "QUEUED"}', dashed: true },
      { from: 2, to: 3, label: '4. Worker claims job & mints ephemeral 15m fx_test_* API key' },
      { from: 3, to: 4, label: '5. BASELINE Phase: Send 5 clean probes (base_<exp>_1..5) prior to fault' },
      { from: 4, to: 3, label: '6. Baseline HTTP 200 responses + low-latency metric_logs', dashed: true },
      { from: 3, to: 3, label: '7. Transition status -> RUNNING & invalidate gateway expCache' },
      { from: 3, to: 4, label: '8. INJECTION Phase: Send bounded probe waves (inj_<exp>_1..N)' },
      { from: 4, to: 3, label: '9. Gateway injects +250ms delay on authenticated route traffic', dashed: true },
      { from: 3, to: 3, label: '10. Transition status -> ANALYZING (fault deactivated)' },
      { from: 3, to: 4, label: '11. RECOVERY Phase: Send 5 post-fault probes (rec_<exp>_1..5)' },
    ],
  },
  {
    id: 'fig12_seq_fault_cleanup',
    title: 'Figure 2.12: Sequence Diagram 6 — Bounded Fault Injection, Operator Cancellation & Guaranteed Cleanup',
    subtitle: 'Fail-Safe Termination Guaranteeing Ephemeral Key Deletion and Fault Removal Under Errors or Abort',
    actors: ['Operator UI', 'Experiments API', 'Experiment Worker', 'Gateway Cache', 'PostgreSQL'],
    mermaid: `sequenceDiagram
  Operator UI->>Experiments API: POST /api/control/experiments/:id/cancel
  Experiments API->>PostgreSQL: UPDATE experiments SET status='CANCELLED'
  Experiments API->>Gateway Cache: invalidateExpCache(routeId)
  Experiment Worker->>PostgreSQL: Poll isExperimentCancelled(id) -> true
  Experiment Worker->>PostgreSQL: finally: DELETE temp fx_test_* key & clear RUNNING state`,
    messages: [
      { from: 2, to: 4, label: '1. Experiment enters RUNNING state with bounded durationMs (<= 60s)' },
      { from: 0, to: 1, label: '2. Operator clicks Abort -> POST /api/control/experiments/:id/cancel' },
      { from: 1, to: 4, label: '3. UPDATE experiments SET status = "CANCELLED", completed_at = NOW()' },
      { from: 1, to: 3, label: '4. invalidateExpCache(routeId) — halts fault injection immediately' },
      { from: 2, to: 4, label: '5. Worker loop checks isExperimentCancelled() before next wave -> true' },
      { from: 2, to: 4, label: '6. try/finally block: DELETE ephemeral fx_test_* API key row' },
      { from: 2, to: 3, label: '7. invalidateApiKeyCache(tempKeyId) + invalidateExpCache(routeId)' },
      { from: 1, to: 0, label: '8. Socket.IO broadcast experiment:updated {status: "CANCELLED"}', dashed: true },
    ],
  },
  {
    id: 'fig13_seq_telemetry_verify',
    title: 'Figure 2.13: Sequence Diagram 7 & 8 — Telemetry Stream Flush Barrier & Evidence Verification',
    subtitle: 'Eliminating Flush Race Conditions and Vacuous Passes Before Computing Deterministic PASS/FAIL Verdicts',
    actors: ['Experiment Worker', 'Verification Engine', 'Telemetry Barrier', 'PostgreSQL', 'Artifact Store'],
    mermaid: `sequenceDiagram
  Experiment Worker->>Verification Engine: verifyPolicy(expId, policyId, windows)
  Verification Engine->>Telemetry Barrier: flushTelemetryBarrier(timeoutMs: 3000)
  Telemetry Barrier->>PostgreSQL: Drain fortix:stream:metrics + commit pending metric_logs
  Telemetry Barrier-->>Verification Engine: TelemetrySyncResult {synced: true}
  Verification Engine->>PostgreSQL: SELECT metric_logs WHERE experiment_id = expId
  Verification Engine->>Verification Engine: Partition BASELINE / INJECTION / RECOVERY + Evaluate SLA
  Verification Engine->>PostgreSQL: INSERT verifications {expected, observed, verdict}
  Verification Engine->>Artifact Store: Persist SHA-256 Compliance PDF Report`,
    messages: [
      { from: 0, to: 1, label: '1. verifyPolicy(experimentId, policyId, {baseline, injection, recovery})' },
      { from: 1, to: 2, label: '2. Await flushTelemetryBarrier() before reading database' },
      { from: 2, to: 3, label: '3. Drain fortix:stream:metrics consumer batch to metric_logs' },
      { from: 2, to: 1, label: '4. Barrier Complete {flushedCount, timedOut: false}', dashed: true },
      { from: 1, to: 3, label: '5. Query all persisted metric_logs for experimentId (+skew padding)' },
      { from: 3, to: 1, label: '6. Return timestamped status_code, latency_ms & request_id rows', dashed: true },
      { from: 1, to: 1, label: '7. Partition BASELINE / INJECTION / RECOVERY & check coverage >= 80%' },
      { from: 1, to: 1, label: '8. Evaluate deterministic SLA rules (reject vacuous 0-sample runs)' },
      { from: 1, to: 3, label: '9. INSERT INTO verifications (expected, observed, verdict)' },
      { from: 1, to: 4, label: '10. POST /api/control/reports/:id -> Persist SHA-256 PDF artifact' },
    ],
  },
  {
    id: 'fig14_seq_api_studio',
    title: 'Figure 2.14: Sequence Diagram 9 — FortiX API Studio 100-Product Provisioning & Protected CRUD',
    subtitle: 'Zero-Backend Self-Contained API Creation, Gateway Policy Attachment, Live CRUD, and OpenAPI Export',
    actors: ['Operator UI', 'Studio Control API', 'PostgreSQL', 'FortiX Gateway', 'Studio Target Handler'],
    mermaid: `sequenceDiagram
  Operator UI->>Studio Control API: POST /api/control/studio/apis (template: products_100)
  Studio Control API->>PostgreSQL: Transaction: INSERT api_routes, security_policies, studio_apis, 100 studio_records, api_keys
  Studio Control API-->>Operator UI: 201 Created {routeId, rawApiKey, totalRecords: 100}
  Operator UI->>FortiX Gateway: GET /proxy/:routeId/api/store/products (X-API-Key)
  FortiX Gateway->>Studio Target Handler: Enforce Auth/WAF/RateLimit -> handleStudioUpstreamRequest()
  Studio Target Handler->>PostgreSQL: Query paginated studio_records (project-isolated)
  FortiX Gateway-->>Operator UI: 200 OK {items: [prod_0001..], pagination}`,
    messages: [
      { from: 0, to: 1, label: '1. POST /api/control/studio/apis {name: "Store API", template: "products_100"}' },
      { from: 1, to: 2, label: '2. INSERT api_routes (http://fortix-studio.internal/studio/<id>) + policy' },
      { from: 1, to: 2, label: '3. INSERT studio_apis, studio_resources & 100 canonical INR studio_records' },
      { from: 1, to: 2, label: '4. Mint scoped gateway API key (bcrypt secret_hash)' },
      { from: 1, to: 0, label: '5. 201 Created {apiId, routeId, issuedApiKey.rawKey, totalRecords: 100}', dashed: true },
      { from: 0, to: 3, label: '6. Playground Request: GET /proxy/:routeId/api/store/products (X-API-Key)' },
      { from: 3, to: 3, label: '7. Enforce Key Auth, WAF SQLi/XSS check, Lua Rate Limit & Faults' },
      { from: 3, to: 4, label: '8. Dispatch internal target -> handleStudioUpstreamRequest()' },
      { from: 4, to: 2, label: '9. Verify studio_apis.projectId == route.projectId & query records' },
      { from: 3, to: 0, label: '10. 200 OK JSON + Enqueue real metric_logs telemetry', dashed: true },
    ],
  },
];

const DEPLOYMENT_AND_ER_SPECS: DiagramSpec[] = [
  {
    id: 'fig15_deployment',
    title: 'Figure 2.15: Component & Multi-Container Production Deployment Topology',
    subtitle: 'Docker Compose & Cloud Runtime Architecture Separating Stateless API Replicas, Workers, PostgreSQL 15 & Redis 7',
    width: 1180,
    height: 580,
    mermaid: `flowchart LR
  INET["HTTPS Clients & Operators"] --> LB["Reverse Proxy / TLS Ingress"]
  subgraph Docker["Docker Network / Cloud VPC"]
    API["Container: fortix-api (node dist/server.cjs, Non-Root User fortix, Port 3000/8080)"]
    WRK["Container: fortix-worker (node dist/worker.cjs, BullMQ + Webhook Workers)"]
    PG[("Container: postgres:15-alpine (pgdata Volume + RLS)")]
    RD[("Container: redis:7-alpine (appendonly yes, redisdata Volume)")]
    VOL[("Persistent Volume: /app/storage/artifacts")]
  end
  LB --> API
  API --> PG
  API --> RD
  API --> VOL
  WRK --> PG
  WRK --> RD`,
    svgBody: `
      <rect x="35" y="195" width="185" height="160" rx="10" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="2"/>
      <text x="127" y="235" text-anchor="middle" font-weight="700" font-size="13" fill="#1E3A8A">External Network</text>
      <text x="127" y="260" text-anchor="middle" font-size="11" fill="#334155">• Browser Operators</text>
      <text x="127" y="280" text-anchor="middle" font-size="11" fill="#334155">• API Consumers</text>
      <text x="127" y="300" text-anchor="middle" font-size="11" fill="#334155">• TLS Termination</text>
      <text x="127" y="328" text-anchor="middle" font-family="monospace" font-size="10.5" fill="#1D4ED8">HTTPS :443 → :3000/:8080</text>

      <!-- Docker Bridge Boundary -->
      <rect x="265" y="30" width="880" height="510" rx="14" fill="#F8FAFC" stroke="#0F172A" stroke-width="2.5" stroke-dasharray="7,4"/>
      <text x="705" y="58" text-anchor="middle" font-weight="800" font-size="14.5" fill="#0F172A">Isolated Container Bridge Network (docker-compose.yml / Cloud Runtime)</text>

      <rect x="300" y="90" width="380" height="185" rx="10" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
      <rect x="300" y="90" width="380" height="32" rx="8" fill="#0F172A"/>
      <text x="490" y="111" text-anchor="middle" font-weight="700" font-size="12.5" fill="#FFFFFF">&lt;&lt;container&gt;&gt; api (node:22-alpine)</text>
      <text x="318" y="142" font-family="monospace" font-size="11" fill="#0F172A">CMD: ["node", "dist/server.cjs"]</text>
      <text x="318" y="162" font-size="11.5" fill="#334155">• Runs as unprivileged user: fortix:fortix</text>
      <text x="318" y="182" font-size="11.5" fill="#334155">• Serves Vite SPA, Control Plane &amp; /proxy/*</text>
      <text x="318" y="202" font-size="11.5" fill="#334155">• Readiness probe: GET /api/health/ready</text>
      <text x="318" y="222" font-size="11.5" fill="#334155">• Limits: 1.0 vCPU, 1 GB RAM, Fail-Closed Redis</text>
      <text x="318" y="246" font-family="monospace" font-size="10.5" fill="#1D4ED8">START_INTERNAL_WORKER=false</text>

      <rect x="300" y="315" width="380" height="190" rx="10" fill="#FFFFFF" stroke="#6D28D9" stroke-width="2"/>
      <rect x="300" y="315" width="380" height="32" rx="8" fill="#6D28D9"/>
      <text x="490" y="336" text-anchor="middle" font-weight="700" font-size="12.5" fill="#FFFFFF">&lt;&lt;container&gt;&gt; worker (node:22-alpine)</text>
      <text x="318" y="368" font-family="monospace" font-size="11" fill="#0F172A">CMD: ["node", "dist/worker.cjs"]</text>
      <text x="318" y="388" font-size="11.5" fill="#334155">• Dedicated BullMQ Experiment &amp; Webhook Worker</text>
      <text x="318" y="408" font-size="11.5" fill="#334155">• Isolated from proxy event loop latency</text>
      <text x="318" y="428" font-size="11.5" fill="#334155">• Executes 3-Phase Probes &amp; Verification Engine</text>
      <text x="318" y="448" font-size="11.5" fill="#334155">• Exponential backoff + Dead-Letter Queue (DLQ)</text>
      <text x="318" y="472" font-family="monospace" font-size="10.5" fill="#6D28D9">STRICT_PERSISTENT_DB=true</text>

      <rect x="755" y="90" width="355" height="125" rx="10" fill="#F1F5F9" stroke="#0F172A" stroke-width="2"/>
      <text x="932" y="120" text-anchor="middle" font-weight="700" font-size="13" fill="#0F172A">&lt;&lt;database&gt;&gt; postgres:15-alpine</text>
      <text x="932" y="144" text-anchor="middle" font-size="11.5" fill="#334155">Port 5432 · Persistent Volume: pgdata</text>
      <text x="932" y="164" text-anchor="middle" font-size="11.5" fill="#334155">Healthcheck: pg_isready · 8 Drizzle Migrations</text>
      <text x="932" y="186" text-anchor="middle" font-family="monospace" font-size="10.2" fill="#1E40AF">23 Tables + 17 Tenant/User RLS Policies</text>

      <rect x="755" y="245" width="355" height="125" rx="10" fill="#FFF1F2" stroke="#BE123C" stroke-width="2"/>
      <text x="932" y="275" text-anchor="middle" font-weight="700" font-size="13" fill="#881337">&lt;&lt;cache/queue&gt;&gt; redis:7-alpine</text>
      <text x="932" y="299" text-anchor="middle" font-size="11.5" fill="#334155">Port 6379 · AOF Persistence (--appendonly yes)</text>
      <text x="932" y="319" text-anchor="middle" font-size="11.5" fill="#334155">Lua Token Bucket · Telemetry Streams · Pub/Sub</text>
      <text x="932" y="341" text-anchor="middle" font-family="monospace" font-size="10.5" fill="#BE123C">Volume: redisdata · Healthcheck: redis-cli ping</text>

      <rect x="755" y="400" width="355" height="105" rx="10" fill="#ECFDF5" stroke="#047857" stroke-width="2"/>
      <text x="932" y="430" text-anchor="middle" font-weight="700" font-size="13" fill="#065F46">&lt;&lt;storage&gt;&gt; Evidence Artifacts</text>
      <text x="932" y="454" text-anchor="middle" font-size="11.5" fill="#334155">/app/storage/artifacts or S3-Compatible Bucket</text>
      <text x="932" y="476" text-anchor="middle" font-family="monospace" font-size="10.5" fill="#047857">SHA-256 Verified Compliance PDFs</text>

      <line x1="220" y1="245" x2="298" y2="185" stroke="#1D4ED8" stroke-width="2.2" marker-end="url(#arrowBlue)"/>
      <line x1="680" y1="152" x2="753" y2="152" stroke="#0F172A" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="680" y1="220" x2="753" y2="285" stroke="#BE123C" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="680" y1="255" x2="753" y2="435" stroke="#047857" stroke-width="1.8" marker-end="url(#arrowGreen)"/>
      <line x1="680" y1="380" x2="753" y2="180" stroke="#0F172A" stroke-width="1.8" marker-end="url(#arrowSlate)"/>
      <line x1="680" y1="410" x2="753" y2="325" stroke="#BE123C" stroke-width="2" marker-end="url(#arrowSlate)"/>
    `,
  },
  {
    id: 'fig16_er_diagram',
    title: 'Figure 3.1: Entity-Relationship (ER) Diagram — Complete 23-Table PostgreSQL Schema',
    subtitle: 'Primary Keys, Foreign Key Cascade Chains, Cardinalities, and Domain Groupings in src/db/schema.ts',
    width: 1240,
    height: 920,
    mermaid: `erDiagram
  users ||--o{ auth_action_tokens : issues
  users ||--o{ refresh_tokens : maintains
  users ||--o{ recovery_challenges : verifies
  users ||--o{ organizations : owns
  users ||--o{ learning_progress : tracks
  learning_tutorials ||--o{ learning_progress : records
  organizations ||--o{ projects : contains
  projects ||--|| project_settings : configures
  projects ||--o{ audit_logs : records
  projects ||--o{ api_keys : scopes
  projects ||--o{ api_routes : exposes
  projects ||--o{ webhooks : triggers
  webhooks ||--o{ webhook_deliveries : logs
  api_routes ||--o{ security_policies : enforces
  api_routes ||--o{ experiments : tests
  api_routes ||--o{ metric_logs : observes
  api_routes ||--o{ security_events : flags
  api_routes ||--o{ workflow_runs : orchestrates
  experiments ||--o{ verifications : proves
  projects ||--o{ studio_apis : hosts
  studio_apis ||--o{ studio_resources : defines
  studio_resources ||--o{ studio_records : stores`,
    svgBody: `
      <!-- Domain 1: Identity & Recovery (4 Tables) -->
      <rect x="25" y="25" width="280" height="355" rx="10" fill="#EFF6FF" stroke="#1D4ED8" stroke-width="1.8"/>
      <text x="165" y="48" text-anchor="middle" font-weight="800" font-size="12.5" fill="#1E3A8A">IDENTITY &amp; RECOVERY (4 TABLES)</text>

      <rect x="42" y="62" width="246" height="68" rx="6" fill="#FFFFFF" stroke="#1D4ED8" stroke-width="1.8"/>
      <text x="165" y="80" text-anchor="middle" font-weight="700" font-size="11.5" fill="#0F172A">1. users</text>
      <text x="52" y="96" font-family="monospace" font-size="9.8" fill="#334155">PK id | UQ email | UQ phone_e164</text>
      <text x="52" y="112" font-family="monospace" font-size="9.8" fill="#334155">password_hash, role, phone_verified</text>

      <rect x="42" y="142" width="246" height="64" rx="6" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
      <text x="165" y="160" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">2. refresh_tokens</text>
      <text x="50" y="176" font-family="monospace" font-size="8.6" fill="#334155">PK id | FK user_id | UQ token_hash</text>
      <text x="50" y="191" font-family="monospace" font-size="8.6" fill="#334155">family_id, remember_me, reuse_detected_at</text>

      <rect x="42" y="218" width="246" height="64" rx="6" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
      <text x="165" y="236" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">3. recovery_challenges</text>
      <text x="50" y="252" font-family="monospace" font-size="8.6" fill="#334155">PK id | FK user_id | otp_hmac</text>
      <text x="50" y="267" font-family="monospace" font-size="8.6" fill="#334155">channel, purpose, failed_attempts, consumed</text>

      <rect x="42" y="294" width="246" height="68" rx="6" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
      <text x="165" y="312" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">4. auth_action_tokens</text>
      <text x="50" y="328" font-family="monospace" font-size="8.6" fill="#334155">PK id | FK user_id | UQ token_hash</text>
      <text x="50" y="344" font-family="monospace" font-size="8.6" fill="#334155">purpose (VERIFY|RESET|RESET_AUTH), used_at</text>

      <!-- Domain 2: Multi-Tenant Governance & Webhooks (6 Tables) -->
      <rect x="335" y="25" width="290" height="450" rx="10" fill="#F8FAFC" stroke="#0F172A" stroke-width="1.8"/>
      <text x="480" y="48" text-anchor="middle" font-weight="800" font-size="12.5" fill="#0F172A">TENANT &amp; GOVERNANCE (6 TABLES)</text>

      <rect x="352" y="62" width="256" height="56" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="1.6"/>
      <text x="480" y="80" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">5. organizations</text>
      <text x="360" y="98" font-family="monospace" font-size="8.8" fill="#334155">PK id | FK owner_id → users.id (CASCADE)</text>

      <rect x="352" y="130" width="256" height="62" rx="6" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
      <text x="480" y="148" text-anchor="middle" font-weight="700" font-size="11.5" fill="#1E3A8A">6. projects (Tenant Anchor)</text>
      <text x="360" y="166" font-family="monospace" font-size="8.8" fill="#334155">PK id | FK org_id → organizations.id</text>
      <text x="360" y="180" font-family="monospace" font-size="8.8" fill="#334155">name, environment, created_at</text>

      <rect x="352" y="204" width="256" height="58" rx="6" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
      <text x="480" y="222" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">7. project_settings (1:1)</text>
      <text x="360" y="238" font-family="monospace" font-size="8.8" fill="#334155">PK id | UQ FK project_id | version</text>
      <text x="360" y="252" font-family="monospace" font-size="8.8" fill="#334155">gateway/security/rateLimit/exp JSONB</text>

      <rect x="352" y="274" width="256" height="56" rx="6" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
      <text x="480" y="292" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">8. audit_logs</text>
      <text x="360" y="309" font-family="monospace" font-size="8.8" fill="#334155">PK id | FK project_id, user_id | diff JSONB</text>

      <rect x="352" y="342" width="256" height="56" rx="6" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
      <text x="480" y="360" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">9. webhooks</text>
      <text x="360" y="377" font-family="monospace" font-size="8.8" fill="#334155">PK id | FK project_id | url, secret, events</text>

      <rect x="352" y="408" width="256" height="56" rx="6" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
      <text x="480" y="426" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">10. webhook_deliveries</text>
      <text x="360" y="443" font-family="monospace" font-size="8.8" fill="#334155">PK id | FK webhook_id, project_id | sig</text>

      <!-- Domain 3: Gateway, Telemetry & Verification (8 Tables) -->
      <rect x="655" y="25" width="560" height="450" rx="10" fill="#FFFBEB" stroke="#B45309" stroke-width="1.8"/>
      <text x="935" y="48" text-anchor="middle" font-weight="800" font-size="12.5" fill="#92400E">GATEWAY, TELEMETRY, EXPERIMENTS &amp; VERIFICATION (8 TABLES)</text>

      <rect x="672" y="65" width="250" height="68" rx="6" fill="#FFFFFF" stroke="#B45309" stroke-width="1.8"/>
      <text x="797" y="83" text-anchor="middle" font-weight="700" font-size="11.5" fill="#0F172A">11. api_routes</text>
      <text x="682" y="100" font-family="monospace" font-size="9.5" fill="#334155">PK id | FK project_id</text>
      <text x="682" y="115" font-family="monospace" font-size="9.5" fill="#334155">path_pattern, target_url</text>

      <rect x="945" y="65" width="252" height="68" rx="6" fill="#FFFFFF" stroke="#B45309" stroke-width="1.6"/>
      <text x="1071" y="83" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">12. api_keys</text>
      <text x="955" y="100" font-family="monospace" font-size="9.5" fill="#334155">PK id | FK project_id | key_prefix</text>
      <text x="955" y="115" font-family="monospace" font-size="9.5" fill="#334155">secret_hash, scopes, revoked_at</text>

      <rect x="672" y="150" width="250" height="68" rx="6" fill="#FFFFFF" stroke="#B45309" stroke-width="1.6"/>
      <text x="797" y="168" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">13. security_policies</text>
      <text x="682" y="185" font-family="monospace" font-size="9.5" fill="#334155">PK id | FK route_id</text>
      <text x="682" y="200" font-family="monospace" font-size="9.5" fill="#334155">rate_limit_rpm, enable_waf, enable_ssrf</text>

      <rect x="945" y="150" width="252" height="68" rx="6" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
      <text x="1071" y="168" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">14. security_events</text>
      <text x="955" y="185" font-family="monospace" font-size="9.5" fill="#334155">PK id | FK route_id | request_id</text>
      <text x="955" y="200" font-family="monospace" font-size="9.5" fill="#334155">threat_type, payload JSONB, timestamp</text>

      <rect x="672" y="235" width="250" height="72" rx="6" fill="#FFFFFF" stroke="#6D28D9" stroke-width="1.8"/>
      <text x="797" y="253" text-anchor="middle" font-weight="700" font-size="11" fill="#4C1D95">15. experiments</text>
      <text x="682" y="270" font-family="monospace" font-size="9.5" fill="#334155">PK id | FK route_id | type, status</text>
      <text x="682" y="286" font-family="monospace" font-size="9.5" fill="#334155">config JSONB, started_at, completed_at</text>

      <rect x="945" y="235" width="252" height="72" rx="6" fill="#FFFFFF" stroke="#0E7490" stroke-width="1.8"/>
      <text x="1071" y="253" text-anchor="middle" font-weight="700" font-size="11" fill="#155E75">16. verifications</text>
      <text x="955" y="270" font-family="monospace" font-size="9.5" fill="#334155">PK id | FK experiment_id</text>
      <text x="955" y="286" font-family="monospace" font-size="9.5" fill="#334155">expected, observed, verdict, pdf_s3_url</text>

      <rect x="672" y="325" width="250" height="72" rx="6" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
      <text x="797" y="343" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">17. metric_logs</text>
      <text x="682" y="360" font-family="monospace" font-size="9.5" fill="#334155">PK id | FK route_id, experiment_id?</text>
      <text x="682" y="376" font-family="monospace" font-size="9.5" fill="#334155">request_id, latency_ms, status_code</text>

      <rect x="945" y="325" width="252" height="72" rx="6" fill="#FFFFFF" stroke="#64748B" stroke-width="1.5"/>
      <text x="1071" y="343" text-anchor="middle" font-weight="700" font-size="11" fill="#0F172A">18. workflow_runs</text>
      <text x="955" y="360" font-family="monospace" font-size="9.5" fill="#334155">PK id | FK project_id, route_id</text>
      <text x="955" y="376" font-family="monospace" font-size="9.5" fill="#334155">profile, timeline, deterministic_verdict</text>

      <!-- Domain 4: FortiX API Studio (3 Tables) -->
      <rect x="25" y="500" width="1190" height="148" rx="10" fill="#ECFDF5" stroke="#047857" stroke-width="1.8"/>
      <text x="620" y="523" text-anchor="middle" font-weight="800" font-size="12.5" fill="#065F46">FORTIX API STUDIO — SELF-CONTAINED API PLAYGROUND DOMAIN (3 TABLES)</text>

      <rect x="50" y="538" width="350" height="92" rx="6" fill="#FFFFFF" stroke="#047857" stroke-width="1.8"/>
      <text x="225" y="558" text-anchor="middle" font-weight="700" font-size="11.5" fill="#0F172A">19. studio_apis</text>
      <text x="64" y="577" font-family="monospace" font-size="9.6" fill="#334155">PK id | FK project_id (CASCADE)</text>
      <text x="64" y="593" font-family="monospace" font-size="9.6" fill="#334155">FK route_id → api_routes.id (SET NULL)</text>
      <text x="64" y="610" font-family="monospace" font-size="9.6" fill="#065F46">UQ(project_id, base_path, version)</text>

      <rect x="445" y="538" width="350" height="92" rx="6" fill="#FFFFFF" stroke="#047857" stroke-width="1.8"/>
      <text x="620" y="558" text-anchor="middle" font-weight="700" font-size="11.5" fill="#0F172A">20. studio_resources</text>
      <text x="459" y="577" font-family="monospace" font-size="9.6" fill="#334155">PK id | FK api_id → studio_apis.id (CASCADE)</text>
      <text x="459" y="593" font-family="monospace" font-size="9.6" fill="#334155">FK project_id | name, slug, fields JSONB</text>
      <text x="459" y="610" font-family="monospace" font-size="9.6" fill="#065F46">UQ(api_id, slug)</text>

      <rect x="840" y="538" width="350" height="92" rx="6" fill="#FFFFFF" stroke="#047857" stroke-width="1.8"/>
      <text x="1015" y="558" text-anchor="middle" font-weight="700" font-size="11.5" fill="#0F172A">21. studio_records</text>
      <text x="854" y="577" font-family="monospace" font-size="9.6" fill="#334155">PK id | FK resource_id, api_id, project_id</text>
      <text x="854" y="593" font-family="monospace" font-size="9.6" fill="#334155">record_id (prod_0001..), data JSONB, version</text>
      <text x="854" y="610" font-family="monospace" font-size="9.6" fill="#065F46">UQ(resource_id, record_id)</text>

      <!-- Domain 5: In-App Video Learning Center (2 Tables) -->
      <rect x="25" y="666" width="1190" height="140" rx="10" fill="#F5F3FF" stroke="#6D28D9" stroke-width="1.8"/>
      <text x="620" y="689" text-anchor="middle" font-weight="800" font-size="12.5" fill="#4C1D95">IN-APP VIDEO LEARNING CENTER DOMAIN — FTX-LEARN-001 (2 TABLES)</text>

      <rect x="65" y="704" width="520" height="86" rx="6" fill="#FFFFFF" stroke="#6D28D9" stroke-width="1.8"/>
      <text x="325" y="724" text-anchor="middle" font-weight="700" font-size="11.5" fill="#0F172A">22. learning_tutorials</text>
      <text x="80" y="743" font-family="monospace" font-size="9.6" fill="#334155">PK id | UQ slug | module_name, lifecycle_stage, category, difficulty</text>
      <text x="80" y="759" font-family="monospace" font-size="9.6" fill="#334155">video_provider, duration_seconds, steps JSONB, published, sort_order</text>
      <text x="80" y="775" font-family="monospace" font-size="9.6" fill="#5B21B6">IDX(published, sort_order) · IDX(lifecycle_stage, sort_order)</text>

      <rect x="655" y="704" width="520" height="86" rx="6" fill="#FFFFFF" stroke="#6D28D9" stroke-width="1.8"/>
      <text x="915" y="724" text-anchor="middle" font-weight="700" font-size="11.5" fill="#0F172A">23. learning_progress</text>
      <text x="670" y="743" font-family="monospace" font-size="9.6" fill="#334155">PK id | FK user_id → users.id (CASCADE) | FK tutorial_id → learning_tutorials.id</text>
      <text x="670" y="759" font-family="monospace" font-size="9.6" fill="#334155">last_position_seconds, max_watched_seconds, completed, completed_at</text>
      <text x="670" y="775" font-family="monospace" font-size="9.6" fill="#5B21B6">UQ(user_id, tutorial_id) · RLS User-Isolated</text>

      <!-- Major Inter-Domain Relationship Lines -->
      <line x1="288" y1="90" x2="350" y2="90" stroke="#1D4ED8" stroke-width="2" marker-end="url(#arrowBlue)"/>
      <text x="319" y="83" text-anchor="middle" font-size="10" font-weight="700" fill="#1E3A8A">1:N</text>
      <line x1="608" y1="160" x2="670" y2="100" stroke="#B45309" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <text x="638" y="122" text-anchor="middle" font-size="10" font-weight="700" fill="#92400E">1:N</text>
      <line x1="922" y1="271" x2="943" y2="271" stroke="#0E7490" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <line x1="400" y1="584" x2="443" y2="584" stroke="#047857" stroke-width="2" marker-end="url(#arrowGreen)"/>
      <line x1="795" y1="584" x2="838" y2="584" stroke="#047857" stroke-width="2" marker-end="url(#arrowGreen)"/>
      <line x1="585" y1="747" x2="653" y2="747" stroke="#6D28D9" stroke-width="2" marker-end="url(#arrowSlate)"/>
      <text x="619" y="739" text-anchor="middle" font-size="10" font-weight="700" fill="#4C1D95">1:N</text>

      <!-- Legend Footer -->
      <rect x="25" y="822" width="1190" height="78" rx="8" fill="#F8FAFC" stroke="#CBD5E1"/>
      <text x="48" y="846" font-weight="700" font-size="12" fill="#0F172A">Relational Integrity &amp; Security Invariants Across All 23 Tables:</text>
      <text x="48" y="866" font-size="11" fill="#334155">1. Every tenant table cascades cleanly from organizations → projects (ON DELETE CASCADE); metric_logs.experiment_id &amp; studio_apis.route_id use ON DELETE SET NULL.</text>
      <text x="48" y="885" font-size="11" fill="#334155">2. Zero plaintext secrets stored: password_hash (bcrypt), api_keys.secret_hash (bcrypt), token_hash (SHA-256), otp_hmac (HMAC-SHA256). 17 tenant/user tables enforce PostgreSQL RLS.</text>
    `,
  },
];

function wrapDiagramHtml(spec: {
  title: string;
  subtitle: string;
  svgBody: string;
  width: number;
  height: number;
}): string {
  const totalH = spec.height + 90;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #FFFFFF;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    width: ${spec.width}px;
    height: ${totalH}px;
    overflow: hidden;
  }
  .frame {
    width: ${spec.width}px;
    height: ${totalH}px;
    border: 2px solid #CBD5E1;
    border-radius: 10px;
    background: #FFFFFF;
    display: flex;
    flex-direction: column;
  }
  .hdr {
    background: #0F172A;
    color: #FFFFFF;
    padding: 14px 24px;
    border-bottom: 3px solid #EA580C;
  }
  .hdr h1 {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }
  .hdr p {
    font-size: 12px;
    color: #CBD5E1;
    margin-top: 3px;
  }
</style>
</head>
<body>
  <div class="frame">
    <div class="hdr">
      <h1>${spec.title}</h1>
      <p>${spec.subtitle}</p>
    </div>
    <svg width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arrowBlue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#1D4ED8"/>
        </marker>
        <marker id="arrowGreen" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#15803D"/>
        </marker>
        <marker id="arrowSlate" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#334155"/>
        </marker>
      </defs>
      ${spec.svgBody}
    </svg>
  </div>
</body>
</html>`;
}

async function redactSensitiveDom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }
    for (const node of nodes) {
      if (!node.nodeValue) continue;
      let val = node.nodeValue;
      // Redact any raw API keys or prefixes with secret material
      val = val.replace(/fx_(live|test)_[a-f0-9]{8,}_[a-f0-9]{8,}/gi, 'fx_$1_••••••••REDACTED••••••••');
      // Redact any 64-char hex tokens
      val = val.replace(/\b[a-f0-9]{64}\b/gi, '[REDACTED_64_HEX_TOKEN]');
      // Replace masked or unmasked test email with standard academic demo email
      val = val.replace(/[a-zA-Z0-9._%+-]*\*+[a-zA-Z0-9._%+-]*@(fortix\.dev|fortix\.test|gmail\.com|example\.edu)/gi, 'op***@example.edu');
      val = val.replace(/operator\.\d+@example\.edu/gi, 'operator@example.edu');
      val = val.replace(/[a-zA-Z0-9._%+-]+@(fortix\.dev|fortix\.test|gmail\.com)/gi, 'operator@example.edu');
      node.nodeValue = val;
    }

    const inputs = Array.from(document.querySelectorAll('input'));
    for (const input of inputs) {
      if (input.value && /@(fortix\.dev|fortix\.test|gmail\.com)/i.test(input.value)) {
        input.value = 'operator@example.edu';
      }
      if (input.value && /fx_(live|test)_/i.test(input.value)) {
        input.value = 'fx_live_••••••••REDACTED••••••••';
      }
    }
  });
}

async function main() {
  fs.mkdirSync(DIAGRAMS_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Render all 17 UML / DFD / Architecture / ER Diagrams at 2x DPI + save .mmd sources
    const allDiagrams: DiagramSpec[] = [
      ...DIAGRAM_SPECS,
      ...SEQUENCE_SPECS.map((s) => {
        const built = buildSequenceSvg(s.actors, s.messages);
        return {
          id: s.id,
          title: s.title,
          subtitle: s.subtitle,
          mermaid: s.mermaid,
          svgBody: built.svgBody,
          width: 1180,
          height: built.height,
        };
      }),
      ...DEPLOYMENT_AND_ER_SPECS,
    ];

    const diagContext = await browser.newContext({
      viewport: { width: 1280, height: 1020 },
      deviceScaleFactor: 2,
    });
    const diagPage = await diagContext.newPage();

    for (const spec of allDiagrams) {
      const mmdPath = path.join(DIAGRAMS_DIR, `${spec.id}.mmd`);
      fs.writeFileSync(mmdPath, spec.mermaid.trim() + '\n', 'utf8');

      const w = spec.width || 1180;
      const h = spec.height || 640;
      await diagPage.setViewportSize({ width: w, height: h + 90 });
      await diagPage.setContent(
        wrapDiagramHtml({
          title: spec.title,
          subtitle: spec.subtitle,
          svgBody: spec.svgBody,
          width: w,
          height: h,
        }),
        { waitUntil: 'load' }
      );
      const pngPath = path.join(DIAGRAMS_DIR, `${spec.id}.png`);
      await diagPage.screenshot({ path: pngPath, fullPage: false });
      console.log(`[Diagram] Rendered ${spec.id}.png (${w}x${h + 90} @2x)`);
    }
    await diagContext.close();

    // 2. Capture 14 Real, Redacted Application Screenshots from Live FortiX Server
    const appContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1.5,
    });
    const page = await appContext.newPage();
    const demoEmail = `operator.${Date.now()}@example.edu`;
    const demoPass = 'AcademicReport!2026';

    // Register & seed realistic workspace state via real REST endpoints first
    await page.request.post(`${BASE_URL}/api/auth/register`, {
      data: { email: demoEmail, password: demoPass, name: 'Academic Evaluator' },
    });

    // Screen 1: Login (/login)
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.getByLabel('Email address or phone number').fill('operator@example.edu');
    await page.getByLabel('Remember me').check();
    await redactSensitiveDom(page);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'scr01_login.png') });
    console.log('[Screenshot] Captured scr01_login.png');

    // Screen 2: Register Mode (/login -> Create an account)
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email address').fill('operator@example.edu');
    await redactSensitiveDom(page);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'scr02_register.png') });
    console.log('[Screenshot] Captured scr02_register.png');

    // Screen 3: Forgot Password (/forgot-password)
    await page.goto(`${BASE_URL}/forgot-password`, { waitUntil: 'networkidle' });
    await page.getByLabel('Email address or phone number').fill('operator@example.edu');
    await redactSensitiveDom(page);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'scr03_forgot_password.png') });
    console.log('[Screenshot] Captured scr03_forgot_password.png');

    // Screen 4: Trigger real forgot-password transition to /verify-reset with redacted devOtpCode in response
    await page.route('**/api/auth/forgot-password', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      if (json && typeof json === 'object') {
        json.devOtpCode = '••••••';
        json.destinationMasked = 'op***@example.edu';
      }
      await route.fulfill({ response, json });
    });
    await page.getByLabel('Email address or phone number').fill(demoEmail);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForURL('**/verify-reset');
    await page.unroute('**/api/auth/forgot-password');
    await redactSensitiveDom(page);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'scr04_verify_otp.png') });
    console.log('[Screenshot] Captured scr04_verify_otp.png');

    // Sign in for real via /login UI and provision API Studio Store Products API + run a real experiment
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.getByLabel('Email address or phone number').fill(demoEmail);
    await page.getByLabel('Password', { exact: true }).fill(demoPass);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Sign Out' }).first().waitFor({ timeout: 15000 });

    const apiLoginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
      data: { identifier: demoEmail, password: demoPass },
    });
    const { token } = await apiLoginRes.json();
    const projsRes = await page.request.get(`${BASE_URL}/api/control/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const projects = await projsRes.json();
    const activeProjectId = projects[0]?.id;

    if (activeProjectId) {
      const resendVer = await page.request.post(`${BASE_URL}/api/auth/resend-verification`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const resendData = await resendVer.json().catch(() => ({}));
      if (resendData.devVerificationToken) {
        await page.request.post(`${BASE_URL}/api/auth/verify-email`, {
          data: { token: resendData.devVerificationToken },
        });
      }

      const studioCreate = await page.request.post(`${BASE_URL}/api/control/studio/apis`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          projectId: activeProjectId,
          name: 'Store Products API',
          description: 'Self-contained e-commerce catalog API protected by FortiX Gateway',
          basePath: '/api/store',
          version: 'v1',
          template: 'products_100',
          initialPolicy: { rateLimitRpm: 30, enableWaf: true, enableSsrf: true },
          issueApiKey: true,
        },
      });
      if (studioCreate.ok()) {
        const created = await studioCreate.json();
        const routeId = created.routeId;
        const rawKey = created.issuedApiKey?.rawKey;
        if (routeId && rawKey) {
          for (let i = 0; i < 6; i++) {
            await page.request.get(`${BASE_URL}/proxy/${routeId}/api/store/products?limit=10`, {
              headers: { 'x-api-key': rawKey },
            });
          }
          await page.request.get(
            `${BASE_URL}/proxy/${routeId}/api/store/products?q=${encodeURIComponent("' OR 1=1--")}`,
            { headers: { 'x-api-key': rawKey } }
          );

          const expRes = await page.request.post(`${BASE_URL}/api/control/experiments`, {
            headers: { Authorization: `Bearer ${token}` },
            data: {
              projectId: activeProjectId,
              routeId,
              type: 'latency',
              config: { latencyMs: 200, durationMs: 2000 },
            },
          });
          if (expRes.ok()) {
            for (let w = 0; w < 20; w++) {
              await new Promise((r) => setTimeout(r, 400));
              const verCheck = await page.request.get(
                `${BASE_URL}/api/control/verifications?projectId=${activeProjectId}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (verCheck.ok()) {
                const vers = await verCheck.json();
                if (Array.isArray(vers) && vers.length > 0) break;
              }
            }
          }
        }
      }
    }

    const authenticatedScreens: Array<{ route: string; filename: string; waitMs?: number }> = [
      { route: '/', filename: 'scr05_dashboard.png', waitMs: 1300 },
      { route: '/studio', filename: 'scr06_api_studio.png', waitMs: 1300 },
      { route: '/apis', filename: 'scr07_protected_apis.png', waitMs: 1000 },
      { route: '/security', filename: 'scr08_security_policies.png', waitMs: 1000 },
      { route: '/threats', filename: 'scr09_threats.png', waitMs: 1000 },
      { route: '/experiments', filename: 'scr10_experiments.png', waitMs: 1000 },
      { route: '/verifications', filename: 'scr11_verifications.png', waitMs: 1000 },
      { route: '/resilience', filename: 'scr12_resilience.png', waitMs: 1000 },
      { route: '/topology', filename: 'scr13_topology.png', waitMs: 1000 },
      { route: '/learning-center', filename: 'scr14_learning_center.png', waitMs: 1100 },
      { route: '/settings?tab=account', filename: 'scr15_settings_account.png', waitMs: 1000 },
    ];

    for (const s of authenticatedScreens) {
      await page.goto(`${BASE_URL}${s.route}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Sign Out' }).first().waitFor({ timeout: 12000 });
      await page.waitForTimeout(s.waitMs || 1100);
      await redactSensitiveDom(page);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, s.filename) });
      console.log(`[Screenshot] Captured ${s.filename}`);
    }

    await appContext.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[capture-assets] Fatal error:', err);
  process.exit(1);
});
