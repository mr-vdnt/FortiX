import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import cors from 'cors';
import http from 'http';
import { isAiStudioDevPreview, resolveGatewayPort } from './src/lib/port.js';
import { isOriginAllowed, resolveRequestHost } from './src/lib/cors-csrf.js';
import { buildReadinessPayload, evaluateReadinessContract } from './src/lib/readiness.js';
import {
  captureTrackedError,
  apiGlobalErrorHandler,
  incrementUncaughtErrorCount,
  getUncaughtErrorCount,
} from './src/lib/error-tracker.js';

// Deliberate process-level exception & rejection handling (no silent ECONNREFUSED suppression)
process.on('uncaughtException', (err) => {
  incrementUncaughtErrorCount();
  captureTrackedError({
    source: 'server',
    code: 'UNCAUGHT_EXCEPTION',
    statusCode: 500,
    message: err?.message || String(err),
  });
  if (process.env.STRICT_FATAL_UNCAUGHT === 'true') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason: any) => {
  incrementUncaughtErrorCount();
  captureTrackedError({
    source: 'server',
    code: 'UNHANDLED_REJECTION',
    statusCode: 500,
    message: reason?.message || String(reason),
  });
});

let isShuttingDown = false;

// Production Security Guardrails
export function validateProductionJwtSecret(secret?: string): { valid: boolean; reason?: string } {
  if (!secret || typeof secret !== 'string') {
    return { valid: false, reason: 'JWT_SECRET is missing or empty' };
  }
  if (secret.length < 32) {
    return { valid: false, reason: 'JWT_SECRET must be at least 32 characters long' };
  }
  const disallowedDefaults = [
    'dev_secret_key',
    'secret',
    'changeme',
    'production-secret-change-me',
    'password',
    'fortix_secret',
    '12345678901234567890123456789012',
    'abcdefghijklmnopqrstuvwxyz123456',
  ];
  if (disallowedDefaults.includes(secret.toLowerCase())) {
    return { valid: false, reason: 'JWT_SECRET contains a known development placeholder or default password' };
  }
  const distinctChars = new Set(secret).size;
  if (distinctChars < 8) {
    return { valid: false, reason: 'JWT_SECRET has insufficient entropy (fewer than 8 distinct characters)' };
  }
  return { valid: true };
}

export function resolveServerPort(argv = process.argv, env = process.env): number {
  return resolveGatewayPort(argv, env);
}

export interface PortBindOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

export function listenWithBoundedRetry(
  server: http.Server,
  port: number,
  host = '0.0.0.0',
  options: PortBindOptions = {}
): Promise<void> {
  const envRetries =
    process.env.PORT_BIND_MAX_RETRIES !== undefined
      ? Number.parseInt(process.env.PORT_BIND_MAX_RETRIES, 10)
      : NaN;
  const envDelay =
    process.env.PORT_BIND_RETRY_DELAY_MS !== undefined
      ? Number.parseInt(process.env.PORT_BIND_RETRY_DELAY_MS, 10)
      : NaN;

  const maxRetries = options.maxRetries ?? (Number.isFinite(envRetries) && envRetries >= 0 ? envRetries : 2);
  const retryDelayMs = options.retryDelayMs ?? (Number.isFinite(envDelay) && envDelay >= 0 ? envDelay : 400);

  return new Promise<void>((resolve, reject) => {
    let attempt = 0;

    const tryBind = () => {
      const onListening = () => {
        server.removeListener('error', onStartupError);
        server.on('error', (runtimeErr: any) => {
          console.error('[Server] Fatal runtime server error:', runtimeErr);
        });
        console.log(`FortiX Server listening on http://${host}:${port}`);
        resolve();
      };

      const onStartupError = (err: any) => {
        server.removeListener('listening', onListening);
        if (err?.code === 'EADDRINUSE' && attempt < maxRetries) {
          attempt += 1;
          console.warn(
            `[Server] Port ${port} already in use (retry ${attempt}/${maxRetries} in ${retryDelayMs}ms)...`
          );
          setTimeout(tryBind, retryDelayMs);
          return;
        }

        if (err?.code === 'EADDRINUSE') {
          const bindError = new Error(
            `[Server] Failed to bind http://${host}:${port} after ${attempt + 1} attempt(s): port ${port} is already in use (EADDRINUSE). Terminate the conflicting listener or configure an available PORT.`
          ) as Error & { code?: string };
          bindError.code = 'EADDRINUSE';
          reject(bindError);
          return;
        }

        reject(err);
      };

      server.once('listening', onListening);
      server.once('error', onStartupError);
      try {
        server.listen(port, host);
      } catch (syncErr) {
        server.removeListener('listening', onListening);
        server.removeListener('error', onStartupError);
        reject(syncErr);
      }
    };

    tryBind();
  });
}

export interface GracefulShutdownResources {
  server?: (Pick<http.Server, 'close'> & { listening?: boolean; closeIdleConnections?: () => void }) | null;
  closeWebSockets?: (() => Promise<void>) | null;
  viteClose?: (() => Promise<void>) | null;
  closeDemoApi?: (() => Promise<void>) | null;
  shutdownWorkers?: (() => Promise<void>) | null;
  closeExperimentQueue?: (() => Promise<void>) | null;
  closeKeyRevocationClients?: (() => Promise<void>) | null;
  closeRedisConnection?: (() => Promise<void>) | null;
  closeDatabaseConnection?: (() => Promise<void>) | null;
}

export async function executeGracefulShutdown(
  resources: GracefulShutdownResources
): Promise<{ errors: string[] }> {
  const errors: string[] = [];

  const runStep = async (name: string, fn?: (() => Promise<void>) | null) => {
    if (!fn) return;
    try {
      await fn();
    } catch (err: any) {
      const msg = `${name}: ${err?.message || String(err)}`;
      errors.push(msg);
      console.error(`[Shutdown] Error closing ${name}:`, err);
    }
  };

  await runStep('websockets', resources.closeWebSockets);

  if (resources.server) {
    await runStep('httpServer', async () => {
      if (resources.server?.listening === false) return;
      await new Promise<void>((resolve, reject) => {
        try {
          resources.server?.closeIdleConnections?.();
          resources.server!.close((err?: Error & { code?: string }) => {
            if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
              return reject(err);
            }
            resolve();
          });
        } catch (err: any) {
          if (err?.code === 'ERR_SERVER_NOT_RUNNING') {
            return resolve();
          }
          reject(err);
        }
      });
    });
  }

  await runStep('viteDevServer', resources.viteClose);
  await runStep('demoApiServer', resources.closeDemoApi);
  await runStep('workers', resources.shutdownWorkers);
  await runStep('experimentQueue', resources.closeExperimentQueue);
  await runStep('keyRevocationPubSub', resources.closeKeyRevocationClients);
  await runStep('redisConnection', resources.closeRedisConnection);
  await runStep('databaseConnection', resources.closeDatabaseConnection);

  return { errors };
}

if (process.env.NODE_ENV === 'production') {
  const validation = validateProductionJwtSecret(process.env.JWT_SECRET);
  if (!validation.valid) {
    if (process.env.STRICT_PRODUCTION_SECRETS === 'true') {
      console.error(`[SECURITY FATAL] Production startup rejected: ${validation.reason}.`);
      process.exit(1);
    }
    const generatedSecret = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET = generatedSecret;
    console.warn(
      `[Security] JWT_SECRET not configured (${validation.reason}); generated cryptographically strong 256-bit ephemeral secret for this instance.`
    );
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const PORT = resolveServerPort();

  // Immediate liveness probes before heavy module/Vite initialization so Cloud Run startup checks succeed immediately
  const livenessHandler: express.RequestHandler = (_req, res) => {
    if (isShuttingDown) {
      return res.status(503).json({ status: 'shutting_down' });
    }
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  };
  app.get('/health/live', livenessHandler);
  app.get('/api/health/live', livenessHandler);
  app.get('/_ah/health', livenessHandler);

  app.use((req, res, next) => {
    const reqHost = resolveRequestHost(req);
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, reqHost)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
    })(req, res, next);
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const server = http.createServer(app);

  // Bind TCP listener with bounded retry so cold-boot probes succeed while occupied-port conflicts fail fast
  await listenWithBoundedRetry(server, PORT, '0.0.0.0');

  // Dynamic router populated asynchronously; in-flight requests await bootstrapPromise seamlessly
  const runtimeRouter = express.Router();
  const shutdownResources: GracefulShutdownResources = { server };
  let backgroundStartupTimer: NodeJS.Timeout | null = null;

  const bootstrapPromise = (async () => {
    const distPath = path.join(process.cwd(), 'dist');
    const useCompiledSpa =
      !isAiStudioDevPreview(process.env) &&
      (process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE)) &&
      fs.existsSync(path.join(distPath, 'index.html'));

    const vitePromise = !useCompiledSpa
      ? (async () => {
          if (process.env.DISABLE_HMR === undefined) {
            process.env.DISABLE_HMR = 'true';
          }
          const { createServer: createViteServer } = await import('vite');
          return createViteServer({
            server: {
              middlewareMode: true,
              hmr: false,
              ws: false,
              watch: null,
            },
            appType: 'spa',
          });
        })()
      : Promise.resolve(null);

    const [
      { setupWebSockets, closeWebSockets },
      { getDependenciesHealth },
      { setupApiRoutes },
      { setupGateway },
      { initDatabase },
      { closeDatabaseConnection },
      { closeRedisConnection },
      { closeExperimentQueue },
      { closeKeyRevocationClients },
      vite,
    ] = await Promise.all([
      import('./src/socket.js'),
      import('./src/api/system.js'),
      import('./src/api/index.js'),
      import('./src/gateway/index.js'),
      import('./src/db/init.js'),
      import('./src/db/index.js'),
      import('./src/redis.js'),
      import('./src/experiments/queue.js'),
      import('./src/lib/key-invalidation.js'),
      vitePromise,
    ]);

    shutdownResources.closeWebSockets = closeWebSockets;
    shutdownResources.viteClose = vite ? () => vite.close() : null;
    shutdownResources.closeExperimentQueue = closeExperimentQueue;
    shutdownResources.closeKeyRevocationClients = closeKeyRevocationClients;
    shutdownResources.closeRedisConnection = closeRedisConnection;
    shutdownResources.closeDatabaseConnection = closeDatabaseConnection;

    setupWebSockets(server);

    runtimeRouter.get('/health/ready', async (_req, res) => {
      if (isShuttingDown) {
        return res.status(503).json({ status: 'shutting_down' });
      }
      const health = await getDependenciesHealth();
      const evaluation = evaluateReadinessContract(health);

      res
        .status(evaluation.httpStatus)
        .json(buildReadinessPayload(health, evaluation, getUncaughtErrorCount()));
    });

    runtimeRouter.get('/health/dependencies', async (_req, res) => {
      const health = await getDependenciesHealth();
      res.status(200).json(health);
    });

    runtimeRouter.get('/health', async (_req, res) => {
      const health = await getDependenciesHealth();
      res.status(200).json(health);
    });

    setupApiRoutes(runtimeRouter as any);
    setupGateway(runtimeRouter as any);

    if (vite) {
      runtimeRouter.use(vite.middlewares);
    } else {
      runtimeRouter.use(express.static(distPath));
      runtimeRouter.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    // Run migrations and abandoned-workflow reconciliation asynchronously
    initDatabase()
      .then(async () => {
        try {
          const { reconcileAbandonedRuns } = await import('./src/autonomous/stateMachine.js');
          const result = await reconcileAbandonedRuns();
          if (result.reconciledCount > 0) {
            console.log(
              `[Recovery] Reconciled ${result.reconciledCount} abandoned workflow run(s) into RECOVERY_REQUIRED:`,
              result.runIds
            );
          }
        } catch (recErr: any) {
          console.warn('[Recovery] Warning during startup run reconciliation:', recErr?.message || recErr);
        }
      })
      .catch((err) => {
        console.error('[Database] Startup migration error:', err?.message || err);
        if (process.env.STRICT_PERSISTENT_DB === 'true') {
          console.error('[Database] STRICT_PERSISTENT_DB is active. Process exiting due to unapplied migrations.');
          process.exit(1);
        }
      });

    // Defer internal demo API and background worker until HTTP & Vite routes are ready
    backgroundStartupTimer = setTimeout(() => {
      if (isShuttingDown) return;
      if (process.env.START_DEMO_API !== 'false') {
        import('./demo-api.js')
          .then((mod) => {
            shutdownResources.closeDemoApi = mod.closeDemoApiServer;
          })
          .catch((err) => {
            console.warn('[DemoApi] Demo API startup warning:', err?.message || err);
          });
      }
      if (process.env.START_INTERNAL_WORKER !== 'false') {
        process.env.FORTIX_EMBEDDED_WORKER = 'true';
        import('./src/worker.js')
          .then((mod) => {
            shutdownResources.shutdownWorkers = mod.shutdownWorkers;
          })
          .catch((err) => {
            console.warn('[Worker] Internal worker startup warning:', err?.message || err);
          });
      }
    }, 150);
    backgroundStartupTimer.unref?.();
  })();

  bootstrapPromise.catch((err) => {
    console.error('[Server] Bootstrap initialization error:', err);
  });

  app.use(async (req, res, next) => {
    try {
      await bootstrapPromise;
      runtimeRouter(req, res, next);
    } catch (err) {
      next(err);
    }
  });

  app.use(apiGlobalErrorHandler as any);

  // Graceful shutdown across HTTP, WebSockets, Vite, demo-api, workers, Redis, and PostgreSQL
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (backgroundStartupTimer) {
      clearTimeout(backgroundStartupTimer);
      backgroundStartupTimer = null;
    }
    console.log(`[Server] Received ${signal}, starting graceful shutdown...`);

    const forceTimer = setTimeout(() => {
      console.error('[Server] Could not close all resources within 10s, forcing exit');
      process.exit(1);
    }, 10000);
    forceTimer.unref?.();

    try {
      await bootstrapPromise.catch(() => {});
      const { errors } = await executeGracefulShutdown(shutdownResources);
      clearTimeout(forceTimer);
      if (errors.length > 0) {
        console.error('[Server] Graceful shutdown finished with resource warnings:', errors);
      } else {
        console.log('[Server] All runtime resources closed cleanly.');
      }
      process.exit(0);
    } catch (err) {
      clearTimeout(forceTimer);
      console.error('[Server] Fatal error during graceful shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer().catch((err) => {
    console.error('[Server] Fatal startup error:', err?.message || err);
    process.exit(1);
  });
}
