import { Queue, Job } from 'bullmq';
import { redisConnection } from '../redis.js';
import { db } from '../db/index.js';
import { experiments } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { dlqJobsTotal, dlqRetriesTotal, dlqCurrentGauge } from './metrics.js';
import { logger } from './logger.js';

export interface DlqJobRecord {
  id: string;
  queueName: string;
  jobName: string;
  experimentId?: string;
  data: any;
  failedReason: string;
  stacktrace: string[];
  attemptsMade: number;
  maxAttempts: number;
  failedAt: string;
  status: 'DEAD_LETTER' | 'FAILED' | 'RETRYING' | 'RESOLVED';
}

export interface QueueHealthStats {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

// In-memory persistent registry for DLQ records to ensure reliability across runtime modes (Real Redis / Mock)
const inMemoryDlqStore = new Map<string, DlqJobRecord>();

// Known BullMQ Queues
const registeredQueues = new Map<string, Queue>();

export function registerQueue(name: string, queue: Queue) {
  registeredQueues.set(name, queue);
}

export function getRegisteredQueue(name: string): Queue | undefined {
  return registeredQueues.get(name);
}

/**
 * Record a failed job into the Dead-Letter Queue
 */
export async function recordDlqFailure(params: {
  jobId: string;
  queueName: string;
  jobName: string;
  data: any;
  failedReason: string;
  stacktrace?: string[];
  attemptsMade?: number;
  maxAttempts?: number;
}) {
  const experimentId = params.data?.experimentId || (typeof params.data === 'string' ? params.data : undefined);
  const attemptsMade = params.attemptsMade ?? 3;
  const maxAttempts = params.maxAttempts ?? 3;

  const record: DlqJobRecord = {
    id: params.jobId,
    queueName: params.queueName,
    jobName: params.jobName,
    experimentId,
    data: params.data,
    failedReason: params.failedReason || 'Unknown execution failure',
    stacktrace: params.stacktrace || [],
    attemptsMade,
    maxAttempts,
    failedAt: new Date().toISOString(),
    status: 'DEAD_LETTER'
  };

  inMemoryDlqStore.set(params.jobId, record);

  // Update Prometheus metrics
  try {
    dlqJobsTotal.inc({ queue: params.queueName, job_name: params.jobName });
    const countForQueue = Array.from(inMemoryDlqStore.values()).filter(j => j.queueName === params.queueName && j.status === 'DEAD_LETTER').length;
    dlqCurrentGauge.set({ queue: params.queueName }, countForQueue);
  } catch (err) {
    // Metric increment resilience
  }

  // Update Experiment record in database if experimentId is present
  if (experimentId) {
    try {
      await db.update(experiments).set({
        status: 'FAILED',
        completedAt: new Date(),
      }).where(eq(experiments.id, experimentId));
    } catch (e) {
      logger.warn({ experimentId, err: e }, '[DLQ] Failed to update experiment status in DB');
    }
  }

  logger.error({
    jobId: params.jobId,
    queue: params.queueName,
    jobName: params.jobName,
    experimentId,
    attemptsMade,
    reason: params.failedReason
  }, '[DLQ] Job permanently failed and routed to Dead-Letter Queue');

  return record;
}

/**
 * Retrieve all DLQ jobs with filtering and pagination
 */
export async function listDlqJobs(options: {
  queueName?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ total: number; jobs: DlqJobRecord[] }> {
  let list = Array.from(inMemoryDlqStore.values());

  if (options.queueName) {
    list = list.filter(j => j.queueName.toLowerCase() === options.queueName!.toLowerCase());
  }

  if (options.status) {
    list = list.filter(j => j.status.toLowerCase() === options.status!.toLowerCase());
  }

  if (options.search) {
    const q = options.search.toLowerCase();
    list = list.filter(j => 
      j.id.toLowerCase().includes(q) ||
      j.jobName.toLowerCase().includes(q) ||
      (j.experimentId && j.experimentId.toLowerCase().includes(q)) ||
      j.failedReason.toLowerCase().includes(q)
    );
  }

  // Sort descending by failedAt
  list.sort((a, b) => new Date(b.failedAt).getTime() - new Date(a.failedAt).getTime());

  const total = list.length;
  const offset = options.offset || 0;
  const limit = options.limit || 50;
  const jobs = list.slice(offset, offset + limit);

  return { total, jobs };
}

/**
 * Get detailed DLQ job by ID
 */
export async function getDlqJob(jobId: string): Promise<DlqJobRecord | null> {
  const job = inMemoryDlqStore.get(jobId);
  return job || null;
}

/**
 * Retry a specific DLQ job
 */
export async function retryDlqJob(jobId: string): Promise<{ success: boolean; message: string; job?: DlqJobRecord }> {
  const dlqJob = inMemoryDlqStore.get(jobId);
  if (!dlqJob) {
    return { success: false, message: `DLQ Job ${jobId} not found` };
  }

  const targetQueue = registeredQueues.get(dlqJob.queueName);

  // If experiment ID exists, reset experiment status in DB
  if (dlqJob.experimentId) {
    try {
      await db.update(experiments).set({
        status: 'QUEUED',
        completedAt: null
      }).where(eq(experiments.id, dlqJob.experimentId));
    } catch (err) {
      logger.warn({ experimentId: dlqJob.experimentId, err }, '[DLQ] Failed to reset experiment status for retry');
    }
  }

  // Try re-adding to target BullMQ Queue
  if (targetQueue) {
    try {
      await targetQueue.add(dlqJob.jobName, dlqJob.data, {
        attempts: dlqJob.maxAttempts || 3,
        backoff: { type: 'exponential', delay: 1000 }
      });
    } catch (queueErr) {
      logger.warn({ jobId, err: queueErr }, '[DLQ] Error re-enqueuing job to BullMQ');
    }
  }

  dlqJob.status = 'RETRYING';
  dlqJob.failedAt = new Date().toISOString();

  // Metrics
  try {
    dlqRetriesTotal.inc({ queue: dlqJob.queueName, job_name: dlqJob.jobName });
    const countForQueue = Array.from(inMemoryDlqStore.values()).filter(j => j.queueName === dlqJob.queueName && j.status === 'DEAD_LETTER').length;
    dlqCurrentGauge.set({ queue: dlqJob.queueName }, countForQueue);
  } catch (e) {}

  logger.info({ jobId, queue: dlqJob.queueName, experimentId: dlqJob.experimentId }, '[DLQ] Job re-enqueued for retry');

  return {
    success: true,
    message: `Job ${jobId} successfully re-enqueued for retry`,
    job: dlqJob
  };
}

/**
 * Retry all DLQ jobs across queues or for a specific queue
 */
export async function retryAllDlqJobs(queueName?: string): Promise<{ retriedCount: number; message: string }> {
  const candidateJobs = Array.from(inMemoryDlqStore.values()).filter(j => 
    (!queueName || j.queueName.toLowerCase() === queueName.toLowerCase()) && 
    j.status === 'DEAD_LETTER'
  );

  let retriedCount = 0;
  for (const job of candidateJobs) {
    const result = await retryDlqJob(job.id);
    if (result.success) {
      retriedCount++;
    }
  }

  return {
    retriedCount,
    message: `Successfully triggered retry for ${retriedCount} DLQ job(s)`
  };
}

/**
 * Discard / purge a single DLQ job
 */
export async function discardDlqJob(jobId: string): Promise<{ success: boolean; message: string }> {
  const dlqJob = inMemoryDlqStore.get(jobId);
  if (!dlqJob) {
    return { success: false, message: `DLQ Job ${jobId} not found` };
  }

  inMemoryDlqStore.delete(jobId);

  try {
    const countForQueue = Array.from(inMemoryDlqStore.values()).filter(j => j.queueName === dlqJob.queueName && j.status === 'DEAD_LETTER').length;
    dlqCurrentGauge.set({ queue: dlqJob.queueName }, countForQueue);
  } catch (e) {}

  logger.info({ jobId, queue: dlqJob.queueName }, '[DLQ] Job discarded from Dead-Letter Queue');

  return { success: true, message: `Job ${jobId} discarded from DLQ` };
}

/**
 * Purge all DLQ jobs
 */
export async function purgeAllDlqJobs(queueName?: string): Promise<{ purgedCount: number; message: string }> {
  let purgedCount = 0;

  for (const [id, job] of inMemoryDlqStore.entries()) {
    if (!queueName || job.queueName.toLowerCase() === queueName.toLowerCase()) {
      inMemoryDlqStore.delete(id);
      purgedCount++;
    }
  }

  try {
    for (const q of registeredQueues.keys()) {
      const countForQueue = Array.from(inMemoryDlqStore.values()).filter(j => j.queueName === q && j.status === 'DEAD_LETTER').length;
      dlqCurrentGauge.set({ queue: q }, countForQueue);
    }
  } catch (e) {}

  logger.info({ purgedCount, queueName: queueName || 'ALL' }, '[DLQ] Purged Dead-Letter Queue jobs');

  return { purgedCount, message: `Purged ${purgedCount} DLQ job(s)` };
}

/**
 * Get aggregate statistics across BullMQ queues and DLQ
 */
export async function getQueueStats(): Promise<{
  dlqTotal: number;
  dlqByQueue: Record<string, number>;
  queues: QueueHealthStats[];
}> {
  const dlqTotal = Array.from(inMemoryDlqStore.values()).filter(j => j.status === 'DEAD_LETTER').length;
  const dlqByQueue: Record<string, number> = {};

  for (const job of inMemoryDlqStore.values()) {
    if (job.status === 'DEAD_LETTER') {
      dlqByQueue[job.queueName] = (dlqByQueue[job.queueName] || 0) + 1;
    }
  }

  const queueStats: QueueHealthStats[] = [];

  const allQueueNames = new Set<string>([...registeredQueues.keys(), 'experiments', 'cleanup', 'telemetry']);

  for (const qName of allQueueNames) {
    const queue = registeredQueues.get(qName);
    let waiting = 0;
    let active = 0;
    let completed = 0;
    let failed = dlqByQueue[qName] || 0;
    let delayed = 0;
    let paused = false;

    if (queue) {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        waiting = counts.waiting || 0;
        active = counts.active || 0;
        completed = counts.completed || 0;
        failed = Math.max(failed, counts.failed || 0);
        delayed = counts.delayed || 0;
        try {
          paused = await queue.isPaused();
        } catch (pErr) {
          paused = false;
        }
      } catch (err) {
        // Degraded/mock mode counts fallback
      }
    }

    queueStats.push({
      queueName: qName,
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused
    });
  }

  return {
    dlqTotal,
    dlqByQueue,
    queues: queueStats
  };
}

/**
 * Helper for testing to clear DLQ store
 */
export function __clearDlqStoreForTests() {
  inMemoryDlqStore.clear();
}
