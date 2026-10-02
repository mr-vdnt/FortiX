const fs = require('fs');

const code = `import { redisConnection } from './redis.js';
import { db } from './db/index.js';
import { metricLogs, securityEvents } from './db/schema.js';
import { logger } from './lib/logger.js';
import { METRICS_BUFFER_KEY, SECURITY_EVENTS_BUFFER_KEY } from './lib/telemetry.js';

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 2000;

let isRunning = true;

export async function processTelemetryBatch() {
  logger.info('Telemetry worker started');
  
  while (isRunning) {
    try {
      // Process Metrics
      const metrics = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const item = await redisConnection.lpop(METRICS_BUFFER_KEY);
        if (!item) break;
        metrics.push(JSON.parse(item));
      }

      if (metrics.length > 0) {
        await db.insert(metricLogs).values(metrics).execute();
        logger.debug({ count: metrics.length }, \`Flushed metrics to DB\`);
      }

      // Process Security Events
      const events = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const item = await redisConnection.lpop(SECURITY_EVENTS_BUFFER_KEY);
        if (!item) break;
        events.push(JSON.parse(item));
      }

      if (events.length > 0) {
        await db.insert(securityEvents).values(events).execute();
        logger.debug({ count: events.length }, \`Flushed security events to DB\`);
      }

    } catch (err) {
      logger.error({ err }, 'Error processing telemetry batch');
    }
    
    // Wait before polling again, unless stopping
    if (isRunning) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  
  logger.info('Telemetry worker stopped');
}

export function stopWorker() {
  isRunning = false;
}

// Automatically start when imported
processTelemetryBatch().catch(err => logger.error({ err }, 'Telemetry worker crashed'));
`;
fs.writeFileSync('src/telemetry-worker.ts', code);
