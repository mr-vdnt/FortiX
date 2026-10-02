import { fetchWithAuth } from "../lib/api.js";
import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Cloud,
  Database,
  Server,
  ShieldCheck,
  Workflow
} from 'lucide-react';

type TopologyStatus = 'healthy' | 'degraded' | 'error';

type TopologyNode = {
  id: string;
  type: 'client' | 'gateway' | 'route' | 'worker' | 'redis' | 'postgres';
  label: string;
  status: TopologyStatus;
  metadata?: {
    routeId?: string;
    targetUrl?: string;
    activeExperimentCount?: number;
  };
};

type TelemetryPoint = {
  timestamp: string;
  cpu: number;
  memory: number;
  heap: number;
};

type TopologyResponse = {
  projectId: string;
  generatedAt: string;
  nodes: TopologyNode[];
  activeExperiments: Array<{
    id: string;
    routeId: string;
    type: string;
    status: string;
  }>;
  telemetry: TelemetryPoint | null;
  telemetryHistory: TelemetryPoint[];
};

const statusClasses: Record<TopologyStatus, string> = {
  healthy: 'border-green-500/50 bg-green-500/5 text-green-400',
  degraded: 'border-yellow-500/50 bg-yellow-500/5 text-yellow-400',
  error: 'border-red-500/50 bg-red-500/5 text-red-400'
};

const statusLabel: Record<TopologyStatus, string> = {
  healthy: 'HEALTHY',
  degraded: 'DEGRADED',
  error: 'ERROR'
};

export default function Topology() {
  const [topology, setTopology] = useState<TopologyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projectId = new URLSearchParams(window.location.search).get('projectId') || '';

  useEffect(() => {
    let mounted = true;

    const loadTopology = async () => {
      try {
        const response = await fetchWithAuth(
          `/api/control/resources?projectId=${encodeURIComponent(projectId)}`
        );

        if (!response.ok) {
          throw new Error(`Topology request failed with HTTP ${response.status}`);
        }

        const data = await response.json() as TopologyResponse;
        if (mounted) {
          setTopology(data);
          setError(null);
        }
      } catch (cause) {
        if (mounted) {
          setError(cause instanceof Error ? cause.message : 'Unable to load topology telemetry');
        }
      }
    };

    void loadTopology();
    const interval = window.setInterval(() => void loadTopology(), 5000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [projectId]);

  const routeNodes = useMemo(
    () => topology?.nodes.filter((node) => node.type === 'route') ?? [],
    [topology]
  );

  const infrastructureNodes = useMemo(
    () => topology?.nodes.filter((node) => ['redis', 'worker', 'postgres'].includes(node.type)) ?? [],
    [topology]
  );

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-strong">System Topology</h2>
          <p className="text-xs text-muted mt-1">
            Tenant-scoped live request, telemetry and persistence topology
          </p>
        </div>
        <span className="text-[10px] font-mono text-muted border border-subtle px-3 py-1 rounded bg-card flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          LIVE · 5s
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <TelemetryStrip telemetry={topology?.telemetry ?? null} activeExperiments={topology?.activeExperiments.length ?? 0} />

      <div className="flex-1 bg-surface border border-subtle rounded-lg p-6 md:p-10 overflow-auto relative min-h-[480px]">
        {!topology ? (
          <div className="h-full min-h-[400px] flex items-center justify-center text-sm text-muted">
            Loading topology telemetry…
          </div>
        ) : (
          <div className="min-w-[980px] h-full min-h-[400px] flex flex-col justify-center gap-12">
            <div className="flex items-center justify-center gap-5">
              <TopologyNodeView node={findNode(topology.nodes, 'client')} icon={<Cloud size={28} />} />
              <TopologyArrow active />
              <TopologyNodeView node={findNode(topology.nodes, 'gateway')} icon={<ShieldCheck size={28} />} highlight />
              <TopologyArrow active />
              <div className="flex flex-col gap-3">
                {routeNodes.length === 0 ? (
                  <TopologyNodeView
                    node={{
                      id: 'route:none',
                      type: 'route',
                      label: 'No protected routes',
                      status: 'healthy'
                    }}
                    icon={<Server size={24} />}
                  />
                ) : (
                  routeNodes.map((node) => (
                    <div key={node.id} className="flex items-center gap-3">
                      <TopologyNodeView node={node} icon={<Server size={24} />} compact />
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center justify-center gap-5">
              {infrastructureNodes.map((node, index) => (
                <React.Fragment key={node.id}>
                  {index > 0 && <TopologyArrow active={node.status !== 'error'} />}
                  <TopologyNodeView
                    node={node}
                    icon={
                      node.type === 'worker'
                        ? <Workflow size={24} />
                        : <Database size={24} />
                    }
                  />
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TelemetryStrip({
  telemetry,
  activeExperiments
}: {
  telemetry: TelemetryPoint | null;
  activeExperiments: number;
}) {
  const metrics = [
    ['PROCESS CPU', telemetry ? `${telemetry.cpu.toFixed(1)}%` : '—'],
    ['MEMORY', telemetry ? `${telemetry.memory.toFixed(1)}%` : '—'],
    ['HEAP', telemetry ? `${telemetry.heap.toFixed(1)}%` : '—'],
    ['ACTIVE EXPERIMENTS', String(activeExperiments)]
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {metrics.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-subtle bg-card px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
          <div className="text-xl font-semibold text-strong mt-1">{value}</div>
        </div>
      ))}
    </div>
  );
}

function findNode(nodes: TopologyNode[], id: string): TopologyNode {
  return nodes.find((node) => node.id === id) ?? {
    id,
    type: id === 'client' ? 'client' : 'gateway',
    label: id === 'client' ? 'Client Traffic' : 'FortiX Gateway',
    status: 'error'
  };
}

function TopologyNodeView({
  node,
  icon,
  highlight = false,
  compact = false
}: {
  node: TopologyNode;
  icon: React.ReactNode;
  highlight?: boolean;
  compact?: boolean;
}) {
  const classes = highlight
    ? 'border-primary bg-primary/10 text-primary'
    : statusClasses[node.status];

  return (
    <div
      title={node.metadata?.targetUrl}
      className={`relative flex flex-col items-center justify-center rounded-lg border shadow-lg transition-transform hover:scale-[1.02] ${compact ? 'w-48 min-h-24 px-3' : 'w-44 h-28 px-4'} ${classes}`}
    >
      <div className="mb-2">{icon}</div>
      <div className="text-[11px] font-bold uppercase tracking-widest text-center text-base-text">
        {node.label}
      </div>
      <div className="text-[9px] font-mono mt-1 opacity-80">
        {highlight ? 'GATEWAY' : statusLabel[node.status]}
        {node.metadata?.activeExperimentCount
          ? ` · ${node.metadata.activeExperimentCount} EXP`
          : ''}
      </div>
    </div>
  );
}

function TopologyArrow({ active }: { active: boolean }) {
  return (
    <div className="relative flex items-center justify-center w-10 shrink-0">
      <div className={`absolute w-full h-0.5 ${active ? 'bg-border-strong' : 'bg-border'}`} />
      <ArrowRight
        className={`${active ? 'text-[#4A4A4C]' : 'text-[#2A2A2C']} w-5 h-5 shrink-0 relative z-10 bg-surface px-1`}
      />
    </div>
  );
}
