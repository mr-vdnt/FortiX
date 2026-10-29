import crypto from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from './index.js';
import {
  projects,
  projectSettings,
  apiRoutes,
  apiKeys,
  securityPolicies,
  experiments,
  verifications,
  webhooks,
  workflowRuns,
} from './schema.js';

export interface WorkspaceBackupPayload {
  schemaVersion: 1;
  exportedAt: string;
  project: typeof projects.$inferSelect;
  settings: (typeof projectSettings.$inferSelect) | null;
  routes: Array<typeof apiRoutes.$inferSelect>;
  keys: Array<Omit<typeof apiKeys.$inferSelect, 'secretHash'> & { secretHashRedacted: true }>;
  policies: Array<typeof securityPolicies.$inferSelect>;
  experiments: Array<typeof experiments.$inferSelect>;
  verifications: Array<typeof verifications.$inferSelect>;
  webhooks: Array<Omit<typeof webhooks.$inferSelect, 'secret'> & { hasSecret: boolean }>;
  workflowRuns: Array<typeof workflowRuns.$inferSelect>;
}

export interface SignedWorkspaceBackup {
  format: 'fortix-workspace-backup-v1';
  checksumSha256: string;
  payload: WorkspaceBackupPayload;
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

export function computeBackupChecksum(payload: WorkspaceBackupPayload): string {
  return crypto.createHash('sha256').update(canonicalize(payload)).digest('hex');
}

export function verifyWorkspaceBackupIntegrity(backup: SignedWorkspaceBackup): {
  valid: boolean;
  reason?: string;
} {
  if (!backup || backup.format !== 'fortix-workspace-backup-v1' || !backup.payload) {
    return { valid: false, reason: 'Unsupported or malformed backup envelope' };
  }
  if (backup.payload.schemaVersion !== 1 || !backup.payload.project?.id) {
    return { valid: false, reason: 'Unsupported backup schema version or missing project record' };
  }
  const expected = computeBackupChecksum(backup.payload);
  if (expected !== backup.checksumSha256) {
    return { valid: false, reason: 'Backup SHA-256 integrity checksum mismatch' };
  }
  return { valid: true };
}

export async function exportWorkspaceBackup(projectId: string): Promise<SignedWorkspaceBackup> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    throw new Error(`Project ${projectId} not found for backup export`);
  }

  const [settings] = await db
    .select()
    .from(projectSettings)
    .where(eq(projectSettings.projectId, projectId))
    .limit(1);

  const routes = await db.select().from(apiRoutes).where(eq(apiRoutes.projectId, projectId));
  const routeIds = routes.map((r) => r.id);

  const rawKeys = await db.select().from(apiKeys).where(eq(apiKeys.projectId, projectId));
  const keys = rawKeys.map(({ secretHash: _omittedHash, ...rest }) => ({
    ...rest,
    secretHashRedacted: true as const,
  }));

  const policies =
    routeIds.length > 0
      ? await db.select().from(securityPolicies).where(inArray(securityPolicies.routeId, routeIds))
      : [];

  const exps =
    routeIds.length > 0
      ? await db.select().from(experiments).where(inArray(experiments.routeId, routeIds))
      : [];
  const expIds = exps.map((e) => e.id);

  const verifs =
    expIds.length > 0
      ? await db.select().from(verifications).where(inArray(verifications.experimentId, expIds))
      : [];

  const rawHooks = await db.select().from(webhooks).where(eq(webhooks.projectId, projectId));
  const sanitizedHooks = rawHooks.map(({ secret, ...rest }) => ({
    ...rest,
    hasSecret: Boolean(secret),
  }));

  const runs = await db.select().from(workflowRuns).where(eq(workflowRuns.projectId, projectId));

  const payload: WorkspaceBackupPayload = JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      project,
      settings: settings || null,
      routes,
      keys,
      policies,
      experiments: exps,
      verifications: verifs,
      webhooks: sanitizedHooks,
      workflowRuns: runs,
    })
  );

  return {
    format: 'fortix-workspace-backup-v1',
    checksumSha256: computeBackupChecksum(payload),
    payload,
  };
}

export async function restoreWorkspaceBackup(
  backup: SignedWorkspaceBackup,
  targetOrgId: string,
  overrideProjectId?: string
): Promise<{ restoredProjectId: string; routesRestored: number; policiesRestored: number; experimentsRestored: number }> {
  const integrity = verifyWorkspaceBackupIntegrity(backup);
  if (!integrity.valid) {
    throw new Error(`Refusing backup restore: ${integrity.reason}`);
  }

  const { payload } = backup;
  const restoredProjectId = overrideProjectId || payload.project.id;
  const routeIdMap = new Map<string, string>();
  const expIdMap = new Map<string, string>();

  await db
    .insert(projects)
    .values({
      id: restoredProjectId,
      orgId: targetOrgId,
      name: payload.project.name,
      environment: payload.project.environment,
      createdAt: new Date(payload.project.createdAt),
    })
    .onConflictDoNothing();

  if (payload.settings) {
    await db
      .insert(projectSettings)
      .values({
        id: overrideProjectId ? crypto.randomUUID() : payload.settings.id,
        projectId: restoredProjectId,
        version: payload.settings.version,
        gatewayConfig: payload.settings.gatewayConfig,
        securityConfig: payload.settings.securityConfig,
        rateLimitConfig: payload.settings.rateLimitConfig,
        experimentConfig: payload.settings.experimentConfig,
        telemetryConfig: payload.settings.telemetryConfig,
      })
      .onConflictDoNothing();
  }

  for (const r of payload.routes) {
    const newRouteId = overrideProjectId ? crypto.randomUUID() : r.id;
    routeIdMap.set(r.id, newRouteId);
    await db
      .insert(apiRoutes)
      .values({
        id: newRouteId,
        projectId: restoredProjectId,
        pathPattern: r.pathPattern,
        targetUrl: r.targetUrl,
        createdAt: new Date(r.createdAt),
      })
      .onConflictDoNothing();
  }

  for (const p of payload.policies) {
    const mappedRouteId = routeIdMap.get(p.routeId) || p.routeId;
    await db
      .insert(securityPolicies)
      .values({
        id: overrideProjectId ? crypto.randomUUID() : p.id,
        routeId: mappedRouteId,
        rateLimitRpm: p.rateLimitRpm,
        enableWaf: p.enableWaf,
        enableSsrf: p.enableSsrf,
        createdAt: new Date(p.createdAt),
      })
      .onConflictDoNothing();
  }

  for (const e of payload.experiments) {
    const mappedRouteId = routeIdMap.get(e.routeId) || e.routeId;
    const newExpId = overrideProjectId ? crypto.randomUUID() : e.id;
    expIdMap.set(e.id, newExpId);
    await db
      .insert(experiments)
      .values({
        id: newExpId,
        routeId: mappedRouteId,
        type: e.type,
        status: e.status,
        config: e.config,
        scheduledFor: e.scheduledFor ? new Date(e.scheduledFor) : null,
        startedAt: e.startedAt ? new Date(e.startedAt) : null,
        completedAt: e.completedAt ? new Date(e.completedAt) : null,
        createdAt: new Date(e.createdAt),
      })
      .onConflictDoNothing();
  }

  for (const v of payload.verifications) {
    const mappedExpId = expIdMap.get(v.experimentId) || v.experimentId;
    await db
      .insert(verifications)
      .values({
        id: overrideProjectId ? crypto.randomUUID() : v.id,
        experimentId: mappedExpId,
        expected: v.expected,
        observed: v.observed,
        verdict: v.verdict,
        pdfS3Url: v.pdfS3Url,
        createdAt: new Date(v.createdAt),
      })
      .onConflictDoNothing();
  }

  return {
    restoredProjectId,
    routesRestored: payload.routes.length,
    policiesRestored: payload.policies.length,
    experimentsRestored: payload.experiments.length,
  };
}
