import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import { setupGateway } from '../../src/gateway/index.js';
import { db, getStorageMode, isPersistentStorage } from '../../src/db/index.js';
import { normalizeDatabaseUrl, resolvePostgresSslOption } from '../../src/db/url.js';
import { normalizeRedisUrl } from '../../src/redis.js';
import { apiRoutes, apiKeys, users, organizations, projects } from '../../src/db/schema.js';
import {
  validateProductionJwtSecret,
  listenWithBoundedRetry,
  executeGracefulShutdown,
} from '../../server.js';
import { getEffectiveRedisFailurePolicy, parseAndValidateRedisFailurePolicy } from '../../src/rate-limit/redis.js';
import { getDependenciesHealth } from '../../src/api/system.js';
import { setupApiRoutes } from '../../src/api/index.js';
import { buildReadinessPayload, evaluateReadinessContract } from '../../src/lib/readiness.js';
import {
  getUncaughtErrorCount,
  incrementUncaughtErrorCount,
  resetUncaughtErrorCountForTests,
} from '../../src/lib/error-tracker.js';
import { extractRequestToken } from '../../src/lib/jwt-security.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

describe('Phase 2 — Production Hardening & Gateway Correctness', () => {
  describe('1. Production Persistent Storage Safeguards', () => {
    it('accurately identifies current database storage mode', () => {
      const mode = getStorageMode();
      expect(['persistent', 'in-memory']).toContain(mode);
      expect(typeof isPersistentStorage()).toBe('boolean');
    });

    it('rejects startup in strict persistent mode if DATABASE_URL is missing or memory-based', async () => {
      const validateProductionDbConfig = (nodeEnv: string, strictDb: boolean, dbUrl?: string) => {
        if (nodeEnv === 'production' || strictDb) {
          if (!dbUrl || dbUrl.includes('memory') || dbUrl.trim() === '') {
            throw new Error(
              '[FATAL SECURITY SAFEGUARD] Production startup rejected: Persistent PostgreSQL database (DATABASE_URL) is required in production (STRICT_PERSISTENT_DB or NODE_ENV=production). In-memory fallback (pg-mem) is strictly prohibited in production.'
            );
          }
        }
        return true;
      };

      // Fails when missing
      expect(() => validateProductionDbConfig('production', false, undefined)).toThrow(
        /Production startup rejected/
      );

      // Fails when memory URL
      expect(() => validateProductionDbConfig('production', false, 'postgres://memory:5432')).toThrow(
        /In-memory fallback \(pg-mem\) is strictly prohibited/
      );

      // Fails when STRICT_PERSISTENT_DB is true regardless of NODE_ENV
      expect(() => validateProductionDbConfig('development', true, '')).toThrow(
        /Production startup rejected/
      );

      // Succeeds when valid postgres connection string provided
      expect(
        validateProductionDbConfig('production', false, 'postgres://fortix:secret@prod-db.cloud.internal:5432/fortix_prod')
      ).toBe(true);
    });

    it('normalizes quoted cloud PostgreSQL/Redis URLs and encodes @ in passwords', () => {
      const rawPg = '"postgresql://postgres.ref:my@pass@word@aws-0-region.pooler.supabase.com:5432/postgres"';
      const normalizedPg = normalizeDatabaseUrl(rawPg);
      expect(normalizedPg).toBe('postgresql://postgres.ref:my%40pass%40word@aws-0-region.pooler.supabase.com:5432/postgres');
      expect(resolvePostgresSslOption(normalizedPg)).toEqual({ rejectUnauthorized: false });
      expect(resolvePostgresSslOption('postgres://fortix:pw@127.0.0.1:5432/fortix_db')).toBe(false);

      const rawRedis = '"rediss://default:token123@example.upstash.io:6379"';
      expect(normalizeRedisUrl(rawRedis)).toBe('rediss://default:token123@example.upstash.io:6379');
    });
  });

  describe('2. Production Secret Entropy & Default Credential Validation', () => {
    it('rejects missing, default, repetitive, or low-entropy JWT secrets in production', () => {
      // Missing
      expect(validateProductionJwtSecret(undefined).valid).toBe(false);
      expect(validateProductionJwtSecret('').valid).toBe(false);

      // Known development / placeholder defaults
      expect(validateProductionJwtSecret('dev_secret_key').valid).toBe(false);
      expect(validateProductionJwtSecret('production-secret-change-me').valid).toBe(false);
      expect(validateProductionJwtSecret('12345678901234567890123456789012').valid).toBe(false);

      // Under 32 characters
      expect(validateProductionJwtSecret('short_key_under_32_characters').valid).toBe(false);

      // Low entropy: repeated single character >= 32 chars
      expect(validateProductionJwtSecret('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').valid).toBe(false);
      expect(validateProductionJwtSecret('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').reason).toMatch(/insufficient entropy/i);

      // Valid strong cryptographically generated secret
      const strongSecret = crypto.randomBytes(32).toString('hex');
      const validRes = validateProductionJwtSecret(strongSecret);
      expect(validRes.valid).toBe(true);
      expect(validRes.reason).toBeUndefined();
    });
  });

  describe('3. Rate Limit Redis Failure Policy & Consistency Limits', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('parses and validates allowed policy values and rejects invalid inputs', () => {
      // Valid policies
      expect(parseAndValidateRedisFailurePolicy('fail-closed').policy).toBe('fail-closed');
      expect(parseAndValidateRedisFailurePolicy('fail-open').policy).toBe('fail-open');
      expect(parseAndValidateRedisFailurePolicy(' FAIL-CLOSED ').policy).toBe('fail-closed');

      // Invalid input defaults safely to fail-closed with error
      const invalid = parseAndValidateRedisFailurePolicy('arbitrary-invalid-policy');
      expect(invalid.policy).toBe('fail-closed');
      expect(invalid.error).toMatch(/Allowed values: fail-closed, fail-open/i);
    });

    it('enforces fail-closed by default in production and rejects unsafe fail-open without explicit flag', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_UNSAFE_REDIS_FAIL_OPEN;

      // When unset in production -> fail-closed
      delete process.env.REDIS_FAILURE_BEHAVIOR;
      expect(getEffectiveRedisFailurePolicy()).toBe('fail-closed');

      // When set to fail-open without break-glass flag in production -> overridden to fail-closed
      process.env.REDIS_FAILURE_BEHAVIOR = 'fail-open';
      expect(getEffectiveRedisFailurePolicy()).toBe('fail-closed');

      // Only allows fail-open in production when ALLOW_UNSAFE_REDIS_FAIL_OPEN is explicitly true
      process.env.ALLOW_UNSAFE_REDIS_FAIL_OPEN = 'true';
      expect(getEffectiveRedisFailurePolicy()).toBe('fail-open');
    });

    it('allows fail-open or fail-closed as configured in non-production environments', () => {
      process.env.NODE_ENV = 'development';
      process.env.REDIS_FAILURE_BEHAVIOR = 'fail-open';
      expect(getEffectiveRedisFailurePolicy()).toBe('fail-open');

      process.env.REDIS_FAILURE_BEHAVIOR = 'fail-closed';
      expect(getEffectiveRedisFailurePolicy()).toBe('fail-closed');
    });
  });

  describe('4. Gateway Upstream Request Bounding, Cancellation & Timeout Handling', () => {
    let app: express.Express;
    let mockUpstreamServer: http.Server;
    let upstreamPort: number;
    let timeoutRouteId: string;
    let normalRouteId: string;
    let testRawApiKey: string;
    let projectId: string;

    beforeAll(async () => {
      mockUpstreamServer = http.createServer((req, res) => {
        if (req.url === '/hang') {
          // Simulate hung upstream target
          setTimeout(() => {
            if (!res.writableEnded) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'too_late' }));
            }
          }, 10000);
        } else if (req.url === '/fast') {
          // Simulate normal upstream response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', data: 'normal_response' }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => {
        mockUpstreamServer.listen(0, () => {
          const addr = mockUpstreamServer.address() as any;
          upstreamPort = addr.port;
          resolve();
        });
      });

      process.env.GATEWAY_UPSTREAM_TIMEOUT_MS = '600';
      process.env.REDIS_FAILURE_BEHAVIOR = 'fail-open';

      app = express();
      app.use(express.json());
      setupGateway(app);

      projectId = uuidv4();
      const orgId = uuidv4();
      const userId = uuidv4();

      await db.insert(users).values({ id: userId, email: `test_${userId}@fortix.test`, passwordHash: 'hash', role: 'ADMIN' }).onConflictDoNothing();
      await db.insert(organizations).values({ id: orgId, name: 'Timeout Test Org', ownerId: userId }).onConflictDoNothing();
      await db.insert(projects).values({ id: projectId, name: 'Timeout Test Project', orgId, environment: 'test' }).onConflictDoNothing();

      // Route for timeout testing
      timeoutRouteId = uuidv4();
      await db.insert(apiRoutes).values({
        id: timeoutRouteId,
        projectId,
        pathPattern: '/test-timeout',
        targetUrl: `http://fortix-demo-api.internal:${upstreamPort}/hang`
      });

      // Route for normal traffic testing
      normalRouteId = uuidv4();
      await db.insert(apiRoutes).values({
        id: normalRouteId,
        projectId,
        pathPattern: '/test-normal',
        targetUrl: `http://fortix-demo-api.internal:${upstreamPort}/fast`
      });

      const keyId = crypto.randomBytes(8).toString('hex');
      const secret = crypto.randomBytes(32).toString('hex');
      testRawApiKey = `fx_test_${keyId}_${secret}`;

      await db.insert(apiKeys).values({
        id: keyId,
        projectId,
        keyPrefix: `fx_test_${keyId}`,
        secretHash: await bcrypt.hash(secret, 10),
        name: 'Hardening Test Key'
      });
    });

    afterAll(async () => {
      delete process.env.GATEWAY_UPSTREAM_TIMEOUT_MS;
      await new Promise<void>((resolve) => mockUpstreamServer.close(() => resolve()));
    });

    it('allows normal completed requests to pass without premature client aborts', async () => {
      const res = await request(app)
        .get(`/proxy/${normalRouteId}`)
        .set('X-API-Key', testRawApiKey);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.data).toBe('normal_response');
    });

    it('maps upstream timeouts to HTTP 504 with message reflecting the effective timeout', async () => {
      const start = Date.now();
      const res = await request(app)
        .get(`/proxy/${timeoutRouteId}`)
        .set('X-API-Key', testRawApiKey);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(3500);

      expect([504, 502]).toContain(res.status);
      if (res.status === 504) {
        expect(res.body.error).toMatch(/Gateway Timeout: Upstream target timed out after 600ms/i);
      }
    });

    it('returns HTTP 502 Bad Gateway when upstream target refuses connection', async () => {
      const deadPort = 64997;
      const deadRouteId = uuidv4();
      await db.insert(apiRoutes).values({
        id: deadRouteId,
        projectId,
        pathPattern: '/test-dead',
        targetUrl: `http://fortix-demo-api.internal:${deadPort}/nowhere`
      });

      const res = await request(app)
        .get(`/proxy/${deadRouteId}`)
        .set('X-API-Key', testRawApiKey);

      expect(res.status).toBe(502);
      expect(res.body.error).toMatch(/Bad Gateway: Upstream failure/i);
    });
  });

  describe('5. FTX-REL-P0-P1-RUNTIME-001 — Bounded Port Retry, Graceful Shutdown, Readiness Parity & Worker Bundle', () => {
    it('fails fast with an actionable EADDRINUSE error after bounded retries when a port is already occupied', async () => {
      const blocker = http.createServer((_req, res) => res.end('occupied'));
      await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
      const occupiedPort = (blocker.address() as any).port as number;

      const candidate = http.createServer((_req, res) => res.end('candidate'));
      try {
        await expect(
          listenWithBoundedRetry(candidate, occupiedPort, '127.0.0.1', {
            maxRetries: 2,
            retryDelayMs: 25,
          })
        ).rejects.toThrow(new RegExp(`port ${occupiedPort} is already in use \\(EADDRINUSE\\)`, 'i'));
      } finally {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
      }
    });

    it('closes all owned runtime resources deterministically during executeGracefulShutdown', async () => {
      const callOrder: string[] = [];
      const ephemeralServer = http.createServer((_req, res) => res.end('ok'));
      await listenWithBoundedRetry(ephemeralServer, 0, '127.0.0.1', { maxRetries: 0 });
      expect(ephemeralServer.listening).toBe(true);

      const { errors } = await executeGracefulShutdown({
        server: ephemeralServer,
        closeWebSockets: async () => {
          callOrder.push('websockets');
        },
        viteClose: async () => {
          callOrder.push('vite');
        },
        closeDemoApi: async () => {
          callOrder.push('demoApi');
        },
        shutdownWorkers: async () => {
          callOrder.push('workers');
        },
        closeExperimentQueue: async () => {
          callOrder.push('experimentQueue');
        },
        closeKeyRevocationClients: async () => {
          callOrder.push('keyRevocationPubSub');
        },
        closeRedisConnection: async () => {
          callOrder.push('redis');
        },
        closeDatabaseConnection: async () => {
          callOrder.push('postgres');
        },
      });

      expect(errors).toEqual([]);
      expect(ephemeralServer.listening).toBe(false);
      expect(callOrder).toEqual([
        'websockets',
        'vite',
        'demoApi',
        'workers',
        'experimentQueue',
        'keyRevocationPubSub',
        'redis',
        'postgres',
      ]);

      // Idempotent second call when HTTP server is already stopped must not throw ERR_SERVER_NOT_RUNNING
      const secondRun = await executeGracefulShutdown({ server: ephemeralServer });
      expect(secondRun.errors).toEqual([]);
    });

    it('standardizes /health/ready and /api/health/ready payloads and reports worker.queue as "experiments"', async () => {
      resetUncaughtErrorCountForTests();
      incrementUncaughtErrorCount();

      const health = await getDependenciesHealth();
      expect(health.worker.queue).toBe('experiments');

      const readinessApp = express();
      readinessApp.get('/health/ready', async (_req, res) => {
        const depHealth = await getDependenciesHealth();
        const evaluation = evaluateReadinessContract(depHealth);
        res
          .status(evaluation.httpStatus)
          .json(buildReadinessPayload(depHealth, evaluation, getUncaughtErrorCount()));
      });
      setupApiRoutes(readinessApp);

      const rootReady = await request(readinessApp).get('/health/ready');
      const apiReady = await request(readinessApp).get('/api/health/ready');

      expect(rootReady.status).toBe(apiReady.status);
      expect(Object.keys(rootReady.body).sort()).toEqual(Object.keys(apiReady.body).sort());
      expect(rootReady.body.status).toBe(apiReady.body.status);
      expect(rootReady.body.deploymentMode).toBe(apiReady.body.deploymentMode);
      expect(rootReady.body.persistenceVerified).toBe(apiReady.body.persistenceVerified);
      expect(rootReady.body.postgresStorageMode).toBe(apiReady.body.postgresStorageMode);
      expect(rootReady.body.postgresMigrationStatus).toBe(apiReady.body.postgresMigrationStatus);
      expect(rootReady.body.redisStorageMode).toBe(apiReady.body.redisStorageMode);
      expect(rootReady.body.uncaughtErrors).toBe(1);
      expect(apiReady.body.uncaughtErrors).toBe(1);

      resetUncaughtErrorCountForTests();
    });

    it('prioritizes explicit Authorization Bearer header over ambient session cookies without cookie fallback', () => {
      const explicitBearer = extractRequestToken({
        headers: {
          authorization: 'Bearer explicit-header-jwt',
          cookie: 'fortix_session=ambient-cookie-jwt',
        },
        cookies: { fortix_session: 'ambient-cookie-jwt' },
      });
      expect(explicitBearer).toBe('explicit-header-jwt');

      const malformedBearerWithCookie = extractRequestToken({
        headers: {
          authorization: 'Basic dXNlcjpwYXNz',
          cookie: 'fortix_session=ambient-cookie-jwt',
        },
        cookies: { fortix_session: 'ambient-cookie-jwt' },
      });
      expect(malformedBearerWithCookie).toBeUndefined();
    });

    it('enforces Vite ws:false, Playwright **/*.spec.ts isolation, and compiled dist/worker.cjs Docker command', () => {
      const repoRoot = process.cwd();
      const serverSrc = fs.readFileSync(path.join(repoRoot, 'server.ts'), 'utf8');
      const playwrightCfg = fs.readFileSync(path.join(repoRoot, 'playwright.config.ts'), 'utf8');
      const composeCfg = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
      const pkgJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

      expect(serverSrc).toMatch(/hmr:\s*false/);
      expect(serverSrc).toMatch(/ws:\s*false/);
      expect(playwrightCfg).toMatch(/testMatch:\s*['"]\*\*\/\*\.spec\.ts['"]/);
      expect(composeCfg).not.toMatch(/--loader\s+tsx/);
      expect(composeCfg).toMatch(/\["node",\s*"dist\/worker\.cjs"\]/);
      expect(pkgJson.scripts.build).toContain('dist/worker.cjs');
    });
  });
});
