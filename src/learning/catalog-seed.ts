import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import type {
  LearningCategory,
  LearningDifficulty,
  LearningLifecycleStage,
  TutorialDocLink,
  TutorialStep,
  VideoProvider,
} from './types.js';

export interface SeedTutorialDefinition {
  id: string;
  slug: string;
  title: string;
  description: string;
  moduleName: string;
  lifecycleStage: LearningLifecycleStage;
  category: LearningCategory;
  difficulty: LearningDifficulty;
  videoProvider: VideoProvider;
  videoReference: string | null;
  videoSourceNote: string | null;
  thumbnailUrl: string | null;
  captionsUrl: string | null;
  durationSeconds: number;
  learningObjectives: string[];
  prerequisites: string[];
  steps: TutorialStep[];
  warnings: string[];
  relatedSlugs: string[];
  docLinks: TutorialDocLink[];
  featured: boolean;
  published: boolean;
  sortOrder: number;
}

export const CANONICAL_LEARNING_TUTORIALS: SeedTutorialDefinition[] = [
  // =========================================================================
  // MODULE 1 — GETTING STARTED
  // =========================================================================
  {
    id: '10000000-0000-4000-8000-000000000001',
    slug: 'what-is-fortix',
    title: 'FortiX in 5 Minutes: Platform Lifecycle Overview',
    description:
      'Tour the complete FortiX verification lifecycle—PROTECT, BREAK, OBSERVE, PROVE, and IMPROVE—from route registration to deterministic verification evidence.',
    moduleName: 'Module 1 — Getting Started',
    lifecycleStage: 'PROTECT',
    category: 'Getting Started',
    difficulty: 'Beginner',
    videoProvider: 'self_hosted',
    videoReference: '/learning/videos/what-is-fortix.webm',
    videoSourceNote:
      'Automated silent live-UI walkthrough capture (25s) with synchronized WebVTT captions.',
    thumbnailUrl: null,
    captionsUrl: '/learning/captions/what-is-fortix.vtt',
    durationSeconds: 25,
    learningObjectives: [
      'Understand how FortiX combines an API security gateway with controlled resilience verification.',
      'Navigate between Dashboard, API Studio, Protected APIs, Security Policies, Experiments, Resilience, and Verifications.',
      'Trace how every security or resilience claim is backed by observed request telemetry rather than configuration assumptions.',
    ],
    prerequisites: ['An active FortiX operator or developer account.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Inspect Workspace Health on the Dashboard',
        instruction:
          'Open the Dashboard to verify active project context, gateway operational status, and current storage posture before running traffic.',
        actionPath: '/',
        actionLabel: 'Open Dashboard',
      },
      {
        stepNumber: 2,
        title: 'Create or Register an API Endpoint',
        instruction:
          'Use API Studio to generate a self-contained REST API with sample records, or register an existing upstream service in Protected APIs.',
        actionPath: '/studio',
        actionLabel: 'Open API Studio',
      },
      {
        stepNumber: 3,
        title: 'Enforce Gateway Controls (PROTECT)',
        instruction:
          'Attach API key requirements, token-bucket rate limits, SQLi/XSS WAF inspection, and SSRF protection to your route.',
        actionPath: '/security',
        actionLabel: 'Open Security Policies',
      },
      {
        stepNumber: 4,
        title: 'Execute Controlled Faults & Verify (BREAK → OBSERVE → PROVE)',
        instruction:
          'Run a controlled latency, HTTP 5xx, or burst experiment and inspect deterministic PASS, FAIL, or INCONCLUSIVE verdicts in Verifications.',
        actionPath: '/verifications',
        actionLabel: 'Open Verifications',
      },
    ],
    warnings: [
      'In Sandbox In-Memory mode, routes and telemetry reset when the server restarts; configure persistent PostgreSQL for permanent retention.',
    ],
    relatedSlugs: [
      'creating-your-first-api',
      'creating-an-api-using-api-studio',
      'understanding-verification-results',
    ],
    docLinks: [
      { title: 'Interactive OpenAPI Specification', href: '/api/docs', kind: 'openapi' },
      { title: 'Workspace Settings & Defaults', href: '/settings', kind: 'workspace' },
    ],
    featured: true,
    published: true,
    sortOrder: 10,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    slug: 'fortix-architecture-overview',
    title: 'FortiX Control Plane & Gateway Proxy Architecture',
    description:
      'Learn how the FortiX Control Plane (/api/control/*) separates configuration management from live Gateway Proxy enforcement (/proxy/:routeId).',
    moduleName: 'Module 1 — Getting Started',
    lifecycleStage: 'PROTECT',
    category: 'API Gateway',
    difficulty: 'Beginner',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 240,
    learningObjectives: [
      'Distinguish Control Plane endpoints (/api/control/*) from Gateway data-plane proxy traffic (/proxy/:routeId/*).',
      'Understand how BullMQ workers execute scheduled fault experiments and reconcile interrupted runs.',
      'Verify project-scoped multi-tenant isolation across routes, API keys, policies, and verification artifacts.',
    ],
    prerequisites: ['Completion of FortiX in 5 Minutes is recommended.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Review Active Project Scope',
        instruction:
          'Check the top header project selector and sidebar Storage Mode indicator to see which tenant workspace owns your routes and telemetry.',
        actionPath: '/',
        actionLabel: 'View Workspace Header',
      },
      {
        stepNumber: 2,
        title: 'Inspect Registered Proxy Routes',
        instruction:
          'Open Protected APIs to view how each registered route receives a dedicated gateway proxy URL (/proxy/<routeId>).',
        actionPath: '/apis',
        actionLabel: 'Inspect Protected APIs',
      },
      {
        stepNumber: 3,
        title: 'Explore Service Topology',
        instruction:
          'Visit Topology to visualize gateway ingress, upstream route bindings, and active policy enforcement status.',
        actionPath: '/topology',
        actionLabel: 'Open Topology',
      },
    ],
    warnings: [
      'Client traffic must traverse /proxy/<routeId> to be protected and measured by FortiX; calling upstream services directly bypasses gateway controls.',
    ],
    relatedSlugs: ['what-is-fortix', 'configuring-gateway-routes'],
    docLinks: [
      { title: 'Gateway Topology View', href: '/topology', kind: 'workspace' },
      { title: 'Control Plane OpenAPI Reference', href: '/api/docs', kind: 'openapi' },
    ],
    featured: false,
    published: true,
    sortOrder: 20,
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    slug: 'navigating-the-dashboard',
    title: 'Navigating the Dashboard & Command Palette',
    description:
      'Use keyboard-driven navigation (Ctrl+K / Cmd+K), theme switching, and live readiness indicators to move efficiently across FortiX.',
    moduleName: 'Module 1 — Getting Started',
    lifecycleStage: 'OBSERVE',
    category: 'Getting Started',
    difficulty: 'Beginner',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 180,
    learningObjectives: [
      'Open the global Command Palette with Ctrl+K (or Cmd+K) to jump directly to any module.',
      'Interpret gateway health and storage indicators in the workspace header.',
      'Switch cleanly between Dark and Light display themes.',
    ],
    prerequisites: ['Signed in to FortiX Control Plane.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Launch the Command Palette',
        instruction:
          'Press Ctrl+K (Windows/Linux) or Cmd+K (macOS), or click the search bar in the top header, to filter workspace pages.',
        actionPath: '/',
        actionLabel: 'Go to Dashboard',
      },
      {
        stepNumber: 2,
        title: 'Check Dependency Readiness',
        instruction:
          'Confirm the top-right status indicator reads OPERATIONAL before executing benchmark or chaos verification runs.',
        actionPath: '/resilience',
        actionLabel: 'Check System Health',
      },
    ],
    warnings: [
      'If the status indicator shows CHECK HEALTH, inspect database or worker queue connectivity before starting timed experiments.',
    ],
    relatedSlugs: ['what-is-fortix', 'understanding-telemetry'],
    docLinks: [{ title: 'Dashboard Overview', href: '/', kind: 'workspace' }],
    featured: false,
    published: true,
    sortOrder: 30,
  },

  // =========================================================================
  // MODULE 2 — PROTECTING AN API
  // =========================================================================
  {
    id: '10000000-0000-4000-8000-000000000004',
    slug: 'creating-your-first-api',
    title: 'Create and Protect Your First API',
    description:
      'Register an upstream route in Protected APIs, issue a project-scoped gateway API key, and bind WAF, SSRF, and rate-limit protections.',
    moduleName: 'Module 2 — Protecting an API',
    lifecycleStage: 'PROTECT',
    category: 'API Management',
    difficulty: 'Beginner',
    videoProvider: 'self_hosted',
    videoReference: '/learning/videos/creating-your-first-api.webm',
    videoSourceNote:
      'Automated silent live-UI walkthrough capture (25s) with synchronized WebVTT captions.',
    thumbnailUrl: null,
    captionsUrl: '/learning/captions/creating-your-first-api.vtt',
    durationSeconds: 25,
    learningObjectives: [
      'Register a route path pattern and authorized upstream URL under Protected APIs.',
      'Issue a hashed gateway API key (ftx_...) and store the raw secret safely upon creation.',
      'Attach a custom Security Policy with WAF blocking, SSRF parameter inspection, and token-bucket rate limiting.',
    ],
    prerequisites: ['An active FortiX project workspace.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Register an Upstream Route',
        instruction:
          'Open Protected APIs, click Add API Route, enter a path pattern starting with "/" (e.g., /api/v1/orders), and provide a valid public HTTPS upstream URL (or use API Studio for an internal target).',
        actionPath: '/apis',
        actionLabel: 'Open Protected APIs',
      },
      {
        stepNumber: 2,
        title: 'Issue a Gateway API Key',
        instruction:
          'In the Gateway API Keys section on Protected APIs, create a named key and copy the one-time raw secret immediately.',
        actionPath: '/apis',
        actionLabel: 'Manage API Keys',
      },
      {
        stepNumber: 3,
        title: 'Bind a Route Security Policy',
        instruction:
          'Navigate to Security, click Configure Route Policy, select your route, set Requests Per Minute (RPM), and enable WAF + Deep Parameter SSRF Guard.',
        actionPath: '/security',
        actionLabel: 'Configure Route Policy',
      },
    ],
    warnings: [
      'Raw API keys are displayed only once at creation because FortiX stores only cryptographic secret hashes.',
      'FortiX blocks private, loopback, and cloud-metadata upstream URLs by default to prevent Server-Side Request Forgery (SSRF).',
    ],
    relatedSlugs: [
      'configuring-security-policies',
      'applying-rate-limiting',
      'creating-an-api-using-api-studio',
    ],
    docLinks: [
      { title: 'Protected APIs & Keys', href: '/apis', kind: 'workspace' },
      { title: 'Security Policies Console', href: '/security', kind: 'workspace' },
    ],
    featured: true,
    published: true,
    sortOrder: 40,
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    slug: 'configuring-gateway-routes',
    title: 'Configuring Gateway Proxy Routes & Upstream SSRF Guards',
    description:
      'Configure clean path patterns, understand how FortiX proxies requests to upstream targets, and avoid SSRF validation rejections.',
    moduleName: 'Module 2 — Protecting an API',
    lifecycleStage: 'PROTECT',
    category: 'API Gateway',
    difficulty: 'Intermediate',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 300,
    learningObjectives: [
      'Format route path patterns cleanly (e.g., /api/v1/catalog) for predictable gateway forwarding.',
      'Understand why private CIDR ranges (127.0.0.0/8, 10.0.0.0/8, 169.254.169.254) are rejected during route registration.',
      'Verify upstream timeouts and fail-closed vs fail-open behavior in Project Settings.',
    ],
    prerequisites: ['Familiarity with HTTP reverse proxies.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Inspect Existing Gateway Routes',
        instruction:
          'Open Protected APIs to review registered path patterns, target URLs, and route identifiers.',
        actionPath: '/apis',
        actionLabel: 'Open Protected APIs',
      },
      {
        stepNumber: 2,
        title: 'Review Gateway Timeout & Failure Posture',
        instruction:
          'Open Settings to inspect upstream timeout thresholds and project-wide gateway failure mode.',
        actionPath: '/settings',
        actionLabel: 'Open Settings',
      },
    ],
    warnings: [
      'Deleting a route cascades to its attached security policy and historical experiment bindings—verify no active workflow run is executing first.',
    ],
    relatedSlugs: ['creating-your-first-api', 'configuring-security-policies'],
    docLinks: [
      { title: 'Protected APIs', href: '/apis', kind: 'workspace' },
      { title: 'Gateway Settings', href: '/settings', kind: 'workspace' },
    ],
    featured: false,
    published: true,
    sortOrder: 50,
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    slug: 'setting-up-authentication',
    title: 'Gateway API Keys, Operator Sessions & Account Recovery',
    description:
      'Manage X-API-Key client credentials for gateway traffic alongside HttpOnly rotating operator sessions and OTP account recovery.',
    moduleName: 'Module 2 — Protecting an API',
    lifecycleStage: 'PROTECT',
    category: 'Authentication and Authorization',
    difficulty: 'Beginner',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 270,
    learningObjectives: [
      'Pass gateway API keys via the X-API-Key header when invoking protected proxy routes.',
      'Revoke compromised gateway keys with immediate cache invalidation.',
      'Audit active operator login sessions and verified recovery channels in Settings.',
    ],
    prerequisites: ['At least one project workspace in FortiX.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Create and Test a Gateway Key',
        instruction:
          'Generate an API key in Protected APIs and supply it in the X-API-Key header when testing requests in API Studio.',
        actionPath: '/apis',
        actionLabel: 'Open Protected APIs',
      },
      {
        stepNumber: 2,
        title: 'Review Active Operator Sessions',
        instruction:
          'Open Settings to view active browser sessions, Remember-Me persistence status, and individual session revocation controls.',
        actionPath: '/settings',
        actionLabel: 'Review Sessions in Settings',
      },
    ],
    warnings: [
      'Never commit raw ftx_ API keys to source control or embed them in public client-side bundles.',
    ],
    relatedSlugs: ['creating-your-first-api', 'configuring-security-policies'],
    docLinks: [
      { title: 'Gateway Keys', href: '/apis', kind: 'workspace' },
      { title: 'Operator Account & Sessions', href: '/settings', kind: 'workspace' },
    ],
    featured: false,
    published: true,
    sortOrder: 60,
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    slug: 'configuring-security-policies',
    title: 'Configuring WAF & Deep Parameter SSRF Policies',
    description:
      'Protect routes against SQL injection, cross-site scripting (XSS), path traversal, and parameter-borne SSRF attacks.',
    moduleName: 'Module 2 — Protecting an API',
    lifecycleStage: 'PROTECT',
    category: 'Security Policies',
    difficulty: 'Intermediate',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 300,
    learningObjectives: [
      'Enable WAF blocking on sensitive routes to intercept SQLi, XSS, and directory traversal payloads.',
      'Enable Deep Parameter SSRF Guard to scan query and JSON body fields for internal URLs.',
      'Verify blocked requests in the Threats telemetry log.',
    ],
    prerequisites: ['At least one registered API route.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Open the Route Policy Composer',
        instruction:
          'In Security, click Configure Route Policy, choose your target route, and enable both WAF Blocking and Deep Parameter SSRF Guard.',
        actionPath: '/security',
        actionLabel: 'Open Security Policies',
      },
      {
        stepNumber: 2,
        title: 'Inspect Blocked Threat Events',
        instruction:
          'After sending test payloads through the gateway proxy, open Threats to inspect blocked threat categories and request IDs.',
        actionPath: '/threats',
        actionLabel: 'Open Threats Log',
      },
    ],
    warnings: [
      'Routes without an explicit custom policy inherit project baseline rate limits, but WAF and deep parameter SSRF scanning should be explicitly enabled for untrusted inputs.',
    ],
    relatedSlugs: ['creating-your-first-api', 'applying-rate-limiting', 'understanding-telemetry'],
    docLinks: [
      { title: 'Security Policies', href: '/security', kind: 'workspace' },
      { title: 'Threat Intelligence Log', href: '/threats', kind: 'workspace' },
    ],
    featured: false,
    published: true,
    sortOrder: 70,
  },
  {
    id: '10000000-0000-4000-8000-000000000008',
    slug: 'applying-rate-limiting',
    title: 'Applying Token-Bucket Rate Limiting',
    description:
      'Configure per-route RPM quotas and project baseline rate limits to shed abusive traffic spikes with deterministic HTTP 429 responses.',
    moduleName: 'Module 2 — Protecting an API',
    lifecycleStage: 'PROTECT',
    category: 'Rate Limiting',
    difficulty: 'Intermediate',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 260,
    learningObjectives: [
      'Configure custom route-level Requests Per Minute (RPM) limits in Security Policies.',
      'Understand how project baseline RPM applies when a route uses inherited defaults.',
      'Inspect X-RateLimit-Limit and X-RateLimit-Remaining headers on gateway responses.',
    ],
    prerequisites: ['A registered route in Protected APIs or API Studio.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Set a Route RPM Quota',
        instruction:
          'Open Security, edit or create a policy for your route, enable Custom Route RPM, and set a low test quota (such as 10 RPM) to observe throttling clearly.',
        actionPath: '/security',
        actionLabel: 'Set Route Rate Limit',
      },
      {
        stepNumber: 2,
        title: 'Verify HTTP 429 Enforcement',
        instruction:
          'Use API Studio Burst (20x) or a traffic_burst experiment to exceed the quota and confirm excess calls receive HTTP 429.',
        actionPath: '/studio',
        actionLabel: 'Test Burst in API Studio',
      },
    ],
    warnings: [
      'Setting an overly low RPM on shared production routes will throttle legitimate callers; test aggressive limits on dedicated Studio or staging routes.',
    ],
    relatedSlugs: ['testing-rate-limit-enforcement', 'configuring-security-policies'],
    docLinks: [{ title: 'Security Policies', href: '/security', kind: 'workspace' }],
    featured: false,
    published: true,
    sortOrder: 80,
  },

  // =========================================================================
  // MODULE 3 — BREAKING SAFELY
  // =========================================================================
  {
    id: '10000000-0000-4000-8000-000000000009',
    slug: 'creating-your-first-experiment',
    title: 'Run Your First Resilience Experiment',
    description:
      'Define a falsifiable resilience hypothesis, review blast-radius safety controls, and execute a controlled fault experiment on a gateway route.',
    moduleName: 'Module 3 — Breaking Safely',
    lifecycleStage: 'BREAK',
    category: 'Resilience Experiments',
    difficulty: 'Beginner',
    videoProvider: 'self_hosted',
    videoReference: '/learning/videos/creating-your-first-experiment.webm',
    videoSourceNote:
      'Automated silent live-UI walkthrough capture (25s) with synchronized WebVTT captions.',
    thumbnailUrl: null,
    captionsUrl: '/learning/captions/creating-your-first-experiment.vtt',
    durationSeconds: 25,
    learningObjectives: [
      'Select a target route and fault injection profile (latency, HTTP 503, timeout, or traffic burst) in Experiments.',
      'Write a clear verification hypothesis before injecting faults.',
      'Use explicit authorization locking and monitor queued-to-completed execution lifecycle.',
    ],
    prerequisites: ['At least one route registered in Protected APIs or API Studio.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Select Target Route & Fault Type',
        instruction:
          'Open Experiments, pick your target route from the dropdown, and choose Latency Injection (800ms) for a safe first experiment.',
        actionPath: '/experiments',
        actionLabel: 'Open Experiments',
      },
      {
        stepNumber: 2,
        title: 'Document Your Hypothesis',
        instruction:
          'State the expected behavior under stress—for example, whether latency stays bounded and recovery returns to baseline after fault removal.',
        actionPath: '/experiments',
        actionLabel: 'Edit Hypothesis',
      },
      {
        stepNumber: 3,
        title: 'Authorize Safety Lock & Execute',
        instruction:
          'Review the duration and retry parameters in Experiment Safety Controls, check "I authorize this fault injection test", and click Execute Chaos.',
        actionPath: '/experiments',
        actionLabel: 'Run Experiment',
      },
    ],
    warnings: [
      'Fault injection intentionally degrades responses on the selected route for the 15-second experiment window—never target external third-party production endpoints without permission.',
    ],
    relatedSlugs: [
      'running-latency-injection',
      'running-http-failure-injection',
      'understanding-verification-results',
    ],
    docLinks: [
      { title: 'Experiments & DLQ Console', href: '/experiments', kind: 'workspace' },
      { title: 'Resilience Telemetry', href: '/resilience', kind: 'workspace' },
    ],
    featured: true,
    published: true,
    sortOrder: 90,
  },
  {
    id: '10000000-0000-4000-8000-000000000010',
    slug: 'running-latency-injection',
    title: 'Running Latency Injection Experiments',
    description:
      'Inject controlled 800ms upstream delay on a gateway route to measure tail-latency shifts (p50, p95, p99) and post-window recovery.',
    moduleName: 'Module 3 — Breaking Safely',
    lifecycleStage: 'BREAK',
    category: 'Resilience Experiments',
    difficulty: 'Intermediate',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 300,
    learningObjectives: [
      'Execute a latency fault experiment while generating real proxy traffic.',
      'Compare p50 and p95 latency across baseline, injection, and recovery windows.',
      'Identify client timeout mismatches before they cause cascading outages.',
    ],
    prerequisites: ['Completion of Run Your First Resilience Experiment.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Queue a Latency Experiment',
        instruction:
          'In Experiments, select Latency Injection (800ms), confirm the target route, authorize the safety check, and launch.',
        actionPath: '/experiments',
        actionLabel: 'Launch Latency Test',
      },
      {
        stepNumber: 2,
        title: 'Inspect Percentile Impact',
        instruction:
          'Open Resilience to observe live p50 and p95 latency telemetry and verify latency normalizes once the experiment completes.',
        actionPath: '/resilience',
        actionLabel: 'Inspect Latency Percentiles',
      },
    ],
    warnings: [
      'Ensure real requests hit the target route during the experiment window; zero-traffic windows produce INCONCLUSIVE verdicts.',
    ],
    relatedSlugs: ['creating-your-first-experiment', 'reading-latency-and-error-metrics'],
    docLinks: [
      { title: 'Experiments Console', href: '/experiments', kind: 'workspace' },
      { title: 'Resilience Dashboard', href: '/resilience', kind: 'workspace' },
    ],
    featured: false,
    published: true,
    sortOrder: 100,
  },
  {
    id: '10000000-0000-4000-8000-000000000011',
    slug: 'running-http-failure-injection',
    title: 'HTTP 5xx Failure Injection & Dead-Letter Queue Troubleshooting',
    description:
      'Simulate upstream HTTP 503 failures and gateway timeouts, and troubleshoot failed worker jobs using the BullMQ Dead-Letter Queue (DLQ).',
    moduleName: 'Module 3 — Breaking Safely',
    lifecycleStage: 'IMPROVE',
    category: 'Troubleshooting',
    difficulty: 'Intermediate',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 330,
    learningObjectives: [
      'Run HTTP 503 Failure and Gateway Timeout fault simulations safely.',
      'Inspect failed background jobs in the Experiments Dead-Letter Queue (DLQ) tab.',
      'Replay or purge DLQ entries after resolving upstream connectivity or configuration errors.',
    ],
    prerequisites: ['At least one route registered in FortiX.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Execute an HTTP 503 Failure Experiment',
        instruction:
          'Open Experiments, select HTTP 503 Failure as the fault type, authorize the safety lock, and trigger the run.',
        actionPath: '/experiments',
        actionLabel: 'Open Experiments',
      },
      {
        stepNumber: 2,
        title: 'Inspect & Recover Dead-Letter Queue Jobs',
        instruction:
          'Switch to the Dead-Letter Queue (DLQ) view in Experiments to inspect retry counts, failure reasons, and replay actions.',
        actionPath: '/experiments',
        actionLabel: 'Inspect Worker DLQ',
      },
    ],
    warnings: [
      'Purging all DLQ jobs permanently removes failure diagnostics; inspect failure payloads before purging.',
    ],
    relatedSlugs: ['creating-your-first-experiment', 'understanding-verification-results'],
    docLinks: [{ title: 'Experiments & Worker DLQ', href: '/experiments', kind: 'workspace' }],
    featured: false,
    published: true,
    sortOrder: 110,
  },
  {
    id: '10000000-0000-4000-8000-000000000012',
    slug: 'testing-rate-limit-enforcement',
    title: 'Testing Burst Traffic & Rate-Limit Enforcement',
    description:
      'Prove that configured token-bucket limits actively reject excess burst traffic with HTTP 429 rather than passing vacuously on idle routes.',
    moduleName: 'Module 3 — Breaking Safely',
    lifecycleStage: 'BREAK',
    category: 'Rate Limiting',
    difficulty: 'Intermediate',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 280,
    learningObjectives: [
      'Generate high-concurrency burst traffic against a rate-limited route.',
      'Verify non-zero allowed (2xx) and throttled (429) request counts.',
      'Understand why FortiX requires observed burst traffic before certifying rate-limit enforcement.',
    ],
    prerequisites: ['A route configured with a custom RPM limit in Security Policies.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Run a 20-Request Burst in API Studio or Autonomous Verification',
        instruction:
          'Open API Studio and click Send Burst (20x), or run a Rate-Limit Enforcement profile in Verifications.',
        actionPath: '/verifications',
        actionLabel: 'Run Rate-Limit Verification',
      },
      {
        stepNumber: 2,
        title: 'Confirm Observed 429 Throttling',
        instruction:
          'Check the evidence summary to confirm requests exceeded the RPM budget and excess traffic received HTTP 429.',
        actionPath: '/verifications',
        actionLabel: 'Inspect Verification Evidence',
      },
    ],
    warnings: [
      'If total observed requests stay below your RPM quota, rate-limit verification will report INCONCLUSIVE or FAIL because throttling was never exercised.',
    ],
    relatedSlugs: ['applying-rate-limiting', 'understanding-verification-results'],
    docLinks: [
      { title: 'Autonomous Verifications', href: '/verifications', kind: 'workspace' },
      { title: 'API Studio Playground', href: '/studio', kind: 'workspace' },
    ],
    featured: false,
    published: true,
    sortOrder: 120,
  },

  // =========================================================================
  // MODULE 4 — OBSERVING TELEMETRY
  // =========================================================================
  {
    id: '10000000-0000-4000-8000-000000000013',
    slug: 'understanding-telemetry',
    title: 'Understanding Live Telemetry, Threat Events & Metrics',
    description:
      'Monitor request latency logs, HTTP status distributions, blocked WAF/SSRF threat events, and Prometheus metrics across your project.',
    moduleName: 'Module 4 — Observing Telemetry',
    lifecycleStage: 'OBSERVE',
    category: 'Telemetry and Monitoring',
    difficulty: 'Beginner',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 260,
    learningObjectives: [
      'Read availability, error rate, and latency telemetry on the Resilience dashboard.',
      'Inspect blocked SQLi, XSS, and SSRF events on the Threats page.',
      'Query Prometheus exposition metrics (/metrics) for external observability.',
    ],
    prerequisites: ['Gateway proxy traffic sent through at least one route.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Inspect Resilience Summary Metrics',
        instruction:
          'Open Resilience to view live availability percentage, error rate, p50/p95 latency, and global resilience posture.',
        actionPath: '/resilience',
        actionLabel: 'Open Resilience Dashboard',
      },
      {
        stepNumber: 2,
        title: 'Audit Security Events in Threats',
        instruction:
          'Open Threats to inspect timestamped WAF and SSRF blocks tied to specific routes and request IDs.',
        actionPath: '/threats',
        actionLabel: 'Open Threats',
      },
    ],
    warnings: [
      'When no traffic has traversed a route yet, FortiX explicitly reports INSUFFICIENT_DATA rather than fabricating synthetic latency numbers.',
    ],
    relatedSlugs: ['reading-latency-and-error-metrics', 'understanding-verification-results'],
    docLinks: [
      { title: 'Resilience Telemetry', href: '/resilience', kind: 'workspace' },
      { title: 'Threats Telemetry', href: '/threats', kind: 'workspace' },
    ],
    featured: false,
    published: true,
    sortOrder: 130,
  },
  {
    id: '10000000-0000-4000-8000-000000000014',
    slug: 'reading-latency-and-error-metrics',
    title: 'Reading Baseline, Fault Injection & Recovery Windows',
    description:
      'Understand how FortiX flushes in-flight telemetry buffers and compares pre-fault baseline metrics against fault-injection and recovery windows.',
    moduleName: 'Module 4 — Observing Telemetry',
    lifecycleStage: 'OBSERVE',
    category: 'Telemetry and Monitoring',
    difficulty: 'Intermediate',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 320,
    learningObjectives: [
      'Interpret p50, p90, p95, and p99 latency percentiles accurately.',
      'Understand why baseline, injection, and recovery phases are evaluated as distinct windows.',
      'Recognize how deterministic telemetry flushing eliminates race conditions before verification queries run.',
    ],
    prerequisites: ['Familiarity with basic HTTP status codes and response latency.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Review Phase Timelines in Verifications',
        instruction:
          'Open Verifications and select a completed run to inspect its timestamped execution timeline from BASELINE through VERIFYING.',
        actionPath: '/verifications',
        actionLabel: 'Inspect Run Timeline',
      },
      {
        stepNumber: 2,
        title: 'Compare Observed Metrics Against Thresholds',
        instruction:
          'Examine each check row to compare observed p95 latency, error rate, and recovery duration against deterministic thresholds.',
        actionPath: '/verifications',
        actionLabel: 'Compare Thresholds',
      },
    ],
    warnings: [
      'High p99 latency alongside normal p50 latency indicates tail-latency spikes affecting a subset of requests rather than uniform slowdown.',
    ],
    relatedSlugs: ['understanding-telemetry', 'understanding-verification-results'],
    docLinks: [{ title: 'Verifications Timeline', href: '/verifications', kind: 'workspace' }],
    featured: false,
    published: true,
    sortOrder: 140,
  },

  // =========================================================================
  // MODULE 5 — PROVING SECURITY & RESILIENCE
  // =========================================================================
  {
    id: '10000000-0000-4000-8000-000000000015',
    slug: 'understanding-verification-results',
    title: 'Understand Telemetry & Verification: PASS, FAIL & INCONCLUSIVE',
    description:
      'Execute an autonomous verification run and learn exactly how FortiX computes deterministic PASS, FAIL, and INCONCLUSIVE verdicts from real evidence.',
    moduleName: 'Module 5 — Proving Security & Resilience',
    lifecycleStage: 'PROVE',
    category: 'Verification and Evidence',
    difficulty: 'Intermediate',
    videoProvider: 'self_hosted',
    videoReference: '/learning/videos/understanding-verification-results.webm',
    videoSourceNote:
      'Automated silent live-UI walkthrough capture (25s) with synchronized WebVTT captions.',
    thumbnailUrl: null,
    captionsUrl: '/learning/captions/understanding-verification-results.vtt',
    durationSeconds: 25,
    learningObjectives: [
      'Launch an autonomous verification profile (Full Verification, Rate-Limit, WAF, or Resilience) on a target route.',
      'Differentiate PASS (controls proven by telemetry), FAIL (threshold or control breach observed), and INCONCLUSIVE (insufficient sample size or missing traffic).',
      'Use individual check failures and evidence references to tighten policies and re-verify (IMPROVE).',
    ],
    prerequisites: ['At least one route registered in Protected APIs or API Studio.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Select Route & Verification Profile',
        instruction:
          'Open Verifications, choose your route and verification profile (e.g., Full Verification), and start an autonomous verification run.',
        actionPath: '/verifications',
        actionLabel: 'Open Verifications',
      },
      {
        stepNumber: 2,
        title: 'Inspect the Deterministic Check Matrix',
        instruction:
          'Review each individual check—observed value, threshold, status (PASS, FAIL, or INCONCLUSIVE), and telemetry evidence reference.',
        actionPath: '/verifications',
        actionLabel: 'Inspect Check Matrix',
      },
      {
        stepNumber: 3,
        title: 'Remediate Policy Gaps & Re-Run (IMPROVE)',
        instruction:
          'If a WAF, SSRF, or rate-limit check fails, update the route policy in Security and execute a fresh verification run to prove remediation.',
        actionPath: '/security',
        actionLabel: 'Tighten Security Policy',
      },
    ],
    warnings: [
      'Never treat INCONCLUSIVE as PASS: INCONCLUSIVE indicates insufficient request observations were captured to prove or disprove the control.',
    ],
    relatedSlugs: [
      'exporting-evidence-reports',
      'testing-rate-limit-enforcement',
      'configuring-security-policies',
    ],
    docLinks: [
      { title: 'Autonomous Verification Engine', href: '/verifications', kind: 'workspace' },
      { title: 'Resilience Summary', href: '/resilience', kind: 'workspace' },
    ],
    featured: true,
    published: true,
    sortOrder: 150,
  },
  {
    id: '10000000-0000-4000-8000-000000000016',
    slug: 'exporting-evidence-reports',
    title: 'Exporting JSON & PDF Verification Evidence Reports',
    description:
      'Generate portable JSON evidence bundles and formatted PDF verification reports for security reviews, audits, and capstone evaluations.',
    moduleName: 'Module 5 — Proving Security & Resilience',
    lifecycleStage: 'PROVE',
    category: 'Reports and Analysis',
    difficulty: 'Intermediate',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 210,
    learningObjectives: [
      'Export machine-readable JSON evidence artifacts from completed autonomous verification runs.',
      'Download server-generated PDF verification reports from Verifications and Resilience.',
      'Verify artifact contents including run timelines, observed metrics, and check verdicts.',
    ],
    prerequisites: ['At least one completed verification run.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Download JSON & PDF Run Artifacts',
        instruction:
          'Open Verifications, select a completed run, and use the Export JSON or Export PDF controls to download evidence.',
        actionPath: '/verifications',
        actionLabel: 'Export from Verifications',
      },
      {
        stepNumber: 2,
        title: 'Generate a Project Resilience Report',
        instruction:
          'Open Resilience and click Export Evidence PDF to download a summary report of project-wide telemetry and latest verdicts.',
        actionPath: '/resilience',
        actionLabel: 'Open Resilience Reports',
      },
    ],
    warnings: [
      'Exported evidence reflects the exact point-in-time run; re-export after policy changes and re-verification to share updated proof.',
    ],
    relatedSlugs: ['understanding-verification-results', 'reading-latency-and-error-metrics'],
    docLinks: [
      { title: 'Verifications Console', href: '/verifications', kind: 'workspace' },
      { title: 'Resilience Reports', href: '/resilience', kind: 'workspace' },
    ],
    featured: false,
    published: true,
    sortOrder: 160,
  },

  // =========================================================================
  // MODULE 6 — API STUDIO
  // =========================================================================
  {
    id: '10000000-0000-4000-8000-000000000017',
    slug: 'creating-an-api-using-api-studio',
    title: 'Build and Test an API Using API Studio (Products API Workflow)',
    description:
      'Create a complete Store / Products REST API inside FortiX without external backend setup, populate 100 deterministic records, apply security, and verify behavior.',
    moduleName: 'Module 6 — API Studio',
    lifecycleStage: 'PROTECT',
    category: 'API Studio',
    difficulty: 'Beginner',
    videoProvider: 'self_hosted',
    videoReference: '/learning/videos/creating-an-api-using-api-studio.webm',
    videoSourceNote:
      'Automated silent live-UI walkthrough capture (25s) with synchronized WebVTT captions.',
    thumbnailUrl: null,
    captionsUrl: '/learning/captions/creating-an-api-using-api-studio.vtt',
    durationSeconds: 25,
    learningObjectives: [
      'Provision a live Products API (or custom multi-resource Store API) with automatic gateway route binding in one click.',
      'Seed realistic, deterministic sample records and inspect generated CRUD endpoints and OpenAPI 3.1 specs.',
      'Send live GET/POST/PATCH/DELETE and 20-request burst calls through the FortiX Gateway and verify security controls.',
    ],
    prerequisites: ['Signed in to FortiX Control Plane.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Provision the Products API in API Studio',
        instruction:
          'Open API Studio and click Create Products API (100 Records) to generate the API, typed resource fields, sample dataset, and bound gateway route.',
        actionPath: '/studio',
        actionLabel: 'Open API Studio',
      },
      {
        stepNumber: 2,
        title: 'Send Live Gateway Requests in the Playground',
        instruction:
          'Select an endpoint (such as GET /products), attach an API key if required, and click Send Request to inspect real HTTP status, latency, rate-limit headers, and JSON payload.',
        actionPath: '/studio',
        actionLabel: 'Test Endpoints in Studio',
      },
      {
        stepNumber: 3,
        title: 'Apply Rate Limiting, WAF & Burst Verification',
        instruction:
          'Configure rate-limit RPM and WAF toggles directly on the Studio API, run a 20x burst test to observe HTTP 429 enforcement, and launch verification.',
        actionPath: '/verifications',
        actionLabel: 'Verify Studio API',
      },
    ],
    warnings: [
      'Schema validation on Studio POST and PATCH endpoints strictly enforces declared field types, required attributes, and numeric bounds.',
    ],
    relatedSlugs: [
      'seeding-sample-data-in-studio',
      'testing-crud-endpoints-in-studio',
      'protecting-and-verifying-studio-api',
    ],
    docLinks: [
      { title: 'FortiX API Studio', href: '/studio', kind: 'workspace' },
      { title: 'Autonomous Verifications', href: '/verifications', kind: 'workspace' },
    ],
    featured: true,
    published: true,
    sortOrder: 170,
  },
  {
    id: '10000000-0000-4000-8000-000000000018',
    slug: 'seeding-sample-data-in-studio',
    title: 'Defining Resources & Seeding Deterministic Sample Data',
    description:
      'Design custom Studio resources (Products, Customers, Orders) with typed field constraints and populate deterministic sample records.',
    moduleName: 'Module 6 — API Studio',
    lifecycleStage: 'PROTECT',
    category: 'API Studio',
    difficulty: 'Beginner',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 240,
    learningObjectives: [
      'Create custom resources with string, number, integer, boolean, and enum field schemas.',
      'Seed deterministic sample batches or import JSON records cleanly.',
      'Download the auto-generated OpenAPI JSON contract for your custom Studio API.',
    ],
    prerequisites: ['Access to FortiX API Studio.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Add a Custom Resource Schema',
        instruction:
          'In API Studio, select your API, define resource fields (such as name, price, stock, category), and save the resource.',
        actionPath: '/studio',
        actionLabel: 'Configure Studio Resource',
      },
      {
        stepNumber: 2,
        title: 'Generate Sample Records',
        instruction:
          'Trigger deterministic sample generation to populate realistic records ready for immediate CRUD and burst testing.',
        actionPath: '/studio',
        actionLabel: 'Seed Records in Studio',
      },
    ],
    warnings: [
      'Re-seeding with reset enabled replaces existing Studio records in that resource—export any custom test records you wish to keep.',
    ],
    relatedSlugs: ['creating-an-api-using-api-studio', 'testing-crud-endpoints-in-studio'],
    docLinks: [{ title: 'FortiX API Studio', href: '/studio', kind: 'workspace' }],
    featured: false,
    published: true,
    sortOrder: 180,
  },
  {
    id: '10000000-0000-4000-8000-000000000019',
    slug: 'testing-crud-endpoints-in-studio',
    title: 'Testing CRUD Endpoints & Request Validation in API Studio',
    description:
      'Exercise GET, POST, PATCH, and DELETE operations through the gateway proxy and inspect status codes, request IDs, and schema validation errors.',
    moduleName: 'Module 6 — API Studio',
    lifecycleStage: 'OBSERVE',
    category: 'API Studio',
    difficulty: 'Intermediate',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 270,
    learningObjectives: [
      'Execute collection GET, item GET, POST creation, PATCH partial updates, and DELETE calls in the Studio request runner.',
      'Verify HTTP 400 validation errors when invalid field types or out-of-range numbers are submitted.',
      'Correlate Studio X-Request-ID headers with gateway metric logs.',
    ],
    prerequisites: ['A Studio API with at least one seeded resource.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Execute Collection & Item Requests',
        instruction:
          'Open API Studio, pick GET /products or POST /products in the interactive playground, customize the JSON body, and click Send.',
        actionPath: '/studio',
        actionLabel: 'Open Studio Playground',
      },
      {
        stepNumber: 2,
        title: 'Inspect Gateway Headers & Latency',
        instruction:
          'Check the response inspector for status code, round-trip latency (ms), X-Request-ID, and rate-limit quota headers.',
        actionPath: '/studio',
        actionLabel: 'Inspect Response Headers',
      },
    ],
    warnings: [
      'DELETE requests mutate the live Studio dataset in your workspace; re-seed the resource anytime to restore baseline records.',
    ],
    relatedSlugs: ['creating-an-api-using-api-studio', 'protecting-and-verifying-studio-api'],
    docLinks: [{ title: 'FortiX API Studio', href: '/studio', kind: 'workspace' }],
    featured: false,
    published: true,
    sortOrder: 190,
  },
  {
    id: '10000000-0000-4000-8000-000000000020',
    slug: 'protecting-and-verifying-studio-api',
    title: 'Protecting, Breaking & Verifying a Studio API End-to-End',
    description:
      'Complete the closed-loop FortiX workflow on a Studio API: enforce security controls, inject faults, verify deterministic checks, and export proof.',
    moduleName: 'Module 6 — API Studio',
    lifecycleStage: 'IMPROVE',
    category: 'Verification and Evidence',
    difficulty: 'Advanced',
    videoProvider: 'none',
    videoReference: null,
    videoSourceNote: null,
    thumbnailUrl: null,
    captionsUrl: null,
    durationSeconds: 360,
    learningObjectives: [
      'Combine API Studio, Security Policies, Experiments, and Autonomous Verifications into a repeatable evaluation workflow.',
      'Diagnose a deliberately weak policy (e.g., disabled WAF), observe a FAIL verdict, enable WAF, and prove a PASS verdict.',
      'Export the resulting PDF and JSON verification evidence for academic or engineering review.',
    ],
    prerequisites: ['A Studio API with a bound gateway route.'],
    steps: [
      {
        stepNumber: 1,
        title: 'Bind Tight Security Controls to Your Studio Route',
        instruction:
          'Confirm WAF blocking, SSRF guard, and an explicit RPM quota are active on the Studio API route.',
        actionPath: '/security',
        actionLabel: 'Verify Policy in Security',
      },
      {
        stepNumber: 2,
        title: 'Run Full Autonomous Verification',
        instruction:
          'Open Verifications, select your Studio API route, run the Full Verification profile, and inspect all deterministic checks.',
        actionPath: '/verifications',
        actionLabel: 'Run Full Verification',
      },
      {
        stepNumber: 3,
        title: 'Export Verification Evidence',
        instruction:
          'Download the PDF and JSON evidence reports proving your Studio API withstood fault and security checks.',
        actionPath: '/verifications',
        actionLabel: 'Export Evidence',
      },
    ],
    warnings: [
      'Wait for active fault experiments on the same route to finish before launching an autonomous verification run so telemetry windows stay isolated.',
    ],
    relatedSlugs: [
      'creating-an-api-using-api-studio',
      'understanding-verification-results',
      'exporting-evidence-reports',
    ],
    docLinks: [
      { title: 'API Studio', href: '/studio', kind: 'workspace' },
      { title: 'Verifications & Evidence', href: '/verifications', kind: 'workspace' },
    ],
    featured: false,
    published: true,
    sortOrder: 200,
  },
];

let seedPromise: Promise<void> | null = null;
let catalogSeeded = false;

export async function ensureLearningCatalogSeeded(database: typeof db = db): Promise<void> {
  if (catalogSeeded && database === db) return;
  if (seedPromise && database === db) return seedPromise;

  const run = async () => {
    for (const item of CANONICAL_LEARNING_TUTORIALS) {
      const existing = await database
        .select({ id: schema.learningTutorials.id })
        .from(schema.learningTutorials)
        .where(eq(schema.learningTutorials.slug, item.slug))
        .limit(1);

      if (existing.length === 0) {
        await database
          .insert(schema.learningTutorials)
          .values({
            id: item.id,
            slug: item.slug,
            title: item.title,
            description: item.description,
            moduleName: item.moduleName,
            lifecycleStage: item.lifecycleStage,
            category: item.category,
            difficulty: item.difficulty,
            videoProvider: item.videoProvider,
            videoReference: item.videoReference,
            videoSourceNote: item.videoSourceNote,
            thumbnailUrl: item.thumbnailUrl,
            captionsUrl: item.captionsUrl,
            durationSeconds: item.durationSeconds,
            learningObjectives: item.learningObjectives,
            prerequisites: item.prerequisites,
            steps: item.steps,
            warnings: item.warnings,
            relatedSlugs: item.relatedSlugs,
            docLinks: item.docLinks,
            featured: item.featured,
            published: item.published,
            sortOrder: item.sortOrder,
          })
          .onConflictDoNothing();
      }
    }
    if (database === db) {
      catalogSeeded = true;
    }
  };

  if (database === db) {
    seedPromise = run().finally(() => {
      seedPromise = null;
    });
    return seedPromise;
  }

  await run();
}

export function resetLearningCatalogSeedFlagForTests(): void {
  catalogSeeded = false;
  seedPromise = null;
}
