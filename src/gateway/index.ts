import { logger } from '../lib/logger.js';
import { Express, Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { db } from '../db/index.js';
import { apiRoutes, apiKeys, metricLogs, securityEvents, experiments } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { isSafeTarget } from './ssrf.js';
import { v4 as uuidv4 } from 'uuid';
import { enqueueMetric, enqueueSecurityEvent } from '../lib/telemetry.js';
import { checkRateLimit } from '../rate-limit/redis.js';
import { detectThreats } from '../threat-detection/index.js';
import { broadcast } from "../socket.js";
import bcrypt from 'bcryptjs';

// Cache for verified API keys to prevent CPU threadpool starvation under proxy load
interface CachedApiKey {
  key: any;
  cachedAt: number;
}
export const apiKeyCache = new Map<string, CachedApiKey>();

export function getApiKeyCacheSize(): number {
  return apiKeyCache.size;
}

export function invalidateApiKeyCache(keyId?: string, projectId?: string) {
  if (!keyId && !projectId) {
    apiKeyCache.clear();
    return;
  }
  for (const [raw, entry] of apiKeyCache.entries()) {
    if (keyId) {
      if (entry.key?.id === keyId) {
        apiKeyCache.delete(raw);
      }
    } else if (projectId) {
      if (entry.key?.projectId === projectId) {
        apiKeyCache.delete(raw);
      }
    }
  }
}

// 2-second cache for active experiments per route
const expCache = new Map<string, { exps: any[]; cachedAt: number }>();

export function invalidateExpCache(routeId?: string) {
  if (!routeId) {
    expCache.clear();
    return;
  }
  expCache.delete(routeId);
}

export function setupGateway(app: Express) {
  // Ensure distributed API-key invalidation listener is active
  try {
    import('../lib/key-invalidation.js').then(({ setupKeyRevocationSubscriber }) => {
      setupKeyRevocationSubscriber();
    }).catch(() => {});
  } catch {}

  app.use('/proxy/:routeId', async (req: Request, res: Response, next: NextFunction) => {
    const routeId = req.params.routeId as string;
    const startHrTime = process.hrtime.bigint();
    const requestId = uuidv4();

    try {
      // 1. Resolve Route
      const [route] = await db.select().from(apiRoutes).where(eq(apiRoutes.id, routeId)).limit(1);
      if (!route) return res.status(404).json({ error: 'Route not found' });

      // 1.5 Fault Injection (cached lookup)
      let runningExps: any[] = [];
      const cachedExp = expCache.get(routeId);
      if (cachedExp && Date.now() - cachedExp.cachedAt < 2000) {
        runningExps = cachedExp.exps;
      } else {
        const activeExps = await db.select().from(experiments).where(eq(experiments.routeId, routeId));
        runningExps = activeExps.filter(e => e.status === 'RUNNING' || e.status === 'QUEUED');
        expCache.set(routeId, { exps: runningExps, cachedAt: Date.now() });
      }
      
      let injectedLatency = 0;
      let injectedError = false;
      
      for (const exp of runningExps) {
        if (exp.type === 'latency') injectedLatency = Math.max(injectedLatency, (exp.config as any)?.latencyMs || 800);
        if (exp.type === 'error_5xx') injectedError = true;
        if (exp.type === 'timeout') injectedLatency = Math.max(injectedLatency, 6000); // 6s timeout
      }
      
      if (injectedLatency > 0) {
        await new Promise(r => setTimeout(r, injectedLatency));
      }
      
      if (injectedError) {
        const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1000000;
        const logId = uuidv4();
        enqueueMetric({
          id: logId, routeId, experimentId: req.headers['x-experiment-id'] as string || null, latencyMs: Math.round(durationMs), statusCode: 503
        });
        broadcast(route.projectId, 'metric:new', { 
           id: logId, routeId, latencyMs: Math.round(durationMs), statusCode: 503
         });
        return res.status(503).json({ error: 'Service Unavailable (Fault Injection)' });
      }

      
      // 2. SSRF Protection (Double Check)
      if (!isSafeTarget(route.targetUrl)) {
        return res.status(502).json({ error: 'Bad Gateway: Invalid target' });
      }

      // 3. API Key Auth
      let apiKeyId = null;
      
      const rawKey = req.headers['x-api-key'] as string;
      if (!rawKey) return res.status(401).json({ error: 'Missing API Key' });
      
      const parts = rawKey.split('_');
      // Expected: fx_{env}_{keyId}_{secret}
      if (parts.length !== 4 || parts[0] !== 'fx') {
        return res.status(401).json({ error: 'Malformed API Key' });
      }
      
      const keyId = parts[2];
      const secret = parts[3];
      
      let validKey = null;

      // Check fast cache first
      const cached = apiKeyCache.get(rawKey);
      if (cached && (Date.now() - cached.cachedAt < 30000)) {
        if (cached.key && cached.key.projectId === route.projectId && !cached.key.revokedAt) {
          validKey = cached.key;
        } else {
          apiKeyCache.delete(rawKey);
        }
      }

      if (!validKey) {
        const [k] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
        
        if (k && k.projectId === route.projectId && !k.revokedAt) {
          if (!k.expiresAt || new Date(k.expiresAt) > new Date()) {
            const isValid = await bcrypt.compare(secret, k.secretHash);
            if (isValid) {
              validKey = k;
              apiKeyCache.set(rawKey, { key: k, cachedAt: Date.now() });
            }
          }
        }
      }
      
      if (!validKey) {
          // Log auth failure
          const eventId = uuidv4();
          enqueueSecurityEvent({
            id: eventId,
            routeId,
            type: 'INVALID_API_KEY',
            severity: 'MEDIUM',
            action: 'blocked',
            sourceIp: req.ip || 'unknown'
          });
          broadcast(route.projectId, 'security:event', { id: eventId, routeId, type: 'INVALID_API_KEY', severity: 'MEDIUM' });
          return res.status(401).json({ error: 'Invalid or Revoked API Key' });
        }
        
        apiKeyId = validKey.id;

      // 4. Threat Detection
      const threats = detectThreats(req);
      if (threats.length > 0) {
        for (const threat of threats) {
          const eventId = uuidv4();
          enqueueSecurityEvent({
            id: eventId,
            routeId,
            type: threat,
            severity: 'HIGH',
            action: 'blocked',
            sourceIp: req.ip || 'unknown'
          });
          broadcast(route.projectId, 'security:event', { id: eventId, routeId, type: threat, severity: 'HIGH' });
        }
        return res.status(403).json({ error: 'Forbidden: Suspicious activity detected' });
      }

      // 5. Rate Limiting (Phase 4)
      const limitResult = await checkRateLimit(route.projectId, routeId, apiKeyId || req.ip || 'anonymous');
      if (limitResult) {
        res.setHeader('X-RateLimit-Limit', limitResult.limit);
        res.setHeader('X-RateLimit-Remaining', limitResult.remaining);
        if (!limitResult.allowed) {
          const eventId = uuidv4();
          enqueueSecurityEvent({
            id: eventId, routeId, type: 'RATE_LIMIT_EXCEEDED', severity: 'LOW', action: 'blocked', sourceIp: req.ip || 'unknown'
          });
          enqueueMetric({
            id: uuidv4(), routeId, experimentId: req.headers['x-experiment-id'] as string || null, latencyMs: Math.round(Number(process.hrtime.bigint() - startHrTime) / 1000000), statusCode: 429
          });
          broadcast(route.projectId, 'security:event', { id: eventId, routeId, type: 'RATE_LIMIT_EXCEEDED', severity: 'LOW' });
          return res.status(429).json({ error: 'Too Many Requests' });
        }
      }

            // 6. Proxy
      const proxy = createProxyMiddleware({
        target: route.targetUrl,
        router: function(req) {
            // Bypass DNS for the demo api
            if (route.targetUrl.includes('fortix-demo-api')) {
                return route.targetUrl.replace(/fortix-demo-api(\.[a-z0-9-]+)?/i, '127.0.0.1:3001');
            }
            return route.targetUrl;
        },
        changeOrigin: true,
        pathRewrite: { [`^/proxy/${routeId}`]: '' },
        timeout: 5000,
        proxyTimeout: 5000,
        on: {
          proxyRes: async (proxyRes, req, res) => {
            const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1000000;
            const statusCode = proxyRes.statusCode || 500;
            const isError = statusCode >= 400;
            const logId = uuidv4();
            
            enqueueMetric({
              id: logId,
              routeId,
              experimentId: req.headers['x-experiment-id'] as string || null,
              latencyMs: Math.round(durationMs),
              statusCode,
            });
            Promise.resolve().then(() => {
              broadcast(route.projectId, 'metric:new', { 
                id: logId, routeId, latencyMs: Math.round(durationMs), statusCode
              });
            }).catch(logger.error);
          },
          error: async (err, req, res) => {
            const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1000000;
            const logId = uuidv4();
            
            enqueueMetric({
              id: logId,
              routeId,
              experimentId: req.headers['x-experiment-id'] as string || null,
              latencyMs: Math.round(durationMs),
              statusCode: 502,
            });
            Promise.resolve().then(() => {
              broadcast(route.projectId, 'metric:new', { 
                id: logId, routeId, latencyMs: Math.round(durationMs), statusCode: 502
              });
            }).catch(logger.error);
            
            if (!(res as Response).headersSent) {
              (res as Response).status(502).json({ error: 'Bad Gateway: Upstream failure' });
            }
          }
        }
      });

      proxy(req, res, next);
    } catch (err) {
      next(err);
    }
  });
}