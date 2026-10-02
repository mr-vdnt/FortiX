export type TopologyStatus = 'healthy' | 'degraded' | 'error';

export interface TopologyNode {
  id: string;
  type: 'client' | 'gateway' | 'route' | 'worker' | 'redis' | 'postgres';
  label: string;
  status: TopologyStatus;
  metadata?: Record<string, unknown>;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  relation: 'request' | 'telemetry' | 'persistence';
  status: TopologyStatus;
}

export interface TopologyRoute {
  id: string;
  pathPattern: string;
  targetUrl: string;
}

export interface TopologyExperiment {
  id: string;
  routeId: string;
  type: string;
  status: string;
}

export interface TopologyHealth {
  postgres: TopologyStatus;
  redis: TopologyStatus;
}

export interface ResourceTelemetryPoint {
  timestamp: string;
  cpu: number;
  memory: number;
  heap: number;
}

export interface BuildTopologyInput {
  projectId: string;
  routes: TopologyRoute[];
  experiments: TopologyExperiment[];
  health: TopologyHealth;
  telemetry: ResourceTelemetryPoint | null;
}

export interface TopologySnapshot {
  schemaVersion: 1;
  generatedAt: string;
  projectId: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  telemetry: ResourceTelemetryPoint | null;
  activeExperiments: TopologyExperiment[];
}

const activeStatuses = new Set(['QUEUED', 'RUNNING', 'OBSERVING', 'ANALYZING']);

function statusForExperiment(experiment: TopologyExperiment): TopologyStatus {
  if (experiment.status === 'FAILED') return 'error';
  if (activeStatuses.has(experiment.status)) return 'degraded';
  return 'healthy';
}

export function buildTopology(input: BuildTopologyInput): TopologySnapshot {
  const generatedAt = new Date().toISOString();
  const activeExperiments = input.experiments.filter((experiment) => activeStatuses.has(experiment.status));

  const nodes: TopologyNode[] = [
    {
      id: 'client',
      type: 'client',
      label: 'Client Traffic',
      status: 'healthy'
    },
    {
      id: 'gateway',
      type: 'gateway',
      label: 'FortiX Gateway',
      status: 'healthy'
    }
  ];

  for (const route of input.routes) {
    const routeExperiments = input.experiments.filter((experiment) => experiment.routeId === route.id);
    const routeStatus = routeExperiments.some((experiment) => statusForExperiment(experiment) === 'error')
      ? 'error'
      : routeExperiments.some((experiment) => statusForExperiment(experiment) === 'degraded')
        ? 'degraded'
        : 'healthy';

    nodes.push({
      id: `route:${route.id}`,
      type: 'route',
      label: route.pathPattern,
      status: routeStatus,
      metadata: {
        routeId: route.id,
        targetUrl: route.targetUrl,
        activeExperimentCount: routeExperiments.filter((experiment) => activeStatuses.has(experiment.status)).length
      }
    });
  }

  nodes.push(
    {
      id: 'redis',
      type: 'redis',
      label: 'Redis',
      status: input.health.redis
    },
    {
      id: 'worker',
      type: 'worker',
      label: 'Telemetry / BullMQ Worker',
      status: input.health.redis === 'error' ? 'degraded' : 'healthy'
    },
    {
      id: 'postgres',
      type: 'postgres',
      label: 'PostgreSQL',
      status: input.health.postgres
    }
  );

  const edges: TopologyEdge[] = [
    {
      id: 'client->gateway',
      source: 'client',
      target: 'gateway',
      relation: 'request',
      status: 'healthy'
    },
    {
      id: 'gateway->redis',
      source: 'gateway',
      target: 'redis',
      relation: 'telemetry',
      status: input.health.redis
    },
    {
      id: 'redis->worker',
      source: 'redis',
      target: 'worker',
      relation: 'telemetry',
      status: input.health.redis
    },
    {
      id: 'worker->postgres',
      source: 'worker',
      target: 'postgres',
      relation: 'persistence',
      status: input.health.postgres
    }
  ];

  for (const route of input.routes) {
    edges.push({
      id: `gateway->route:${route.id}`,
      source: 'gateway',
      target: `route:${route.id}`,
      relation: 'request',
      status: nodes.find((node) => node.id === `route:${route.id}`)?.status ?? 'healthy'
    });
  }

  return {
    schemaVersion: 1,
    generatedAt,
    projectId: input.projectId,
    nodes,
    edges,
    telemetry: input.telemetry,
    activeExperiments
  };
}
