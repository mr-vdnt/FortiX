import express from 'express';
import { z } from 'zod';
import { db, getStorageMode } from '../db/index.js';
import { getMigrationStatus } from '../db/init.js';
import { redisConnection, getRedisStorageMode, getLastRedisError, isRealRedisActive } from '../redis.js';
import { sql } from 'drizzle-orm';
import { getSocketStats } from '../socket.js';
import { systemHealthGauge } from '../lib/metrics.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { captureTrackedError, getTrackedErrors } from '../lib/error-tracker.js';
import { getProductAnalyticsSummary, recordProductAnalyticsEvent } from '../lib/analytics.js';
import { evaluateReadinessContract } from '../lib/readiness.js';
import fs from 'fs';
import path from 'path';

const router = express.Router();

let cachedHealth: any = null;
let lastHealthCheckTime = 0;
const HEALTH_CACHE_TTL_MS = 5000;

function sanitizeHealthError(raw?: string): string {
  if (!raw) return 'Database connection error';
  return raw
    .replace(/(?:postgres(?:ql)?|rediss?):\/\/[^\s'"]+/gi, '[REDACTED_URI]')
    .replace(/password=\S+/gi, 'password=[REDACTED]')
    .slice(0, 200);
}

export function invalidateHealthCacheForTests(): void {
  cachedHealth = null;
  lastHealthCheckTime = 0;
}

export async function getDependenciesHealth() {
  const now = Date.now();
  const isTestEnv = Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
  if (!isTestEnv && cachedHealth && now - lastHealthCheckTime < HEALTH_CACHE_TTL_MS) {
    return cachedHealth;
  }

  let dbStatus = 'healthy';
  let redisStatus = 'healthy';
  let dbLatencyMs = 0;
  let redisLatencyMs = 0;
  let dbError: string | undefined = undefined;

  const migrationInfo = getMigrationStatus();

  const dbStart = Date.now();
  try {
    let timeoutId: any;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('PostgreSQL check timed out (4000ms bounded threshold)')),
        4000
      );
    });

    await Promise.race([db.execute(sql`SELECT 1`), timeoutPromise]);
    clearTimeout(timeoutId);
    dbLatencyMs = Date.now() - dbStart;
    if (migrationInfo.status === 'failed') {
      dbStatus = 'error';
      dbError = sanitizeHealthError(migrationInfo.error || 'Database migrations failed');
    } else {
      dbStatus = 'healthy';
      dbError = undefined;
    }
  } catch (err: any) {
    dbStatus = 'error';
    dbError = sanitizeHealthError(err?.message);
  }

  const redisStart = Date.now();
  try {
    if (!isRealRedisActive && process.env.STRICT_REDIS_READINESS === 'true') {
      redisStatus = 'error';
    } else if (
      redisConnection.status &&
      !['ready', 'connecting', 'connect', 'reconnecting'].includes(redisConnection.status)
    ) {
      redisStatus = 'error';
    } else {
      let timeoutId: any;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Redis Ping Timeout')), 4000);
      });
      await Promise.race([redisConnection.ping(), timeoutPromise]);
      clearTimeout(timeoutId);
      redisLatencyMs = Date.now() - redisStart;
      redisStatus = 'healthy';
    }
  } catch {
    redisStatus = 'error';
  }

  const pgStorageMode = getStorageMode();
  const rdStorageMode = getRedisStorageMode();
  const socketStats = getSocketStats();
  const overallStatus = dbStatus === 'healthy' && redisStatus === 'healthy' ? 'healthy' : 'degraded';
  systemHealthGauge.set(overallStatus === 'healthy' ? 1 : 0);

  const partialSnapshot = {
    status: overallStatus,
    postgres: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
      error: dbError,
      storageMode: pgStorageMode,
      migrationStatus: migrationInfo.status,
      migrationError: migrationInfo.error,
    },
    redis: {
      status: redisStatus,
      latencyMs: redisLatencyMs,
      error: redisStatus === 'error' ? getLastRedisError() || 'Redis connection error' : undefined,
      storageMode: rdStorageMode,
    },
  };

  const readiness = evaluateReadinessContract(partialSnapshot);

  const result = {
    status: overallStatus,
    deploymentMode: readiness.deploymentMode,
    persistenceVerified: readiness.persistenceVerified,
    warnings: readiness.warnings,
    timestamp: new Date().toISOString(),
    api: 'healthy',
    postgres: partialSnapshot.postgres,
    redis: partialSnapshot.redis,
    telemetry: {
      status: socketStats.connectedSockets >= 0 ? 'healthy' : 'degraded',
      eventsEmitted: socketStats.totalEventsEmitted,
      activeSockets: socketStats.connectedSockets,
      uptimeSeconds: socketStats.uptimeSeconds,
    },
    worker: {
      status: redisStatus === 'healthy' ? 'healthy' : 'degraded',
      mode: isRealRedisActive ? 'bullmq-redis' : 'in-process-bounded',
      queue: 'fortix-experiments',
    },
  };

  cachedHealth = result;
  lastHealthCheckTime = now;
  return result;
}

export function getSystemTestStatus() {
  const vitestSummaryPath = path.join(process.cwd(), 'test-results', 'vitest-summary.json');
  if (fs.existsSync(vitestSummaryPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(vitestSummaryPath, 'utf8'));
      const stat = fs.statSync(vitestSummaryPath);
      const totalTests = Number(raw.numTotalTests ?? 0);
      const passedTests = Number(raw.numPassedTests ?? 0);
      const failedTests = Number(raw.numFailedTests ?? 0);
      const totalSuites = Number(raw.numTotalTestSuites ?? 0);
      const passedSuites = Number(raw.numPassedTestSuites ?? 0);

      if (totalTests > 0) {
        return {
          status: failedTests === 0 && raw.success !== false ? 'PASSED' : 'FAILED',
          verifiedFromArtifact: true,
          totalTests,
          passed: passedTests,
          failed: failedTests,
          totalSuites,
          passedSuites,
          lastVerifiedAt: raw.startTime ? new Date(raw.startTime).toISOString() : stat.mtime.toISOString(),
          source: 'test-results/vitest-summary.json',
        };
      }
    } catch {
      // Fall through to unverified state if artifact is malformed
    }
  }

  return {
    status: 'UNVERIFIED_AT_RUNTIME',
    verifiedFromArtifact: false,
    totalTests: 0,
    passed: 0,
    failed: 0,
    totalSuites: 0,
    passedSuites: 0,
    lastVerifiedAt: null,
    source: 'No persisted test artifact found — execute npm test to record verified results.',
  };
}

// GET /api/control/system/health
router.get('/health', async (_req, res) => {
  try {
    const health = await getDependenciesHealth();
    res.json(health);
  } catch {
    res.status(500).json({ status: 'error', error: 'Failed to inspect system health' });
  }
});

// GET /api/control/system/test-status
router.get('/test-status', (_req, res) => {
  res.json(getSystemTestStatus());
});

// GET /api/control/system/errors (Authenticated — returns scrubbed error telemetry)
router.get('/errors', authenticate, (_req: AuthRequest, res) => {
  res.json({
    errors: getTrackedErrors(50),
  });
});

const clientErrorSchema = z.object({
  message: z.string().min(1).max(500),
  componentStack: z.string().max(1000).optional(),
  path: z.string().max(256).optional(),
});

// POST /api/control/system/client-error (Authenticated — captures scrubbed UI error boundary events)
router.post('/client-error', authenticate, (req: AuthRequest & { id?: string }, res) => {
  const parsed = clientErrorSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid client error payload', code: 'INVALID_CLIENT_ERROR' });
  }
  const event = captureTrackedError({
    source: 'client',
    code: 'REACT_RENDER_ERROR',
    statusCode: 500,
    message: parsed.data.message,
    path: parsed.data.path,
    requestId: req.id,
    context: parsed.data.componentStack ? { componentStack: parsed.data.componentStack } : undefined,
  });
  res.status(201).json({ recorded: true, errorEventId: event.id });
});

const analyticsEventSchema = z.object({
  event: z.string().min(2).max(64),
  workspaceMode: z.enum(['demo', 'standard']).optional(),
});

// POST /api/control/system/analytics/event (Authenticated, opt-out aware, zero-PII allowlist)
router.post('/analytics/event', authenticate, (req: AuthRequest, res) => {
  const parsed = analyticsEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid analytics event payload' });
  }
  const optOut = req.headers['x-fortix-analytics-opt-out'] === 'true';
  const outcome = recordProductAnalyticsEvent({
    event: parsed.data.event,
    workspaceMode: parsed.data.workspaceMode,
    optOut,
  });
  res.status(200).json(outcome);
});

// GET /api/control/system/analytics/summary (Authenticated)
router.get('/analytics/summary', authenticate, (_req: AuthRequest, res) => {
  res.json(getProductAnalyticsSummary());
});

export const systemRouter = router;
