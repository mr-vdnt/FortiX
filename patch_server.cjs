const fs = require('fs');

const code = `import { stopWorker } from './src/telemetry-worker.js';
import './demo-api.js';
import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { setupApiRoutes } from './src/api/index.js';
import { setupGateway } from './src/gateway/index.js';
import { setupWebSockets } from './src/socket.js';
import http from 'http';
import { db } from './src/db/index.js';
import { redisConnection } from './src/redis.js';
import { sql } from 'drizzle-orm';

// Handle uncaught exceptions and unhandled rejections gracefully
process.on('uncaughtException', (err) => {
  if (err.message && err.message.includes('ECONNREFUSED')) return;
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason: any) => {
  if (reason && reason.message && reason.message.includes('ECONNREFUSED')) return;
  console.error('Unhandled Rejection:', reason);
});

let isShuttingDown = false;

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  // Health checks
  app.get('/health/live', (req, res) => {
    if (isShuttingDown) {
      return res.status(503).json({ status: 'shutting_down' });
    }
    res.status(200).json({ status: 'ok' });
  });

  app.get('/health/ready', async (req, res) => {
    if (isShuttingDown) {
      return res.status(503).json({ status: 'shutting_down' });
    }
    
    let dbStatus = 'ok';
    let redisStatus = 'ok';

    try {
      await db.execute(sql\`SELECT 1\`);
    } catch (e) {
      dbStatus = 'error';
    }

    try {
      await redisConnection.ping();
    } catch (e) {
      redisStatus = 'error';
    }

    if (dbStatus === 'error' || redisStatus === 'error') {
      res.status(503).json({ status: 'error', db: dbStatus, redis: redisStatus });
    } else {
      res.status(200).json({ status: 'ok', db: dbStatus, redis: redisStatus });
    }
  });

  const server = http.createServer(app);
  setupWebSockets(server);

  app.use(cors());
  app.use(express.json());

  setupApiRoutes(app);
  setupGateway(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, () => {
    console.log(\`FortiX Server running on http://0.0.0.0:\${PORT}\`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('Received shutdown signal, starting graceful shutdown...');

    stopWorker();
    
    server.close(async () => {
      console.log('HTTP server closed.');
      try {
        await redisConnection.quit();
        console.log('Redis connection closed.');
      } catch (e) {
        console.error('Error closing Redis connection:', e);
      }
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch(console.error);
`;
fs.writeFileSync('server.ts', code);
