import client from 'prom-client';

// Dedicated Prometheus Registry for FortiX
export const register = new client.Registry();

// Set default labels
register.setDefaultLabels({
  app: 'fortix_gateway'
});

// Collect default metrics (memory, CPU, GC, event loop lag, etc.)
client.collectDefaultMetrics({ register });

// Custom application metrics
export const httpRequestsTotal = new client.Counter({
  name: 'fortix_http_requests_total',
  help: 'Total number of HTTP requests handled by FortiX',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'fortix_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

export const gatewayRequestsTotal = new client.Counter({
  name: 'fortix_gateway_requests_total',
  help: 'Total number of requests proxied through gateway',
  labelNames: ['route_id', 'method', 'status_code'],
  registers: [register]
});

export const activeExperimentsGauge = new client.Gauge({
  name: 'fortix_active_experiments',
  help: 'Current count of active chaos experiments',
  registers: [register]
});

export const systemHealthGauge = new client.Gauge({
  name: 'fortix_system_health_status',
  help: 'FortiX system health status (1 = healthy, 0 = degraded/unhealthy)',
  registers: [register]
});

export const apiKeyCacheInvalidationsTotal = new client.Counter({
  name: 'fortix_api_key_cache_invalidations_total',
  help: 'Total number of API key cache invalidations received via Pub/Sub',
  labelNames: ['source', 'event_type'],
  registers: [register]
});

export const dlqJobsTotal = new client.Counter({
  name: 'fortix_dlq_jobs_total',
  help: 'Total number of jobs moved to DLQ',
  labelNames: ['queue', 'job_name'],
  registers: [register]
});

export const dlqRetriesTotal = new client.Counter({
  name: 'fortix_dlq_retries_total',
  help: 'Total number of DLQ jobs retried',
  labelNames: ['queue', 'job_name'],
  registers: [register]
});

export const dlqCurrentGauge = new client.Gauge({
  name: 'fortix_dlq_current_jobs',
  help: 'Current count of unresolved DLQ jobs',
  labelNames: ['queue'],
  registers: [register]
});

export async function getPrometheusMetrics(): Promise<{ contentType: string; metrics: string }> {
  return {
    contentType: register.contentType,
    metrics: await register.metrics()
  };
}
