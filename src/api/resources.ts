import express from 'express';
import os from 'os';
import { requireProjectOwnership } from './projects.js';

export const resourcesRouter = express.Router();

let resourceHistory: any[] = [];

// Record resource usage periodically
setInterval(() => {
  const memUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  
  const point = {
    timestamp: new Date().toISOString(),
    cpu: os.loadavg()[0] * 10, // simplified CPU metric
    memory: ((totalMem - freeMem) / totalMem) * 100, // percentage
    heap: (memUsage.heapUsed / memUsage.heapTotal) * 100
  };
  
  resourceHistory.push(point);
  if (resourceHistory.length > 24) {
    resourceHistory.shift();
  }
}, 5000);

resourcesRouter.get('/', requireProjectOwnership, (req, res) => {
  res.json(resourceHistory);
});
