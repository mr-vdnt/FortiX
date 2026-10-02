import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { setupApiRoutes } from '../../src/api/index.js';
import { register, getPrometheusMetrics, httpRequestsTotal } from '../../src/lib/metrics.js';

describe('TSK-02: Prometheus Metrics Integration', () => {
  const app = express();
  app.use(express.json());
  setupApiRoutes(app);

  it('exports valid Prometheus register and metric helper', async () => {
    expect(register).toBeDefined();
    const data = await getPrometheusMetrics();
    expect(data.contentType).toContain('text/plain');
    expect(data.metrics).toBeDefined();
  });

  it('serves Prometheus metrics on GET /metrics with correct Content-Type', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.header['content-type']).toContain('text/plain');
    expect(res.text).toContain('fortix_http_requests_total');
    expect(res.text).toContain('fortix_http_request_duration_seconds');
  });

  it('records HTTP request metrics when endpoints are hit', async () => {
    await request(app).get('/api/health/live');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('fortix_http_requests_total');
  });
});
