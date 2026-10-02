echo "experimentQueue.on('error', (err) => { console.error('[BullMQ Queue] Error:', err.message); });" >> src/experiments/queue.ts
echo "experimentWorker.on('error', (err) => { console.error('[BullMQ Worker] Error:', err.message); });" >> src/experiments/worker.ts
