const fs = require('fs');

let apiCode = fs.readFileSync('src/api/experiments.ts', 'utf8');

apiCode = apiCode.replace(
  "import { runExperimentLogic } from '../experiments/worker.js';",
  "import { enqueueExperiment } from '../experiments/queue.js';"
);

apiCode = apiCode.replace(
  "    // Asynchronous worker invocation\n    setTimeout(() => {\n      runExperimentLogic(exp.id).catch(console.error);\n    }, 100);",
  "    // Durable worker invocation via BullMQ\n    await enqueueExperiment(exp.id);"
);

fs.writeFileSync('src/api/experiments.ts', apiCode);

// create queue.ts
const queueCode = `import { Queue } from 'bullmq';
import { redisConnection } from '../redis.js';

export const experimentQueue = new Queue('experiments', { connection: redisConnection as any });

export async function enqueueExperiment(experimentId: string) {
  await experimentQueue.add('run-experiment', { experimentId });
}
`;
fs.writeFileSync('src/experiments/queue.ts', queueCode);

let workerCode = fs.readFileSync('src/worker.ts', 'utf8');
workerCode = workerCode.replace("import { metricLogs } from './db/schema.js';", "import { metricLogs, experiments } from './db/schema.js';\nimport { runExperimentLogic } from './experiments/worker.js';\nimport { eq, and, lt } from 'drizzle-orm';");
workerCode = workerCode.replace(
  "const cleanupQueue = new Queue('cleanup', { connection: redisConnection });",
  "const cleanupQueue = new Queue('cleanup', { connection: redisConnection as any });\nconst experimentWorker = new Worker('experiments', async job => {\n  if (job.name === 'run-experiment') {\n    await runExperimentLogic(job.data.experimentId);\n  }\n}, { connection: redisConnection as any });"
);

workerCode = workerCode.replace(
  "// Using 'any' cast to bypass BullMQ typescript version mismatches for JobsOptions",
  "cleanupQueue.add('reaper', {}, { repeat: { pattern: '*/5 * * * *' } } as any);\n// Using 'any' cast to bypass BullMQ typescript version mismatches for JobsOptions"
);

workerCode = workerCode.replace(
  "    console.log('Cleaned up telemetry older than 7 days');\n  }",
  "    console.log('Cleaned up telemetry older than 7 days');\n  } else if (job.name === 'reaper') {\n    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);\n    const result = await db.update(experiments).set({ status: 'FAILED' })\n      .where(and(eq(experiments.status, 'RUNNING'), lt(experiments.startedAt, fiveMinsAgo)));\n    console.log('Reaped orphaned experiments');\n  }"
);

fs.writeFileSync('src/worker.ts', workerCode);
