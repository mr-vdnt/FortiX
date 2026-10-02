import { redisConnection } from '../redis.js';
import { logger } from './logger.js';

export const METRICS_STREAM_KEY = 'fortix:stream:metrics';
export const SECURITY_EVENTS_STREAM_KEY = 'fortix:stream:security';
const MAX_LEN = 10000;

export async function enqueueMetric(metric: any) {
  try {
    await redisConnection.xadd(METRICS_STREAM_KEY, 'MAXLEN', '~', MAX_LEN, '*', 'data', JSON.stringify(metric));
  } catch (err) {
    logger.error({ err }, 'Failed to enqueue metric');
  }
}

export async function enqueueSecurityEvent(event: any) {
  try {
    await redisConnection.xadd(SECURITY_EVENTS_STREAM_KEY, 'MAXLEN', '~', MAX_LEN, '*', 'data', JSON.stringify(event));
  } catch (err) {
    logger.error({ err }, 'Failed to enqueue security event');
  }
}
