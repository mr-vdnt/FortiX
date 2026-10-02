import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/db/index.js';
import { users, organizations, projects, apiRoutes, apiKeys, securityPolicies, experiments, verifications } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

describe('Gate 1 - Database Integrity', () => {
  const testUserId = uuidv4();
  const orgA_Id = uuidv4();
  const orgB_Id = uuidv4();
  const projA_Id = uuidv4();
  const projB_Id = uuidv4();
  
  beforeAll(async () => {
    await db.insert(users).values({
      id: testUserId,
      email: `${testUserId}@example.com`,
      passwordHash: 'hash',
      role: 'DEVELOPER'
    });

    await db.insert(organizations).values([
      { id: orgA_Id, name: 'Org A', ownerId: testUserId },
      { id: orgB_Id, name: 'Org B', ownerId: testUserId }
    ]);
    
    await db.insert(projects).values([
      { id: projA_Id, name: 'Project A', orgId: orgA_Id, environment: 'development' },
      { id: projB_Id, name: 'Project B', orgId: orgB_Id, environment: 'development' }
    ]);
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it('Schema - foreign keys are enforced at every level', async () => {
    // 1. Project with invalid Org
    await expect(
      db.insert(projects).values({ id: uuidv4(), name: 'Invalid', orgId: uuidv4() })
    ).rejects.toThrow();

    // 2. ApiRoute with invalid Project
    await expect(
      db.insert(apiRoutes).values({ id: uuidv4(), projectId: uuidv4(), pathPattern: '/', targetUrl: 'http://test' })
    ).rejects.toThrow();

    // 3. ApiKey with invalid Project
    await expect(
      db.insert(apiKeys).values({ id: uuidv4(), projectId: uuidv4(), keyPrefix: 'fx_test_1', secretHash: 'hash', name: 'key' })
    ).rejects.toThrow();

    // 4. SecurityPolicy with invalid Route
    await expect(
      db.insert(securityPolicies).values({ id: uuidv4(), routeId: uuidv4() })
    ).rejects.toThrow();

    // 5. Experiment with invalid Route
    await expect(
      db.insert(experiments).values({ id: uuidv4(), routeId: uuidv4(), type: 'latency', status: 'CREATED', config: {} })
    ).rejects.toThrow();

    // 6. Verification with invalid Experiment
    await expect(
      db.insert(verifications).values({ id: uuidv4(), experimentId: uuidv4(), expected: {}, observed: {}, verdict: 'PASS' })
    ).rejects.toThrow();
  });

  it('Schema - Required fields cannot be NULL', async () => {
    await expect(
      db.insert(projects).values({ id: uuidv4(), orgId: orgA_Id } as any) // Missing name
    ).rejects.toThrow();
  });

  it('Lifecycle - cascading deletes operate through the entire chain', async () => {
    const pId = uuidv4();
    await db.insert(projects).values({ id: pId, name: 'Temp Project', orgId: orgA_Id });
    
    const rId = uuidv4();
    await db.insert(apiRoutes).values({ id: rId, projectId: pId, pathPattern: '/test', targetUrl: 'http://test' });
    
    const expId = uuidv4();
    await db.insert(experiments).values({ id: expId, routeId: rId, type: 'latency', status: 'CREATED', config: {} });

    const vId = uuidv4();
    await db.insert(verifications).values({ id: vId, experimentId: expId, expected: {}, observed: {}, verdict: 'PASS' });

    // Ensure they exist
    expect((await db.select().from(verifications).where(eq(verifications.id, vId)))).toHaveLength(1);

    // Delete project
    await db.delete(projects).where(eq(projects.id, pId));

    // Ensure all children are cascaded
    expect((await db.select().from(apiRoutes).where(eq(apiRoutes.id, rId)))).toHaveLength(0);
    expect((await db.select().from(experiments).where(eq(experiments.id, expId)))).toHaveLength(0);
    expect((await db.select().from(verifications).where(eq(verifications.id, vId)))).toHaveLength(0);
  });


  it('Schema - Uniqueness Constraints', async () => {
    // Test unique email on users
    const uniqueEmail = `unique_${uuidv4()}@test.com`;
    await db.insert(users).values({ id: uuidv4(), email: uniqueEmail, passwordHash: 'hash', role: 'DEVELOPER' });
    await expect(
      db.insert(users).values({ id: uuidv4(), email: uniqueEmail, passwordHash: 'hash', role: 'DEVELOPER' })
    ).rejects.toThrow();
  });
});
