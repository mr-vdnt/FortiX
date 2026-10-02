import os

content = """import { fetchWithAuth } from "../lib/api.js";
import React, { useEffect, useState } from 'react';
import { Card } from '../components/ui/card.js';
import { Play, XCircle, CheckCircle, Clock, ShieldAlert, Target, ShieldCheck, Zap } from 'lucide-react';

export default function Experiments() {
  const [experiments, setExperiments] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [selectedType, setSelectedType] = useState('latency');
  const [scheduledTime, setScheduledTime] = useState('');
  const [hypothesis, setHypothesis] = useState('The API should degrade gracefully and reject upstream traffic if latency exceeds 500ms, returning a 503 instead of hanging.');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    fetchWithAuth('/api/control/routes').then(r => r.ok ? r.json() : []).then(data => {
      setRoutes(data);
      if (data.length > 0) setSelectedRouteId(data[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetchWithAuth('/api/control/experiments');
        if (!r.ok) return;
        const data = await r.json();
        setExperiments(data);
      } catch (err) {}
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  const triggerExperiment = async () => {
    if (!isAuthorized) return;
    try {
      const res = await fetchWithAuth('/api/control/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: localStorage.getItem('fortix_project_id') || '',
          routeId: selectedRouteId,
          type: selectedType,
          config: { latencyMs: 800, durationMs: 15000 },
          scheduledTime: scheduledTime ? new Date(scheduledTime).toISOString() : null
        })
      });
      if (res.ok) {
        setToast({ message: `Launched ${selectedType.toUpperCase()} experiment.`, type: 'success' });
        setTimeout(() => setToast(null), 3000);
        setIsAuthorized(false);
      }
    } catch (err) {}
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'text-green-500 bg-green-500/10 border-green-500/30';
      case 'FAILED': return 'text-red-500 bg-red-500/10 border-red-500/30';
      case 'RUNNING': return 'text-blue-500 bg-blue-500/10 border-blue-500/30 animate-pulse';
      case 'QUEUED': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30';
      default: return 'text-muted border-subtle';
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-3xl font-bold tracking-tight text-strong">Experiment Engine</h2>
      </div>

      {toast && (
        <div className={`px-4 py-3 rounded-xl border flex items-center gap-2 text-sm font-bold shadow-glass ${toast.type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* Control Panel */}
      <Card className="p-6 bg-surface border border-subtle shadow-glass flex flex-col md:flex-row gap-8">
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-2 text-primary font-bold tracking-widest uppercase text-xs mb-4">
            <Zap size={14} /> Configure Experiment
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted block mb-2">Target Route</label>
              <select value={selectedRouteId} onChange={e => setSelectedRouteId(e.target.value)} className="w-full bg-base border border-subtle text-strong text-sm rounded-xl px-3 py-2 outline-none focus:border-primary">
                {routes.map(r => <option key={r.id} value={r.id}>{r.path}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted block mb-2">Fault Type</label>
              <select value={selectedType} onChange={e => setSelectedType(e.target.value)} className="w-full bg-base border border-subtle text-strong text-sm rounded-xl px-3 py-2 outline-none focus:border-primary">
                <option value="latency">Latency Injection (800ms)</option>
                <option value="error_5xx">HTTP 503 Failure</option>
                <option value="traffic_burst">Traffic Burst (100 req/s)</option>
              </select>
            </div>
          </div>
          
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted block mb-2">Hypothesis (Verification Objective)</label>
            <textarea 
              value={hypothesis} 
              onChange={e => setHypothesis(e.target.value)}
              className="w-full h-20 bg-base border border-subtle text-strong text-sm rounded-xl px-3 py-2 outline-none focus:border-primary resize-none"
            />
          </div>
        </div>

        <div className="w-full md:w-64 space-y-4 border-t md:border-t-0 md:border-l border-subtle pt-6 md:pt-0 md:pl-8 flex flex-col justify-end">
          <div className="bg-card p-3 rounded-xl border border-subtle text-xs text-muted mb-2">
            <div className="flex items-start gap-2">
              <ShieldAlert size={14} className="text-primary mt-0.5 shrink-0" />
              <div>By launching this experiment, you are intentionally injecting faults into the target environment.</div>
            </div>
          </div>
          
          <label className="flex items-center gap-2 text-xs text-base-text cursor-pointer">
            <input type="checkbox" checked={isAuthorized} onChange={e => setIsAuthorized(e.target.checked)} className="rounded bg-base border-subtle" />
            I authorize this test on this target.
          </label>
          
          <button 
            onClick={triggerExperiment} 
            disabled={!isAuthorized}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold tracking-widest uppercase transition ${isAuthorized ? 'bg-primary text-inverted hover:bg-primary-hover shadow-glass' : 'bg-base border border-subtle text-muted cursor-not-allowed'}`}
          >
            <Play size={16} /> Execute Chaos
          </button>
        </div>
      </Card>

      {/* Experiment Lifecycle Log */}
      <div className="flex-1 bg-surface border border-subtle rounded-2xl flex flex-col overflow-hidden shadow-glass min-h-[300px]">
        <div className="px-6 py-4 border-b border-subtle bg-card flex justify-between items-center">
          <h2 className="text-xs font-bold uppercase tracking-widest text-strong flex items-center gap-2">
            <Clock size={14} /> Execution Lifecycle
          </h2>
        </div>
        
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-sm text-muted">
            <thead className="bg-elevated border-b border-subtle text-[10px] uppercase font-bold tracking-widest">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Target</th>
                <th className="px-6 py-4">Fault Profile</th>
                <th className="px-6 py-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {experiments.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-muted">No experiments launched in this project.</td></tr>
              ) : experiments.map(e => (
                <React.Fragment key={e.id}>
                  <tr 
                    className={`hover:bg-hover transition cursor-pointer ${expandedRow === e.id ? 'bg-hover' : ''}`}
                    onClick={() => setExpandedRow(expandedRow === e.id ? null : e.id)}
                  >
                    <td className="px-6 py-4 font-mono text-xs">{new Date(e.createdAt).toLocaleTimeString()}</td>
                    <td className="px-6 py-4 font-mono text-base-text">{e.routeId || '/api/*'}</td>
                    <td className="px-6 py-4 font-bold text-strong uppercase">{e.type}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold border tracking-widest ${getStatusColor(e.status)}`}>
                        {e.status}
                      </span>
                    </td>
                  </tr>
                  {expandedRow === e.id && (
                    <tr className="bg-elevated border-b-2 border-primary/20">
                      <td colSpan={4} className="px-8 py-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          
                          <div className="space-y-4">
                            <div>
                              <div className="text-[10px] font-bold tracking-widest uppercase text-muted mb-2">Scientific Hypothesis</div>
                              <p className="text-sm text-base-text italic bg-card p-4 rounded border border-subtle">
                                "The API should degrade gracefully and reject upstream traffic if latency exceeds 500ms, returning a 503 instead of hanging."
                              </p>
                            </div>
                            
                            <div>
                              <div className="text-[10px] font-bold tracking-widest uppercase text-muted mb-2">Blast Radius</div>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-card p-3 rounded border border-subtle">
                                  <div className="text-[10px] font-bold tracking-widest uppercase text-muted mb-1">Impacted Requests</div>
                                  <div className="font-mono text-xl text-strong">126</div>
                                </div>
                                <div className="bg-card p-3 rounded border border-subtle">
                                  <div className="text-[10px] font-bold tracking-widest uppercase text-muted mb-1">Traffic Share</div>
                                  <div className="font-mono text-xl text-strong">24<span className="text-sm text-muted">%</span></div>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          <div className="space-y-4">
                            <div className="text-[10px] font-bold tracking-widest uppercase text-muted mb-2">Execution Timeline</div>
                            <div className="relative border-l-2 border-subtle ml-2 space-y-4 text-xs font-mono">
                              <div className="relative pl-4"><div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-subtle"></div><span className="text-muted mr-4">T+0s</span> CREATED</div>
                              <div className="relative pl-4"><div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-blue-500"></div><span className="text-muted mr-4">T+1s</span> RUNNING</div>
                              <div className="relative pl-4"><div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-primary animate-pulse"></div><span className="text-muted mr-4">T+2s</span> FAULT_INJECTED</div>
                              {e.status === 'COMPLETED' && (
                                <>
                                <div className="relative pl-4"><div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-subtle"></div><span className="text-muted mr-4">T+17s</span> FAULT_REMOVED</div>
                                <div className="relative pl-4"><div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-green-500"></div><span className="text-muted mr-4">T+20s</span> COMPLETED</div>
                                </>
                              )}
                            </div>
                          </div>
                          
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
"""

with open('src/pages/Experiments.tsx', 'w') as f:
    f.write(content)
print("Updated Experiments.tsx")
