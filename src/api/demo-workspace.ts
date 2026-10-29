import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  projects,
  projectSettings,
  apiRoutes,
  apiKeys,
  securityPolicies,
  experiments,
  verifications,
  metricLogs,
  securityEvents,
  workflowRuns,
} from '../db/schema.js';
import { AuthRequest } from '../middleware/auth.js';
import { getDefaultOrg } from '../middleware/project.js';
import { defaultSettings, invalidateSettingsCache } from './settings.js';
import { recordProductAnalyticsEvent } from '../lib/analytics.js';

const router = express.Router();

export const DEMO_WORKSPACE_NAME = '[DEMO] Sandbox Resilience Lab';

/**
 * POST /api/control/projects/demo-workspace/reset
 * Creates or deterministically resets an isolated, explicitly labelled [DEMO] Workspace
 * owned by the authenticated operator. All seeded records carry explicit DEMO_SEED
 * provenance metadata so synthetic baseline fixtures are never confused with live telemetry.
 */
router.post('/reset', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  try {
    const org = await getDefaultOrg(userId);
    const existingList = await db
      .select()
      .from(projects)
      .where(and(eq(projects.orgId, org.id), eq(projects.name, DEMO_WORKSPACE_NAME)));

    let demoProject = existingList[0];

    if (demoProject) {
      const oldRoutes = await db
        .select({ id: apiRoutes.id })
        .from(apiRoutes)
        .where(eq(apiRoutes.projectId, demoProject.id));
      const oldRouteIds = oldRoutes.map((r) => r.id);

      await db.delete(workflowRuns).where(eq(workflowRuns.projectId, demoProject.id));
      if (oldRouteIds.length > 0) {
        const oldExps = await db
          .select({ id: experiments.id })
          .from(experiments)
          .where(inArray(experiments.routeId, oldRouteIds));
        const oldExpIds = oldExps.map((e) => e.id);
        if (oldExpIds.length > 0) {
          await db.delete(verifications).where(inArray(verifications.experimentId, oldExpIds));
        }
        await db.delete(securityPolicies).where(inArray(securityPolicies.routeId, oldRouteIds));
        await db.delete(experiments).where(inArray(experiments.routeId, oldRouteIds));
        await db.delete(metricLogs).where(inArray(metricLogs.routeId, oldRouteIds));
        await db.delete(securityEvents).where(inArray(securityEvents.routeId, oldRouteIds));
        await db.delete(apiRoutes).where(inArray(apiRoutes.id, oldRouteIds));
      }
      await db.delete(apiKeys).where(eq(apiKeys.projectId, demoProject.id));
      await db.delete(projectSettings).where(eq(projectSettings.projectId, demoProject.id));
      invalidateSettingsCache(demoProject.id);
    } else {
      const [created] = await db
        .insert(projects)
        .values({
          id: uuidv4(),
          orgId: org.id,
          name: DEMO_WORKSPACE_NAME,
          environment: 'development',
        })
        .returning();
      demoProject = created;
    }

    await db.insert(projectSettings).values({
      id: uuidv4(),
      projectId: demoProject.id,
      version: 1,
      gatewayConfig: {
        ...defaultSettings.gatewayConfig,
        upstreamTimeoutMs: 4000,
        requestTimeoutMs: 4000,
      },
      securityConfig: {
        ...defaultSettings.securityConfig,
        threatDetection: true,
        ssrfProtection: true,
        enforceApiKey: true,
      },
      rateLimitConfig: {
        ...defaultSettings.rateLimitConfig,
        defaultRpm: 60,
        failureMode: 'FAIL_CLOSED',
      },
      experimentConfig: defaultSettings.experimentConfig,
      telemetryConfig: {
        ...defaultSettings.telemetryConfig,
        isDemoWorkspace: true,
        provenance: 'DEMO_SEED',
      },
      updatedBy: userId,
    });

    const demoRouteSpecs = [
      { pathPattern: '/api/v1/orders', targetUrl: 'http://fortix-demo-api:3001/api/v1/orders', rpm: 60 },
      { pathPattern: '/api/v1/payments', targetUrl: 'http://fortix-demo-api:3001/api/payment', rpm: 30 },
      { pathPattern: '/api/v1/inventory', targetUrl: 'http://fortix-demo-api:3001/api/v1/data', rpm: 120 },
      { pathPattern: '/api/v1/slow-checkout', targetUrl: 'http://fortix-demo-api:3001/api/slow', rpm: 30 },
    ];

    const createdRoutes: Array<typeof apiRoutes.$inferSelect> = [];
    for (const spec of demoRouteSpecs) {
      const [route] = await db
        .insert(apiRoutes)
        .values({
          id: uuidv4(),
          projectId: demoProject.id,
          pathPattern: spec.pathPattern,
          targetUrl: spec.targetUrl,
        })
        .returning();
      createdRoutes.push(route);

      await db.insert(securityPolicies).values({
        id: uuidv4(),
        routeId: route.id,
        rateLimitRpm: spec.rpm,
        enableWaf: true,
        enableSsrf: true,
      });
    }

    const primaryRoute = createdRoutes[0];
    const now = Date.now();

    // Seed explicitly labelled synthetic baseline request telemetry (last 12s)
    const sampleLatencies = [18, 22, 19, 25, 31, 24, 21, 145, 29, 20, 23, 19];
    await db.insert(metricLogs).values(
      sampleLatencies.map((lat, idx) => ({
        id: uuidv4(),
        routeId: primaryRoute.id,
        requestId: `demo-seed-metric-${idx + 1}`,
        latencyMs: lat,
        statusCode: idx === 7 ? 429 : 200,
        timestamp: new Date(now - (sampleLatencies.length - idx) * 1000),
      }))
    );

    // Seed 3 explicitly labelled [DEMO_SEED] policy enforcement scenarios
    await db.insert(securityEvents).values([
      {
        id: uuidv4(),
        routeId: primaryRoute.id,
        requestId: 'demo-seed-waf-sqli',
        threatType: 'SQL_INJECTION',
        payload: {
          provenance: 'DEMO_SEED',
          label: '[DEMO_SEED] Blocked SQL tautology probe (?id=1 OR 1=1--)',
          action: 'BLOCKED_403',
        },
        timestamp: new Date(now - 35000),
      },
      {
        id: uuidv4(),
        routeId: createdRoutes[1].id,
        requestId: 'demo-seed-ssrf-guard',
        threatType: 'SSRF_ATTEMPT',
        payload: {
          provenance: 'DEMO_SEED',
          label: '[DEMO_SEED] Blocked cloud metadata redirect (169.254.169.254)',
          action: 'BLOCKED_403',
        },
        timestamp: new Date(now - 20000),
      },
      {
        id: uuidv4(),
        routeId: primaryRoute.id,
        requestId: 'demo-seed-ratelimit',
        threatType: 'RATE_LIMIT_EXCEEDED',
        payload: {
          provenance: 'DEMO_SEED',
          label: '[DEMO_SEED] Token bucket rate limit enforced (429 Too Many Requests)',
          action: 'THROTTLED_429',
        },
        timestamp: new Date(now - 9000),
      },
    ]);

    // Seed 1 explicitly labelled [DEMO_SEED] reference experiment + verification record
    const demoExpId = uuidv4();
    await db.insert(experiments).values({
      id: demoExpId,
      routeId: primaryRoute.id,
      type: 'latency',
      status: 'COMPLETED',
      config: {
        latencyMs: 250,
        durationMs: 10000,
        provenance: 'DEMO_SEED',
        label: '[DEMO_SEED] Baseline Reference Latency Experiment',
      },
      startedAt: new Date(now - 60000),
      completedAt: new Date(now - 50000),
    });

    await db.insert(verifications).values({
      id: uuidv4(),
      experimentId: demoExpId,
      expected: {
        provenance: 'DEMO_SEED',
        maxP95LatencyMs: 500,
        maxErrorRatePercent: 5,
      },
      observed: {
        provenance: 'DEMO_SEED',
        note: 'Synthetic reference fixture — run a live Autonomous Verification to record real gateway observations.',
        p95LatencyMs: 268,
        errorRatePercent: 0,
      },
      verdict: 'PASSED',
    });

    recordProductAnalyticsEvent({
      event: 'demo_workspace_provisioned',
      workspaceMode: 'demo',
      optOut: req.headers['x-fortix-analytics-opt-out'] === 'true',
    });

    res.status(200).json({
      project: {
        ...demoProject,
        isDemoWorkspace: true,
        routeCount: createdRoutes.length,
        keyCount: 0,
        experimentCount: 1,
      },
      routesCreated: createdRoutes.length,
      provenance: 'DEMO_SEED',
      message: 'Labelled [DEMO] Sandbox Workspace provisioned and reset to clean baseline.',
    });
  } catch (error) {
    console.error('[DemoWorkspace] Failed to provision demo workspace:', error);
    res.status(500).json({ error: 'Failed to provision demo workspace' });
  }
});

export const demoWorkspaceRouter = router;
