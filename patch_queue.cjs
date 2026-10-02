const fs = require('fs');
let code = fs.readFileSync('src/experiments/queue.ts', 'utf8');
code = `import { Queue } from 'bullmq';
import { redisConnection } from '../redis.js';
import { runExperimentLogic } from './worker.js';

export const experimentQueue = new Queue('experiments', { connection: redisConnection as any });

export async function enqueueExperiment(experimentId: string) {
  try {
    await experimentQueue.add('run-experiment', { experimentId });
  } catch (e) {
    console.error('BullMQ not supported in ioredis-mock, falling back to direct execution for', experimentId);
    setTimeout(() => {
      runExperimentLogic(experimentId).catch(console.error);
    }, 100);
  }
}
`;
fs.writeFileSync('src/experiments/queue.ts', code);
