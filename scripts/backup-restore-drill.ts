import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import {
  users,
  organizations,
  projects,
  apiRoutes,
  securityPolicies,
  experiments,
  verifications,
} from '../src/db/schema.js';
import {
  exportWorkspaceBackup,
  verifyWorkspaceBackupIntegrity,
  restoreWorkspaceBackup,
} from '../src/db/backup.js';

async function runBackupRestoreDrill() {
  const drillUserId = crypto.randomUUID();
  const drillOrgId = crypto.randomUUID();
  const drillProjectId = crypto.randomUUID();
  const drillRouteId = crypto.randomUUID();
  const drillExpId = crypto.randomUUID();

  try {
    await db.insert(users).values({
      id: drillUserId,
      email: `backup-drill-${Date.now()}@fortix.test`,
      passwordHash: await bcrypt.hash('DrillPass!2345', 8),
      role: 'DEVELOPER',
      emailVerified: true,
    });
    await db.insert(organizations).values({
      id: drillOrgId,
      name: 'Backup Drill Org',
      ownerId: drillUserId,
    });
    await db.insert(projects).values({
      id: drillProjectId,
      orgId: drillOrgId,
      name: 'Backup Drill Project',
      environment: 'staging',
    });
    await db.insert(apiRoutes).values({
      id: drillRouteId,
      projectId: drillProjectId,
      pathPattern: '/api/v1/drill',
      targetUrl: 'http://fortix-demo-api:3001/api/v1/data',
    });
    await db.insert(securityPolicies).values({
      id: crypto.randomUUID(),
      routeId: drillRouteId,
      rateLimitRpm: 90,
      enableWaf: true,
      enableSsrf: true,
    });
    await db.insert(experiments).values({
      id: drillExpId,
      routeId: drillRouteId,
      type: 'latency',
      status: 'COMPLETED',
      config: { latencyMs: 120 },
    });
    await db.insert(verifications).values({
      id: crypto.randomUUID(),
      experimentId: drillExpId,
      expected: { maxLatencyMs: 300 },
      observed: { avgLatencyMs: 130 },
      verdict: 'PASSED',
    });

    const snapshot = await exportWorkspaceBackup(drillProjectId);
    const check = verifyWorkspaceBackupIntegrity(snapshot);
    if (!check.valid) {
      throw new Error(`Integrity verification failed: ${check.reason}`);
    }

    // Wipe original project & children
    await db.delete(verifications).where(eq(verifications.experimentId, drillExpId));
    await db.delete(experiments).where(eq(experiments.routeId, drillRouteId));
    await db.delete(securityPolicies).where(eq(securityPolicies.routeId, drillRouteId));
    await db.delete(apiRoutes).where(eq(apiRoutes.projectId, drillProjectId));
    await db.delete(projects).where(eq(projects.id, drillProjectId));

    const wiped = await db.select().from(projects).where(eq(projects.id, drillProjectId));
    if (wiped.length !== 0) {
      throw new Error('Wipe check failed: project still present prior to restore');
    }

    // Restore from signed snapshot
    const restored = await restoreWorkspaceBackup(snapshot, drillOrgId);
    const [restoredProj] = await db.select().from(projects).where(eq(projects.id, drillProjectId));
    const restoredRoutes = await db.select().from(apiRoutes).where(eq(apiRoutes.projectId, drillProjectId));

    if (!restoredProj || restoredRoutes.length !== 1) {
      throw new Error('Restore verification failed: project or route missing after restore');
    }

    console.log(
      JSON.stringify(
        {
          status: 'DRILL_PASSED',
          checksumSha256: snapshot.checksumSha256,
          restored,
        },
        null,
        2
      )
    );
  } finally {
    await db.delete(users).where(eq(users.id, drillUserId)).catch(() => {});
  }
}

runBackupRestoreDrill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[BackupDrill] FAILED:', err);
    process.exit(1);
  });
