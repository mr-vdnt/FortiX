import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { 
  recordDlqFailure, 
  listDlqJobs, 
  getDlqJob, 
  retryDlqJob, 
  retryAllDlqJobs, 
  discardDlqJob, 
  purgeAllDlqJobs, 
  getQueueStats,
  __clearDlqStoreForTests
} from '../../src/lib/dlq.js';
import { DEFAULT_EXPERIMENT_JOB_OPTIONS } from '../../src/experiments/queue.js';
import { setupApiRoutes } from '../../src/api/index.js';
import { db } from '../../src/db/index.js';
import { users, organizations, projects, apiRoutes, experiments } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

describe('TSK-06: BullMQ Dead-Letter Queue (DLQ) & Failed Job Resilience', () => {
  const app = express();
  app.use(express.json());
  setupApiRoutes(app);

  const secret = process.env.JWT_SECRET || 'secret';
  let token: string;
  let testProjectId: string;
  let testRouteId: string;

  beforeAll(async () => {
    const userId = uuidv4();
    const email = `dlq_tester_${Date.now()}@fortix.io`;
    token = jwt.sign({ id: userId, email }, secret);

    const orgId = uuidv4();
    testProjectId = uuidv4();
    testRouteId = uuidv4();

    await db.insert(users).values({ id: userId, email, passwordHash: 'hash', role: 'DEVELOPER' });
    await db.insert(organizations).values({ id: orgId, name: 'DLQ Org', ownerId: userId });
    await db.insert(projects).values({ id: testProjectId, orgId, name: 'DLQ Proj', environment: 'development' });
    await db.insert(apiRoutes).values({ id: testRouteId, projectId: testProjectId, pathPattern: '/dlq-test', targetUrl: 'http://localhost:9999' });
  });

  beforeEach(() => {
    __clearDlqStoreForTests();
  });

  it('1. Queue Configuration: adheres to max retries and exponential backoff contract', () => {
    expect(DEFAULT_EXPERIMENT_JOB_OPTIONS.attempts).toBe(3);
    expect(DEFAULT_EXPERIMENT_JOB_OPTIONS.backoff.type).toBe('exponential');
    expect(DEFAULT_EXPERIMENT_JOB_OPTIONS.backoff.delay).toBe(1000);
    expect(DEFAULT_EXPERIMENT_JOB_OPTIONS.removeOnFail).toBe(false);
  });

  it('2. DLQ Record Creation & DB Status Synchronization on Exhausted Retries', async () => {
    const expId = uuidv4();
    await db.insert(experiments).values({
      id: expId,
      routeId: testRouteId,
      type: 'latency',
      status: 'RUNNING',
      config: { latencyMs: 800 },
      startedAt: new Date()
    });

    const dlqRecord = await recordDlqFailure({
      jobId: `job-test-101`,
      queueName: 'experiments',
      jobName: 'run-experiment',
      data: { experimentId: expId },
      failedReason: 'Upstream gateway connection timeout after 3 attempts',
      stacktrace: ['Error: Upstream gateway connection timeout', '    at runLatencyExperiment (/app/src/experiments/worker.ts:45:11)'],
      attemptsMade: 3,
      maxAttempts: 3
    });

    expect(dlqRecord.id).toBe('job-test-101');
    expect(dlqRecord.status).toBe('DEAD_LETTER');
    expect(dlqRecord.attemptsMade).toBe(3);
    expect(dlqRecord.failedReason).toContain('Upstream gateway connection timeout');
    expect(dlqRecord.stacktrace.length).toBeGreaterThan(0);

    // Verify DB experiment status transitioned to FAILED
    const [dbExp] = await db.select().from(experiments).where(eq(experiments.id, expId));
    expect(dbExp).toBeDefined();
    expect(dbExp.status).toBe('FAILED');
    expect(dbExp.completedAt).not.toBeNull();
  });

  it('3. DLQ Querying, Filtering & Pagination', async () => {
    await recordDlqFailure({
      jobId: 'exp-failure-1',
      queueName: 'experiments',
      jobName: 'run-experiment',
      data: { experimentId: 'exp-1' },
      failedReason: 'HTTP 503 from backend server'
    });

    await recordDlqFailure({
      jobId: 'cleanup-failure-2',
      queueName: 'cleanup',
      jobName: 'telemetry-ttl',
      data: { retentionDays: 7 },
      failedReason: 'Database deadlock during telemetry purge'
    });

    // Query all
    const all = await listDlqJobs();
    expect(all.total).toBe(2);
    expect(all.jobs.length).toBe(2);

    // Filter by queue
    const expOnly = await listDlqJobs({ queueName: 'experiments' });
    expect(expOnly.total).toBe(1);
    expect(expOnly.jobs[0].id).toBe('exp-failure-1');

    // Search query
    const searchRes = await listDlqJobs({ search: 'deadlock' });
    expect(searchRes.total).toBe(1);
    expect(searchRes.jobs[0].id).toBe('cleanup-failure-2');

    // Single job lookup
    const single = await getDlqJob('exp-failure-1');
    expect(single).not.toBeNull();
    expect(single?.jobName).toBe('run-experiment');
  });

  it('4. DLQ Replay / Retry transitions job to RETRYING and resets experiment DB status to QUEUED', async () => {
    const expId = uuidv4();
    await db.insert(experiments).values({
      id: expId,
      routeId: testRouteId,
      type: 'error_5xx',
      status: 'FAILED',
      config: {},
      startedAt: new Date()
    });

    await recordDlqFailure({
      jobId: 'retryable-job-999',
      queueName: 'experiments',
      jobName: 'run-experiment',
      data: { experimentId: expId },
      failedReason: 'Temporary network partition'
    });

    const retryRes = await retryDlqJob('retryable-job-999');
    expect(retryRes.success).toBe(true);
    expect(retryRes.job?.status).toBe('RETRYING');

    // Verify DB status reset to QUEUED
    const [dbExp] = await db.select().from(experiments).where(eq(experiments.id, expId));
    expect(dbExp.status).toBe('QUEUED');
  });

  it('5. DLQ Discard and Purge Operations', async () => {
    await recordDlqFailure({
      jobId: 'discard-job-1',
      queueName: 'experiments',
      jobName: 'run-experiment',
      data: {},
      failedReason: 'Invalid payload'
    });

    await recordDlqFailure({
      jobId: 'discard-job-2',
      queueName: 'cleanup',
      jobName: 'reaper',
      data: {},
      failedReason: 'Schema lock timeout'
    });

    // Discard single
    const discardRes = await discardDlqJob('discard-job-1');
    expect(discardRes.success).toBe(true);
    expect(await getDlqJob('discard-job-1')).toBeNull();

    // Purge all remaining
    const purgeRes = await purgeAllDlqJobs();
    expect(purgeRes.purgedCount).toBe(1);

    const stats = await getQueueStats();
    expect(stats.dlqTotal).toBe(0);
  });

  it('6. REST API: GET /api/control/dlq requires authentication and serves DLQ state', async () => {
    // Unauthenticated
    const unauth = await request(app).get('/api/control/dlq');
    expect(unauth.status).toBe(401);

    await recordDlqFailure({
      jobId: 'api-dlq-job-1',
      queueName: 'experiments',
      jobName: 'run-experiment',
      data: { foo: 'bar' },
      failedReason: 'Socket hang up'
    });

    // Authenticated
    const res = await request(app)
      .get('/api/control/dlq')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.jobs[0].id).toBe('api-dlq-job-1');
  });

  it('7. REST API: Queue Health Stats, Retry, and Purge Endpoints', async () => {
    await recordDlqFailure({
      jobId: 'endpoint-job-123',
      queueName: 'experiments',
      jobName: 'run-experiment',
      data: {},
      failedReason: 'Memory allocation limit exceeded'
    });

    // GET /api/control/dlq/stats
    const statsRes = await request(app)
      .get('/api/control/dlq/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.dlqTotal).toBe(1);
    expect(statsRes.body.dlqByQueue.experiments).toBe(1);

    // GET /api/control/dlq/:jobId
    const getJobRes = await request(app)
      .get('/api/control/dlq/endpoint-job-123')
      .set('Authorization', `Bearer ${token}`);
    expect(getJobRes.status).toBe(200);
    expect(getJobRes.body.id).toBe('endpoint-job-123');

    // POST /api/control/dlq/:jobId/retry
    const retryRes = await request(app)
      .post('/api/control/dlq/endpoint-job-123/retry')
      .set('Authorization', `Bearer ${token}`);
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.success).toBe(true);

    // DELETE /api/control/dlq/purge-all
    const purgeRes = await request(app)
      .delete('/api/control/dlq/purge-all')
      .set('Authorization', `Bearer ${token}`);
    expect(purgeRes.status).toBe(200);
    expect(purgeRes.body.purgedCount).toBe(1);
  });
});
