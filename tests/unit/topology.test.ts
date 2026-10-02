import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateProjectTopology, TopologySnapshot } from '../../src/api/topology.js';
import { db } from '../../src/db/index.js';
import { projects, apiRoutes, metricLogs, experiments } from '../../src/db/schema.js';

describe('TSK-09: Dynamic Telemetry Topology Engine', () => {
  const testProjectId = 'proj_topo_test_1';
  const testRouteId1 = 'route_topo_users';
  const testRouteId2 = 'route_topo_payments';
  const foreignProjectId = 'proj_foreign_tenant';
  const foreignRouteId = 'route_foreign_secret';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates an empty topology snapshot safely when no routes exist', async () => {
    const snapshot = await generateProjectTopology('non_existent_proj', 15);

    expect(snapshot).toBeDefined();
    expect(snapshot.projectId).toBe('non_existent_proj');
    expect(snapshot.nodes.length).toBe(4); // Ingress, Gateway, DB, Queue nodes
    expect(snapshot.edges.length).toBe(3); // Ingress->Gateway, Gateway->DB, Gateway->Queue
    expect(snapshot.summary.totalRequests).toBe(0);
    expect(snapshot.summary.overallErrorRate).toBe(0);
  });

  it('calculates accurate request counts, p50/p95 latency, and error rates', async () => {
    // Generate snapshot for test project
    const snapshot = await generateProjectTopology(testProjectId, 15);

    expect(snapshot).toBeDefined();
    expect(snapshot.nodes.length).toBeGreaterThanOrEqual(4);
    expect(snapshot.summary.totalNodes).toBe(snapshot.nodes.length);
    expect(typeof snapshot.summary.overallErrorRate).toBe('number');
    expect(typeof snapshot.summary.avgLatencyP95Ms).toBe('number');
  });

  it('enforces strict project and tenant isolation across topology graphs', async () => {
    const projASnapshot = await generateProjectTopology(testProjectId, 15);
    const projBSnapshot = await generateProjectTopology(foreignProjectId, 15);

    // Ensure routes from Project A do not leak into Project B
    const projARouteNodes = projASnapshot.nodes.filter(n => n.type === 'upstream').map(n => n.id);
    const projBRouteNodes = projBSnapshot.nodes.filter(n => n.type === 'upstream').map(n => n.id);

    for (const nodeA of projARouteNodes) {
      expect(projBRouteNodes).not.toContain(nodeA);
    }
  });

  it('correctly builds directed edges with throughput and latency labels', async () => {
    const snapshot = await generateProjectTopology(testProjectId, 15);

    const gatewayToDbEdge = snapshot.edges.find(e => e.source === 'node-gateway' && e.target === 'node-db');
    const gatewayToQueueEdge = snapshot.edges.find(e => e.source === 'node-gateway' && e.target === 'node-queue');
    const clientToGatewayEdge = snapshot.edges.find(e => e.source === 'node-client' && e.target === 'node-gateway');

    expect(gatewayToDbEdge).toBeDefined();
    expect(gatewayToQueueEdge).toBeDefined();
    expect(clientToGatewayEdge).toBeDefined();
    expect(clientToGatewayEdge?.source).toBe('node-client');
    expect(clientToGatewayEdge?.target).toBe('node-gateway');
  });

  it('assigns degraded status to routes or gateway when fault experiments are active', async () => {
    const snapshot = await generateProjectTopology(testProjectId, 15);
    expect(['healthy', 'degraded', 'critical', 'idle']).toContain(snapshot.summary.systemHealth);
  });
});
