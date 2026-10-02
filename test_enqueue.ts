import { enqueueExperiment } from './src/experiments/queue.js';
enqueueExperiment('test-id').then(() => console.log('success')).catch(e => console.error('ERR:', e));
