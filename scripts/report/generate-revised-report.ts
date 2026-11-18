import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import {
  ReportBlock,
  ReportChapter,
  ReportDocumentModel,
} from './types';
import {
  REPORT_METADATA,
  REPORT_ABBREVIATIONS,
  REPORT_PRELIMINARY,
  CHAPTERS_PART1,
} from './content-part1';
import { CHAPTERS_PART2 } from './content-part2';
import { CHAPTERS_PART3 } from './content-part3';

const ROOT_DIR = process.cwd();
const REPORTS_DIR = path.join(ROOT_DIR, 'docs/reports');
const REVISED_AST_PATH = path.join(REPORTS_DIR, 'report-revised-ast.json');
const REVISED_MD_PATH = path.join(REPORTS_DIR, 'FORTIX_BTECH_PROJECT_REPORT_REVISED.md');
const REVISED_PDF_PATH = path.join(REPORTS_DIR, 'FORTIX_BTECH_PROJECT_REPORT_REVISED.pdf');

const PAGE_W = 595.28; // A4 width pt
const PAGE_H = 841.89; // A4 height pt
const MARGIN_L = 50;
const MARGIN_R = 50;
const MARGIN_T = 62;
const MARGIN_B = 64;
const PDFKIT_MARGIN_B = 42;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const MAX_Y = PAGE_H - MARGIN_B;

const TTF_PATHS = {
  sans: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  italic: '/usr/share/fonts/truetype/noto/NotoSans-Italic.ttf',
  mono: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  monoBold: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
};

const HAS_TTF = fs.existsSync(TTF_PATHS.sans);

const FONTS = {
  sans: HAS_TTF ? 'FortiXSans' : 'Helvetica',
  bold: HAS_TTF ? 'FortiXSansBold' : 'Helvetica-Bold',
  italic: HAS_TTF ? 'FortiXSansItalic' : 'Helvetica-Oblique',
  mono: HAS_TTF ? 'FortiXMono' : 'Courier',
  monoBold: HAS_TTF ? 'FortiXMonoBold' : 'Courier-Bold',
};

const COLORS = {
  navy: '#0F172A',
  slateDark: '#1E293B',
  body: '#1F2937',
  muted: '#475569',
  accent: '#EA580C',
  blue: '#1D4ED8',
  border: '#CBD5E1',
  lightBg: '#F8FAFC',
  altRow: '#F1F5F9',
  calloutBg: '#EFF6FF',
};

interface TocEntry {
  level: 1 | 2 | 3;
  label: string;
  page: number;
}

interface IndexedCaption {
  num: string;
  caption: string;
  page: number;
}

interface LayoutIndex {
  toc: TocEntry[];
  figures: IndexedCaption[];
  tables: IndexedCaption[];
  totalPages: number;
}

/**
 * Reads an exact, unmodified, byte-for-byte contiguous line slice from a repository source file
 * and verifies at build time that the extracted slice is a verbatim substring of the source file.
 */
function readVerbatimSlice(
  relPath: string,
  startLine: number,
  endLine: number,
  mustContainAnchor: string
): string {
  const absPath = path.join(ROOT_DIR, relPath);
  const fullText = fs.readFileSync(absPath, 'utf8');
  const lines = fullText.split('\n');
  if (startLine < 1 || endLine > lines.length || startLine > endLine) {
    throw new Error(
      `[VerbatimCheck] Out-of-bounds slice ${relPath}:${startLine}-${endLine} (file has ${lines.length} lines)`
    );
  }
  const slice = lines.slice(startLine - 1, endLine).join('\n');
  if (!fullText.includes(slice)) {
    throw new Error(`[VerbatimCheck] Slice ${relPath}:${startLine}-${endLine} is not a contiguous substring!`);
  }
  if (!slice.includes(mustContainAnchor)) {
    throw new Error(
      `[VerbatimCheck] Slice ${relPath}:${startLine}-${endLine} missing anchor "${mustContainAnchor}"`
    );
  }
  return slice;
}

function buildRevisedDocumentModel(): ReportDocumentModel {
  const metadata: ReportDocumentModel['metadata'] = {
    ...JSON.parse(JSON.stringify(REPORT_METADATA)),
    activeBranch: 'main @ a97c14fb53d0bd3c915016cfdfafe4524c288517 (Source & Sandbox Audited)',
  };

  const abbreviations: ReportDocumentModel['abbreviations'] = JSON.parse(
    JSON.stringify(REPORT_ABBREVIATIONS)
  ).map((item: { abbr: string; full: string; context: string }) => {
    if (item.abbr === 'RLS') {
      return {
        ...item,
        context:
          'PostgreSQL 15 Row-Level Security DDL (drizzle/postgres_rls_policies.sql); source-confirmed, requires external PostgreSQL 15 (skipped in pg-mem sandbox)',
      };
    }
    if (item.abbr === 'WAF') {
      return {
        ...item,
        context:
          'Gateway 13-pattern regex request inspector detecting multi-decoded SQLi, XSS, and path traversal (src/threat-detection/index.ts)',
      };
    }
    return item;
  });
  abbreviations.push({
    abbr: 'SHA-256',
    full: 'Secure Hash Algorithm 256-bit (FIPS 180-4)',
    context:
      'Content digest used for HashedApiKeyCache indexing, single-use token hashing, and PDF artifact checksums (not an asymmetric signature)',
  });

  const preliminary: ReportDocumentModel['preliminary'] = {
    ...JSON.parse(JSON.stringify(REPORT_PRELIMINARY)),
    declarationText: [
      'We hereby declare that the project report entitled "FORTIX — API Security & Resilience Verification Platform" submitted in partial fulfillment of the degree of Bachelor of Technology in Information Technology is our original work carried out during the [Academic Year 2025–2026].',
      'Every architectural diagram, database table specification, verbatim source code slice, UI screenshot, and automated test figure in this revised document is anchored to commit a97c14fb53d0bd3c915016cfdfafe4524c288517 of the FortiX repository. Throughout this report we strictly distinguish between SOURCE-CONFIRMED implementations (verified in repository TypeScript/SQL/Docker files), RUNTIME-VERIFIED behaviors (executed and logged in the Node.js 22 + Chromium test sandbox backed by pg-mem and local/in-memory Redis fallbacks), and INFRASTRUCTURE-BLOCKED or STUB capabilities (live multi-container Docker Compose, live PostgreSQL 15 NOBYPASSRLS enforcement, external Redis 7 Lua/Streams/BullMQ execution, S3 cloud storage SDK calls, and live SMTP/SMS carrier delivery).',
    ],
    abstractParagraphs: [
      'Modern cloud-native and microservice applications expose core business logic and sensitive multi-tenant data through HTTP Application Programming Interfaces (APIs). Organizations routinely configure defensive controls—such as API-key authentication, rate limiting, request payload filters, Server-Side Request Forgery (SSRF) guards, and upstream timeouts—under the assumption that configuration alone guarantees runtime protection. In practice, concurrency race conditions in rate limiters, middleware ordering defects, upstream dependency latency spikes, and cross-tenant authorization oversights frequently invalidate those assumptions under real traffic.',
      'FortiX is an integrated API Security and Resilience Verification Platform built around a closed-loop engineering lifecycle: PROTECT → BREAK → OBSERVE → PROVE → IMPROVE. Rather than treating gateway protection, fault injection, and compliance reporting as disconnected tools, FortiX unifies (1) an HTTP reverse-proxy enforcement plane (/proxy/:routeId/*) implementing SHA-256/bcrypt scoped API-key validation, SSRF/DNS-rebinding defenses, a 13-pattern multi-decoded SQLi/XSS/path-traversal regex inspector, and token-bucket rate limiting; (2) FortiX API Studio, a self-contained zero-backend API builder seeded with a canonical 100-record e-commerce Products dataset and OpenAPI 3.0.3 export; (3) an asynchronous experiment engine executing bounded latency, HTTP 5xx, timeout, and traffic-burst workloads across three observation windows (BASELINE, INJECTION, and RECOVERY); (4) a deterministic Verification Engine synchronized via flushTelemetryBarrier() that produces non-vacuous PASS, FAIL, or INCONCLUSIVE verdicts and server-side PDFKit compliance reports stamped with SHA-256 content checksums (X-FortiX-Artifact-SHA256); and (5) an integrated In-App Video Learning Center (FTX-LEARN-001) mounted at /api/learning/*.',
      'The platform is implemented in TypeScript 5.8 on Node.js 22 (Express 4.21 backend, React 19 + Vite 6 control-plane SPA) over a normalized 23-table relational schema managed with Drizzle ORM 0.45 (migrations 0000–0007). Source-confirmed production artifacts include PostgreSQL 15 Row-Level Security (RLS) DDL across 17 tables (drizzle/postgres_rls_policies.sql), an embedded Redis 7 Lua token-bucket script (src/rate-limit/redis.ts), Redis Streams telemetry pipelines (fortix:stream:metrics and fortix:stream:security), Pub/Sub key-revocation broadcasts (fortix:api-key:revoked:v1), and BullMQ job queues, paired with deterministic in-memory fallbacks (pg-mem and ioredis-mock / local runners) when external daemons are absent. Operator authentication (FTX-AUTH-001) provides HttpOnly session cookies, rotating Remember-Me refresh token families with reuse detection, double-submit CSRF protection, and 6-digit HMAC-SHA256 OTP account recovery.',
      'Empirical validation executed on commit a97c14fb53d0bd3c915016cfdfafe4524c288517 in the Node.js 22 + Headless Chromium sandbox confirms 0 TypeScript lint/build errors, 35/35 passing Vitest unit and integration suites (269/269 passing assertions in 122.2s), and 13/13 passing Playwright end-to-end and security specifications (48.2s). External multi-container Docker Compose, live PostgreSQL 15 RLS role enforcement, external Redis 7 execution, cloud S3 SDK integration (currently a local-delegating stub), and paid SMTP/SMS carrier delivery are explicitly documented as source-confirmed or infrastructure-blocked rather than overstated as sandbox-executed.',
    ],
  };

  const chPart1: ReportChapter[] = JSON.parse(JSON.stringify(CHAPTERS_PART1));
  const chPart2: ReportChapter[] = JSON.parse(JSON.stringify(CHAPTERS_PART2));
  const chPart3: ReportChapter[] = JSON.parse(JSON.stringify(CHAPTERS_PART3));

  // ==================== CHAPTER 1 & CHAPTER 2 REVISIONS ====================
  const ch1 = chPart1[0];
  const sec11 = ch1.sections[0];
  // Callout in 1.1: replace "tamper-evident" with "SHA-256 content-checksummed"
  sec11.blocks = sec11.blocks.map((b) =>
    b.kind === 'callout'
      ? {
          ...b,
          text: 'Configuring a control declares intent; testing sends synthetic stimuli; observing records runtime telemetry; proving evaluates complete, synchronized baseline, fault-injection, and recovery observations against explicit SLA rules to produce deterministic PASS, FAIL, or INCONCLUSIVE verdicts backed by SHA-256 content-checksummed PDF reports.',
        }
      : b
  );

  // Sub 1.1.1 Table 1.1
  const sub111 = sec11.subsections![0];
  sub111.blocks = sub111.blocks.map((b) => {
    if (b.kind === 'table' && b.tableNumber === '1.1') {
      return {
        ...b,
        rows: [
          b.rows[0],
          [
            'Rate-Limit Enforcement',
            'Often relies on per-process counters or non-atomic cache reads vulnerable to burst race conditions.',
            'Provides an atomic Redis Lua token-bucket script (src/rate-limit/redis.ts, SOURCE-CONFIRMED) with production fail-closed policy and bounded single-process fallback in sandbox mode.',
          ],
          b.rows[2],
          [
            'Chaos & Fault Safety',
            'External chaos scripts risk impacting unauthenticated traffic or leaving zombie fault rules active on crash.',
            'Pre-auth gateway ordering (401 before fault injection), strict project ownership checks, Zod API bounds (1–300s) + worker hard execution clamp (0.5–10s), and try/finally ephemeral key cleanup.',
          ],
          b.rows[4],
          [
            'Audit & Compliance Evidence',
            'Screenshots of terminal logs without structured integrity digests or three-phase SLA comparison.',
            'Generates structured JSONB verdicts and server-side PDFKit compliance reports stamped with SHA-256 content checksums (X-FortiX-Artifact-SHA256) on local artifact storage.',
          ],
        ],
      };
    }
    return b;
  });

  // Sub 1.1.2 Objectives, Figure 1.1 sourceNote, and Table 1.2
  const sub112 = sec11.subsections![1];
  sub112.blocks = sub112.blocks.map((b) => {
    if (b.kind === 'numbered') {
      return {
        kind: 'numbered',
        items: [
          'Enforce layered pre-upstream API protection (scoped API keys, SSRF/DNS-rebinding guards, a 13-pattern multi-decoded SQLi/XSS/path-traversal regex filter, and token-bucket rate limiting) with SHA-256 digest key caching.',
          'Provide hardened operator authentication (FTX-AUTH-001) supporting email or verified E.164 phone sign-in, Remember-Me refresh session rotation, active session revocation, and 6-digit HMAC-SHA256 OTP password recovery.',
          'Eliminate external demo dependencies via FortiX API Studio, enabling zero-code creation of multi-resource CRUD APIs pre-populated with a deterministic 100-record Store Products catalog.',
          'Execute bounded, authorized resilience experiments (latency, error_5xx, timeout, and traffic_burst; worker-clamped to 500–10,000 ms) via BullMQ workers (with deterministic in-process fallback when external Redis is absent).',
          'Guarantee deterministic verification by synchronizing telemetry persistence via flushTelemetryBarrier() prior to SQL evaluation and enforcing >=80% baseline, injection, and recovery sample coverage.',
          'Produce downloadable SHA-256 checksummed PDF reports (via LocalStorageProvider), HMAC-SHA256 signed outbound webhooks, resilience posture scoring, and guided in-app video tutorials (/api/learning/*).',
        ],
      };
    }
    if (b.kind === 'figure' && b.figureNumber === '1.1') {
      return {
        ...b,
        sourceNote:
          'Reconstructed from server.ts, src/api/index.ts (mounting /api/auth/*, /api/learning/*, and /api/control/*), src/gateway/index.ts, src/experiments/worker.ts, and src/verification/engine.ts. Note: S3StorageProvider in src/storage/s3-storage.ts currently delegates to LocalStorageProvider without AWS SDK cloud calls.',
      };
    }
    if (b.kind === 'table' && b.tableNumber === '1.2') {
      return {
        ...b,
        caption: 'Repository-Verified Feature & Three-Tier Evidence Classification Matrix',
        headers: [
          'Capability / Module',
          'Evidence Classification',
          'Primary Source Files',
          'DB Tables & Redis Keys',
          'Executed Test / Audit Evidence',
        ],
        rows: [
          [
            'Operator Auth, Remember-Me & OTP Recovery (FTX-AUTH-001)',
            'SOURCE-CONFIRMED + RUNTIME-VERIFIED (Sandbox)',
            'src/api/auth.ts, src/auth/sessions.ts, src/auth/recovery.ts, src/components/Login.tsx, src/pages/PasswordRecovery.tsx',
            'users, refresh_tokens, recovery_challenges, auth_action_tokens',
            'ftx-auth-001.test.ts, auth-recovery.spec.ts (03-vitest.log, 04-playwright.log)',
          ],
          [
            'Application RBAC & BOLA Project Guards',
            'SOURCE-CONFIRMED + RUNTIME-VERIFIED (Sandbox)',
            'src/middleware/auth.ts, src/middleware/entitlements.ts, src/middleware/project.ts, src/api/admin.ts',
            'organizations, projects, project_settings, audit_logs',
            'tests/security/all.spec.ts, security-guard.test.ts (26 tests)',
          ],
          [
            'PostgreSQL 15 Row-Level Security (17 Tables)',
            'SOURCE-CONFIRMED + STATICALLY AUDITED (Live Postgres 15 BLOCKED in Sandbox)',
            'drizzle/postgres_rls_policies.sql, src/db/rls.ts',
            '17 tenant/user tables, role fortix_app (NOBYPASSRLS)',
            'postgres-rls.test.ts (SQL audit); skipped at runtime in pg-mem (!isPersistentStorage)',
          ],
          [
            'Reverse-Proxy Gateway, SSRF Guard & 13-Pattern Regex Filter',
            'SOURCE-CONFIRMED + RUNTIME-VERIFIED (Sandbox)',
            'src/gateway/index.ts, src/gateway/ssrf.ts, src/threat-detection/index.ts, src/lib/key-invalidation.ts',
            'api_routes, api_keys, security_policies, security_events, fortix:api-key:revoked:v1',
            'tests/security/auth.spec.ts, threat-detection.test.ts, ssrf.test.ts (26 tests)',
          ],
          [
            'Token-Bucket Rate Limiter (Lua Script + Local Fallback)',
            'SOURCE-CONFIRMED (Lua) + RUNTIME-VERIFIED (Local Bucket in Sandbox; Live Redis 7 BLOCKED)',
            'src/rate-limit/redis.ts',
            'Redis: ratelimit:{routeId}:{identifier} (PEXPIRE 60000ms)',
            'rate-limit.test.ts, api-studio.spec.ts (evaluateLocalBucket active when !isRealRedisActive)',
          ],
          [
            'FortiX API Studio & 100-Product Catalog Engine',
            'SOURCE-CONFIRMED + RUNTIME-VERIFIED (Sandbox)',
            'src/api/studio.ts, src/studio/target-handler.ts, src/studio/products-dataset.ts, src/studio/openapi-generator.ts',
            'studio_apis, studio_resources, studio_records',
            'api-studio.test.ts, api-studio.spec.ts (4.7s E2E pass)',
          ],
          [
            '3-Phase Chaos Worker & Deterministic Verification',
            'SOURCE-CONFIRMED + RUNTIME-VERIFIED (Sandbox Fallback Runner; Live BullMQ Redis BLOCKED)',
            'src/experiments/worker.ts, src/experiments/queue.ts, src/verification/engine.ts, src/lib/telemetry.ts',
            'experiments, metric_logs, verifications, fortix:stream:metrics',
            'verification-defects.test.ts, golden-demo.spec.ts (9.1s E2E pass)',
          ],
          [
            'SHA-256 Checksummed PDF Reports & Signed Webhooks',
            'LOCAL STORAGE VERIFIED / S3 ADAPTER IS A LOCAL STUB',
            'src/api/reports.ts, src/storage/local-storage.ts, src/storage/s3-storage.ts, src/lib/webhooks.ts',
            'webhooks, webhook_deliveries, storage/artifacts/*.pdf',
            'report.spec.ts, artifact-storage.test.ts (9 tests), webhooks.test.ts',
          ],
          [
            'In-App Video Learning Center (FTX-LEARN-001)',
            'SOURCE-CONFIRMED + RUNTIME-VERIFIED (Sandbox)',
            'src/api/learning.ts (/api/learning/*), src/learning/catalog-seed.ts, src/learning/video-validator.ts, src/pages/LearningCenter.tsx',
            'learning_tutorials, learning_progress, public/learning/*',
            'learning-center.test.ts, learning-center.spec.ts (23.8s 10-step E2E pass)',
          ],
          [
            'External SMTP / SMS OTP Webhook Delivery',
            'PARTIALLY VERIFIED (Webhook Contract Tested; Live Carrier BLOCKED)',
            'src/auth/providers.ts',
            'Env: AUTH_MAIL_WEBHOOK_URL, AUTH_SMS_WEBHOOK_URL',
            'Mock HTTP 2xx/5xx verified in ftx-auth-001.test.ts; live carrier requires external secrets',
          ],
        ],
      };
    }
    return b;
  });

  // Section 1.2 Tables 1.3, 1.4, 1.7
  const sec12 = ch1.sections[1];
  sec12.blocks = sec12.blocks.map((b) => {
    if (b.kind === 'table' && b.tableNumber === '1.3') {
      return {
        ...b,
        rows: b.rows.map((row) => {
          if (row[0] === 'FR-05') {
            return [
              'FR-05',
              'Active Session & Phone Management',
              'Lists active refresh session families for revocation, rotates account password, and enrolls E.164 phone numbers via 6-digit SMS OTP verification.',
              'GET/DELETE /api/auth/sessions, POST /api/auth/phone/*, POST /api/control/account/password',
            ];
          }
          if (row[0] === 'FR-10') {
            return [
              'FR-10',
              'Token-Bucket Rate Limiting',
              'Enforces RPM quotas via an embedded Redis Lua script (PEXPIRE 60s) in distributed deployments and bounded evaluateLocalBucket() in standalone sandbox mode; returns HTTP 429 when exhausted.',
              'src/rate-limit/redis.ts',
            ];
          }
          if (row[0] === 'FR-11') {
            return [
              'FR-11',
              '13-Pattern Regex Filter & SSRF Prevention',
              'Blocks multi-decoded SQLi, XSS, and path traversal payloads (13 regex signatures) and SSRF targets with HTTP 403/502 and logs rows to security_events.',
              'src/threat-detection/index.ts, src/gateway/ssrf.ts',
            ];
          }
          if (row[0] === 'FR-13') {
            return [
              'FR-13',
              'Bounded Chaos Experiment Execution',
              'Queues latency, error_5xx, timeout, and traffic_burst jobs (BullMQ with in-process fallback); runs 5 BASELINE probes, worker-clamped INJECTION probes (500–10,000 ms), and 5 RECOVERY probes.',
              'POST /api/control/experiments',
            ];
          }
          if (row[0] === 'FR-16') {
            return [
              'FR-16',
              'SHA-256 Checksummed PDF & Webhooks',
              'Generates PDFKit verification reports with X-FortiX-Artifact-SHA256 digests on LocalStorageProvider and dispatches t=<ts>,v1=<hex> HMAC-SHA256 webhooks.',
              'POST /api/control/reports/:verificationId',
            ];
          }
          if (row[0] === 'FR-17') {
            return [
              'FR-17',
              'In-App Video Learning Center & Progress',
              'Provides categorized lifecycle tutorials, allowlist-validated video references, step checklists, contextual drawers, and per-user resume/completion persistence.',
              'GET /api/learning/tutorials, PUT /api/learning/progress/:tutorialId',
            ];
          }
          return row;
        }),
      };
    }
    if (b.kind === 'table' && b.tableNumber === '1.4') {
      return {
        ...b,
        rows: b.rows.map((row) => {
          if (row[0] === 'Reliability & Fault Safety') {
            return [
              'Reliability & Fault Safety',
              'Chaos experiments must never persist indefinitely if a worker crashes or an operator aborts execution.',
              'API Zod schema cap (1–300s) + worker hard clamp (500–10,000 ms in src/experiments/worker.ts:282), explicit cancellation polling, and try/finally ephemeral fx_test_* key deletion.',
            ];
          }
          return row;
        }),
      };
    }
    if (b.kind === 'table' && b.tableNumber === '1.7') {
      return {
        ...b,
        rows: b.rows.map((row) => {
          if (row[0] === 'UC-05') {
            return [
              'UC-05',
              'Execute 3-Phase Experiment & Verify SLA',
              'API Operator / Worker',
              'Pre: Target route belongs to operator project. Main: Enqueue latency/error_5xx/timeout/traffic_burst experiment -> worker runs 5 BASELINE probes, activates fault for INJECTION probes (clamped <=10s), runs 5 RECOVERY probes -> awaits flushTelemetryBarrier() -> Verification Engine computes verdict & PDF report. Exc: Insufficient probe coverage (<80%) yields INCONCLUSIVE rather than false PASS. Post: Persisted verification record and SHA-256 checksummed PDF stored locally.',
            ];
          }
          return row;
        }),
      };
    }
    return b;
  });

  // Section 1.3 Table 1.8 + Repository Metadata Drift Disclosure Callout
  const sec13 = ch1.sections[2];
  sec13.blocks = sec13.blocks.map((b) => {
    if (b.kind === 'table' && b.tableNumber === '1.8') {
      return {
        ...b,
        rows: [
          ...b.rows.map((r) => {
            if (r[0] === 'Express') {
              return [
                'Express',
                '4.21.2',
                'HTTP Control & Proxy Server',
                'Mounts /api/auth, /api/learning, /api/control, /proxy/:routeId/*, health probes, security headers, and CSRF/CORS middleware.',
              ];
            }
            if (r[0] === 'React & Vite') {
              return [
                'React & Vite',
                '19.0.1 / ^6.2.3 (v6.4.3)',
                'Frontend SPA & Bundler',
                'Renders operator dashboard, API Studio, policy editors, OTP recovery screens, Learning Center, and Recharts visualizations.',
              ];
            }
            if (r[0] === 'PostgreSQL') {
              return [
                'PostgreSQL & pg-mem',
                '15-alpine / 3.0.14',
                'Relational DB & Sandbox SQL',
                'Stores all 23 normalized tables (PostgreSQL 15 + 17-table RLS DDL in Docker; auto-migrated pg-mem in local sandbox/Vitest).',
              ];
            }
            if (r[0] === 'Redis (ioredis)') {
              return [
                'Redis & ioredis-mock',
                '7-alpine / 6.0 / 8.13',
                'State, Streams & Sandbox Mock',
                'Defines Lua token-bucket script, fortix:stream:metrics, Pub/Sub, and BullMQ queues (with in-memory fallbacks when REDIS_URL is unset).',
              ];
            }
            if (r[0] === 'PDFKit') {
              return [
                'PDFKit',
                '0.20.2',
                'Compliance Report Renderer',
                'Synthesizes downloadable server-side verification PDF reports stamped with SHA-256 content checksums (X-FortiX-Artifact-SHA256).',
              ];
            }
            return r;
          }),
        ],
      };
    }
    return b;
  });
  sec13.blocks.push({
    kind: 'callout',
    title: 'Repository Metadata & Root Documentation Drift Disclosure (Read-Only Audit Note)',
    text: 'In the audited commit (a97c14fb53d0bd3c915016cfdfafe4524c288517), package.json retains initial scaffold metadata ("name": "react-example", "version": "0.0.0"), README.md contains legacy pre-refactor phrasing (referencing Redis Lists LPUSH/LPOP instead of Redis Streams XADD/XREADGROUP, /health/live instead of /api/health/live, and "cryptographic PDF report serving as immutable evidence"), and docs/development/PROGRESS.md + RELEASE_BASELINE.md reflect earlier test counts (230 Vitest / 9 Playwright) prior to FTX-AUTH-001 and FTX-LEARN-001. Per forensic audit protocol, application files were left untouched and authoritative figures in this report reflect the verified source and test execution logs.',
  });

  // Chapter 2 updates: Table 2.2 & Sequence narratives
  const ch2 = chPart1[1];
  const sec23 = ch2.sections[2];
  sec23.blocks = sec23.blocks.map((b) => {
    if (b.kind === 'table' && b.tableNumber === '2.2') {
      return {
        ...b,
        rows: b.rows.map((r) => {
          if (r[0] === 'RefreshSessionService') {
            return [
              'RefreshSessionService',
              'src/auth/sessions.ts',
              'createRefreshSession(), rotateRefreshSession(), revokeUserSessionFamily(), listActiveUserSessions(); manages Remember-Me TTLs and reuse detection.',
            ];
          }
          if (r[0] === 'ArtifactStorageProvider') {
            return [
              'ArtifactStorageProvider',
              'src/storage/artifact-storage.ts, local-storage.ts, s3-storage.ts',
              'LocalStorageProvider (RUNTIME-VERIFIED) persists PDFs + .meta.json SHA-256 sidecars; S3StorageProvider is a source-confirmed local-delegating stub (AWS SDK cloud upload is future work).',
            ];
          }
          return r;
        }),
      };
    }
    return b;
  });

  const sec24 = ch2.sections[3];
  sec24.blocks = sec24.blocks.map((b) => {
    if (b.kind === 'p' && b.text.startsWith('Workflow 4 Explanation')) {
      return {
        kind: 'p',
        text: 'Workflow 4 Explanation (Figure 2.10): When external Redis 7 is active (isRealRedisActive === true, SOURCE-CONFIRMED), checkRateLimit() evaluates an embedded 3-ARGV Lua script via EVAL on key ratelimit:{routeId}:{identifier} (reading tokens and last_refill via HMGET, computing integer elapsed refill math.floor(time_passed * (refillRate / 60000)), decrementing 1 token if available, and persisting via HMSET + PEXPIRE 60000). In standalone sandbox/test mode (!isRealRedisActive, RUNTIME-VERIFIED), checkRateLimit() executes evaluateLocalBucket() in process memory.',
      };
    }
    if (b.kind === 'p' && b.text.startsWith('Workflow 5 Explanation')) {
      return {
        kind: 'p',
        text: 'Workflow 5 Explanation (Figure 2.11): Creating an experiment validates route ownership and Zod schema bounds (type in latency | error_5xx | timeout | traffic_burst; API durationMs 1,000–300,000 ms), persists status=QUEUED, and enqueues a BullMQ job (or triggers dispatchFallbackExperimentRunner() in sandbox mode). The worker clamps active execution duration to 500–10,000 ms (src/experiments/worker.ts:282), mints a 15-minute ephemeral fx_test_* API key, transitions status through QUEUED -> BASELINE -> RUNNING -> OBSERVING -> ANALYZING -> COMPLETED, and records tagged BASELINE (5), INJECTION, and RECOVERY (5) probe waves.',
      };
    }
    if (b.kind === 'p' && b.text.startsWith('Workflow 7 & 8 Explanation')) {
      return {
        kind: 'p',
        text: 'Workflow 7 & 8 Explanation (Figure 2.13): Immediately after probe execution completes, VerificationEngine invokes flushTelemetryBarrier() so buffered stream/in-memory telemetry entries are committed to metric_logs before SQL evaluation begins. Observations are partitioned into BASELINE, INJECTION, and RECOVERY windows using exact probe request IDs and timestamp bounds. If expected probe coverage falls below 80% or zero injection samples exist, the engine refuses to emit a vacuous PASS and records INCONCLUSIVE; otherwise it persists PASS or FAIL and enables server-side PDFKit report generation stamped with an X-FortiX-Artifact-SHA256 checksum.',
      };
    }
    return b;
  });

  // ==================== CHAPTER 3 REVISIONS ====================
  const ch3 = chPart2[0];
  const sec31 = ch3.sections[0];
  sec31.blocks = sec31.blocks.map((b) => {
    if (b.kind === 'table' && b.tableNumber === '3.11') {
      return {
        ...b,
        rows: b.rows.map((r) => {
          if (r[0] === 'type') {
            return ['type', 'TEXT', 'NOT NULL', 'None', "'latency' | 'error_5xx' | 'timeout' | 'traffic_burst'"];
          }
          if (r[0] === 'status') {
            return [
              'status',
              'TEXT',
              'NOT NULL',
              'None',
              "'QUEUED' | 'BASELINE' | 'RUNNING' | 'OBSERVING' | 'ANALYZING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'",
            ];
          }
          return r;
        }),
      };
    }
    if (b.kind === 'table' && b.tableNumber === '3.12') {
      return {
        ...b,
        rows: b.rows.map((r) =>
          r[0] === 'pdf_s3_url'
            ? [
                'pdf_s3_url',
                'TEXT',
                'NULLABLE',
                'NULL',
                '"reports/proj-dd7b.../verification-51d2....pdf" (legacy column name; stored locally via LocalStorageProvider)',
              ]
            : r
        ),
      };
    }
    if (b.kind === 'table' && b.tableNumber === '3.16') {
      return {
        ...b,
        rows: b.rows.map((r) =>
          r[0] === 'signature'
            ? ['signature', 'TEXT', 'NULLABLE', 'NULL', '"t=1762165082,v1=6f4e2a9c..." (X-FortiX-Signature-256 format)']
            : r
        ),
      };
    }
    if (b.kind === 'table' && b.tableNumber === '3.23') {
      return {
        ...b,
        rows: b.rows.map((r) => {
          if (r[0] === 'video_reference') {
            return [
              'video_reference',
              'TEXT',
              'NULLABLE',
              'NULL',
              '"/learning/videos/fortix-platform-overview.webm" or 11-char ID / allowlisted HTTPS URL',
            ];
          }
          if (r[0] === 'captions_url') {
            return ['captions_url', 'TEXT', 'NULLABLE', 'NULL', '"/learning/captions/fortix-platform-overview.vtt"'];
          }
          return r;
        }),
      };
    }
    return b;
  });

  // Sub 3.1.1 RLS nuance + verbatim SQL migration 0006 + Table 3.25 fixes
  const sub311 = sec31.subsections![0];
  const verbatimSql0006 = readVerbatimSlice(
    'drizzle/0006_auth_sessions_and_recovery.sql',
    1,
    50,
    'CREATE TABLE IF NOT EXISTS "recovery_challenges"'
  );
  sub311.blocks = sub311.blocks.map((b) => {
    if (b.kind === 'bullets') {
      return {
        kind: 'bullets',
        items: b.items.map((item) =>
          item.startsWith('Engine-Level Tenant Isolation')
            ? "Defense-in-Depth PostgreSQL Row-Level Security (RLS — SOURCE-CONFIRMED, External DB Required): In drizzle/postgres_rls_policies.sql and src/db/rls.ts, FortiX defines non-superuser role fortix_app (NOBYPASSRLS), binds set_config('app.current_user_id', userId, true) inside withTenantContext(), and declares ENABLE ROW LEVEL SECURITY across 17 tenant/user tables. Two operational boundaries are explicitly noted: (1) in pg-mem sandbox mode (!isPersistentStorage()), withTenantContext() bypasses set_config because pg-mem does not emulate PostgreSQL RLS; and (2) policies include COALESCE(current_setting('app.current_user_id', true), '') = '' OR ... so background worker connections without a bound user setting remain functional—making Express project ownership middleware (src/middleware/project.ts) the primary runtime-enforced gate."
            : item
        ),
      };
    }
    if (b.kind === 'code') {
      return {
        kind: 'code',
        title: 'Verbatim SQL Migration — Auth Sessions & OTP Recovery (Lines 1–50)',
        filePath: 'drizzle/0006_auth_sessions_and_recovery.sql (lines 1–50)',
        language: 'sql',
        code: verbatimSql0006,
      };
    }
    if (b.kind === 'table' && b.tableNumber === '3.25') {
      return {
        ...b,
        caption: 'Redis 7 Operational Keyspace, Constants, and Sandbox Fallback Mapping (SOURCE-CONFIRMED)',
        rows: [
          [
            'ratelimit:{routeId}:{identifier}',
            'HASH',
            'PEXPIRE 60000 ms (60s)',
            'Mutated atomically by the 3-ARGV Lua script in src/rate-limit/redis.ts when external Redis is active; falls back to in-memory evaluateLocalBucket() when !isRealRedisActive.',
          ],
          [
            'fortix:stream:metrics & fortix:stream:security',
            'STREAM',
            'MAXLEN ~ 10,000',
            'Appended via XADD (src/lib/telemetry.ts:11) and drained by consumer group fortix:telemetry_group; uses inMemoryStreams + direct DB persistence in sandbox mode.',
          ],
          [
            'fortix:revoked-jwt:{jtiOrHash}',
            'STRING',
            'Remaining JWT exp',
            'Distributed access-JWT revocation denylist checked on control-plane requests (backed by bounded local Map when external Redis is absent).',
          ],
          [
            'fortix:revoked-sid:{familyId}',
            'STRING',
            'Up to 30 days',
            'Invalidates active access JWTs immediately when a refresh session family is revoked or token reuse is detected.',
          ],
          [
            'fortix:api-key:revoked:v1',
            'PUB/SUB',
            'Transient broadcast',
            'Broadcasts API-key revocation events (src/lib/key-invalidation.ts) across gateway replicas alongside immediate local HashedApiKeyCache eviction.',
          ],
          [
            'bull:experiments:* / bull:fortix-webhooks:*',
            'LIST / ZSET / HASH',
            'Removed on completion; DLQ retained',
            'BullMQ queues ("experiments" and "fortix-webhooks"); sandbox mode dispatches via in-process setTimeout fallback runners.',
          ],
        ],
      };
    }
    return b;
  });

  // ==================== CHAPTER 4 REVISIONS ====================
  const ch4 = chPart3[0];
  const sec41 = ch4.sections[0];
  sec41.blocks = sec41.blocks.map((b) => {
    if (b.kind === 'p') {
      return {
        kind: 'p',
        text: 'All fifteen user interface screenshots in this chapter (Figures 4.1–4.15) were captured programmatically via Playwright Headless Chromium from the live running FortiX server on http://127.0.0.1:3000 (scripts/report/capture-assets.ts) with automatic DOM redaction of raw fx_live_* API keys, session tokens, OTP digits, and personal email addresses. Authenticated workspace views (Figures 4.5–4.15) reflect the live ephemeral sandbox runtime (pg-mem + ioredis-mock); companion document docs/reports/SCREENSHOT_REQUIREMENTS.md lists additional views (such as /reset-password, /learning-center/:slug active video playback, and persistent Docker readiness) recommended when presenting a persistent multi-container deployment.',
      };
    }
    if (b.kind === 'table' && b.tableNumber === '4.1') {
      return {
        ...b,
        rows: b.rows.map((r) => {
          if (r[0].startsWith('Chaos Experiments')) {
            return [
              'Chaos Experiments (/experiments)',
              'src/pages/Experiments.tsx',
              'Validates type (latency | error_5xx | timeout | traffic_burst), API Zod durationMs 1,000–300,000 ms (clamped to 500–10,000 ms in worker); live QUEUED -> BASELINE -> RUNNING -> OBSERVING -> ANALYZING -> COMPLETED badges and Abort.',
              'GET/POST /api/control/experiments, POST /:id/cancel',
            ];
          }
          if (r[0].startsWith('Verifications & PDF')) {
            return [
              'Verifications & PDF (/verifications)',
              'src/pages/Verifications.tsx',
              'Renders PASS / FAIL / INCONCLUSIVE badges, Baseline vs Injection vs Recovery metrics, and one-click SHA-256 checksummed PDF compliance report generation.',
              'GET /api/control/verifications, POST /api/control/reports/:id',
            ];
          }
          if (r[0].startsWith('Video Learning Center')) {
            return [
              'Video Learning Center (/learning-center & /:slug)',
              'src/pages/LearningCenter.tsx & TutorialDetail.tsx',
              'Filters tutorials by lifecycle stage/category/difficulty, validates allowlisted video sources, renders WebM/VTT playback + checklist, and persists resume cursor & completion.',
              'GET /api/learning/tutorials, GET /:slug, PUT /api/learning/progress/:tutorialId',
            ];
          }
          if (r[0].startsWith('Account & Governance')) {
            return [
              'Account & Governance (/settings)',
              'src/pages/Settings.tsx',
              'Validates E.164 phone enrollment + 6-digit SMS OTP, lists active refresh session families with Revoke buttons, rotates password, and enforces optimistic version locking on project settings.',
              'GET/DELETE /api/auth/sessions, POST /api/auth/phone/*, /api/control/account/*, /api/control/settings',
            ];
          }
          return r;
        }),
      };
    }
    if (b.kind === 'figure') {
      const figNum = b.figureNumber;
      const isSandboxWorkspace = !['4.1', '4.2', '4.3', '4.4'].includes(figNum);
      return {
        ...b,
        sourceNote: `${b.sourceNote || ''}${
          isSandboxWorkspace ? ' [Runtime context: Live FortiX ephemeral-sandbox mode (pg-mem + in-memory Redis fallback), secrets redacted.]' : ''
        }`.trim(),
      };
    }
    return b;
  });

  // Section 4.2: Replace ALL 7 paraphrased samples with 100% VERBATIM repository slices
  const sample1Code = readVerbatimSlice(
    'src/auth/sessions.ts',
    110,
    305,
    'export async function rotateRefreshSession(params:'
  );
  const sample2aCode = readVerbatimSlice(
    'src/auth/recovery.ts',
    108,
    121,
    'export function computeOtpHmac('
  );
  const sample2bCode = readVerbatimSlice(
    'src/auth/recovery.ts',
    600,
    791,
    'export async function verifyPasswordRecoveryOtp(params:'
  );
  const sample3Code = readVerbatimSlice(
    'src/rate-limit/redis.ts',
    91,
    205,
    'export async function checkRateLimit('
  );
  const sample4aCode = readVerbatimSlice(
    'src/gateway/index.ts',
    147,
    162,
    "proxyReq.removeHeader('x-api-key')"
  );
  const sample4bCode = readVerbatimSlice(
    'src/gateway/index.ts',
    336,
    417,
    'const rawKey = extractGatewayApiKey(req);'
  );
  const sample4cCode = readVerbatimSlice(
    'src/gateway/index.ts',
    498,
    565,
    'const threats = detectThreats(req);'
  );
  const sample5Code = readVerbatimSlice(
    'src/verification/engine.ts',
    66,
    245,
    'export async function verifyPolicy('
  );
  const sample6aCode = readVerbatimSlice(
    'src/studio/target-handler.ts',
    180,
    210,
    'export async function handleStudioUpstreamRequest('
  );
  const sample6bCode = readVerbatimSlice(
    'src/studio/target-handler.ts',
    301,
    391,
    'const validation = validateStudioRecordPayload('
  );
  const sample7Code = readVerbatimSlice(
    'src/learning/video-validator.ts',
    107,
    199,
    'export function validateVideoSource('
  );

  const sec42 = ch4.sections[1];
  sec42.blocks = [
    {
      kind: 'p',
      text: 'This section presents character-for-character verbatim TypeScript excerpts extracted directly from the audited FortiX repository (commit a97c14fb53d0bd3c915016cfdfafe4524c288517) with exact source file paths and line ranges. Zero paraphrasing, signature condensation, or identifier renaming has been performed; build-time substring verification confirms every code block matches the repository file byte-for-byte.',
    },
    {
      kind: 'code',
      title: 'Sample 1 — Verbatim Refresh Session Rotation & Reuse Detection',
      filePath: 'src/auth/sessions.ts (lines 110–305 — rotateRefreshSession)',
      language: 'typescript',
      code: sample1Code,
    },
    {
      kind: 'p',
      text: 'Walkthrough & Security Analysis (src/auth/sessions.ts:110–305): rotateRefreshSession({ rawRefreshToken, userAgent, ip }) serializes concurrent calls per SHA-256 token digest using refreshRotationLocks, inspects existing.replacedById !== null || existing.revokedAt !== null to detect replay of an already-rotated token (immediately revoking the entire familyId and calling revokeSessionFamilySid(familyId)), enforces both rolling TTL and hard absoluteExpiresAt bounds, claims rotation via an atomic conditional UPDATE ... WHERE revoked_at IS NULL AND replaced_by_id IS NULL RETURNING id, inserts the successor hash, and signs a fresh access JWT. Runtime-verified in tests/unit/ftx-auth-001.test.ts and tests/e2e/auth-recovery.spec.ts.',
    },
    {
      kind: 'code',
      title: 'Sample 2a — Verbatim Domain-Separated OTP HMAC & Timing-Safe Compare',
      filePath: 'src/auth/recovery.ts (lines 108–121 — computeOtpHmac & timingSafeHexEqual)',
      language: 'typescript',
      code: sample2aCode,
    },
    {
      kind: 'code',
      title: 'Sample 2b — Verbatim OTP Verification, Anti-Enumeration & Single-Use Consumption',
      filePath: 'src/auth/recovery.ts (lines 600–791 — verifyPasswordRecoveryOtp)',
      language: 'typescript',
      code: sample2bCode,
    },
    {
      kind: 'p',
      text: 'Walkthrough & Security Analysis (src/auth/recovery.ts:108–121, 600–791): computeOtpHmac binds challengeId, purpose, and trimmed 6-digit OTP under getOtpHmacSecret(). verifyPasswordRecoveryOtp({ challengeId, otp, ip }) enforces multi-dimensional OTP rate limiting, executes constant-work dummy HMAC comparison when isSyntheticChallengeId(params.challengeId) is true (preventing account/phone enumeration), serializes per-challenge access via withChallengeLock, increments failedAttempts with automatic invalidation at maxAttempts (5), and executes a 5-clause conditional UPDATE setting consumedAt = now before issuing a 10-minute single-use RESET_AUTHORIZATION token. Runtime-verified in tests/unit/ftx-auth-001.test.ts.',
    },
    {
      kind: 'code',
      title: 'Sample 3 — Verbatim Token-Bucket Rate Limiter (Local Fallback + 3-ARGV Redis Lua Script)',
      filePath: 'src/rate-limit/redis.ts (lines 91–205 — checkRateLimit)',
      language: 'typescript',
      code: sample3Code,
    },
    {
      kind: 'p',
      text: 'Walkthrough & Security Analysis (src/rate-limit/redis.ts:91–205): checkRateLimit(projectId, routeId, identifier) loads route rateLimitRpm and explicitly handles two runtime modes: when external Redis is unavailable or !isRealRedisActive (sandbox/Vitest mode, lines 145–147), it enforces per-process rate limits via evaluateLocalBucket() (unless fail-closed policy blocks on broken Redis); when external Redis 7 is connected (SOURCE-CONFIRMED, lines 149–191), it executes the 3-ARGV Lua script atomically via redis.eval(script, 1, key, limit, refillRate, Date.now()) with PEXPIRE key 60000.',
    },
    {
      kind: 'code',
      title: 'Sample 4a — Verbatim Upstream Proxy Credential Sanitization & Socket Timeout',
      filePath: 'src/gateway/index.ts (lines 147–162 — createSharedGatewayProxy on.proxyReq)',
      language: 'typescript',
      code: sample4aCode,
    },
    {
      kind: 'code',
      title: 'Sample 4b — Verbatim Pre-Auth Static SSRF Check & Hashed API-Key Validation',
      filePath: 'src/gateway/index.ts (lines 336–417 — setupGateway pre-auth guard)',
      language: 'typescript',
      code: sample4bCode,
    },
    {
      kind: 'code',
      title: 'Sample 4c — Verbatim 13-Pattern Regex Threat Detection & Rate-Limit Gate',
      filePath: 'src/gateway/index.ts (lines 498–565 — detectThreats & checkRateLimit)',
      language: 'typescript',
      code: sample4cCode,
    },
    {
      kind: 'p',
      text: 'Walkthrough & Security Analysis (src/gateway/index.ts:147–162, 336–417, 498–565): The gateway strictly validates isSafeTarget(route.targetUrl) and scoped fx_{env}_{keyId}_{secret} credentials (via 30s apiKeyCache + bcrypt.compare) BEFORE inspecting threats (detectThreats(req) returning matched signature names), enforcing checkRateLimit(), or applying RUNNING experiment faults. On external proxy dispatch, proxyReq.removeHeader strips x-api-key, x-fortix-token, and Bearer fx_* headers so gateway secrets never leak upstream. Runtime-verified in tests/security/auth.spec.ts and tests/security/all.spec.ts.',
    },
    {
      kind: 'code',
      title: 'Sample 5 — Verbatim Telemetry Flush Barrier & Three-Phase SLA Verification Engine',
      filePath: 'src/verification/engine.ts (lines 66–245 — verifyPolicy)',
      language: 'typescript',
      code: sample5Code,
    },
    {
      kind: 'p',
      text: 'Walkthrough & Security Analysis (src/verification/engine.ts:66–245): verifyPolicy(experimentId, policyId, startTime, endTime, options?) prevents duplicate concurrent evaluations via activeVerificationLocks, awaits flushTelemetryBarrier({ timeoutMs: 3000, since: overallStart }), queries persisted metricLogs within padded window bounds, partitions BASELINE, INJECTION, and RECOVERY cohorts via filterRowsForPhase and computePhaseMetrics, delegates deterministic threshold/coverage evaluation (>=80% coverage gate preventing vacuous PASS) to evaluateExperimentVerification, and inserts the resulting row into verifications. Runtime-verified in tests/unit/verification-defects.test.ts.',
    },
    {
      kind: 'code',
      title: 'Sample 6a — Verbatim API Studio Project-Scoped Tenant Ownership Check',
      filePath: 'src/studio/target-handler.ts (lines 180–210 — handleStudioUpstreamRequest)',
      language: 'typescript',
      code: sample6aCode,
    },
    {
      kind: 'code',
      title: 'Sample 6b — Verbatim API Studio Collection Filtering (category, status, q) & POST Validation',
      filePath: 'src/studio/target-handler.ts (lines 301–391 — GET/POST collection handler)',
      language: 'typescript',
      code: sample6bCode,
    },
    {
      kind: 'p',
      text: 'Walkthrough & Security Analysis (src/studio/target-handler.ts:180–210, 301–391): handleStudioUpstreamRequest(req, res, ctx) binds studioApis.projectId === ctx.route.projectId (returning 502 STUDIO_TARGET_NOT_FOUND on cross-tenant mismatch), enforces pagination bounds (limit 1–100, offset 0–10000), filters GET collections by category, status, and q/search substring matching, and validates POST JSON bodies via readJsonBodySafe() and validateStudioRecordPayload() (checking validation.ok). Runtime-verified in tests/unit/api-studio.test.ts and tests/e2e/api-studio.spec.ts.',
    },
    {
      kind: 'code',
      title: 'Sample 7 — Verbatim Allowlisted Video Provider & Origin Validator (FTX-LEARN-001)',
      filePath: 'src/learning/video-validator.ts (lines 107–199 — validateVideoSource)',
      language: 'typescript',
      code: sample7Code,
    },
    {
      kind: 'p',
      text: 'Walkthrough & Security Analysis (src/learning/video-validator.ts:107–199): validateVideoSource(providerInput, referenceInput, env) rejects raw HTML/iframe/script schemes, enforces SELF_HOSTED_VIDEO_RE (/^\\/learning\\/videos\\/[a-z0-9][a-z0-9._-]{1,120}\\.(webm|mp4)$/i) without path traversal for self_hosted assets, requires an exact 11-character ID (YOUTUBE_VIDEO_ID_RE) for youtube_nocookie (subsequently formatted into a safe embed URL by resolveSafeVideoPlayback()), and checks private-host SSRF rules plus LEARNING_ALLOWED_VIDEO_ORIGINS for https_allowlist URLs. Runtime-verified in tests/unit/learning-center.test.ts.',
    },
  ];

  // Sub 4.2.1 Security Audit refinements
  const sub421 = sec42.subsections![0];
  sub421.blocks = [
    {
      kind: 'bullets',
      items: [
        '1. Authentication: Dual-identifier login (email or verified E.164 phone) with dummy bcrypt comparison on unknown users to mitigate timing enumeration.',
        '2. Authorization & RBAC: Role hierarchy (ADMIN, DEVELOPER, VIEWER) enforced server-side via src/middleware/entitlements.ts, src/api/admin.ts, and project BOLA guards (src/middleware/project.ts).',
        '3. Password Handling: Hashed exclusively with bcryptjs (cost factor 10); never stored in localStorage, sessionStorage, cookies, or logs.',
        '4. API-Key Protection: Raw fx_live_<id>_<secret> shown once; DB stores bcrypt secret_hash; gateway caches SHA-256 digest (30s TTL, max 5,000) with fortix:api-key:revoked:v1 invalidation.',
        '5. Session Management: Short-lived access JWT in HttpOnly cookie + rotating refresh token families (12h standard / 30d Remember Me via SESSION_SHORT_TTL_HOURS and SESSION_REMEMBER_TTL_DAYS) with reuse detection.',
        '6. Input Validation: Strict Zod schemas on every REST route, Studio dynamic field validation (64 KB body cap), and allowlisted tutorial media validation.',
        '7. Rate Limiting: Express auth/OTP rate limiters on /api/auth/* and Redis Lua token-bucket script (with bounded local fallback in sandbox mode) on /proxy/:routeId/*.',
        '8. SQL Injection & Payload Filtering: 100% parameterized queries via Drizzle ORM plus a lightweight 13-pattern regex request inspector (src/threat-detection/index.ts) covering 2-pass URL-decoded query/path, JSON depth <= 4, and 3 headers.',
        '9. SSRF Protection: Blocks private RFC 1918, loopback, link-local/cloud metadata (169.254.169.254), and DNS-rebinding resolutions (src/gateway/ssrf.ts).',
        '10. CORS & CSRF: Origin allowlist (ALLOWED_ORIGINS) with credentials support and double-submit CSRF validation (fortix_csrf cookie matched against X-CSRF-Token header).',
        '11. Multi-Tenant Isolation: Primary runtime enforcement via Express project ownership middleware (RUNTIME-VERIFIED), backed by source-confirmed PostgreSQL 15 RLS DDL on 17 tables (requires persistent PostgreSQL 15 + withTenantContext(); skipped in pg-mem).',
        '12. Secret Management: Fail-fast startup checks in production requiring cryptographic JWT_SECRET, OTP_HMAC_SECRET, DATABASE_URL, and REDIS_URL.',
        '13. Logging & Redaction: Pino logger configured with explicit redact paths stripping authorization headers, cookies, password fields, OTPs, and raw keys.',
        '14. Experiment Authorization & Blast Radius: Experiments execute only against routes owned by the caller project, strictly post-authentication, with worker duration clamp (500–10,000 ms) and guaranteed try/finally cleanup.',
        '15. Artifact Checksums vs. Storage Stubs: LocalStorageProvider verifies SHA-256 sidecar checksums on PDF reads; S3StorageProvider is currently a local-delegating stub without AWS SDK calls, and PDFs are checksummed rather than digitally signed.',
        '16. Error Handling & Known Security Boundaries: Central error middleware suppresses stack traces in production; WebAuthn/FIDO2 MFA, full OWASP CRS WAF anomaly scoring, asymmetric PKCS#7 PDF signing, and live external SMTP/SMS carrier credentials remain outside current sandbox scope.',
      ],
    },
  ];

  // Section 4.3 Commands & Table 4.2 Env Vars
  const sec43 = ch4.sections[2];
  sec43.blocks = [
    {
      kind: 'p',
      text: 'FortiX defines two execution topologies in package.json and docker-compose.yml: (A) Standalone Sandbox / Development Mode (RUNTIME-VERIFIED in this audit on Node.js v22.23.3 using automatic pg-mem SQL migration bootstrap and in-memory Redis/queue fallbacks) and (B) Multi-Container Docker Compose Mode (SOURCE-CONFIRMED in Dockerfile and docker-compose.yml, requiring an external Docker Engine + PostgreSQL 15 + Redis 7 host; NOT executed inside the sandbox container).',
    },
    {
      kind: 'code',
      title: 'Sandbox-Verified Commands vs. Source-Confirmed Docker Production Commands',
      filePath: 'package.json / docker-compose.yml / docs/reports/evidence-logs/',
      language: 'bash',
      code: `# === PART A: RUNTIME-VERIFIED IN AUDIT SANDBOX (Commit a97c14fb53d0bd3c915016cfdfafe4524c288517) ===
npm run lint                        # tsc --noEmit -> EXIT_CODE=0 (02-typecheck-and-build.log)
npm run build                       # Vite v6.4.3 SPA + dist/server.cjs + dist/worker.cjs -> EXIT_CODE=0
npx vitest run                      # 35/35 suites, 269/269 tests passed in 122.23s (03-vitest.log)
npx playwright test --reporter=list # 13/13 E2E & security tests passed in 48.2s (04-playwright.log)
curl -s http://127.0.0.1:3000/api/health/live
curl -s http://127.0.0.1:3000/api/health/ready

# === PART B: SOURCE-CONFIRMED MULTI-CONTAINER DEPLOYMENT (NOT EXECUTED IN SANDBOX; REQUIRES DOCKER) ===
cp .env.example .env                # Populate JWT_SECRET, OTP_HMAC_SECRET, DATABASE_URL, REDIS_URL
docker compose up --build -d        # Starts postgres:15-alpine, redis:7-alpine, api, and worker
curl -s http://localhost:8080/api/health/ready`,
    },
    {
      kind: 'table',
      tableNumber: '4.2',
      caption: 'Verified Environment Configuration Variables Reference (.env.example & src/* — Variable Names Only)',
      colWidths: [32, 16, 52],
      headers: ['Exact Variable Name', 'Requirement', 'Verified Operational Purpose in Codebase'],
      rows: [
        ['PORT / NODE_ENV', 'Required', 'HTTP listener port (3000 in dev) and runtime mode (development | test | production).'],
        ['DATABASE_URL / STRICT_PERSISTENT_DB', 'Prod Required', 'PostgreSQL 15 URI and strict persistence gate; uses migrated pg-mem sandbox in dev/test when omitted.'],
        ['ENABLE_POSTGRES_RLS', 'Optional (true)', 'Enables set_config(app.current_user_id) inside withTenantContext() when connected to persistent PostgreSQL 15.'],
        ['REDIS_URL / REDIS_FAILURE_BEHAVIOR', 'Prod Required', 'Redis 7 connection URI and fail-closed vs fail-open rate-limit behavior (src/rate-limit/redis.ts).'],
        ['JWT_SECRET / OTP_HMAC_SECRET', 'Prod Required', 'Cryptographic secrets signing access JWTs and domain-separated 6-digit recovery/phone OTP HMACs.'],
        ['SESSION_REMEMBER_TTL_DAYS / SESSION_SHORT_TTL_HOURS', 'Optional (30 / 12)', 'Configures persistent Remember-Me refresh family lifetime (days) vs standard session lifetime (hours) in src/auth/sessions.ts.'],
        ['AUTH_MAIL_WEBHOOK_URL / AUTH_SMS_WEBHOOK_URL', 'Prod Optional', 'External HTTPS webhook endpoints for transactional Email and E.164 SMS OTP delivery (src/auth/providers.ts).'],
        ['ALLOWED_ORIGINS', 'Prod Required', 'Comma-separated allowlist of origins permitted to send credentialed cross-origin requests (src/lib/cors-csrf.ts).'],
        ['FORTIX_STORAGE_PROVIDER', 'Optional (local)', 'Selects artifact storage adapter (local verified; s3 currently delegates locally as a stub in src/storage/s3-storage.ts).'],
        ['LEARNING_ALLOWED_VIDEO_ORIGINS', 'Optional', 'Comma-separated HTTPS origins permitted for https_allowlist tutorial videos (src/learning/video-validator.ts).'],
      ],
    },
  ];

  // Sub 4.3.1 Walkthrough step 5 & 7 terminology alignment
  sec43.subsections![0].blocks = [
    {
      kind: 'numbered',
      items: [
        'Authenticate (/login): Register an operator account or sign in with Remember Me enabled; observe HttpOnly session cookie establishment without any credentials stored in localStorage.',
        'Follow Guided Onboarding (/learning-center): Open the In-App Video Learning Center (/api/learning/tutorials) to watch self-hosted WebM walkthroughs with WebVTT captions and step checklists.',
        'Provision Self-Contained API (/studio): Open FortiX API Studio, select the "Store Products API (100 INR Records)" template, set rateLimitRpm = 30, enableWaf = true, enableSsrf = true, and copy the one-time scoped fx_live_* API key.',
        'PROTECT — Verify Live Enforcement: Send GET /proxy/:routeId/api/store/products with X-API-Key -> inspect HTTP 200 JSON (100 seeded products). Omit X-API-Key -> observe HTTP 401. Append ?q=\' OR 1=1-- -> observe HTTP 403 regex filter block recorded in /threats.',
        'BREAK — Execute Controlled Experiment (/experiments): Launch a bounded latency (latencyMs = 200, durationMs = 2000) or traffic_burst experiment on the Store Products route.',
        'OBSERVE — Inspect Three-Phase Telemetry (/ & /topology): Watch real-time Socket.IO updates as the runner records 5 clean BASELINE probes, active INJECTION probes, and 5 post-fault RECOVERY probes.',
        'PROVE — Audit Verdict & Export SHA-256 Checksummed PDF (/verifications): Inspect the deterministic PASS/FAIL/INCONCLUSIVE verdict and download the server-side PDFKit report carrying header X-FortiX-Artifact-SHA256.',
        'IMPROVE — Harden Policy (/security & /resilience): Adjust RPM quotas or upstream timeout thresholds based on observed P95/429 evidence and re-run verification to confirm posture improvement.',
      ],
    },
  ];

  // ==================== CHAPTER 5 REVISIONS ====================
  const ch5 = chPart3[1];
  ch5.sections[0].blocks = [
    {
      kind: 'p',
      text: 'FortiX demonstrates that API security and service resilience become verifiable when gateway enforcement, bounded fault injection, synchronized telemetry, and deterministic SLA evaluation operate as a single closed-loop system. Across this revision, every engineering claim is strictly bounded to its verified source and runtime scope.',
    },
    {
      kind: 'table',
      tableNumber: '5.1',
      caption: 'Summary of Completed Engineering Objectives and Three-Tier Verification Outcomes',
      colWidths: [25, 25, 50],
      headers: ['Project Objective', 'Verified Status & Scope', 'Empirical Repository & Runtime Evidence'],
      rows: [
        [
          'Hardened Auth, Remember-Me & OTP Recovery (FTX-AUTH-001)',
          'SOURCE-CONFIRMED + RUNTIME-VERIFIED (Sandbox; External Carrier Blocked)',
          'HttpOnly session + rotating refresh families, reuse detection, 6-digit HMAC OTP recovery, verified phone SMS gate; passed ftx-auth-001.test.ts & auth-recovery.spec.ts (6.4s Chromium E2E).',
        ],
        [
          'Multi-Layered Reverse-Proxy Protection',
          'SOURCE-CONFIRMED + RUNTIME-VERIFIED (Sandbox Local Bucket; External Redis 7 Blocked)',
          'Pre-auth ordering, SHA-256 key cache, 13-pattern SQLi/XSS/traversal regex filter, SSRF/DNS-rebind guard, and token-bucket rate limiting (Lua script source-confirmed; local bucket runtime-verified).',
        ],
        [
          'Zero-Friction API Studio (100-Product Seed)',
          'SOURCE-CONFIRMED + RUNTIME-VERIFIED (Sandbox)',
          'Instant 100-record Store Products CRUD API, category/status/q filtering, schema validation, gateway binding, and OpenAPI 3.0.3 export verified in api-studio.spec.ts (4.7s E2E).',
        ],
        [
          'Deterministic Three-Phase Verification Engine',
          'SOURCE-CONFIRMED + RUNTIME-VERIFIED (Sandbox)',
          'flushTelemetryBarrier() synchronization, BASELINE/INJECTION/RECOVERY partitioning, >=80% sample sufficiency gate (INCONCLUSIVE on starvation), verified in verification-defects.test.ts & golden-demo.spec.ts.',
        ],
        [
          'Checksummed PDF Reporting & Video Learning Center',
          'LOCAL STORAGE & LEARNING CENTER VERIFIED (Cloud S3 Stub Only)',
          'PDFKit reports with X-FortiX-Artifact-SHA256 on LocalStorageProvider, t=<ts>,v1=<hex> HMAC webhooks, and FTX-LEARN-001 (/api/learning/*) verified in learning-center.spec.ts (23.8s E2E).',
        ],
      ],
    },
  ];

  ch5.sections[1].blocks = [
    {
      kind: 'p',
      text: 'The following capabilities are explicitly classified as planned future work (or incomplete stubs in the current codebase) and are NOT claimed as completed production features:',
    },
    {
      kind: 'bullets',
      items: [
        'Native AWS S3 & Google Cloud Storage Artifact SDKs: Replacing the local-delegating stub in src/storage/s3-storage.ts with real @aws-sdk/client-s3 PutObjectCommand/GetObjectCommand calls, S3 Object Lock (WORM), and a concrete GCS provider.',
        'Cryptographic Digital Signatures & Trusted Timestamps on PDFs: Extending SHA-256 content checksums (X-FortiX-Artifact-SHA256) with X.509/PKCS#7 detached digital signatures and RFC 3161 timestamping.',
        'Full OWASP ModSecurity Core Rule Set (CRS) WAF Engine: Expanding the current 13-pattern regex filter (src/threat-detection/index.ts) into anomaly-scored multipart/XML/GraphQL request inspection.',
        'Strict Always-On PostgreSQL RLS Enforcement: Requiring mandatory withTenantContext() binding across all queries and validating fortix_app NOBYPASSRLS isolation in automated PostgreSQL 15 CI containers.',
        'Hardware-Backed Multi-Factor Authentication (WebAuthn / Passkeys): Extending FTX-AUTH-001 with FIDO2 passkey challenges for privileged ADMIN and DEVELOPER accounts.',
        'Distributed W3C OpenTelemetry Tracing & mTLS Upstreams: Propagating traceparent headers across multi-hop microservices and authenticating gateway-to-upstream hops via per-project client certificates.',
        'Kubernetes Operator & Multi-Container CI Gate: Executing docker-compose.yml (postgres:15-alpine + redis:7-alpine + api + worker) and Kubernetes CRD regression suites in external CI pipelines.',
      ],
    },
  ];

  // ==================== CHAPTER 6 REVISIONS (SPLIT EXTERNAL VS REPO ARTIFACTS) ====================
  const ch6 = chPart3[2];
  ch6.sections = [
    {
      number: '6.1',
      title: 'Peer-Reviewed Research Papers, Textbooks, IETF RFCs, OWASP Standards & Framework Specifications (IEEE Format)',
      blocks: ch6.sections[0].blocks,
    },
    {
      number: '6.2',
      title: 'Submitted FortiX Repository Implementation & Forensic Verification Artifacts',
      blocks: [
        {
          kind: 'numbered',
          items: [
            'FortiX Source Repository, Branch main, Commit a97c14fb53d0bd3c915016cfdfafe4524c288517, https://github.com/mr-vdnt/FortiX (Verified read-only source tree: server.ts, src/*, drizzle/0000..0007*.sql, drizzle/postgres_rls_policies.sql, Dockerfile, docker-compose.yml).',
            'FortiX Report Authenticity Audit & Correction Artifacts (FORTIX-REPORT-AUTH-001): docs/reports/REPORT_AUTHENTICITY_AUDIT.md, docs/reports/FEATURE_VERIFICATION_MATRIX.csv, docs/reports/FEATURE_VERIFICATION_MATRIX.xlsx, and docs/reports/FORTIX_REPORT_CORRECTION_LOG.md.',
            'FortiX Empirical Test Execution Logs (Nov. 04, 2026 UTC): docs/reports/TEST_EVIDENCE.md and raw logs docs/reports/evidence-logs/01-env-and-git.log, 02-typecheck-and-build.log, 03-vitest.log (35/35 suites, 269/269 tests), and 04-playwright.log (13/13 E2E specs).',
            'FortiX UI Screenshot Provenance & Final Capture Specification: docs/reports/SCREENSHOT_REQUIREMENTS.md and live sandbox captures docs/reports/screenshots/scr01_login.png through scr15_settings_account.png.',
          ],
        },
      ],
    },
  ];

  // ==================== APPENDICES A, C, D, F REVISIONS ====================
  const appA = chPart3[3];
  appA.sections[0].blocks = [
    {
      kind: 'table',
      tableNumber: 'A.1',
      caption: 'Master FortiX HTTP API Specification (Verified Against src/api/index.ts, src/api/*, and src/gateway/index.ts)',
      colWidths: [11, 31, 17, 41],
      headers: ['Method', 'Exact Endpoint Path', 'Auth / Guard', 'Verified Contract, Status Codes & Behavior'],
      rows: [
        ['POST', '/api/auth/register', 'Public (Rate Limited)', 'Body: {email, password, name?, phone?}. Creates user + default Org/Project; returns 201 + HttpOnly cookies; 409 on duplicate.'],
        ['POST', '/api/auth/login', 'Public (Rate Limited)', 'Body: {identifier, password, rememberMe?}. Verifies email or verified E.164 phone; sets fortix_session, fortix_refresh & fortix_csrf cookies.'],
        ['POST', '/api/auth/refresh & /logout', 'Cookie fortix_refresh', '/refresh rotates token within family_id (401 + family revoke on replay); /logout revokes JWT jti + refresh family and clears cookies.'],
        ['POST', '/api/auth/forgot-password', 'Public (Rate Limited)', 'Body: {identifier}. Generates 6-digit HMAC-SHA256 OTP (10m TTL, 60s resend cooldown); returns anti-enumeration 200 + challengeId.'],
        ['POST', '/api/auth/verify-reset-otp & /resend-reset-otp', 'Public (Rate Limited)', 'Verifies 6-digit OTP (<=5 attempts, atomic single-use consume) and issues 10m single-use resetAuthorization token.'],
        ['POST', '/api/auth/reset-password', 'Single-Use Token', 'Body: {resetAuthorization, newPassword, confirmPassword}. Updates bcrypt hash and revokes all refresh families, action tokens & sockets.'],
        ['GET / DELETE / POST', '/api/auth/sessions, /:familyId, /revoke-others', 'JWT + CSRF', 'Lists active refresh session families (listActiveUserSessions) or revokes a specific familyId / all other sessions.'],
        ['POST', '/api/auth/phone/request-verify & /confirm-verify', 'JWT + CSRF', 'Enrolls and verifies unique E.164 phone numbers via 6-digit SMS OTP challenge before enabling SMS password recovery.'],
        ['GET / POST / DELETE', '/api/control/account/me, /password, /', 'JWT + CSRF', 'Returns user profile + RBAC entitlements (/me), rotates password (/password), or deletes account + revokes keys with literal "DELETE" (/).'],
        ['GET / POST', '/api/control/projects & /settings', 'JWT + Project BOLA', 'Lists/creates tenant workspaces and manages version-locked project_settings with audit_logs diffs.'],
        ['GET / POST / DELETE', '/api/control/routes & /keys', 'JWT + Project BOLA', 'Registers SSRF-checked gateway routes and mints/revokes scoped fx_live_* API keys with fortix:api-key:revoked:v1 invalidation.'],
        ['GET / POST / PUT', '/api/control/policies', 'JWT + Project BOLA', 'Configures per-route rateLimitRpm, enableWaf, and enableSsrf toggles.'],
        ['GET', '/api/control/metrics, /events, /topology', 'JWT + Project BOLA', 'Returns time-series telemetry, blocked SQLi/XSS/traversal/SSRF events, and live route/upstream topology graph.'],
        ['GET / POST', '/api/control/studio/apis & /:id/openapi', 'JWT + Project BOLA', 'Provisions API Studio APIs (including 100-record Store Products seed) and exports OpenAPI 3.0.3 JSON specs.'],
        ['GET / POST', '/api/control/experiments & /:id/cancel', 'JWT + DEVELOPER+', 'Queues latency, error_5xx, timeout, or traffic_burst runs (worker-clamped <=10s) and supports mid-run cancellation.'],
        ['GET / POST', '/api/control/verifications & /reports/:id', 'JWT + Project BOLA', 'Returns PASS/FAIL/INCONCLUSIVE verdicts and generates/downloads local PDFKit reports with X-FortiX-Artifact-SHA256.'],
        ['GET / PUT / POST', '/api/learning/tutorials, /:slug, /progress/:tutorialId', 'JWT (ADMIN for /admin/*)', 'Mounted at /api/learning (src/api/index.ts:158): serves tutorials/categories, upserts watch progress (/complete), and ADMIN authoring.'],
        ['GET / POST', '/api/control/admin/* & /api/metrics', 'ADMIN / Internal', 'Platform user-role governance, Dead-Letter Queue inspection/replay, and Prometheus metrics exposition.'],
        ['ALL', '/proxy/:routeId/*', 'X-API-Key (Gateway)', 'Enforces pre-auth SSRF, HashedApiKeyCache auth (401), 13-regex filter (403), rate limit (429), post-auth faults, and Upstream/Studio dispatch.'],
        ['GET', '/api/health/live & /api/health/ready', 'Public Health Probes', 'Reports process liveness and deploymentMode / persistenceVerified / postgresStorageMode / redisStorageMode readiness.'],
      ],
    },
  ];

  const appC = chPart3[5];
  appC.sections[0].blocks = [
    {
      kind: 'p',
      text: 'All validation results below were re-executed on commit a97c14fb53d0bd3c915016cfdfafe4524c288517 on November 04, 2026 (14:34–14:44 UTC) and saved verbatim in docs/reports/evidence-logs/01..04.log. Table C.1 strictly separates checks executed in the Node.js 22 + Chromium sandbox from checks blocked by absent external infrastructure.',
    },
    {
      kind: 'table',
      tableNumber: 'C.1',
      caption: 'Forensic Validation Ledger — Executed & Passed (Sandbox), Failed (0), Statically Audited, and Blocked by Infrastructure',
      colWidths: [20, 23, 22, 35],
      headers: ['Validation Tier', 'Command / Artifact', 'Observed Result', 'Environment & Evidence Scope'],
      rows: [
        ['1. Health & Readiness', 'curl /api/health/live & /ready', 'EXECUTED & PASSED (HTTP 200)', 'Reports ephemeral-sandbox mode (pg-mem + in-memory Redis); logged in 01-env-and-git.log.'],
        ['2. TypeScript Typecheck', 'npm run lint (tsc --noEmit)', 'EXECUTED & PASSED (0 Errors)', 'Full backend, gateway, Studio, Learning Center & React 19 TSX static check; 02-typecheck-and-build.log.'],
        ['3. Production Bundle', 'npm run build', 'EXECUTED & PASSED (EXIT 0)', 'Vite v6.4.3 SPA (2753 modules) + dist/server.cjs (840.2 KB) + dist/worker.cjs (169.1 KB); 02-typecheck-and-build.log.'],
        ['4. Vitest Unit/Integration', 'npx vitest run', 'EXECUTED & PASSED (35/35 Suites, 269/269 Tests, 122.2s)', 'Executed on migrated pg-mem + ioredis-mock + LocalStorageProvider; logged in 03-vitest.log.'],
        ['5. Playwright E2E/Security', 'npx playwright test --reporter=list', 'EXECUTED & PASSED (13/13 Tests, 8 Specs, 48.2s)', 'Executed with Headless Chromium v1243 against live sandbox server; logged in 04-playwright.log.'],
        ['6. Executed Failures', 'All above commands', '0 FAILURES', 'Zero failing unit, integration, typecheck, build, or Playwright tests after Chromium v1243 installation.'],
        ['7. Postgres 15 RLS DDL', 'tests/unit/postgres-rls.test.ts', 'STATICALLY AUDITED / LIVE DB BLOCKED', '17-table RLS SQL verified structurally; live fortix_app NOBYPASSRLS enforcement blocked (no postgres daemon in sandbox).'],
        ['8. Docker Compose Stack', 'docker compose up --build -d', 'BLOCKED BY INFRASTRUCTURE', 'Dockerfile & docker-compose.yml source-confirmed; docker daemon absent in sandbox (01-env-and-git.log).'],
        ['9. Live Redis 7 Lua/BullMQ', 'External REDIS_URL runtime', 'BLOCKED BY INFRASTRUCTURE', 'Lua script, Streams & BullMQ queues source-confirmed; redis-server absent (sandbox uses local fallbacks).'],
        ['10. Cloud S3 & Live Carrier', 'S3 SDK / SMTP / SMS gateways', 'STUB (S3) / BLOCKED (Carrier)', 'S3StorageProvider delegates locally without AWS SDK; webhook HTTP mock tested locally, paid carrier not run.'],
      ],
    },
  ];

  const appD = chPart3[6];
  appD.sections[0].blocks[0] = {
    kind: 'code',
    title: 'FortiX Repository Structure (Verified Commit a97c14fb53d0bd3c915016cfdfafe4524c288517)',
    filePath: '/',
    language: 'text',
    code: `FortiX/
├── server.ts                       # Express + HTTP Proxy + Socket.IO + Vite dev/prod entrypoint
├── package.json / README.md        # Build/test scripts (Note: retains legacy name "react-example" & pre-refactor README notes)
├── Dockerfile / docker-compose.yml # Source-confirmed multi-stage non-root Alpine image & 4-service Compose stack
├── drizzle/                        # 8 SQL migrations (0000..0007) & postgres_rls_policies.sql (17-table RLS DDL)
├── public/learning/                # Self-hosted FTX-LEARN-001 .webm tutorial videos & .vtt caption tracks
├── src/
│   ├── api/                        # Express routers (/api/auth, /api/learning, /api/control/*, /api/health/*, /api/metrics)
│   ├── auth/                       # FTX-AUTH-001 session rotation (sessions.ts), HMAC OTP (recovery.ts), providers.ts
│   ├── db/                         # 23-table Drizzle schema (schema.ts), migrate.ts, rls.ts & Postgres/pg-mem connector
│   ├── gateway/                    # /proxy/:routeId/* pipeline (index.ts), HashedApiKeyCache & ssrf.ts
│   ├── threat-detection/ & lib/    # 13-pattern regex filter, cors-csrf, jwt-security, key-invalidation, telemetry, webhooks
│   ├── middleware/                 # auth.ts, entitlements.ts (RBAC), project.ts (primary BOLA tenant guard)
│   ├── rate-limit/                 # 3-ARGV Redis Lua token-bucket script + evaluateLocalBucket fallback (redis.ts)
│   ├── studio/                     # 100-Product INR dataset, schema-validator, target-handler & openapi-generator
│   ├── learning/                   # FTX-LEARN-001 catalog-seed.ts, video-validator.ts & types.ts
│   ├── experiments/ & verification/# 3-phase probe worker (<=10s clamp) & flush-synchronized SLA verification engine
│   ├── storage/                    # LocalStorageProvider (SHA-256 sidecars) + S3StorageProvider (local-delegating stub)
│   ├── components/ & pages/        # React 19 UI (Login, PasswordRecovery, Dashboard, ApiStudio, LearningCenter, TutorialDetail, etc.)
├── scripts/report/                 # Asset capture, audit matrix generator, verbatim PDFKit & OpenXML DOCX builders
├── tests/                          # 35 Vitest suites (269 tests) + 8 Playwright spec files (13 tests)
└── docs/reports/                   # Original & Revised Reports, Audit, Matrix (.csv/.xlsx), Correction Log & Evidence Logs`,
  };

  const appF = chPart3[8];
  appF.sections[0].blocks = [
    {
      kind: 'table',
      tableNumber: 'F.1',
      caption: 'Documented Technical & Operational Limitations of the Audited FortiX Implementation',
      colWidths: [26, 74],
      headers: ['Limitation Area', 'Verified Boundary & Operational Implication'],
      rows: [
        ['1. S3 / Cloud Storage Stub', 'src/storage/s3-storage.ts does not install @aws-sdk/client-s3 and delegates put/get/list/delete to LocalStorageProvider; "gcs" is only a TypeScript union literal. Cloud object persistence is future work.'],
        ['2. PDF Checksum vs. Signature', 'Generated PDF reports include a SHA-256 content digest (X-FortiX-Artifact-SHA256) and local .meta.json verification, but do NOT implement PKCS#7/X.509 digital signatures, RFC 3161 timestamps, or WORM immutability.'],
        ['3. 13-Pattern Regex Filter Scope', 'src/threat-detection/index.ts evaluates 13 SQLi, XSS, and path-traversal regex patterns across 2-pass URL decoding, JSON bodies (depth <= 4), and 3 headers; it is not an enterprise ModSecurity / OWASP CRS WAF.'],
        ['4. PostgreSQL RLS Runtime Scope', 'drizzle/postgres_rls_policies.sql defines RLS across 17 tables, but pg-mem skips set_config in sandbox mode, and policies include COALESCE(current_setting(\'app.current_user_id\', true), \'\') = \'\' when withTenantContext() is not called.'],
        ['5. Sandbox vs. External Infra', 'Docker Compose, live PostgreSQL 15, and live Redis 7 (Lua EVAL, XREADGROUP Streams, multi-process BullMQ) were not executed inside the container sandbox due to absent docker/postgres/redis daemons.'],
        ['6. Worker Fault Duration Clamp', 'While the REST Zod schema accepts durationMs up to 300,000 ms, src/experiments/worker.ts line 282 clamps active fault injection execution to 500–10,000 ms for safety.'],
        ['7. External Email / SMS Gateways', 'src/auth/providers.ts implements HTTPS webhook dispatchers (AUTH_MAIL_WEBHOOK_URL, AUTH_SMS_WEBHOOK_URL) with dev outbox fallback; real inbox/SMS delivery requires external provider credentials.'],
        ['8. Studio Query Filter Scope', 'FortiX API Studio GET collection endpoints filter by category, status, and q/search (with limit 1–100 and offset 0–10000), without numeric range query operators (such as minPrice/maxPrice).'],
        ['9. Single-Region HTTP/1.1 Scope', 'Gateway proxying targets HTTP/1.1 REST/JSON workloads; gRPC HTTP/2 trailers, GraphQL AST depth limiting, WebAuthn MFA, and multi-region active-active replication are out of scope.'],
        ['10. Root Repository Doc Drift', 'package.json ("react-example" / "0.0.0"), README.md, PROGRESS.md, and RELEASE_BASELINE.md retain earlier milestone descriptions/counts that lag behind the current main implementation.'],
      ],
    },
  ];

  const allChapters = [...chPart1, ...chPart2, ...chPart3];
  const redactHexKey = (s: string) =>
    s.replace(/fx_(live|test)_[0-9a-fA-F]{16,}/g, 'fx_$1_<REDACTED_HEX_TOKEN>');
  const sanitizeBlock = (b: ReportBlock) => {
    if (b.kind === 'p') b.text = redactHexKey(b.text);
    else if (b.kind === 'bullets' || b.kind === 'numbered') b.items = b.items.map(redactHexKey);
    else if (b.kind === 'callout') {
      b.title = redactHexKey(b.title);
      b.text = redactHexKey(b.text);
    } else if (b.kind === 'table') {
      b.rows = b.rows.map((r) => r.map(redactHexKey));
    } else if (b.kind === 'code' && !b.filePath.startsWith('src/') && !b.filePath.startsWith('drizzle/')) {
      b.code = redactHexKey(b.code);
    }
  };
  for (const ch of allChapters) {
    (ch.blocks || []).forEach(sanitizeBlock);
    for (const sec of ch.sections) {
      sec.blocks.forEach(sanitizeBlock);
      for (const sub of sec.subsections || []) {
        sub.blocks.forEach(sanitizeBlock);
      }
    }
  }

  return {
    metadata,
    abbreviations,
    preliminary,
    chapters: allChapters,
  };
}

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  return { width: 1200, height: 750 };
}

function generateMarkdown(docModel: ReportDocumentModel): string {
  const lines: string[] = [];
  const m = docModel.metadata;

  lines.push(`# ${m.projectTitle} — ${m.projectSubtitle} (Revised & Authenticity-Audited Edition)`);
  lines.push(`**Core Principle:** \`${m.corePrinciple}\`  `);
  lines.push(`**Degree Program:** ${m.degreeProgram}  `);
  lines.push(`**Department:** ${m.departmentPlaceholder}, ${m.institutionPlaceholder}  `);
  lines.push(`**Affiliating University:** ${m.universityPlaceholder} (${m.academicYearPlaceholder})  `);
  lines.push(`**Repository & Audited Commit:** ${m.repositoryUrl} (\`${m.activeBranch}\`)`);
  lines.push('\n---\n');

  lines.push('## PRELIMINARY PAGES\n');
  lines.push('### Certificate\n');
  docModel.preliminary.certificateText.forEach((p) => lines.push(`${p}\n`));
  lines.push('### Candidate Declaration\n');
  docModel.preliminary.declarationText.forEach((p) => lines.push(`${p}\n`));
  lines.push('### Acknowledgement\n');
  docModel.preliminary.acknowledgementText.forEach((p) => lines.push(`${p}\n`));
  lines.push('### Abstract\n');
  docModel.preliminary.abstractParagraphs.forEach((p) => lines.push(`${p}\n`));
  lines.push(`**Keywords:** ${docModel.preliminary.keywords.join(', ')}\n`);

  lines.push('### List of Abbreviations\n');
  lines.push('| Abbreviation | Full Term | Operational Context in FortiX |');
  lines.push('|---|---|---|');
  for (const a of docModel.abbreviations) {
    lines.push(`| **${a.abbr}** | ${a.full} | ${a.context} |`);
  }
  lines.push('\n---\n');

  const renderBlockMd = (b: ReportBlock) => {
    if (b.kind === 'p') {
      lines.push(`${b.text}\n`);
    } else if (b.kind === 'bullets') {
      b.items.forEach((item) => lines.push(`- ${item}`));
      lines.push('');
    } else if (b.kind === 'numbered') {
      b.items.forEach((item, idx) => lines.push(`${idx + 1}. ${item}`));
      lines.push('');
    } else if (b.kind === 'callout') {
      lines.push(`> **${b.title}:** ${b.text}\n`);
    } else if (b.kind === 'table') {
      lines.push(`**Table ${b.tableNumber}: ${b.caption}**\n`);
      lines.push(`| ${b.headers.map((h) => h.replace(/\|/g, '\\|')).join(' | ')} |`);
      lines.push(`| ${b.headers.map(() => '---').join(' | ')} |`);
      for (const r of b.rows) {
        lines.push(`| ${r.map((c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
      }
      lines.push('');
    } else if (b.kind === 'figure') {
      const rel = b.imagePath.replace(/^docs\/reports\//, './');
      lines.push(`![Figure ${b.figureNumber}: ${b.caption}](${rel})`);
      lines.push(`*Figure ${b.figureNumber}: ${b.caption}${b.sourceNote ? ` (${b.sourceNote})` : ''}*\n`);
    } else if (b.kind === 'code') {
      lines.push(`**${b.title}** — \`Source: ${b.filePath}\`\n`);
      lines.push(`\`\`\`${b.language}`);
      lines.push(b.code);
      lines.push('```\n');
    }
  };

  for (const ch of docModel.chapters) {
    const headingPrefix = ch.isAppendix ? `${ch.number} — ${ch.title}` : `${ch.number}. ${ch.title}`;
    lines.push(`# ${headingPrefix}\n`);
    (ch.blocks || []).forEach(renderBlockMd);
    for (const sec of ch.sections) {
      lines.push(`## ${sec.number} ${sec.title}\n`);
      sec.blocks.forEach(renderBlockMd);
      for (const sub of sec.subsections || []) {
        lines.push(`### ${sub.number} ${sub.title}\n`);
        sub.blocks.forEach(renderBlockMd);
      }
    }
    lines.push('---\n');
  }

  return lines.join('\n');
}

async function renderPdfPass(
  docModel: ReportDocumentModel,
  knownIndex: LayoutIndex | null,
  outputPath: string | null
): Promise<LayoutIndex> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN_T, bottom: PDFKIT_MARGIN_B, left: MARGIN_L, right: MARGIN_R },
      bufferPages: true,
      autoFirstPage: false,
      font: HAS_TTF ? TTF_PATHS.sans : 'Helvetica',
      info: {
        Title: 'FORTIX — API Security & Resilience Verification Platform (Revised B.Tech IT Project Report)',
        Author: 'FortiX Engineering Team',
        Subject: 'B.Tech Information Technology Final Year Software Project Report (Authenticity-Audited Revision)',
        Keywords: docModel.preliminary.keywords.join(', '),
      },
    });

    if (HAS_TTF) {
      doc.registerFont(FONTS.sans, TTF_PATHS.sans);
      doc.registerFont(FONTS.bold, TTF_PATHS.bold);
      doc.registerFont(FONTS.italic, TTF_PATHS.italic);
      doc.registerFont(FONTS.mono, TTF_PATHS.mono);
      doc.registerFont(FONTS.monoBold, TTF_PATHS.monoBold);
    }

    const outStream = outputPath ? fs.createWriteStream(outputPath) : null;
    if (outStream) {
      doc.pipe(outStream);
    } else {
      doc.on('data', () => {});
    }

    const recordedToc: TocEntry[] = [];
    const recordedFigures: IndexedCaption[] = [];
    const recordedTables: IndexedCaption[] = [];
    const pageHeaders: string[] = [];
    let currentPage = 0;
    let currentHeaderLabel = 'PRELIMINARY PAGES';

    doc.on('pageAdded', () => {
      currentPage += 1;
      pageHeaders[currentPage - 1] = currentHeaderLabel;
      doc.y = MARGIN_T;
    });

    const addNewPage = (headerLabel?: string) => {
      if (headerLabel) currentHeaderLabel = headerLabel;
      doc.addPage();
    };

    const ensureSpace = (neededHeight: number) => {
      if (doc.y + neededHeight > MAX_Y) {
        addNewPage();
      }
    };

    const m = docModel.metadata;

    // ==================== PAGE 1: FORMAL UNIVERSITY TITLE PAGE ====================
    addNewPage('TITLE PAGE');
    doc.save();
    doc.rect(0, 0, PAGE_W, 196).fill(COLORS.navy);
    doc.rect(0, 196, PAGE_W, 5).fill(COLORS.accent);

    doc.fillColor('#F97316').font(FONTS.bold).fontSize(9.6).text(
      'BACHELOR OF TECHNOLOGY IN INFORMATION TECHNOLOGY — REVISED MAJOR PROJECT REPORT',
      MARGIN_L,
      44,
      { width: CONTENT_W, align: 'center' }
    );
    doc.fillColor('#FFFFFF').font(FONTS.bold).fontSize(29).text(
      m.projectTitle,
      MARGIN_L,
      72,
      { width: CONTENT_W, align: 'center' }
    );
    doc.fillColor('#E2E8F0').font(FONTS.bold).fontSize(14.5).text(
      m.projectSubtitle,
      MARGIN_L,
      114,
      { width: CONTENT_W, align: 'center' }
    );
    doc.fillColor('#94A3B8').font(FONTS.monoBold).fontSize(9.5).text(
      `CORE VERIFICATION LIFECYCLE: ${m.corePrinciple}`,
      MARGIN_L,
      152,
      { width: CONTENT_W, align: 'center' }
    );
    doc.restore();

    doc.y = 224;
    doc.fillColor(COLORS.muted).font(FONTS.sans).fontSize(10.3).text(
      'An Authenticity-Audited Software Engineering Project Report Submitted in Partial Fulfillment\nof the Requirements for the Award of the Degree of',
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center', lineGap: 3.5 }
    );
    doc.moveDown(0.6);
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(13.5).text(
      m.degreeProgram,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );

    doc.moveDown(1.2);
    const boxY = doc.y;
    doc.save();
    doc.roundedRect(MARGIN_L + 35, boxY, CONTENT_W - 70, 132, 6).fillAndStroke(COLORS.lightBg, COLORS.border);
    doc.restore();
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(10).text(
      'SUBMITTED BY',
      MARGIN_L + 50,
      boxY + 13,
      { width: CONTENT_W - 100, align: 'center' }
    );
    let sy = boxY + 37;
    for (const st of m.studentsPlaceholder) {
      doc.fillColor(COLORS.body).font(FONTS.bold).fontSize(10.5).text(
        `${st.name}   —   ${st.rollNo}`,
        MARGIN_L + 50,
        sy,
        { width: CONTENT_W - 100, align: 'center' }
      );
      sy += 25;
    }

    doc.y = boxY + 150;
    doc.fillColor(COLORS.muted).font(FONTS.bold).fontSize(9.8).text(
      'UNDER THE SUPERVISION OF',
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.35);
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(11.5).text(
      m.guidePlaceholder,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );

    doc.moveDown(1.3);
    doc.moveTo(MARGIN_L + 90, doc.y).lineTo(PAGE_W - MARGIN_R - 90, doc.y).strokeColor(COLORS.border).lineWidth(1).stroke();
    doc.moveDown(0.85);
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(12).text(
      m.departmentPlaceholder.toUpperCase(),
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.3);
    doc.fillColor(COLORS.slateDark).font(FONTS.bold).fontSize(11.5).text(
      m.institutionPlaceholder,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.25);
    doc.fillColor(COLORS.muted).font(FONTS.sans).fontSize(10.5).text(
      m.universityPlaceholder,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );
    doc.moveDown(0.45);
    doc.fillColor(COLORS.accent).font(FONTS.bold).fontSize(10.2).text(
      `${m.academicYearPlaceholder}  ·  Audited Commit: a97c14f`,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, align: 'center' }
    );

    const renderPrelimHeading = (title: string) => {
      doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(15).text(title, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'left',
      });
      doc.moveDown(0.2);
      doc.moveTo(MARGIN_L, doc.y).lineTo(PAGE_W - MARGIN_R, doc.y).strokeColor(COLORS.accent).lineWidth(1.6).stroke();
      doc.moveDown(0.75);
    };

    // ==================== PAGE 2: CERTIFICATE & CANDIDATE DECLARATION ====================
    addNewPage('PRELIMINARY — CERTIFICATE & DECLARATION');
    recordedToc.push({ level: 1, label: 'Certificate & Candidate Declaration', page: currentPage });
    renderPrelimHeading('CERTIFICATE');
    for (const p of docModel.preliminary.certificateText) {
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.8).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 2.8,
      });
      doc.moveDown(0.55);
    }
    doc.moveDown(0.9);
    const sigY = doc.y;
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.4).text(
      `_____________________________\n${m.guidePlaceholder}\nProject Supervisor`,
      MARGIN_L,
      sigY,
      { width: 220 }
    );
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.4).text(
      `_____________________________\n${m.hodPlaceholder}\nHead of Department`,
      PAGE_W - MARGIN_R - 220,
      sigY,
      { width: 220, align: 'right' }
    );
    doc.y = sigY + 58;
    doc.moveDown(0.7);

    renderPrelimHeading('CANDIDATE DECLARATION');
    for (const p of docModel.preliminary.declarationText) {
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.6).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 2.6,
      });
      doc.moveDown(0.5);
    }
    doc.moveDown(0.4);
    for (const st of m.studentsPlaceholder) {
      doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.4).text(
        `${st.name} (${st.rollNo})   —   Signature: ______________________`,
        MARGIN_L,
        doc.y,
        { width: CONTENT_W }
      );
      doc.moveDown(0.4);
    }

    // ==================== PAGE 3: ACKNOWLEDGEMENT ====================
    addNewPage('PRELIMINARY — ACKNOWLEDGEMENT');
    recordedToc.push({ level: 1, label: 'Acknowledgement', page: currentPage });
    renderPrelimHeading('ACKNOWLEDGEMENT');
    for (const p of docModel.preliminary.acknowledgementText) {
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(10.2).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 3.5,
      });
      doc.moveDown(0.75);
    }

    // ==================== PAGE 4: ABSTRACT ====================
    addNewPage('PRELIMINARY — ABSTRACT');
    recordedToc.push({ level: 1, label: 'Abstract', page: currentPage });
    renderPrelimHeading('ABSTRACT');
    for (const p of docModel.preliminary.abstractParagraphs) {
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.6).text(p, MARGIN_L, doc.y, {
        width: CONTENT_W,
        align: 'justify',
        lineGap: 2.8,
      });
      doc.moveDown(0.55);
    }
    doc.moveDown(0.35);
    doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.4).text(
      `Keywords: ${docModel.preliminary.keywords.join(' · ')}`,
      MARGIN_L,
      doc.y,
      { width: CONTENT_W, lineGap: 2.3 }
    );

    // ==================== TABLE OF CONTENTS ====================
    addNewPage('TABLE OF CONTENTS');
    recordedToc.push({ level: 1, label: 'Table of Contents', page: currentPage });
    renderPrelimHeading('TABLE OF CONTENTS');
    const tocSource = knownIndex
      ? knownIndex.toc
      : [
          { level: 1 as const, label: '1. ABOUT THE SYSTEM', page: 10 },
          { level: 1 as const, label: '2. SYSTEM DESIGN USING UML', page: 20 },
          { level: 1 as const, label: '3. DATA DICTIONARY', page: 36 },
          { level: 1 as const, label: '4. IMPLEMENTATION', page: 48 },
          { level: 1 as const, label: '5. CONCLUSION', page: 70 },
          { level: 1 as const, label: '6. REFERENCES', page: 72 },
        ];
    for (const item of tocSource) {
      const indent = item.level === 1 ? 0 : item.level === 2 ? 16 : 32;
      const font = item.level === 1 ? FONTS.bold : FONTS.sans;
      const fontSize = item.level === 1 ? 9.6 : 8.9;
      doc.font(font).fontSize(fontSize);
      const labelW = CONTENT_W - indent - 45;
      const h = doc.heightOfString(item.label, { width: labelW });
      ensureSpace(h + 6);
      const rowY = doc.y;
      doc.fillColor(item.level === 1 ? COLORS.navy : COLORS.body).font(font).fontSize(fontSize).text(
        item.label,
        MARGIN_L + indent,
        rowY,
        { width: labelW }
      );
      const nextY = doc.y;
      doc.fillColor(COLORS.navy).font(font).fontSize(fontSize).text(
        String(item.page),
        PAGE_W - MARGIN_R - 40,
        rowY,
        { width: 40, align: 'right', lineBreak: false }
      );
      doc.y = Math.max(nextY, rowY + (item.level === 1 ? 15.5 : 13.5)) + 2.5;
    }

    // ==================== LIST OF FIGURES ====================
    addNewPage('LIST OF FIGURES');
    recordedToc.push({ level: 1, label: 'List of Figures', page: currentPage });
    renderPrelimHeading('LIST OF FIGURES');
    const figSource = knownIndex
      ? knownIndex.figures
      : Array.from({ length: 32 }, (_, i) => ({
          num: `${i + 1}`,
          caption: 'Placeholder layout reservation for engineering diagram or live UI screenshot',
          page: 10 + i,
        }));
    for (const f of figSource) {
      doc.font(FONTS.sans).fontSize(9.0);
      const labelText = `Figure ${f.num}: ${f.caption}`;
      const h = doc.heightOfString(labelText, { width: CONTENT_W - 44 });
      ensureSpace(h + 6);
      const rowY = doc.y;
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.0).text(labelText, MARGIN_L, rowY, {
        width: CONTENT_W - 44,
      });
      const nextY = doc.y;
      doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.0).text(
        String(f.page),
        PAGE_W - MARGIN_R - 36,
        rowY,
        { width: 36, align: 'right', lineBreak: false }
      );
      doc.y = Math.max(nextY, rowY + 14) + 3;
    }

    // ==================== LIST OF TABLES ====================
    addNewPage('LIST OF TABLES');
    recordedToc.push({ level: 1, label: 'List of Tables', page: currentPage });
    renderPrelimHeading('LIST OF TABLES');
    const tblSource = knownIndex
      ? knownIndex.tables
      : Array.from({ length: 43 }, (_, i) => ({
          num: `${i + 1}`,
          caption: 'Placeholder layout reservation for schema data dictionary or verification matrix',
          page: 12 + i,
        }));
    for (const t of tblSource) {
      doc.font(FONTS.sans).fontSize(8.9);
      const labelText = `Table ${t.num}: ${t.caption}`;
      const h = doc.heightOfString(labelText, { width: CONTENT_W - 44 });
      ensureSpace(h + 6);
      const rowY = doc.y;
      doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(8.9).text(labelText, MARGIN_L, rowY, {
        width: CONTENT_W - 44,
      });
      const nextY = doc.y;
      doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(8.9).text(
        String(t.page),
        PAGE_W - MARGIN_R - 36,
        rowY,
        { width: 36, align: 'right', lineBreak: false }
      );
      doc.y = Math.max(nextY, rowY + 13) + 2.5;
    }

    // ==================== LIST OF ABBREVIATIONS ====================
    addNewPage('LIST OF ABBREVIATIONS');
    recordedToc.push({ level: 1, label: 'List of Abbreviations', page: currentPage });
    renderPrelimHeading('LIST OF ABBREVIATIONS');

    const renderTableBlock = (
      tableNumber: string | null,
      caption: string | null,
      headers: string[],
      rows: string[][],
      colWeights?: number[]
    ) => {
      if (tableNumber && caption) {
        ensureSpace(64);
        recordedTables.push({ num: tableNumber, caption, page: currentPage });
        doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.4).text(
          `Table ${tableNumber}: ${caption}`,
          MARGIN_L,
          doc.y,
          { width: CONTENT_W }
        );
        doc.moveDown(0.3);
      }

      const weights =
        colWeights && colWeights.length === headers.length
          ? colWeights
          : headers.map(() => 100 / headers.length);
      const totalWeight = weights.reduce((acc, v) => acc + v, 0);
      const colWidths = weights.map((w) => (w / totalWeight) * CONTENT_W);

      const calcHeaderHeight = () => {
        let maxH = 20;
        headers.forEach((h, idx) => {
          doc.font(FONTS.bold).fontSize(8.3);
          const hHeight = doc.heightOfString(h, { width: colWidths[idx] - 10 }) + 10;
          if (hHeight > maxH) maxH = hHeight;
        });
        return maxH;
      };

      const drawHeaderRow = () => {
        const maxH = calcHeaderHeight();
        const y0 = doc.y;
        doc.save();
        doc.rect(MARGIN_L, y0, CONTENT_W, maxH).fill(COLORS.navy);
        doc.restore();
        let x = MARGIN_L;
        headers.forEach((h, idx) => {
          doc.fillColor('#FFFFFF').font(FONTS.bold).fontSize(8.3).text(h, x + 5, y0 + 5, {
            width: colWidths[idx] - 10,
            align: 'left',
          });
          x += colWidths[idx];
        });
        doc.y = y0 + maxH;
      };

      const firstRowH = (() => {
        if (rows.length === 0) return 20;
        let rh = 18;
        rows[0].forEach((cell, cIdx) => {
          doc.font(cIdx === 0 ? FONTS.bold : FONTS.sans).fontSize(8.1);
          const ch = doc.heightOfString(cell || '', { width: colWidths[cIdx] - 10, lineGap: 1.4 }) + 9;
          if (ch > rh) rh = ch;
        });
        return rh;
      })();

      if (doc.y + calcHeaderHeight() + firstRowH > MAX_Y) {
        addNewPage();
      }
      drawHeaderRow();

      rows.forEach((row, rIdx) => {
        let rowH = 18;
        row.forEach((cell, cIdx) => {
          doc.font(cIdx === 0 ? FONTS.bold : FONTS.sans).fontSize(8.1);
          const ch = doc.heightOfString(cell || '', { width: colWidths[cIdx] - 10, lineGap: 1.4 }) + 9;
          if (ch > rowH) rowH = ch;
        });

        if (doc.y + rowH > MAX_Y) {
          addNewPage();
          drawHeaderRow();
        }

        const y0 = doc.y;
        doc.save();
        doc.rect(MARGIN_L, y0, CONTENT_W, rowH).fillAndStroke(
          rIdx % 2 === 0 ? '#FFFFFF' : COLORS.altRow,
          COLORS.border
        );
        doc.restore();

        let x = MARGIN_L;
        row.forEach((cell, cIdx) => {
          if (cIdx > 0) {
            doc.save();
            doc.moveTo(x, y0).lineTo(x, y0 + rowH).strokeColor(COLORS.border).lineWidth(0.5).stroke();
            doc.restore();
          }
          doc.fillColor(cIdx === 0 ? COLORS.navy : COLORS.body)
            .font(cIdx === 0 ? FONTS.bold : FONTS.sans)
            .fontSize(8.1)
            .text(cell || '', x + 5, y0 + 4.5, {
              width: colWidths[cIdx] - 10,
              align: 'left',
              lineGap: 1.4,
            });
          x += colWidths[cIdx];
        });
        doc.y = y0 + rowH;
      });
      doc.y = Math.min(doc.y + 9, MAX_Y);
    };

    renderTableBlock(
      null,
      null,
      ['Abbreviation', 'Full Technical Term', 'Operational Context in FortiX'],
      docModel.abbreviations.map((a) => [a.abbr, a.full, a.context]),
      [16, 36, 48]
    );

    const renderBlock = (b: ReportBlock) => {
      if (b.kind === 'p') {
        doc.font(FONTS.sans).fontSize(9.8);
        const h = doc.heightOfString(b.text, { width: CONTENT_W, align: 'justify', lineGap: 2.8 });
        if (h <= MAX_Y - MARGIN_T) {
          ensureSpace(h + 4);
        } else {
          ensureSpace(40);
        }
        doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.8).text(b.text, MARGIN_L, doc.y, {
          width: CONTENT_W,
          align: 'justify',
          lineGap: 2.8,
        });
        doc.y = Math.min(doc.y + 7, MAX_Y);
      } else if (b.kind === 'bullets') {
        for (const item of b.items) {
          doc.font(FONTS.sans).fontSize(9.5);
          const h = doc.heightOfString(item, { width: CONTENT_W - 16, align: 'justify', lineGap: 2.3 });
          ensureSpace(Math.min(h + 6, MAX_Y - MARGIN_T));
          const y0 = doc.y;
          doc.fillColor(COLORS.accent).font(FONTS.bold).fontSize(9.8).text('•', MARGIN_L + 4, y0, { lineBreak: false });
          doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.5).text(item, MARGIN_L + 16, y0, {
            width: CONTENT_W - 16,
            align: 'justify',
            lineGap: 2.3,
          });
          doc.y = Math.min(doc.y + 5, MAX_Y);
        }
        doc.y = Math.min(doc.y + 3, MAX_Y);
      } else if (b.kind === 'numbered') {
        b.items.forEach((item, idx) => {
          doc.font(FONTS.sans).fontSize(9.4);
          const h = doc.heightOfString(item, { width: CONTENT_W - 26, align: 'justify', lineGap: 2.2 });
          ensureSpace(Math.min(h + 6, MAX_Y - MARGIN_T));
          const y0 = doc.y;
          doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.4).text(`[${idx + 1}]`, MARGIN_L, y0, {
            width: 24,
            lineBreak: false,
          });
          doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.4).text(item, MARGIN_L + 26, y0, {
            width: CONTENT_W - 26,
            align: 'justify',
            lineGap: 2.2,
          });
          doc.y = Math.min(doc.y + 5, MAX_Y);
        });
        doc.y = Math.min(doc.y + 3, MAX_Y);
      } else if (b.kind === 'callout') {
        doc.font(FONTS.bold).fontSize(9.5);
        const titleH = doc.heightOfString(b.title, { width: CONTENT_W - 26 });
        doc.font(FONTS.sans).fontSize(9.2);
        const textH = doc.heightOfString(b.text, { width: CONTENT_W - 28, lineGap: 2.2 });
        const boxH = titleH + textH + 22;
        ensureSpace(boxH + 10);
        const y0 = doc.y;
        doc.save();
        doc.roundedRect(MARGIN_L, y0, CONTENT_W, boxH, 5).fillAndStroke(COLORS.calloutBg, COLORS.blue);
        doc.rect(MARGIN_L, y0, 4, boxH).fill(COLORS.blue);
        doc.restore();
        doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.5).text(b.title, MARGIN_L + 14, y0 + 7, {
          width: CONTENT_W - 26,
        });
        doc.fillColor(COLORS.body).font(FONTS.sans).fontSize(9.2).text(b.text, MARGIN_L + 14, y0 + 9 + titleH, {
          width: CONTENT_W - 28,
          lineGap: 2.2,
        });
        doc.y = Math.min(y0 + boxH + 9, MAX_Y);
      } else if (b.kind === 'table') {
        renderTableBlock(b.tableNumber, b.caption, b.headers, b.rows, b.colWidths);
      } else if (b.kind === 'figure') {
        const absImg = path.join(ROOT_DIR, b.imagePath);
        if (fs.existsSync(absImg)) {
          const dims = readPngDimensions(absImg);
          const maxImgW = CONTENT_W - 8;
          const maxImgH = 310;
          const scale = Math.min(maxImgW / dims.width, maxImgH / dims.height);
          const drawW = Math.round(dims.width * scale);
          const drawH = Math.round(dims.height * scale);

          doc.font(FONTS.bold).fontSize(9.0);
          const capText = `Figure ${b.figureNumber}: ${b.caption}`;
          const capH = doc.heightOfString(capText, { width: CONTENT_W });
          let noteH = 0;
          if (b.sourceNote) {
            doc.font(FONTS.italic).fontSize(8.0);
            noteH = doc.heightOfString(b.sourceNote, { width: CONTENT_W }) + 3;
          }
          ensureSpace(drawH + capH + noteH + 22);

          recordedFigures.push({ num: b.figureNumber, caption: b.caption, page: currentPage });
          const imgX = MARGIN_L + Math.round((CONTENT_W - drawW) / 2);
          const imgY = doc.y;
          doc.save();
          doc.roundedRect(imgX - 3, imgY - 3, drawW + 6, drawH + 6, 4).strokeColor(COLORS.border).lineWidth(0.8).stroke();
          doc.restore();
          doc.image(absImg, imgX, imgY, { width: drawW, height: drawH });
          doc.y = imgY + drawH + 7;

          doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(9.0).text(capText, MARGIN_L, doc.y, {
            width: CONTENT_W,
            align: 'center',
          });
          if (b.sourceNote) {
            doc.fillColor(COLORS.muted).font(FONTS.italic).fontSize(8.0).text(b.sourceNote, MARGIN_L, doc.y + 1, {
              width: CONTENT_W,
              align: 'center',
            });
          }
          doc.y = Math.min(doc.y + 10, MAX_Y);
        }
      } else if (b.kind === 'code') {
        const rawLines = b.code.split('\n');
        let lineIdx = 0;
        let isContinuation = false;

        while (lineIdx < rawLines.length) {
          if (doc.y + 68 > MAX_Y) {
            addNewPage();
          }
          const availBodyH = MAX_Y - doc.y - 36;
          const chunkLines: string[] = [];
          doc.font(FONTS.mono).fontSize(7.5);
          while (lineIdx < rawLines.length) {
            const candidate = [...chunkLines, rawLines[lineIdx]].join('\n');
            const candidateH = doc.heightOfString(candidate, { width: CONTENT_W - 20, lineGap: 1.3 });
            if (chunkLines.length > 0 && candidateH > availBodyH) {
              break;
            }
            chunkLines.push(rawLines[lineIdx]);
            lineIdx += 1;
          }

          const chunkText = chunkLines.join('\n');
          doc.font(FONTS.mono).fontSize(7.5);
          const codeH = doc.heightOfString(chunkText, { width: CONTENT_W - 20, lineGap: 1.3 });

          const y0 = doc.y;
          doc.save();
          doc.roundedRect(MARGIN_L, y0, CONTENT_W, 20, 4).fill(COLORS.navy);
          doc.restore();
          const hdrTitle = isContinuation
            ? `${b.title} (continued)  —  Source: ${b.filePath}`
            : `${b.title}  —  Source: ${b.filePath}`;
          doc.fillColor('#F8FAFC').font(FONTS.bold).fontSize(8.0).text(hdrTitle, MARGIN_L + 8, y0 + 5, {
            width: CONTENT_W - 16,
            lineBreak: false,
            ellipsis: true,
          });
          const bodyY = y0 + 20;
          doc.save();
          doc.rect(MARGIN_L, bodyY, CONTENT_W, codeH + 14).fillAndStroke(COLORS.lightBg, COLORS.border);
          doc.restore();
          doc.fillColor('#0F172A').font(FONTS.mono).fontSize(7.5).text(chunkText, MARGIN_L + 10, bodyY + 7, {
            width: CONTENT_W - 20,
            lineGap: 1.3,
          });
          doc.y = Math.min(bodyY + codeH + 22, MAX_Y);
          isContinuation = true;
          if (lineIdx < rawLines.length) {
            addNewPage();
          }
        }
      }
    };

    // ==================== CHAPTERS 1–6 & APPENDICES A–F ====================
    for (const ch of docModel.chapters) {
      const chDisplay = ch.isAppendix
        ? `${ch.number.toUpperCase()} — ${ch.title}`
        : `${ch.number}. ${ch.title}`;
      addNewPage(chDisplay);
      recordedToc.push({ level: 1, label: chDisplay, page: currentPage });

      const bannerY = doc.y;
      doc.save();
      doc.roundedRect(MARGIN_L, bannerY, CONTENT_W, 52, 6).fill(COLORS.navy);
      doc.rect(MARGIN_L, bannerY + 48, CONTENT_W, 4).fill(COLORS.accent);
      doc.restore();
      doc.fillColor('#F97316').font(FONTS.bold).fontSize(8.8).text(ch.chapterLabel, MARGIN_L + 14, bannerY + 9, {
        width: CONTENT_W - 28,
        lineBreak: false,
      });
      doc.fillColor('#FFFFFF').font(FONTS.bold).fontSize(14.5).text(
        ch.isAppendix ? `${ch.number}: ${ch.title}` : `${ch.number}. ${ch.title}`,
        MARGIN_L + 14,
        bannerY + 24,
        { width: CONTENT_W - 28, lineBreak: false, ellipsis: true }
      );
      doc.y = bannerY + 66;

      (ch.blocks || []).forEach(renderBlock);

      for (const sec of ch.sections) {
        ensureSpace(58);
        const secLabel = `${sec.number} ${sec.title}`;
        recordedToc.push({ level: 2, label: secLabel, page: currentPage });
        doc.y += 4;
        doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(12).text(secLabel, MARGIN_L, doc.y, {
          width: CONTENT_W,
        });
        doc.moveTo(MARGIN_L, doc.y + 2).lineTo(PAGE_W - MARGIN_R, doc.y + 2).strokeColor(COLORS.border).lineWidth(0.9).stroke();
        doc.y += 10;

        sec.blocks.forEach(renderBlock);

        for (const sub of sec.subsections || []) {
          ensureSpace(48);
          const subLabel = `${sub.number} ${sub.title}`;
          recordedToc.push({ level: 3, label: subLabel, page: currentPage });
          doc.y += 3;
          doc.fillColor(COLORS.slateDark).font(FONTS.bold).fontSize(10.4).text(subLabel, MARGIN_L, doc.y, {
            width: CONTENT_W,
          });
          doc.y += 5;
          sub.blocks.forEach(renderBlock);
        }
      }
    }

    // Stamp Running Headers & Footers without triggering PDFKit margin auto-pagination
    const range = doc.bufferedPageRange();
    const totalPages = range.count;
    for (let i = 1; i < totalPages; i++) {
      doc.switchToPage(i);
      const prevTop = doc.page.margins.top;
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.top = 0;
      doc.page.margins.bottom = 0;

      const hdr = pageHeaders[i] || 'FORTIX PROJECT REPORT (REVISED)';
      doc.save();
      doc.fillColor(COLORS.muted).font(FONTS.bold).fontSize(7.6).text(
        'FORTIX — API Security & Resilience Verification Platform (Revised)',
        MARGIN_L,
        28,
        { width: CONTENT_W * 0.6, lineBreak: false }
      );
      doc.fillColor(COLORS.navy).font(FONTS.sans).fontSize(7.6).text(
        hdr,
        MARGIN_L + CONTENT_W * 0.6,
        28,
        { width: CONTENT_W * 0.4, align: 'right', lineBreak: false, ellipsis: true }
      );
      doc.moveTo(MARGIN_L, 41).lineTo(PAGE_W - MARGIN_R, 41).strokeColor(COLORS.border).lineWidth(0.6).stroke();

      const footerY = PAGE_H - 36;
      doc.moveTo(MARGIN_L, footerY - 5).lineTo(PAGE_W - MARGIN_R, footerY - 5).strokeColor(COLORS.border).lineWidth(0.6).stroke();
      doc.fillColor(COLORS.muted).font(FONTS.sans).fontSize(7.8).text(
        'B.Tech. (IT) Revised Software Project Report  ·  Commit a97c14f',
        MARGIN_L,
        footerY,
        { width: CONTENT_W * 0.72, lineBreak: false }
      );
      doc.fillColor(COLORS.navy).font(FONTS.bold).fontSize(8.0).text(
        `Page ${i + 1} of ${totalPages}`,
        PAGE_W - MARGIN_R - 110,
        footerY,
        { width: 110, align: 'right', lineBreak: false }
      );
      doc.restore();

      doc.page.margins.top = prevTop;
      doc.page.margins.bottom = prevBottom;
    }

    doc.end();

    if (outStream) {
      outStream.on('finish', () =>
        resolve({ toc: recordedToc, figures: recordedFigures, tables: recordedTables, totalPages })
      );
      outStream.on('error', reject);
    } else {
      doc.on('end', () =>
        resolve({ toc: recordedToc, figures: recordedFigures, tables: recordedTables, totalPages })
      );
    }
  });
}

async function main() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const docModel = buildRevisedDocumentModel();

  fs.writeFileSync(REVISED_AST_PATH, JSON.stringify(docModel, null, 2), 'utf8');
  console.log(`[RevisedReport] Wrote structured AST -> ${REVISED_AST_PATH}`);

  const md = generateMarkdown(docModel);
  fs.writeFileSync(REVISED_MD_PATH, md, 'utf8');
  console.log(`[RevisedReport] Wrote Markdown -> ${REVISED_MD_PATH} (${(md.length / 1024).toFixed(1)} KB)`);

  const pass1 = await renderPdfPass(docModel, null, null);
  const pass2 = await renderPdfPass(docModel, pass1, REVISED_PDF_PATH);
  const finalIndex =
    pass2.totalPages !== pass1.totalPages
      ? await renderPdfPass(docModel, pass2, REVISED_PDF_PATH)
      : pass2;

  fs.writeFileSync(
    REVISED_AST_PATH,
    JSON.stringify({ ...docModel, computedIndex: finalIndex }, null, 2),
    'utf8'
  );

  const stat = fs.statSync(REVISED_PDF_PATH);
  console.log(
    `[RevisedReport] Generated ${REVISED_PDF_PATH} — ${finalIndex.totalPages} pages, ${finalIndex.figures.length} figures, ${finalIndex.tables.length} tables (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`
  );
}

main().catch((err) => {
  console.error('[generate-revised-report] Fatal error:', err);
  process.exit(1);
});
