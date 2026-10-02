import os

content = """import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import * as dotenv from 'dotenv';
import { db } from './db/index.js';
import { sql } from 'drizzle-orm';

dotenv.config({ override: true });

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
connection.on('error', (err: any) => {
  if (err.message && err.message.includes('ECONNREFUSED')) return;
  console.error('[Redis Worker] Error:', err.message);
});

const cleanupQueue = new Queue('cleanupQueue', { connection });

// Schedule a repeatable job for database cleanup every hour
cleanupQueue.add('telemetry-ttl', {}, {
  repeat: {
    pattern: '0 * * * *', // every hour
  }
}).catch(err => console.error('Failed to schedule TTL job:', err));

const experimentWorker = new Worker(
  'experimentQueue',
  async (job) => {
    console.log(`Processing experiment job ${job.id}`);
  },
  { connection }
);

const cleanupWorker = new Worker(
  'cleanupQueue',
  async (job) => {
    if (job.name === 'telemetry-ttl') {
      console.log('Running Telemetry TTL Cleanup Job...');
      try {
        // Delete logs older than 7 days
        const result = await db.execute(sql`DELETE FROM metric_logs WHERE timestamp < NOW() - INTERVAL '7 days'`);
        console.log(`Deleted old telemetry rows successfully.`);
      } catch (err) {
        console.error('Error during telemetry TTL cleanup:', err);
      }
    }
  },
  { connection }
);

experimentWorker.on('completed', (job) => console.log(`Job ${job.id} completed!`));
experimentWorker.on('failed', (job, err) => console.log(`Job ${job?.id} failed:`, err));
cleanupWorker.on('completed', (job) => console.log(`Cleanup Job ${job.id} completed!`));
cleanupWorker.on('failed', (job, err) => console.log(`Cleanup Job ${job?.id} failed:`, err));

console.log('FortiX BullMQ Worker & TTL Cleanup started.');
"""

with open('src/worker.ts', 'w') as f:
    f.write(content)

print("worker.ts patched with TTL cleanup job")
