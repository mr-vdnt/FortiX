import { Express } from 'express';
import cookieParser from 'cookie-parser';
import { accountRouter } from './account.js';
import { authRouter } from './auth.js';
import { adminRouter } from './admin.js';
import { demoWorkspaceRouter } from './demo-workspace.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { requireEntitlement } from '../middleware/entitlements.js';
import { csrfProtectionMiddleware } from '../lib/cors-csrf.js';
import { evaluateReadinessContract } from '../lib/readiness.js';
import { apiGlobalErrorHandler } from '../lib/error-tracker.js';
import { projectsRouter } from './projects.js';
import { apiRoutesRouter } from './routes.js';
import { apiKeysRouter } from './keys.js';
import { policiesRouter } from './policies.js';
import { experimentsRouter } from './experiments.js';
import { metricsRouter } from './metrics.js';
import { verificationsRouter } from './verifications.js';
import { eventsRouter } from './events.js';
import { webhooksRouter } from './webhooks.js';
import { resourcesRouter } from './resources.js';
import { topologyRouter } from './topology.js';
import { settingsRouter } from './settings.js';
import { systemRouter, getDependenciesHealth } from './system.js';
import { dlqRouter } from './dlq.js';
import reportsRouter from './reports.js';
import { workflowRunsRouter } from './runs.js';
import { openApiRouter, getSwaggerHtml } from './openapi.js';
import { register, httpRequestsTotal, httpRequestDurationSeconds } from '../lib/metrics.js';
import pinoHttp from 'pino-http';
import { logger } from '../lib/logger.js';
import { v4 as uuidv4 } from 'uuid';

export function setupApiRoutes(app: Express) {
  app.use(cookieParser());
  app.use((req, res, next) => {
    req.id = (req.headers['x-request-id'] as string) || uuidv4();
    res.setHeader('X-Request-ID', req.id);
    next();
  });
  app.use('/api', csrfProtectionMiddleware);

  // Prometheus Metrics Tracker (with bounded route label cardinality)
  app.use((req, res, next) => {
    if (req.path === '/metrics') return next();
    const start = process.hrtime();
    res.on('finish', () => {
      const [seconds, nanoseconds] = process.hrtime(start);
      const durationInSeconds = seconds + nanoseconds / 1e9;
      let routePath = 'unmatched';
      if (req.route?.path) {
        const suffix = typeof req.route.path === 'string' && req.route.path !== '/' ? req.route.path : '';
        routePath = `${req.baseUrl || ''}${suffix}` || '/';
      } else if (req.baseUrl) {
        routePath = req.baseUrl;
      } else if (req.path.startsWith('/proxy/')) {
        routePath = '/proxy/:routeId';
      } else if (res.statusCode < 400) {
        routePath = req.path || 'unknown';
      }
      httpRequestsTotal.inc({
        method: req.method,
        route: routePath,
        status_code: res.statusCode.toString(),
      });
      httpRequestDurationSeconds.observe(
        {
          method: req.method,
          route: routePath,
          status_code: res.statusCode.toString(),
        },
        durationInSeconds
      );
    });
    next();
  });

  const pinoMiddleware = pinoHttp({ logger, genReqId: (req) => req.id });
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/proxy')) {
      pinoMiddleware(req, res, next);
    } else {
      next();
    }
  });

  // Health Checks
  app.get('/api/health', async (_req, res) => {
    const health = await getDependenciesHealth();
    res.status(200).json(health);
  });

  app.get('/api/health/live', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/health/ready', async (_req, res) => {
    const health = await getDependenciesHealth();
    const evaluation = evaluateReadinessContract(health);

    res.status(evaluation.httpStatus).json({
      status: evaluation.status,
      deploymentMode: evaluation.deploymentMode,
      persistenceVerified: evaluation.persistenceVerified,
      postgres: health.postgres.status,
      postgresStorageMode: health.postgres.storageMode,
      postgresMigrationStatus: health.postgres.migrationStatus || 'verified',
      redis: health.redis.status,
      redisStorageMode: health.redis.storageMode,
      warnings: evaluation.warnings,
    });
  });

  app.get('/api/health/dependencies', async (_req, res) => {
    const health = await getDependenciesHealth();
    res.status(200).json(health);
  });

  // Prometheus Metrics Exposition
  app.get('/metrics', async (_req, res) => {
    try {
      res.setHeader('Content-Type', register.contentType);
      res.send(await register.metrics());
    } catch (err) {
      res.status(500).send(err instanceof Error ? err.message : 'Error retrieving metrics');
    }
  });

  // OpenAPI 3 Specification & Interactive Docs
  app.use('/api', openApiRouter);
  app.get('/api-docs', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(getSwaggerHtml('/api/openapi.json'));
  });
  app.get('/api/docs', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(getSwaggerHtml('/api/openapi.json'));
  });

  // Public Auth
  app.use('/api/auth', authRouter);
  app.use('/api/control/account', authenticate, accountRouter);

  // Protected Control Plane
  app.use('/api/control/system', systemRouter);
  app.use('/api/control/settings', authenticate, settingsRouter);
  app.use('/api/control/projects/demo-workspace', authenticate, demoWorkspaceRouter);
  app.use('/api/control/projects', authenticate, projectsRouter);
  app.use('/api/control/routes', authenticate, apiRoutesRouter);
  app.use('/api/control/keys', authenticate, apiKeysRouter);
  app.use('/api/control/policies', authenticate, policiesRouter);
  app.use('/api/control/experiments', authenticate, requireEntitlement('ADVANCED_EXPERIMENTS'), experimentsRouter);
  app.use('/api/control/metrics', authenticate, requireEntitlement('ADVANCED_ANALYTICS'), metricsRouter);
  app.use('/api/control/verifications', authenticate, requireEntitlement('POLICY_VERIFICATION'), verificationsRouter);
  app.use('/api/control/events', authenticate, eventsRouter);
  app.use('/api/control/webhooks', authenticate, requireEntitlement('ADVANCED_SECURITY'), webhooksRouter);
  app.use('/api/control/resources', authenticate, requireEntitlement('TOPOLOGY'), resourcesRouter);
  app.use('/api/control/topology', authenticate, requireEntitlement('TOPOLOGY'), topologyRouter);
  app.use('/api/control/dlq', authenticate, dlqRouter);
  app.use('/api/control/queue', authenticate, dlqRouter);
  app.use('/api/control/admin', authenticate, requireAdmin, adminRouter);
  app.use('/api/control/runs', authenticate, workflowRunsRouter);
  app.use('/api', reportsRouter);

  // Structured JSON 404 handler for unmatched /api/* routes (never fall through to HTML SPA)
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: 'Requested API endpoint does not exist.',
      code: 'API_ROUTE_NOT_FOUND',
      path: req.originalUrl,
      requestId: req.id,
      recoveryHint: 'Verify the API endpoint path or consult /api/docs for supported routes.',
    });
  });

  // Global scrubbed API error handler (never leaks stack traces or raw SQL)
  app.use('/api', apiGlobalErrorHandler as any);
}
