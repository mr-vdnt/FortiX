import { redisConnection } from '../redis.js';
import { db } from '../db/index.js';
import { metricLogs, securityEvents } from '../db/schema.js';
import { inArray } from 'drizzle-orm';
import { logger } from './logger.js';

export const METRICS_STREAM_KEY = 'fortix:stream:metrics';
export const SECURITY_EVENTS_STREAM_KEY = 'fortix:stream:security';
export const TELEMETRY_CONSUMER_GROUP = 'fortix:telemetry_group';

const MAX_LEN = 10000;
const DRAIN_BATCH_SIZE = 100;
const MAX_TRACKED_FAILURES = 250;

export interface TelemetryIngestionFailure {
  timestampMs: number;
  kind: 'metric' | 'security';
  id: string;
  persistedToStream: boolean;
  error: string;
}

export interface TelemetrySyncResult {
  synchronized: boolean;
  timedOut: boolean;
  inFlightResolved: number;
  pendingRemaining: number;
  streamDrainedCount: number;
  unpersistedFailures: number;
  durationMs: number;
  error?: string;
}

const inFlightTelemetryOps = new Set<Promise<void>>();
const recentIngestionFailures: TelemetryIngestionFailure[] = [];

function recordIngestionFailure(failure: TelemetryIngestionFailure): void {
  if (recentIngestionFailures.length >= MAX_TRACKED_FAILURES) {
    recentIngestionFailures.shift();
  }
  recentIngestionFailures.push(failure);
}

export function __trackInFlightTelemetryOpForTests(op: Promise<void>): void {
  const tracked = op.catch(() => {}).finally(() => {
    inFlightTelemetryOps.delete(tracked);
  });
  inFlightTelemetryOps.add(tracked);
}

export function __clearTelemetryStateForTests(): void {
  inFlightTelemetryOps.clear();
  recentIngestionFailures.length = 0;
}

export function getInFlightTelemetryCount(): number {
  return inFlightTelemetryOps.size;
}

export async function setupTelemetryConsumerGroup(streamKey: string): Promise<void> {
  if (!redisConnection || typeof (redisConnection as any).xgroup !== 'function') {
    return;
  }
  try {
    await redisConnection.xgroup('CREATE', streamKey, TELEMETRY_CONSUMER_GROUP, '0', 'MKSTREAM');
  } catch (err: any) {
    if (err?.message && (err.message.includes('BUSYGROUP') || err.message.includes('already exists'))) {
      return;
    }
    try {
      const exists = await redisConnection.exists(streamKey);
      if (!exists) {
        await redisConnection.xadd(streamKey, '*', 'init', '1');
      }
      await redisConnection.xgroup('CREATE', streamKey, TELEMETRY_CONSUMER_GROUP, '0');
    } catch (e: any) {
      if (!e?.message?.includes('BUSYGROUP') && !e?.message?.includes('already exists')) {
        logger.debug({ err: e }, `Could not create consumer group for ${streamKey}`);
      }
    }
  }
}

export async function processTelemetryStreamBatch(
  streamKey: string,
  table: typeof metricLogs | typeof securityEvents,
  entries: any[]
): Promise<number> {
  const records: any[] = [];
  const idsToAck: string[] = [];

  for (const entry of entries) {
    const streamId = entry[0];
    const fields = entry[1];

    let dataStr: string | null = null;
    if (Array.isArray(fields)) {
      for (let i = 0; i < fields.length; i += 2) {
        if (fields[i] === 'data') {
          dataStr = fields[i + 1];
          break;
        }
      }
    }

    if (dataStr) {
      try {
        const raw = JSON.parse(dataStr);
        if (table === securityEvents) {
          records.push({
            id: raw.id,
            routeId: raw.routeId,
            requestId: raw.requestId || null,
            threatType: raw.threatType || raw.type || 'SUSPICIOUS_ACTIVITY',
            payload: raw.payload || {
              severity: raw.severity || 'HIGH',
              action: raw.action || 'BLOCKED',
              sourceIp: raw.sourceIp || 'unknown',
            },
            timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
          });
        } else {
          records.push({
            id: raw.id,
            routeId: raw.routeId,
            experimentId: raw.experimentId || null,
            requestId: raw.requestId || null,
            latencyMs: Number(raw.latencyMs),
            statusCode: Number(raw.statusCode),
            timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
          });
        }
      } catch {
        logger.error({ streamId }, 'Malformed telemetry data in stream, skipping');
      }
    }
    idsToAck.push(streamId);
  }

  if (records.length > 0) {
    await db.transaction(async (tx) => {
      await tx.insert(table as any).values(records).onConflictDoNothing().execute();
    });
  }

  if (idsToAck.length > 0 && typeof (redisConnection as any).xack === 'function') {
    await redisConnection.xack(streamKey, TELEMETRY_CONSUMER_GROUP, ...idsToAck);
  }

  return records.length;
}

export async function drainTelemetryStreamsOnce(
  maxBatches = 25,
  consumerName = `barrier-${process.pid}`
): Promise<{ drainedCount: number; error?: string }> {
  if (!redisConnection || typeof (redisConnection as any).xreadgroup !== 'function') {
    return { drainedCount: 0 };
  }

  let drainedCount = 0;

  try {
    await setupTelemetryConsumerGroup(METRICS_STREAM_KEY);
    await setupTelemetryConsumerGroup(SECURITY_EVENTS_STREAM_KEY);

    const streamSpecs: Array<{ key: string; table: typeof metricLogs | typeof securityEvents }> = [
      { key: METRICS_STREAM_KEY, table: metricLogs },
      { key: SECURITY_EVENTS_STREAM_KEY, table: securityEvents },
    ];

    for (const spec of streamSpecs) {
      for (const cursor of ['0', '>'] as const) {
        for (let batch = 0; batch < maxBatches; batch++) {
          const res = await redisConnection.xreadgroup(
            'GROUP',
            TELEMETRY_CONSUMER_GROUP,
            consumerName,
            'COUNT',
            DRAIN_BATCH_SIZE,
            'STREAMS',
            spec.key,
            cursor
          );

          if (!res || !Array.isArray(res) || res.length === 0) {
            break;
          }
          const entries = (res as any)[0]?.[1];
          if (!Array.isArray(entries) || entries.length === 0) {
            break;
          }

          drainedCount += await processTelemetryStreamBatch(spec.key, spec.table, entries);
          if (entries.length < DRAIN_BATCH_SIZE) {
            break;
          }
        }
      }
    }

    return { drainedCount };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (
      msg.includes('NOGROUP') ||
      msg.includes('no such key') ||
      msg.includes('unknown command') ||
      msg.includes('ERR unknown command')
    ) {
      return { drainedCount };
    }
    logger.error({ err }, 'Telemetry stream drain barrier encountered error');
    return { drainedCount, error: msg };
  }
}

export function enqueueMetric(metric: any): Promise<void> {
  const eventTimestamp = metric?.timestamp ? new Date(metric.timestamp) : new Date();
  const payload = {
    ...metric,
    timestamp: eventTimestamp.toISOString(),
  };

  const op = (async () => {
    let persistedToStream = false;
    try {
      if (redisConnection && typeof (redisConnection as any).xadd === 'function') {
        await redisConnection.xadd(METRICS_STREAM_KEY, 'MAXLEN', '~', MAX_LEN, '*', 'data', JSON.stringify(payload));
        persistedToStream = true;
      }
    } catch (err) {
      logger.error({ err }, 'Failed to enqueue metric to Redis stream');
    }

    try {
      await db
        .insert(metricLogs)
        .values({
          id: metric.id,
          routeId: metric.routeId,
          experimentId: metric.experimentId || null,
          requestId: metric.requestId || null,
          latencyMs: metric.latencyMs,
          statusCode: metric.statusCode,
          timestamp: eventTimestamp,
        })
        .onConflictDoNothing();
    } catch (dbErr: any) {
      recordIngestionFailure({
        timestampMs: Date.now(),
        kind: 'metric',
        id: String(metric?.id || ''),
        persistedToStream,
        error: dbErr?.message || String(dbErr),
      });
    }
  })();

  const tracked = op.finally(() => {
    inFlightTelemetryOps.delete(tracked);
  });
  inFlightTelemetryOps.add(tracked);
  return tracked;
}

export function enqueueSecurityEvent(event: any): Promise<void> {
  const eventTimestamp = event?.timestamp ? new Date(event.timestamp) : new Date();
  const payload = {
    ...event,
    timestamp: eventTimestamp.toISOString(),
  };

  const op = (async () => {
    let persistedToStream = false;
    try {
      if (redisConnection && typeof (redisConnection as any).xadd === 'function') {
        await redisConnection.xadd(
          SECURITY_EVENTS_STREAM_KEY,
          'MAXLEN',
          '~',
          MAX_LEN,
          '*',
          'data',
          JSON.stringify(payload)
        );
        persistedToStream = true;
      }
    } catch (err) {
      logger.error({ err }, 'Failed to enqueue security event to Redis stream');
    }

    try {
      await db
        .insert(securityEvents)
        .values({
          id: event.id,
          routeId: event.routeId,
          requestId: event.requestId || null,
          threatType: event.threatType || event.type || 'SUSPICIOUS_ACTIVITY',
          payload: event,
          timestamp: eventTimestamp,
        })
        .onConflictDoNothing();
    } catch (dbErr: any) {
      recordIngestionFailure({
        timestampMs: Date.now(),
        kind: 'security',
        id: String(event?.id || ''),
        persistedToStream,
        error: dbErr?.message || String(dbErr),
      });
    }
  })();

  const tracked = op.finally(() => {
    inFlightTelemetryOps.delete(tracked);
  });
  inFlightTelemetryOps.add(tracked);
  return tracked;
}

/**
 * Deterministically awaits all in-flight gateway telemetry writes and drains any
 * buffered Redis stream entries into PostgreSQL before verification queries run.
 * Bounded by `timeoutMs` with zero arbitrary sleep delays.
 */
export async function flushTelemetryBarrier(options?: {
  timeoutMs?: number;
  since?: Date;
}): Promise<TelemetrySyncResult> {
  const timeoutMs = Math.max(10, options?.timeoutMs ?? 3000);
  const startMs = Date.now();
  const windowSinceMs = options?.since ? options.since.getTime() - 1000 : startMs - 60000;

  let inFlightResolved = 0;
  let streamDrainedCount = 0;
  let drainError: string | undefined;
  let timedOut = false;

  const work = (async () => {
    let safetyPasses = 0;
    while (inFlightTelemetryOps.size > 0 && safetyPasses < 20) {
      safetyPasses++;
      const batch = Array.from(inFlightTelemetryOps);
      await Promise.allSettled(batch);
      inFlightResolved += batch.length;
    }

    const drainRes = await drainTelemetryStreamsOnce();
    streamDrainedCount = drainRes.drainedCount;
    drainError = drainRes.error;
  })();

  let timer: NodeJS.Timeout | undefined;
  const timeoutSentinel = new Promise<'TIMEOUT'>((resolve) => {
    timer = setTimeout(() => resolve('TIMEOUT'), timeoutMs);
    timer.unref?.();
  });

  try {
    const outcome = await Promise.race([work.then(() => 'DONE' as const), timeoutSentinel]);
    if (outcome === 'TIMEOUT') {
      timedOut = true;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  const durationMs = Date.now() - startMs;
  const pendingRemaining = inFlightTelemetryOps.size;

  if (timedOut) {
    return {
      synchronized: false,
      timedOut: true,
      inFlightResolved,
      pendingRemaining,
      streamDrainedCount,
      unpersistedFailures: 0,
      durationMs,
      error: `Telemetry synchronization barrier timed out after ${timeoutMs}ms (${pendingRemaining} operations still pending)`,
    };
  }

  // Verify whether any direct-DB dual-write failures in the observation window remained unpersisted after stream drain
  const candidateFailures = recentIngestionFailures.filter((f) => f.timestampMs >= windowSinceMs);
  let unpersistedFailures = 0;
  let failureReason: string | undefined = drainError;

  if (candidateFailures.length > 0) {
    const metricFailIds = candidateFailures.filter((f) => f.kind === 'metric' && f.id).map((f) => f.id);
    const secFailIds = candidateFailures.filter((f) => f.kind === 'security' && f.id).map((f) => f.id);
    const idlessFailures = candidateFailures.filter((f) => !f.id).length;
    unpersistedFailures += idlessFailures;

    try {
      if (metricFailIds.length > 0) {
        const recovered = await db
          .select({ id: metricLogs.id })
          .from(metricLogs)
          .where(inArray(metricLogs.id, metricFailIds));
        const recoveredSet = new Set(recovered.map((r) => r.id));
        for (const id of metricFailIds) {
          if (!recoveredSet.has(id)) {
            unpersistedFailures++;
          }
        }
      }
      if (secFailIds.length > 0) {
        const recovered = await db
          .select({ id: securityEvents.id })
          .from(securityEvents)
          .where(inArray(securityEvents.id, secFailIds));
        const recoveredSet = new Set(recovered.map((r) => r.id));
        for (const id of secFailIds) {
          if (!recoveredSet.has(id)) {
            unpersistedFailures++;
          }
        }
      }
    } catch (verifyErr: any) {
      unpersistedFailures = Math.max(1, candidateFailures.length);
      failureReason = failureReason || verifyErr?.message || String(verifyErr);
    }

    if (unpersistedFailures > 0 && !failureReason) {
      failureReason = candidateFailures[candidateFailures.length - 1]?.error || 'Telemetry persistence failure';
    }
  }

  const synchronized = !timedOut && pendingRemaining === 0 && !drainError && unpersistedFailures === 0;

  return {
    synchronized,
    timedOut: false,
    inFlightResolved,
    pendingRemaining,
    streamDrainedCount,
    unpersistedFailures,
    durationMs,
    ...(failureReason ? { error: failureReason } : {}),
  };
}
