import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { setupApiRoutes } from '../../src/api/index.js';
import { db } from '../../src/db/index.js';
import { users, organizations, projects } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
dotenv.config();

describe('TSK-03: Unified Server-Side PDF Report Generation', () => {
  const secret = process.env.JWT_SECRET || 'secret';
  const app = express();
  app.use(express.json());
  setupApiRoutes(app);

  const owner = {
    userId: uuidv4(),
    email: 'pdf_owner@fortix.io',
    token: '',
    orgId: uuidv4(),
    projId: uuidv4(),
  };

  const outsider = {
    userId: uuidv4(),
    email: 'pdf_outsider@fortix.io',
    token: '',
    orgId: uuidv4(),
  };

  beforeAll(async () => {
    owner.token = jwt.sign({ id: owner.userId, email: owner.email }, secret);
    outsider.token = jwt.sign({ id: outsider.userId, email: outsider.email }, secret);

    // Seed owner user, org, and project
    await db.insert(users).values([
      { id: owner.userId, email: owner.email, passwordHash: 'hash_owner', role: 'DEVELOPER' },
      { id: outsider.userId, email: outsider.email, passwordHash: 'hash_outsider', role: 'DEVELOPER' }
    ]);
    await db.insert(organizations).values([
      { id: owner.orgId, name: 'PDF Org Owner', ownerId: owner.userId },
      { id: outsider.orgId, name: 'PDF Org Outsider', ownerId: outsider.userId }
    ]);
    await db.insert(projects).values([
      { id: owner.projId, name: 'PDF Resilience Project', orgId: owner.orgId, environment: 'production' }
    ]);
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, owner.userId));
    await db.delete(users).where(eq(users.id, outsider.userId));
  });

  it('rejects unauthenticated report generation requests with 401', async () => {
    const res = await request(app)
      .post('/api/control/reports/verify-sec-101')
      .send({ projectId: owner.projId, details: 'Unauthorized attempt' });
    expect(res.status).toBe(401);
  });

  it('enforces tenant isolation and rejects cross-tenant report generation with 403', async () => {
    const res = await request(app)
      .post('/api/control/reports/verify-sec-102')
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ projectId: owner.projId, details: 'Cross tenant attempt' });
    expect(res.status).toBe(403);
  });

  it('generates a valid, non-empty server-side PDF with application/pdf Content-Type', async () => {
    const verificationId = `VERIFY-RESILIENCE-${Date.now()}`;
    const res = await request(app)
      .post(`/api/control/reports/${verificationId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        projectId: owner.projId,
        details: 'Global Resilience Score: 98/100\nAvailability: 99.99%\nP95 Latency: 42ms\nSLO Attestation: PASS'
      })
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`filename=FortiX-Report-${verificationId}.pdf`);
    
    // Validate binary buffer starts with PDF magic bytes %PDF-
    const buffer = Buffer.from(res.body);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
  });
});
