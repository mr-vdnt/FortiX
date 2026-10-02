import './demo-api.js';
import './src/worker.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { setupApiRoutes } from './src/api/index.js';
import { setupGateway } from './src/gateway/index.js';
import { setupWebSockets } from './src/socket.js';
import http from 'http';
import { db } from './src/db/index.js';
import { initDatabase } from './src/db/init.js';
import { redisConnection } from './src/redis.js';
import { sql } from 'drizzle-orm';
import { getDependenciesHealth } from './src/api/system.js';

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

// Production Security Guardrail
if (process.env.NODE_ENV === 'production') {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'dev_secret_key' || secret.length < 16) {
    console.warn('[SECURITY WARNING] Production mode detected with default or short JWT_SECRET. Ensure strong secret is set in production deployment.');
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  
  // Health checks
  app.get('/health/live', (req, res) => {
    if (isShuttingDown) {
      return res.status(503).json({ status: 'shutting_down' });
    }
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/health/ready', async (req, res) => {
    if (isShuttingDown) {
      return res.status(503).json({ status: 'shutting_down' });
    }
    const health = await getDependenciesHealth();
    if (health.status !== 'healthy') {
      return res.status(503).json({ status: 'degraded', postgres: health.postgres.status, redis: health.redis.status });
    }
    res.status(200).json({ status: 'ok', postgres: health.postgres.status, redis: health.redis.status });
  });

  app.get('/health/dependencies', async (req, res) => {
    const health = await getDependenciesHealth();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  });

  app.get('/health', async (req, res) => {
    const health = await getDependenciesHealth();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  });

  const server = http.createServer(app);
  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.warn(`[Server] Port ${PORT} already in use. Retrying in 1s...`);
      setTimeout(() => {
        try {
          server.listen(PORT, '0.0.0.0');
        } catch {}
      }, 1000);
    } else {
      console.error('[Server] Fatal server error:', err);
    }
  });

  setupWebSockets(server);

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  setupApiRoutes(app);
  setupGateway(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
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

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`FortiX Server running on http://0.0.0.0:${PORT}`);
  });

  // Run migrations without blocking the initial TCP probe listener
  initDatabase().catch((err) => {
    console.warn('[Database] Initial startup migration warning:', err?.message || err);
  });

  // Graceful shutdown
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('Received shutdown signal, starting graceful shutdown...');

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
