import { Worker, Queue } from 'bullmq';
import { db, closeDatabaseConnection } from './db/index.js';
import { metricLogs, experiments } from './db/schema.js';
import { runExperimentLogic } from './experiments/worker.js';
import { closeExperimentQueue } from './experiments/queue.js';
import { eq, and, lt, sql } from 'drizzle-orm';
import { registerQueue, recordDlqFailure } from './lib/dlq.js';
import { closeKeyRevocationClients } from './lib/key-invalidation.js';
import { logger } from './lib/logger.js';
import { processTelemetryBatch, stopTelemetryWorker } from './telemetry-worker.js';
import { executeWebhookDelivery } from './lib/webhooks.js';
import {
  closeRedisConnection,
  getBullMqConnectionOptions,
  isManagedServerlessRedis,
  isRealRedisActive,
} from './redis.js';

export function isBenignConnectionError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || '');
  const code = String(err.code || '');
  return (
    code === 'ECONNREFUSED' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNRESET' ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('EAI_AGAIN') ||
    msg.includes('getaddrinfo') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ETIMEDOUT')
  );
}

let cleanupQueueRef: Queue | null = null;
let experimentWorkerRef: Worker | null = null;
let webhookWorkerRef: Worker | null = null;
let cleanupWorkerRef: Worker | null = null;
let workersShuttingDown = false;

if (isRealRedisActive) {
  const redisConnection = getBullMqConnectionOptions();
  const workerOptions = isManagedServerlessRedis
    ? { connection: redisConnection as any, drainDelay: 30, stalledInterval: 120000 }
    : { connection: redisConnection as any };

  const cleanupQueue = new Queue('cleanup', { connection: redisConnection as any });
  cleanupQueueRef = cleanupQueue;
  registerQueue('cleanup', cleanupQueue);

  cleanupQueue.on('error', (err: any) => {
    if (isBenignConnectionError(err)) return;
    logger.error({ err }, '[BullMQ cleanupQueue] Error');
  });

  const experimentWorker = new Worker('experiments', async job => {
    if (job.name === 'run-experiment') {
      await runExperimentLogic(job.data.experimentId);
    }
  }, workerOptions);
  experimentWorkerRef = experimentWorker;

  experimentWorker.on('error', (err: any) => {
    if (isBenignConnectionError(err)) return;
    logger.error({ err }, '[BullMQ experimentWorker] Error');
  });

  experimentWorker.on('failed', async (job, err) => {
    if (!job) return;
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts?.attempts || 3;

    logger.warn({
      jobId: job.id,
      name: job.name,
      attemptsMade,
      maxAttempts,
      err: err?.message
    }, '[BullMQ experimentWorker] Job attempt failed');

    if (attemptsMade >= maxAttempts) {
      await recordDlqFailure({
        jobId: job.id || `exp-job-${Date.now()}`,
        queueName: 'experiments',
        jobName: job.name,
        data: job.data,
        failedReason: err?.message || 'Job execution failed after max retries',
        stacktrace: err?.stack ? [err.stack] : job.stacktrace || [],
        attemptsMade,
        maxAttempts
      });
    }
  });

  // Dedicated Webhook Redelivery Worker
  const webhookWorker = new Worker('fortix-webhooks', async job => {
    if (job.name === 'deliver-webhook') {
      const attempt = (job.attemptsMade || 0) + 1;
      await executeWebhookDelivery(job.data, attempt);
    }
  }, workerOptions);
  webhookWorkerRef = webhookWorker;

  webhookWorker.on('error', (err: any) => {
    if (isBenignConnectionError(err)) return;
    logger.error({ err }, '[BullMQ webhookWorker] Error');
  });

  webhookWorker.on('failed', async (job, err) => {
    if (!job) return;
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts?.attempts || 5;

    logger.warn({
      jobId: job.id,
      name: job.name,
      attemptsMade,
      maxAttempts,
      err: err?.message,
    }, '[BullMQ webhookWorker] Webhook delivery attempt failed');

    if (attemptsMade >= maxAttempts) {
      await recordDlqFailure({
        jobId: job.id || `wh-job-${Date.now()}`,
        queueName: 'fortix-webhooks',
        jobName: job.name,
        data: job.data,
        failedReason: err?.message || 'Webhook delivery failed after 5 exponential attempts',
        stacktrace: err?.stack ? [err.stack] : job.stacktrace || [],
        attemptsMade,
        maxAttempts,
      });
    }
  });

  // Schedule the cleanup job to run periodically
  cleanupQueue.add('reaper', {}, { repeat: { pattern: '*/5 * * * *' } } as any).catch(() => {});
  cleanupQueue.add('telemetry-ttl', {}, { repeat: { pattern: '0 * * * *' } } as any).catch(() => {});

  const cleanupWorker = new Worker('cleanup', async job => {
    if (job.name === 'telemetry-ttl') {
      await db.execute(sql`
        DELETE FROM ${metricLogs}
        WHERE timestamp < NOW() - INTERVAL '7 days'
      `);
      logger.info('Cleaned up telemetry older than 7 days');
    } else if (job.name === 'reaper') {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      await db.update(experiments).set({ status: 'FAILED' })
        .where(and(eq(experiments.status, 'RUNNING'), lt(experiments.startedAt, fiveMinsAgo)));
      logger.info('Reaped orphaned experiments');
    }
  }, workerOptions);
  cleanupWorkerRef = cleanupWorker;

  cleanupWorker.on('error', (err: any) => {
    if (isBenignConnectionError(err)) return;
    logger.error({ err }, '[BullMQ cleanupWorker] Error');
  });

  cleanupWorker.on('failed', async (job, err) => {
    if (!job) return;
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts?.attempts || 3;

    if (attemptsMade >= maxAttempts) {
      await recordDlqFailure({
        jobId: job.id || `cleanup-job-${Date.now()}`,
        queueName: 'cleanup',
        jobName: job.name,
        data: job.data,
        failedReason: err?.message || 'Cleanup job execution failed',
        stacktrace: err?.stack ? [err.stack] : job.stacktrace || [],
        attemptsMade,
        maxAttempts
      });
    }
  });

  logger.info('BullMQ workers initialized with DLQ failure routing');
} else {
  logger.info('[Worker] In-memory Redis active; using direct in-process job execution and stream telemetry consumer');
}

// Start the telemetry ingestion loop
processTelemetryBatch().catch((err) => {
  if (isBenignConnectionError(err)) return;
  logger.error({ err }, 'Telemetry ingestion loop error');
});

export async function shutdownWorkers(): Promise<void> {
  if (workersShuttingDown) return;
  workersShuttingDown = true;

  await stopTelemetryWorker();

  const closers: Promise<unknown>[] = [];
  if (experimentWorkerRef) closers.push(experimentWorkerRef.close());
  if (webhookWorkerRef) closers.push(webhookWorkerRef.close());
  if (cleanupWorkerRef) closers.push(cleanupWorkerRef.close());
  if (cleanupQueueRef) closers.push(cleanupQueueRef.close());
  closers.push(closeExperimentQueue());
  closers.push(closeKeyRevocationClients());

  await Promise.allSettled(closers);
  experimentWorkerRef = null;
  webhookWorkerRef = null;
  cleanupWorkerRef = null;
  cleanupQueueRef = null;
}

const isStandaloneWorkerProcess =
  process.env.FORTIX_EMBEDDED_WORKER !== 'true' &&
  process.env.NODE_ENV !== 'test' &&
  !process.env.VITEST;

if (isStandaloneWorkerProcess) {
  let standaloneExiting = false;
  const handleWorkerSignal = async (signal: string) => {
    if (standaloneExiting) return;
    standaloneExiting = true;
    logger.info({ signal }, '[Worker] Received shutdown signal, closing workers and connections...');
    const forceTimer = setTimeout(() => {
      logger.error('[Worker] Shutdown timed out after 10s, exiting forcefully');
      process.exit(1);
    }, 10000);
    forceTimer.unref?.();

    try {
      await shutdownWorkers();
      await closeRedisConnection();
      await closeDatabaseConnection();
      clearTimeout(forceTimer);
      logger.info('[Worker] Graceful shutdown complete.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, '[Worker] Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void handleWorkerSignal('SIGTERM'));
  process.on('SIGINT', () => void handleWorkerSignal('SIGINT'));
}
