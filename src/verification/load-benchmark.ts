import http from 'http';
import { percentile } from '../lib/math.js';
import fs from 'fs';
import path from 'path';

export interface BenchmarkConfig {
  name: string;
  targetUrl: string;
  headers?: Record<string, string>;
  totalRequests: number;
  concurrency: number;
  warmupRequests?: number;
  timeoutMs?: number;
}

export interface LatencyStats {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface BenchmarkResult {
  benchmarkName: string;
  targetUrl: string;
  concurrency: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  durationSeconds: number;
  throughputRps: number;
  latencies: LatencyStats;
  statusCodes: Record<number, number>;
  errorRatePercent: number;
  resourceUsage: {
    startHeapMb: number;
    endHeapMb: number;
    heapDeltaMb: number;
  };
  timestamp: string;
}

export interface ComparativeBenchmarkReport {
  timestamp: string;
  directUpstream: BenchmarkResult;
  gatewayProtected: BenchmarkResult;
  gatewayOverheadMs: {
    p50Delta: number;
    p95Delta: number;
    p99Delta: number;
    meanDelta: number;
  };
  targetOverheadSlaMet: boolean; // Overhead < 15ms target
}

/**
 * Executes an in-process, high-precision HTTP load benchmark
 */
export async function runHttpBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
  const {
    name,
    targetUrl,
    headers = {},
    totalRequests,
    concurrency,
    warmupRequests = 0,
    timeoutMs = 5000,
  } = config;

  const url = new URL(targetUrl);
  const startHeap = process.memoryUsage().heapUsed / 1024 / 1024;

  // 1. Warmup phase (discarded from metrics)
  if (warmupRequests > 0) {
    for (let i = 0; i < warmupRequests; i++) {
      try {
        await executeSingleRequest(url, headers, timeoutMs);
      } catch {}
    }
  }

  // 2. Timed benchmark phase
  const latenciesMs: number[] = [];
  const statusCodes: Record<number, number> = {};
  let successfulRequests = 0;
  let failedRequests = 0;
  let completed = 0;

  const startTime = process.hrtime.bigint();

  // Worker pool for concurrency control
  const worker = async () => {
    while (true) {
      const currentIndex = completed++;
      if (currentIndex >= totalRequests) break;

      const reqStart = process.hrtime.bigint();
      try {
        const statusCode = await executeSingleRequest(url, headers, timeoutMs);
        const reqDurationMs = Number(process.hrtime.bigint() - reqStart) / 1e6;
        latenciesMs.push(reqDurationMs);
        statusCodes[statusCode] = (statusCodes[statusCode] || 0) + 1;
        if (statusCode >= 200 && statusCode < 400) {
          successfulRequests++;
        } else {
          failedRequests++;
        }
      } catch (err) {
        const reqDurationMs = Number(process.hrtime.bigint() - reqStart) / 1e6;
        latenciesMs.push(reqDurationMs);
        failedRequests++;
        statusCodes[599] = (statusCodes[599] || 0) + 1; // Network/timeout error
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, totalRequests) }, () => worker());
  await Promise.all(workers);

  const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
  const endHeap = process.memoryUsage().heapUsed / 1024 / 1024;

  const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);
  const sumLatency = sortedLatencies.reduce((acc, val) => acc + val, 0);
  const meanLatency = sortedLatencies.length > 0 ? sumLatency / sortedLatencies.length : 0;

  const stats: LatencyStats = {
    min: sortedLatencies.length > 0 ? sortedLatencies[0] : 0,
    max: sortedLatencies.length > 0 ? sortedLatencies[sortedLatencies.length - 1] : 0,
    mean: Math.round(meanLatency * 100) / 100,
    p50: sortedLatencies.length > 0 ? percentile(sortedLatencies, 0.5) : 0,
    p90: sortedLatencies.length > 0 ? percentile(sortedLatencies, 0.9) : 0,
    p95: sortedLatencies.length > 0 ? percentile(sortedLatencies, 0.95) : 0,
    p99: sortedLatencies.length > 0 ? percentile(sortedLatencies, 0.99) : 0,
  };

  const throughputRps =
    durationSeconds > 0 ? Math.round((totalRequests / durationSeconds) * 10) / 10 : 0;
  const errorRatePercent =
    totalRequests > 0 ? Math.round((failedRequests / totalRequests) * 1000) / 10 : 0;

  return {
    benchmarkName: name,
    targetUrl,
    concurrency,
    totalRequests,
    successfulRequests,
    failedRequests,
    durationSeconds: Math.round(durationSeconds * 1000) / 1000,
    throughputRps,
    latencies: stats,
    statusCodes,
    errorRatePercent,
    resourceUsage: {
      startHeapMb: Math.round(startHeap * 10) / 10,
      endHeapMb: Math.round(endHeap * 10) / 10,
      heapDeltaMb: Math.round((endHeap - startHeap) * 10) / 10,
    },
    timestamp: new Date().toISOString(),
  };
}

function executeSingleRequest(
  url: URL,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: 'GET',
        headers: {
          'Connection': 'keep-alive',
          'User-Agent': 'FortiX-Load-Benchmark/1.0',
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume(); // consume response stream to free memory
        res.on('end', () => resolve(res.statusCode || 200));
      }
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

/**
 * Executes a comparative benchmark comparing direct upstream vs FortiX gateway
 */
export async function runComparativeGatewayBenchmark(
  directUrl: string,
  gatewayUrl: string,
  gatewayHeaders: Record<string, string> = {},
  options: { totalRequests?: number; concurrency?: number } = {}
): Promise<ComparativeBenchmarkReport> {
  const total = options.totalRequests || 500;
  const conc = options.concurrency || 20;

  // 1. Direct Upstream Baseline
  const directResult = await runHttpBenchmark({
    name: 'Direct Upstream (Baseline)',
    targetUrl: directUrl,
    totalRequests: total,
    concurrency: conc,
    warmupRequests: 20,
  });

  // 2. Gateway Protected Path
  const gatewayResult = await runHttpBenchmark({
    name: 'FortiX Gateway Protected Proxy',
    targetUrl: gatewayUrl,
    headers: gatewayHeaders,
    totalRequests: total,
    concurrency: conc,
    warmupRequests: 20,
  });

  const p50Delta = Math.round((gatewayResult.latencies.p50 - directResult.latencies.p50) * 100) / 100;
  const p95Delta = Math.round((gatewayResult.latencies.p95 - directResult.latencies.p95) * 100) / 100;
  const p99Delta = Math.round((gatewayResult.latencies.p99 - directResult.latencies.p99) * 100) / 100;
  const meanDelta = Math.round((gatewayResult.latencies.mean - directResult.latencies.mean) * 100) / 100;

  const report: ComparativeBenchmarkReport = {
    timestamp: new Date().toISOString(),
    directUpstream: directResult,
    gatewayProtected: gatewayResult,
    gatewayOverheadMs: {
      p50Delta,
      p95Delta,
      p99Delta,
      meanDelta,
    },
    targetOverheadSlaMet: p50Delta <= 15,
  };

  // Save report to reports directory
  try {
    const reportsDir = path.resolve(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(reportsDir, 'gateway-benchmark-results.json'),
      JSON.stringify(report, null, 2),
      'utf8'
    );
  } catch (err) {
    // Non-fatal write error
  }

  return report;
}
