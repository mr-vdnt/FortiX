import { redisConnection, isManagedServerlessRedis } from './redis.js';
import { metricLogs, securityEvents } from './db/schema.js';
import { logger } from './lib/logger.js';
import {
  METRICS_STREAM_KEY,
  SECURITY_EVENTS_STREAM_KEY,
  TELEMETRY_CONSUMER_GROUP,
  setupTelemetryConsumerGroup,
  processTelemetryStreamBatch,
  drainTelemetryStreamsOnce,
} from './lib/telemetry.js';

export { drainTelemetryStreamsOnce };

const CONSUMER_GROUP = TELEMETRY_CONSUMER_GROUP;
const CONSUMER_NAME = process.env.HOSTNAME || 'worker-' + process.pid;
const BATCH_SIZE = 100;
const BLOCK_TIMEOUT_MS = isManagedServerlessRedis ? 5000 : 2000;
const IDLE_SLEEP_MS = isManagedServerlessRedis ? 20000 : 1000;

let isRunning = true;
let wakeIdleSleep: (() => void) | null = null;
let activeLoopPromise: Promise<void> | null = null;

function interruptibleSleep(ms: number): Promise<void> {
  if (!isRunning) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeIdleSleep = null;
      resolve();
    }, ms);
    timer.unref?.();
    wakeIdleSleep = () => {
      clearTimeout(timer);
      wakeIdleSleep = null;
      resolve();
    };
  });
}

const setupConsumerGroup = setupTelemetryConsumerGroup;
const processBatch = processTelemetryStreamBatch;

async function processPending(streamKey: string, table: typeof metricLogs | typeof securityEvents) {
  try {
    const res = await redisConnection.xreadgroup(
      'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
      'COUNT', BATCH_SIZE,
      'STREAMS', streamKey,
      '0' // '0' means read pending messages for this consumer
    );
    if (res && res.length > 0) {
      const entries = (res as any)[0][1];
      if (entries.length > 0) {
        await processBatch(streamKey, table, entries);
      }
    }
  } catch (err: any) {
    if (err?.message && (err.message.includes('NOGROUP') || err.message.includes('no such key'))) {
      await setupConsumerGroup(streamKey);
    } else {
      logger.error({ err }, `Error processing pending for ${streamKey}`);
    }
  }
}

export function processTelemetryBatch(): Promise<void> {
  if (activeLoopPromise) return activeLoopPromise;
  isRunning = true;

  activeLoopPromise = (async () => {
    logger.info('Telemetry worker started');

    await setupConsumerGroup(METRICS_STREAM_KEY);
    await setupConsumerGroup(SECURITY_EVENTS_STREAM_KEY);

    // Initial pending recovery
    await processPending(METRICS_STREAM_KEY, metricLogs);
    await processPending(SECURITY_EVENTS_STREAM_KEY, securityEvents);

    while (isRunning) {
      try {
        const res = await redisConnection.xreadgroup(
          'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
          'COUNT', BATCH_SIZE,
          'BLOCK', BLOCK_TIMEOUT_MS,
          'STREAMS', METRICS_STREAM_KEY, SECURITY_EVENTS_STREAM_KEY,
          '>', '>'
        );

        let hadEntries = false;
        if (res && Array.isArray(res) && res.length > 0) {
          for (const streamRes of res as any) {
            const streamKey = streamRes[0];
            const entries = streamRes[1];
            if (entries && entries.length > 0) {
              hadEntries = true;
              const table = streamKey === METRICS_STREAM_KEY ? metricLogs : securityEvents;
              await processBatch(streamKey, table, entries);
            }
          }
        }

        if (!hadEntries && isRunning) {
          await interruptibleSleep(IDLE_SLEEP_MS);
        }
      } catch (err: any) {
        if (!isRunning) break;
        const errMsg = err?.message || '';
        if (errMsg.includes('NOGROUP') || errMsg.includes('no such key')) {
          logger.warn('Consumer group or stream missing (NOGROUP). Re-creating consumer groups...');
          await setupConsumerGroup(METRICS_STREAM_KEY);
          await setupConsumerGroup(SECURITY_EVENTS_STREAM_KEY);
        } else if (
          errMsg.includes('ECONNREFUSED') ||
          errMsg.includes('NR_CLOSED') ||
          errMsg.includes('Connection is closed') ||
          errMsg.includes('EAI_AGAIN') ||
          errMsg.includes('getaddrinfo') ||
          errMsg.includes('ENOTFOUND')
        ) {
          // Connection temporarily lost or closing
        } else {
          logger.error({ err }, 'Error processing telemetry batch');
        }
        if (isRunning) {
          await interruptibleSleep(1000);
        }
      }
    }

    logger.info('Telemetry worker stopped');
  })().finally(() => {
    activeLoopPromise = null;
  });

  return activeLoopPromise;
}

export function stopWorker(): void {
  isRunning = false;
  wakeIdleSleep?.();
}

export async function stopTelemetryWorker(timeoutMs = 2500): Promise<void> {
  stopWorker();
  if (!activeLoopPromise) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    activeLoopPromise.catch(() => {}),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    }),
  ]);
  if (timer) clearTimeout(timer);
}
