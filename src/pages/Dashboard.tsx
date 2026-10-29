import { fetchWithAuth, parseApiErrorResponse, setActiveProjectId, trackProductEvent } from '../lib/api.js';
import React, { useEffect, useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { SystemLogs } from '../components/SystemLogs.js';
import { useProject } from '../context/ProjectContext.js';
import { Link, useOutletContext } from 'react-router-dom';
import {
  Globe,
  ArrowRight,
  CheckCircle2,
  Circle,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';
import type { CurrentOperatorUser } from '../App.js';

export default function Dashboard() {
  const { currentProject, refreshProjects } = useProject();
  const outlet = useOutletContext<{ currentUser?: CurrentOperatorUser | null }>() || {};
  const currentUser = outlet.currentUser || null;

  const [metrics, setMetrics] = useState<any[]>([]);
  const [experiments, setExperiments] = useState<any[]>([]);
  const [routesCount, setRoutesCount] = useState(0);
  const [keysCount, setKeysCount] = useState(0);
  const [policiesCount, setPoliciesCount] = useState(0);
  const [scores, setScores] = useState({ securityScore: 0, resilienceScore: 0 });
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; requestId?: string } | null>(null);
  const [isProvisioningDemo, setIsProvisioningDemo] = useState(false);
  const [demoNotice, setDemoNotice] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      return localStorage.getItem('fortix_onboarding_collapsed') !== 'true';
    } catch {
      return true;
    }
  });

  const isDemoWorkspace = Boolean(
    currentProject?.name?.startsWith('[DEMO]') ||
      (currentProject as any)?.settings?.telemetryConfig?.isDemoWorkspace
  );

  const fetchDashboardData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsInitialLoading(true);
    try {
      const [scoresRes, metricsRes, expRes, routesRes, keysRes, polRes] = await Promise.all([
        fetchWithAuth('/api/control/metrics/scores'),
        fetchWithAuth('/api/control/metrics'),
        fetchWithAuth('/api/control/experiments'),
        fetchWithAuth('/api/control/routes'),
        fetchWithAuth('/api/control/keys'),
        fetchWithAuth('/api/control/policies'),
      ]);

      if (!metricsRes.ok) {
        const parsed = await parseApiErrorResponse(metricsRes, 'Unable to load live gateway telemetry.');
        setLoadError({ message: parsed.message, requestId: parsed.requestId });
      } else {
        setLoadError(null);
        const data = await metricsRes.json();
        setMetrics(Array.isArray(data) ? data : []);
      }

      if (scoresRes.ok) {
        const data = await scoresRes.json();
        setScores({
          securityScore: Number(data.securityScore) || 0,
          resilienceScore: Number(data.resilienceScore) || 0,
        });
      }

      if (expRes.ok) {
        const expData = await expRes.json();
        setExperiments(Array.isArray(expData) ? expData : []);
      }

      if (routesRes.ok) {
        const rData = await routesRes.json();
        setRoutesCount(Array.isArray(rData) ? rData.length : 0);
      }

      if (keysRes.ok) {
        const kData = await keysRes.json();
        setKeysCount(Array.isArray(kData) ? kData.filter((k: any) => !k.revoked).length : 0);
      }

      if (polRes.ok) {
        const pData = await polRes.json();
        setPoliciesCount(Array.isArray(pData) ? pData.length : 0);
      }
    } catch {
      setLoadError({
        message: 'Network connection interrupted while polling FortiX telemetry. Check server connectivity and retry.',
      });
    } finally {
      setIsInitialLoading(false);
    }
  }, [currentProject?.id]);

  useEffect(() => {
    fetchDashboardData(true);
    const interval = setInterval(() => fetchDashboardData(false), 4000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  const handleToggleOnboarding = () => {
    const next = !onboardingOpen;
    setOnboardingOpen(next);
    try {
      localStorage.setItem('fortix_onboarding_collapsed', next ? 'false' : 'true');
    } catch {}
    if (next) {
      trackProductEvent('onboarding_step_viewed', isDemoWorkspace ? 'demo' : 'standard');
    }
  };

  const handleProvisionDemoWorkspace = async () => {
    setIsProvisioningDemo(true);
    setDemoNotice('');
    try {
      const res = await fetchWithAuth('/api/control/projects/demo-workspace/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await parseApiErrorResponse(res, 'Could not provision Demo Workspace.');
        setLoadError({ message: err.message, requestId: err.requestId });
        return;
      }
      const data = await res.json();
      if (data?.project?.id) {
        setActiveProjectId(data.project.id);
        await refreshProjects();
        setDemoNotice('Labelled [DEMO] Sandbox Workspace loaded with 4 local demo routes and DEMO_SEED baseline records.');
        setTimeout(() => setDemoNotice(''), 6000);
      }
    } catch {
      setLoadError({ message: 'Failed to provision Demo Workspace.' });
    } finally {
      setIsProvisioningDemo(false);
    }
  };

  const activeExp = experiments.find((e) => e.status === 'RUNNING' || e.status === 'ANALYZING');
  const completedExpCount = experiments.filter((e) => e.status === 'COMPLETED').length;

  const chartData = metrics
    .map((m) => ({
      time: m.timestamp,
      latency: Number(m.latency) || 0,
      p50: Number(m.p50) || 0,
    }))
    .slice(-30);

  const calculateHealth = () => {
    if (metrics.length === 0) return 100;
    const errors = metrics.filter((m) => Number(m.errorRate) > 0).length;
    return Math.max(0, Math.round(((metrics.length - errors) / metrics.length) * 100));
  };
  const dynamicHealth = calculateHealth();

  const onboardingSteps = [
    {
      label: 'Verify operator email',
      done: Boolean(currentUser?.emailVerified),
      to: '/settings?tab=account',
      cta: 'Account',
    },
    {
      label: 'Select or create an API project',
      done: Boolean(currentProject?.id),
      to: '/settings?tab=projects',
      cta: 'Projects',
    },
    {
      label: 'Register an authorized upstream route',
      done: routesCount > 0,
      to: '/apis',
      cta: 'Add Route',
    },
    {
      label: 'Issue a scoped gateway API key',
      done: keysCount > 0,
      to: '/apis',
      cta: 'Issue Key',
    },
    {
      label: 'Apply WAF, SSRF & Rate-Limit policy',
      done: policiesCount > 0,
      to: '/security',
      cta: 'Policies',
    },
    {
      label: 'Run bounded verification & inspect evidence',
      done: completedExpCount > 0,
      to: '/verifications',
      cta: 'Verify',
    },
  ];
  const completedSteps = onboardingSteps.filter((s) => s.done).length;

  return (
    <div className="space-y-6 flex flex-col min-h-full">
      {/* Demo Workspace Provenance Banner */}
      {isDemoWorkspace && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-amber-200 leading-relaxed">
            <strong className="font-semibold text-amber-300">Demo Workspace Active (`DEMO_SEED`):</strong>{' '}
            Seeded routes, baseline latency samples, and policy block records in this project are synthetic demonstration fixtures targeting the local demo upstream (`:3001`). Run a live verification in{' '}
            <Link to="/verifications" className="underline hover:text-white">
              Verifications
            </Link>{' '}
            to record real gateway evidence.
          </div>
          <button
            type="button"
            disabled={isProvisioningDemo}
            onClick={handleProvisionDemoWorkspace}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw size={13} />
            <span>{isProvisioningDemo ? 'Resetting...' : 'Reset Demo Baseline'}</span>
          </button>
        </div>
      )}

      {demoNotice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{demoNotice}</span>
        </div>
      )}

      {/* Recoverable Error State */}
      {loadError && (
        <div
          role="alert"
          className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-red-300"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-red-200">{loadError.message}</div>
              {loadError.requestId && (
                <div className="font-mono text-[11px] text-red-300/80 mt-0.5">
                  Request ID: {loadError.requestId}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchDashboardData(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/35 text-red-100 font-semibold whitespace-nowrap shrink-0"
          >
            <RefreshCw size={13} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Responsive KPI Strip */}
      {isInitialLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((idx) => (
            <div key={idx} className="bg-card border border-subtle p-4 rounded-2xl animate-pulse space-y-3">
              <div className="h-3 w-24 bg-hover rounded" />
              <div className="h-8 w-20 bg-hover rounded" />
              <div className="h-1 w-full bg-hover rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            title="Security Score"
            value={scores.securityScore.toString()}
            subtext="/100"
            progress={scores.securityScore}
            progressColor="bg-emerald-500"
          />
          <MetricCard
            title="Resilience Score"
            value={scores.resilienceScore.toString()}
            subtext="/100"
            progress={scores.resilienceScore}
            progressColor="bg-primary"
          />
          <MetricCard
            title="Gateway Availability"
            value={dynamicHealth.toString()}
            subtext="%"
            progress={dynamicHealth}
            progressColor="bg-blue-500"
          />
        </div>
      )}

      {/* Guided Operator Onboarding & Safe Demo Workspace Provisioner */}
      <div className="bg-surface border border-subtle rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-subtle bg-card">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-semibold text-strong">Operator Onboarding &amp; Verification Workflow</span>
            <span className="text-xs text-muted font-mono tabular-nums">
              {completedSteps}/{onboardingSteps.length} complete
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isDemoWorkspace && (
              <button
                type="button"
                disabled={isProvisioningDemo}
                onClick={handleProvisionDemoWorkspace}
                className="px-3.5 py-1.5 rounded-lg bg-hover hover:bg-hover-strong border border-subtle text-xs font-semibold text-strong transition-colors whitespace-nowrap"
              >
                {isProvisioningDemo ? 'Provisioning Demo...' : 'Load [DEMO] Sandbox Workspace'}
              </button>
            )}
            <button
              type="button"
              onClick={handleToggleOnboarding}
              className="p-1.5 rounded-lg text-muted hover:text-strong transition-colors"
              aria-label={onboardingOpen ? 'Collapse onboarding checklist' : 'Expand onboarding checklist'}
            >
              {onboardingOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>

        {onboardingOpen && (
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {onboardingSteps.map((step, index) => (
              <div
                key={step.label}
                className="p-3.5 rounded-xl bg-base border border-subtle flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {step.done ? (
                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                  ) : (
                    <Circle size={16} className="text-muted shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted font-mono tabular-nums">0{index + 1}</div>
                    <div className={`text-xs font-medium truncate ${step.done ? 'text-muted' : 'text-strong'}`}>
                      {step.label}
                    </div>
                  </div>
                </div>
                <Link
                  to={step.to}
                  className="text-xs font-semibold text-primary hover:underline whitespace-nowrap shrink-0"
                >
                  {step.cta}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Public API Directory Discovery Bar */}
      <div className="bg-card border border-subtle rounded-xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <Globe size={18} className="text-primary shrink-0 mt-0.5 sm:mt-0" />
          <div className="min-w-0">
            <span className="text-sm font-semibold text-strong">Public API Directory</span>
            <span className="text-xs text-muted ml-2">
              Browse 814 public reference APIs across 29 categories. Only register targets you own or are authorized to test.
            </span>
          </div>
        </div>
        <Link
          to="/directory"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-primary text-inverted text-xs font-semibold rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
        >
          <span>Open Directory</span>
          <ArrowRight size={14} />
        </Link>
      </div>

      {activeExp && (
        <div className="bg-hover border border-primary/30 p-5 rounded-2xl">
          <h3 className="text-primary font-semibold mb-1 text-sm">
            Active Experiment: {String(activeExp.type).toUpperCase()}
          </h3>
          <p className="text-xs text-muted mb-3 font-mono">Target Route ID: {activeExp.routeId}</p>
          <div className="w-full bg-base h-2 rounded-full overflow-hidden border border-subtle">
            <div className="bg-primary h-full w-2/3" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-[300px]">
        <div className="bg-surface border border-subtle rounded-2xl flex flex-col overflow-hidden min-h-[280px]">
          <div className="px-4 py-3 border-b border-subtle bg-card flex justify-between items-center">
            <h2 className="text-xs font-semibold text-strong">Gateway Latency · P95 / P50 (ms)</h2>
            <span className="text-[11px] font-mono text-muted tabular-nums">
              {chartData.length} buckets
            </span>
          </div>
          <div className="flex-1 p-5 flex flex-col justify-center">
            {chartData.length === 0 ? (
              <div className="text-center space-y-2 py-8 px-4">
                <p className="text-sm font-semibold text-strong">No gateway telemetry recorded yet</p>
                <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
                  Send traffic through a protected proxy route or run a bounded verification to populate P50 and P95 latency observations.
                </p>
                <div className="pt-2 flex items-center justify-center gap-3">
                  <Link
                    to="/verifications"
                    className="px-3.5 py-2 rounded-lg bg-primary text-inverted text-xs font-semibold whitespace-nowrap"
                  >
                    Run Verification
                  </Link>
                  {!isDemoWorkspace && (
                    <button
                      type="button"
                      disabled={isProvisioningDemo}
                      onClick={handleProvisionDemoWorkspace}
                      className="px-3.5 py-2 rounded-lg bg-hover border border-subtle text-strong text-xs font-semibold whitespace-nowrap"
                    >
                      Load Demo Workspace
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <XAxis dataKey="time" hide />
                  <YAxis stroke="#4A4A4C" tick={{ fill: '#8E8E93', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111113', borderColor: '#2A2A2C', color: '#E0E0E0' }}
                    itemStyle={{ color: '#F27D26' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="latency"
                    name="P95 Latency (ms)"
                    stroke="#F27D26"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="p50"
                    name="P50 Latency (ms)"
                    stroke="#4A4A4C"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    strokeDasharray="3 3"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="min-h-[280px] flex flex-col">
          <SystemLogs />
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtext,
  progress,
  progressColor,
}: {
  title: string;
  value: string;
  subtext?: string;
  progress?: number;
  progressColor?: string;
}) {
  return (
    <div className="bg-card border border-subtle p-4 rounded-2xl">
      <div className="text-xs text-muted font-medium mb-2">{title}</div>
      <div className="text-3xl font-mono tabular-nums text-strong">
        {value}
        {subtext && <span className="text-lg opacity-50 ml-1">{subtext}</span>}
      </div>
      {progress !== undefined && (
        <div className="mt-2.5 h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className={`h-full ${progressColor || 'bg-emerald-500'}`}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}
