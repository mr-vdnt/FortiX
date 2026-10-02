import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { setupApiRoutes } from '../../src/api/index.js';
import { openApiSpec } from '../../src/api/openapi.js';

describe('TSK-04: OpenAPI 3 Contract & Documentation', () => {
  const app = express();
  app.use(express.json());
  setupApiRoutes(app);

  it('GET /api/openapi.json returns 200 with application/json', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toBeTypeOf('object');
  });

  it('declares valid OpenAPI 3.x specification format', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.body.openapi).toMatch(/^3\.0\.\d+$/);
    expect(res.body.info).toBeDefined();
    expect(res.body.info.title).toContain('FortiX');
    expect(res.body.info.version).toBeDefined();
  });

  it('defines required security schemes for Control Plane and Gateway Proxy', async () => {
    const schemes = openApiSpec.components.securitySchemes;
    expect(schemes.BearerAuth).toBeDefined();
    expect(schemes.BearerAuth.type).toBe('http');
    expect(schemes.BearerAuth.scheme).toBe('bearer');

    expect(schemes.ApiKeyAuth).toBeDefined();
    expect(schemes.ApiKeyAuth.type).toBe('apiKey');
    expect(schemes.ApiKeyAuth.name).toBe('x-api-key');
  });

  it('documents all authoritative FortiX API paths', async () => {
    const paths = Object.keys(openApiSpec.paths);
    
    // Core system & health
    expect(paths).toContain('/api/health');
    expect(paths).toContain('/api/health/live');
    expect(paths).toContain('/metrics');

    // Auth & Account
    expect(paths).toContain('/api/auth/register');
    expect(paths).toContain('/api/auth/login');
    expect(paths).toContain('/api/auth/me');
    expect(paths).toContain('/api/control/account/me');

    // Control plane core
    expect(paths).toContain('/api/control/projects');
    expect(paths).toContain('/api/control/routes');
    expect(paths).toContain('/api/control/keys');
    expect(paths).toContain('/api/control/keys/{id}/revoke');
    expect(paths).toContain('/api/control/policies');
    expect(paths).toContain('/api/control/experiments');
    expect(paths).toContain('/api/control/metrics');
    expect(paths).toContain('/api/control/verifications');
    expect(paths).toContain('/api/control/events');
    expect(paths).toContain('/api/control/webhooks');
    expect(paths).toContain('/api/control/settings');
    expect(paths).toContain('/api/control/reports/{verificationId}');

    // Gateway proxy
    expect(paths).toContain('/proxy/{routeId}');
  });

  it('contains no broken $ref references in schemas and responses', () => {
    const schemas = openApiSpec.components.schemas as Record<string, any>;
    const specStr = JSON.stringify(openApiSpec);
    const refRegex = /"\$ref":\s*"#\/components\/schemas\/([^"]+)"/g;
    
    let match;
    const refsFound: string[] = [];
    while ((match = refRegex.exec(specStr)) !== null) {
      refsFound.push(match[1]);
    }

    expect(refsFound.length).toBeGreaterThan(0);
    for (const refName of refsFound) {
      expect(schemas[refName], `Missing schema reference: ${refName}`).toBeDefined();
    }
  });

  it('serves human-readable documentation on GET /api-docs', async () => {
    const res = await request(app).get('/api-docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('FortiX API Documentation');
    expect(res.text).toContain('/api/openapi.json');
  });
});
