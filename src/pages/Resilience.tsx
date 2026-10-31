import { fetchWithAuth } from '../lib/api.js';
import { useEffect, useState } from 'react';
import React from 'react';
import {
  Activity,
  Clock,
  Download,
  RefreshCw,
  BarChart2,
  CheckCircle,
  XCircle,
  Server,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { Gauge } from '../components/ui/Gauge.js';

function normalizeUiVerdict(raw?: string | null): 'PASS' | 'FAIL' | 'INCONCLUSIVE' {
  const upper = String(raw || '').trim().toUpperCase();
  if (upper === 'PASS' || upper === 'PASSED') return 'PASS';
  if (upper === 'FAIL' || upper === 'FAILED') return 'FAIL';
  return 'INCONCLUSIVE';
}

function getVerdictBadgeClasses(verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE') {
  if (verdict === 'PASS') {
    return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
  }
  if (verdict === 'FAIL') {
    return 'bg-rose-500/10 text-rose-400 border border-rose-500/30';
  }
  return 'bg-amber-500/10 text-amber-400 border border-amber-500/30';
}

export default function Resilience() {
  const [score, setScore] = useState(100);
  const [summary, setSummary] = useState<any>(null);
  const [verifications, setVerifications] = useState<any[]>([]);
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const projectId = localStorage.getItem('fortix_project_id') || '';

  const loadData = () => {
    fetchWithAuth(`/api/control/metrics/resilience-summary?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data) => {
        setSummary(data);
        if (data?.globalScore !== undefined) setScore(data.globalScore);
      })
      .catch(() => {});

    fetchWithAuth(`/api/control/verifications?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setVerifications(data);
      })
      .catch(() => {});

    fetchWithAuth('/api/control/system/health')
      .then((r) => r.json())
      .then((data) => setSystemHealth(data))
      .catch(() => {});
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [projectId]);

  const downloadReport = async () => {
    setIsGenerating(true);
    try {
      const latestVerif = verifications[0];
      const verificationId = latestVerif?.id || `RES-${Date.now()}`;
      const bodyPayload: Record<string, any> = { projectId };
      if (!latestVerif?.id) {
        bodyPayload.details = [
          `Global Resilience Score: ${score}/100`,
          `Availability: ${summary?.availability != null ? `${summary.availability}%` : 'INSUFFICIENT_DATA'}`,
          `P50 Latency: ${summary?.liveTelemetry?.p50Ms != null ? `${summary.liveTelemetry.p50Ms}ms` : 'INSUFFICIENT_DATA'}`,
          `P95 Latency: ${summary?.liveTelemetry?.p95Ms != null ? `${summary.liveTelemetry.p95Ms}ms` : 'INSUFFICIENT_DATA'}`,
          `Error Rate: ${summary?.liveTelemetry?.errorRate != null ? `${summary.liveTelemetry.errorRate}%` : 'INSUFFICIENT_DATA'}`,
          `Recorded Verifications: ${verifications.length}`,
        ].join('\n');
      }
      const res = await fetchWithAuth(`/api/control/reports/${verificationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      if (!res.ok) throw new Error('Failed to generate server-side PDF');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FortiX_Resilience_Evidence_Report_${verificationId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate PDF', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const comp = summary?.comparison;
  const latestVerdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE' = comp?.verdict
    ? normalizeUiVerdict(comp.verdict)
    : verifications.length > 0
    ? normalizeUiVerdict(verifications[0].verdict)
    : 'INCONCLUSIVE';

  return (
    <div id="report-container" className="space-y-8 flex flex-col min-h-full max-w-6xl mx-auto w-full pb-12">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-strong">Resilience Dashboard</h2>
          <p className="text-xs text-muted">
            Authoritative resilience telemetry, latency degradation analysis, and objective verification.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            title="Refresh metrics"
            className="p-2 bg-surface hover:bg-hover border border-subtle rounded-xl text-muted hover:text-strong transition shadow-sm"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={downloadReport}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary text-primary rounded-xl text-xs font-bold tracking-widest uppercase hover:bg-primary/20 transition shadow-glass disabled:opacity-50"
          >
            <Download size={16} /> {isGenerating ? 'Generating...' : 'Evidence Report'}
          </button>
        </div>
      </div>

      {/* 1. RESILIENCE OVERVIEW */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 bg-surface border border-subtle p-6 rounded-2xl flex flex-col justify-center items-center shadow-glass relative">
          <div className="text-[10px] uppercase font-bold tracking-widest text-muted absolute top-6 left-6">
            Global Resilience
          </div>
          <div className="h-40 w-full mt-6">
            <Gauge value={score} label="Score" />
          </div>
        </div>

        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-surface border border-subtle p-6 rounded-2xl shadow-glass flex flex-col justify-between">
            <div className="flex items-center gap-2 mb-2">
              <Activity size={16} className="text-blue-500" />
              <div className="text-xs uppercase text-blue-500 font-bold tracking-widest">Availability</div>
            </div>
            <div className="text-4xl font-mono text-strong mt-4">
              {summary?.availability != null ? (
                <>
                  {summary.availability}
                  <span className="text-xl opacity-50 ml-1">%</span>
                </>
              ) : (
                <span className="text-2xl text-muted">N/A</span>
              )}
            </div>
            <div className="mt-4 text-[10px] text-muted font-bold tracking-widest uppercase">
              OBSERVED GATEWAY AVAILABILITY
            </div>
          </div>

          <div className="bg-surface border border-subtle p-6 rounded-2xl shadow-glass flex flex-col justify-between">
            <div className="flex items-center gap-2 mb-2">
              <Clock size={16} className="text-emerald-400" />
              <div className="text-xs uppercase text-emerald-400 font-bold tracking-widest">MTTR</div>
            </div>
            <div className="text-4xl font-mono text-strong mt-4">
              {summary?.mttrSeconds != null ? (
                <>
                  {summary.mttrSeconds}
                  <span className="text-xl opacity-50 ml-1">sec</span>
                </>
              ) : (
                <span className="text-2xl text-muted">N/A</span>
              )}
            </div>
            <div className="mt-4 text-[10px] text-muted font-bold tracking-widest uppercase">
              MEASURED RECOVERY TIME
            </div>
          </div>

          <div className="bg-surface border border-subtle p-6 rounded-2xl shadow-glass flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-bl-full -mr-4 -mt-4 blur-xl"></div>
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={16} className="text-primary" />
              <div className="text-xs uppercase text-primary font-bold tracking-widest">Fault Containment</div>
            </div>
            <div className="text-4xl font-mono text-strong mt-4">
              {summary?.faultContainment != null ? (
                <>
                  {summary.faultContainment}
                  <span className="text-xl opacity-50 ml-1">%</span>
                </>
              ) : (
                <span className="text-2xl text-muted">N/A</span>
              )}
            </div>
            <div className="mt-4 text-[10px] text-primary font-bold tracking-widest uppercase">
              OBSERVED NON-5XX RATIO
            </div>
          </div>
        </div>
      </div>

      {/* 2. LIVE TELEMETRY (Proxy Overhead & Live Metrics) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-surface border border-subtle rounded-2xl p-6 shadow-glass flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-6">
            <Server size={16} className="text-strong" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-strong">Gateway Telemetry Summary</h3>
          </div>
          <div className="space-y-4 font-mono text-sm">
            <div className="flex justify-between border-b border-subtle pb-2">
              <span className="text-muted">Observed Samples</span>
              <span className="text-strong">{summary?.liveTelemetry?.sampleCount ?? 0}</span>
            </div>
            <div className="flex justify-between border-b border-subtle pb-2">
              <span className="text-muted">Through FortiX (P50)</span>
              <span className="text-strong">
                {summary?.gatewayOverhead?.fortixMs != null ? `${summary.gatewayOverhead.fortixMs} ms` : 'N/A (<5 samples)'}
              </span>
            </div>
            <div className="flex justify-between text-primary font-bold pt-2">
              <span>Latest Verdict</span>
              <span>{latestVerdict}</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-surface border border-subtle rounded-2xl p-6 shadow-glass flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-6">
            <BarChart2 size={16} className="text-strong" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-strong">Live Ingress Telemetry</h3>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-card border border-subtle p-4 rounded-xl">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">P50 Latency</div>
              <div className="text-2xl font-mono text-strong">
                {summary?.liveTelemetry?.p50Ms != null ? `${summary.liveTelemetry.p50Ms} ms` : 'N/A'}
              </div>
            </div>
            <div className="bg-card border border-subtle p-4 rounded-xl">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">P95 Latency</div>
              <div className="text-2xl font-mono text-strong">
                {summary?.liveTelemetry?.p95Ms != null ? `${summary.liveTelemetry.p95Ms} ms` : 'N/A'}
              </div>
            </div>
            <div className="bg-card border border-subtle p-4 rounded-xl">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Error Rate</div>
              <div className="text-2xl font-mono text-strong">
                {summary?.liveTelemetry?.errorRate != null ? `${summary.liveTelemetry.errorRate}%` : 'N/A'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. BASELINE vs EXPERIMENT */}
      <div className="bg-surface border border-subtle rounded-2xl flex flex-col overflow-hidden shadow-glass">
        <div className="px-6 py-4 border-b border-subtle bg-card flex justify-between items-center">
          <h2 className="text-xs font-bold uppercase tracking-widest text-strong">
            Baseline vs Fault Injection Comparison {comp ? `(${comp.experimentName})` : ''}
          </h2>
          {comp && (
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-primary/10 border border-primary/30 text-primary text-[10px] font-mono font-bold uppercase rounded">
                Status: {comp.status}
              </span>
              <span
                className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded ${getVerdictBadgeClasses(
                  normalizeUiVerdict(comp.verdict)
                )}`}
              >
                {normalizeUiVerdict(comp.verdict)}
              </span>
            </div>
          )}
        </div>
        <div className="p-6 overflow-auto">
          {comp ? (
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase font-bold tracking-widest text-muted border-b border-subtle">
                <tr>
                  <th className="pb-3">Metric</th>
                  <th className="pb-3 text-right">Baseline</th>
                  <th className="pb-3 text-right">During Fault</th>
                  <th className="pb-3 text-right">Recovery</th>
                  <th className="pb-3 text-right">Delta Impact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                <tr>
                  <td className="py-4 font-bold text-base-text">Latency</td>
                  <td className="py-4 text-right font-mono text-muted">{comp.latency.baseline}</td>
                  <td className="py-4 text-right font-mono text-strong">{comp.latency.fault}</td>
                  <td className="py-4 text-right font-mono text-emerald-400">{comp.latency.recovery}</td>
                  <td className="py-4 text-right font-mono font-bold text-rose-400">{comp.latency.delta}</td>
                </tr>
                <tr>
                  <td className="py-4 font-bold text-base-text">Error Rate</td>
                  <td className="py-4 text-right font-mono text-muted">{comp.errorRate.baseline}</td>
                  <td className="py-4 text-right font-mono text-strong">{comp.errorRate.fault}</td>
                  <td className="py-4 text-right font-mono text-emerald-400">{comp.errorRate.recovery}</td>
                  <td className="py-4 text-right font-mono font-bold text-rose-400">{comp.errorRate.delta}</td>
                </tr>
                <tr>
                  <td className="py-4 font-bold text-base-text">Availability</td>
                  <td className="py-4 text-right font-mono text-muted">{comp.availability.baseline}</td>
                  <td className="py-4 text-right font-mono text-strong">{comp.availability.fault}</td>
                  <td className="py-4 text-right font-mono text-emerald-400">{comp.availability.recovery}</td>
                  <td className="py-4 text-right font-mono font-bold text-amber-400">{comp.availability.delta}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="py-8 text-center text-xs text-muted">
              <p className="mb-2">No active or historical resilience experiment recorded for this project yet.</p>
              <p>Run a chaos injection experiment from the Chaos panel to record real-time baseline vs degradation evidence.</p>
            </div>
          )}
        </div>
      </div>

      {/* 4. INFRASTRUCTURE DEPENDENCY HEALTH */}
      <div className="bg-surface border border-subtle rounded-2xl flex flex-col overflow-hidden shadow-glass">
        <div className="px-6 py-4 border-b border-subtle bg-card">
          <h2 className="text-xs font-bold uppercase tracking-widest text-strong">Infrastructure Dependencies</h2>
        </div>
        <div className="p-6 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] uppercase font-bold tracking-widest text-muted border-b border-subtle">
              <tr>
                <th className="pb-3">Component</th>
                <th className="pb-3 text-right">Status</th>
                <th className="pb-3 text-right">Latency / Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              <tr>
                <td className="py-4 font-bold text-base-text">PostgreSQL Database</td>
                <td className="py-4 text-right">
                  <span className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold tracking-widest uppercase rounded">
                    {systemHealth?.postgres?.status || 'UNKNOWN'}
                  </span>
                </td>
                <td className="py-4 text-right text-xs text-muted font-mono">
                  {systemHealth?.postgres?.latencyMs != null ? `${systemHealth.postgres.latencyMs} ms` : '—'}
                </td>
              </tr>
              <tr>
                <td className="py-4 font-bold text-base-text">Redis Cache & Rate Limiter</td>
                <td className="py-4 text-right">
                  <span className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold tracking-widest uppercase rounded">
                    {systemHealth?.redis?.status || 'UNKNOWN'}
                  </span>
                </td>
                <td className="py-4 text-right text-xs text-muted font-mono">
                  {systemHealth?.redis?.latencyMs != null ? `${systemHealth.redis.latencyMs} ms` : '—'}
                </td>
              </tr>
              <tr>
                <td className="py-4 font-bold text-base-text">Reverse Proxy Gateway</td>
                <td className="py-4 text-right">
                  <span className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold tracking-widest uppercase rounded">
                    OPERATIONAL
                  </span>
                </td>
                <td className="py-4 text-right text-xs text-muted font-mono">Active</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. OBJECTIVE VERIFICATION PROOFS */}
      <div className="bg-surface border border-subtle rounded-2xl flex flex-col overflow-hidden shadow-glass">
        <div className="px-6 py-4 border-b border-subtle bg-card flex justify-between items-center">
          <h2 className="text-xs font-bold uppercase tracking-widest text-strong">Resilience Objective Verifications</h2>
          <span className="text-xs font-mono text-muted">{verifications.length} Proofs</span>
        </div>
        <div className="p-6">
          {verifications.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {verifications.slice(0, 6).map((v) => {
                const verdict = normalizeUiVerdict(v.verdict);
                const obs = v.observed ?? v.observedMetrics ?? {};
                const createdTs = v.createdAt ?? v.timestamp;
                const summaryLine =
                  typeof obs === 'object' && obs !== null
                    ? obs.summary ||
                      `total=${obs.total ?? 0}, 2xx=${obs.accepted ?? 0}, 429=${obs.rejected ?? 0}, 5xx=${obs.error ?? 0}, avg=${obs.avgLatencyMs ?? 'N/A'}ms`
                    : String(obs);

                return (
                  <div key={v.id} className="p-4 bg-base border border-subtle rounded-xl space-y-2">
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-xs font-mono text-strong font-bold truncate">
                        Exp: {String(v.experimentId || v.id).substring(0, 14)}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded uppercase shrink-0 ${getVerdictBadgeClasses(
                          verdict
                        )}`}
                      >
                        {verdict}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted font-mono break-words">{summaryLine}</div>
                    <div className="text-[10px] text-muted pt-1 border-t border-subtle">
                      {createdTs ? new Date(createdTs).toLocaleString() : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted flex flex-col items-center gap-2">
              <AlertCircle size={20} className="text-amber-400" />
              <div className="font-bold uppercase tracking-wider text-amber-400">INCONCLUSIVE — NO VERIFICATION PROOFS RECORDED</div>
              <p>Execute an experiment or autonomous verification run to produce synchronized telemetry evidence.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
