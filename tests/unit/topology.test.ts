import { describe, expect, it } from 'vitest';
import { buildTopology } from '../../src/topology/service.js';

describe('TSK-09: Dynamic Telemetry Topology', () => {
  it('builds a tenant-scoped topology from current routes and experiments', () => {
    const snapshot = buildTopology({
      projectId: 'project-a',
      routes: [
        { id: 'route-1', pathPattern: '/payments', targetUrl: 'https://payments.example.test' },
        { id: 'route-2', pathPattern: '/users', targetUrl: 'https://users.example.test' }
      ],
      experiments: [
        { id: 'exp-1', routeId: 'route-1', type: 'latency', status: 'RUNNING' },
        { id: 'exp-2', routeId: 'route-2', type: 'error_5xx', status: 'COMPLETED' }
      ],
      health: { postgres: 'healthy', redis: 'healthy' },
      telemetry: {
        timestamp: '2026-10-02T17:00:00.000Z',
        cpu: 12.5,
        memory: 44.2,
        heap: 31.1
      }
    });

    expect(snapshot.projectId).toBe('project-a');
    expect(snapshot.nodes.map((node) => node.id)).toEqual([
      'client',
      'gateway',
      'route:route-1',
      'route:route-2',
      'redis',
      'worker',
      'postgres'
    ]);
    expect(snapshot.edges).toHaveLength(6);
    expect(snapshot.activeExperiments).toHaveLength(1);
    expect(snapshot.nodes.find((node) => node.id === 'route:route-1')?.status).toBe('degraded');
    expect(snapshot.nodes.find((node) => node.id === 'route:route-2')?.status).toBe('healthy');
  });

  it('marks failed experiments as route errors', () => {
    const snapshot = buildTopology({
      projectId: 'project-b',
      routes: [{ id: 'route-1', pathPattern: '/checkout', targetUrl: 'https://checkout.example.test' }],
      experiments: [{ id: 'exp-1', routeId: 'route-1', type: 'error_5xx', status: 'FAILED' }],
      health: { postgres: 'healthy', redis: 'degraded' },
      telemetry: null
    });

    expect(snapshot.nodes.find((node) => node.id === 'route:route-1')?.status).toBe('error');
    expect(snapshot.nodes.find((node) => node.id === 'redis')?.status).toBe('degraded');
    expect(snapshot.edges.find((edge) => edge.id === 'gateway->redis')?.status).toBe('degraded');
    expect(snapshot.telemetry).toBeNull();
  });

  it('supports an empty project without fabricating route nodes', () => {
    const snapshot = buildTopology({
      projectId: 'empty-project',
      routes: [],
      experiments: [],
      health: { postgres: 'healthy', redis: 'healthy' },
      telemetry: null
    });

    expect(snapshot.nodes.filter((node) => node.type === 'route')).toHaveLength(0);
    expect(snapshot.activeExperiments).toEqual([]);
  });
});
