import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { runHttpBenchmark, runComparativeGatewayBenchmark } from '../../src/verification/load-benchmark.js';
import fs from 'fs';
import path from 'path';

describe('TSK-10: Gateway Load Benchmark Engine', () => {
  let directServer: http.Server;
  let gatewayServer: http.Server;
  let directPort: number;
  let gatewayPort: number;

  beforeAll(async () => {
    // 1. Setup mock direct upstream server
    directServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', source: 'direct-upstream' }));
    });

    await new Promise<void>((resolve) => {
      directServer.listen(0, '127.0.0.1', () => {
        const addr = directServer.address() as any;
        directPort = addr.port;
        resolve();
      });
    });

    // 2. Setup mock gateway server with 2ms synthetic processing overhead
    gatewayServer = http.createServer((req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', source: 'fortix-gateway' }));
      }, 2);
    });

    await new Promise<void>((resolve) => {
      gatewayServer.listen(0, '127.0.0.1', () => {
        const addr = gatewayServer.address() as any;
        gatewayPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => directServer.close(() => resolve()));
    await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
  });

  it('runs HTTP benchmark and computes accurate throughput, latencies, and percentiles', async () => {
    const result = await runHttpBenchmark({
      name: 'Direct Load Test',
      targetUrl: `http://127.0.0.1:${directPort}`,
      totalRequests: 100,
      concurrency: 10,
      warmupRequests: 5,
    });

    expect(result.totalRequests).toBe(100);
    expect(result.successfulRequests).toBe(100);
    expect(result.failedRequests).toBe(0);
    expect(result.throughputRps).toBeGreaterThan(0);
    expect(result.latencies.p50).toBeGreaterThanOrEqual(0);
    expect(result.latencies.p95).toBeGreaterThanOrEqual(result.latencies.p50);
    expect(result.latencies.p99).toBeGreaterThanOrEqual(result.latencies.p95);
    expect(result.statusCodes[200]).toBe(100);
    expect(result.resourceUsage.startHeapMb).toBeGreaterThan(0);
  });

  it('runs comparative benchmark and measures gateway overhead SLA', async () => {
    const report = await runComparativeGatewayBenchmark(
      `http://127.0.0.1:${directPort}`,
      `http://127.0.0.1:${gatewayPort}`,
      {},
      { totalRequests: 50, concurrency: 5 }
    );

    expect(report.directUpstream.successfulRequests).toBe(50);
    expect(report.gatewayProtected.successfulRequests).toBe(50);
    expect(typeof report.gatewayOverheadMs.p50Delta).toBe('number');
    expect(typeof report.gatewayOverheadMs.p95Delta).toBe('number');
    expect(typeof report.gatewayOverheadMs.p99Delta).toBe('number');
    expect(report.targetOverheadSlaMet).toBe(true);

    // Verify report was written to disk
    const reportFilePath = path.resolve(process.cwd(), 'reports/gateway-benchmark-results.json');
    expect(fs.existsSync(reportFilePath)).toBe(true);
  });
});
