import { fetchWithAuth } from "../lib/api.js";
import React, { useEffect, useState } from 'react';
import { Card } from '../components/ui/card.js';
import { ShieldCheck, CheckCircle, XCircle, Activity, Zap, Shield, AlertTriangle } from 'lucide-react';

export default function Verifications() {
  const [scores, setScores] = useState({ securityScore: 0, resilienceScore: 0 });
  const [verifications, setVerifications] = useState<any[]>([]);
  const [lastExperiment, setLastExperiment] = useState<any>(null);

  useEffect(() => {
    // Fetch Scores
    fetchWithAuth('/api/control/metrics/scores')
      .then(r => r.json())
      .then(data => setScores({ securityScore: data.securityScore || 0, resilienceScore: data.resilienceScore || 0 }))
      .catch(() => {});

    // Fetch Verifications (mocking the structure for the requested UI if needed, but pulling real if available)
    fetchWithAuth('/api/control/verifications')
      .then(r => r.json())
      .then(data => {
        setVerifications(data);
      })
      .catch(() => {});
      
    // Fetch Experiments to get the last one
    fetchWithAuth('/api/control/experiments')
      .then(r => r.json())
      .then(data => {
        if (data && data.length > 0) {
          setLastExperiment(data[0]);
        }
      })
      .catch(() => {});
  }, []);

  const displayVerifications = verifications.map(v => {
    const verdict = v.verdict || (v.passed ? 'PASSED' : 'FAILED');
    const passed = verdict === 'PASSED';
    let objective = 'Verification Objective';
    if (v.expected) {
      if (typeof v.expected === 'object') {
        const entries = Object.entries(v.expected);
        objective = entries.map(([k, val]) => `${k}: ${val}`).join(', ');
      } else {
        objective = String(v.expected);
      }
    }
    return {
      id: v.id,
      name: v.name || 'Resilience Contract',
      objective: objective.length > 35 ? objective.substring(0, 35) + '...' : objective,
      passed
    };
  });

  return (
    <div className="space-y-6 flex flex-col h-full max-w-5xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-2">
        <ShieldCheck size={28} className="text-primary" />
        <h2 className="text-3xl font-bold tracking-tight text-strong">FortiX Verification Center</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* SCORES CARD */}
        <Card className="p-6 bg-surface border border-subtle flex flex-col justify-center">
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield size={24} className="text-green-500" />
                <span className="text-xl font-bold text-base-text">Security Score</span>
              </div>
              <div className="text-4xl font-mono text-strong">{scores.securityScore} <span className="text-xl text-muted">/ 100</span></div>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Activity size={24} className="text-blue-500" />
                <span className="text-xl font-bold text-base-text">Resilience Score</span>
              </div>
              <div className="text-4xl font-mono text-strong">{scores.resilienceScore} <span className="text-xl text-muted">/ 100</span></div>
            </div>
          </div>
        </Card>

        {/* POLICY VERIFICATIONS CARD */}
        <Card className="p-6 bg-surface border border-subtle flex flex-col">
          <h3 className="text-[10px] font-bold tracking-widest uppercase text-muted mb-6">Policy Verifications</h3>
          {displayVerifications.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">
              No policy verifications recorded yet. Launch an experiment from the Experiments view to evaluate policy compliance.
            </div>
          ) : (
            <div className="space-y-3">
              {displayVerifications.map((v: any, i: number) => (
                <div key={v.id || i} className="flex items-center justify-between py-2 border-b border-subtle/50 last:border-0">
                  <div className="flex-1 font-bold text-sm text-base-text">{v.name}</div>
                  <div className="flex-1 text-xs text-muted font-mono">{v.objective}</div>
                  <div className={`flex items-center gap-2 text-xs font-bold tracking-widest uppercase ${v.passed ? 'text-green-500' : 'text-red-500'}`}>
                    {v.passed ? <CheckCircle size={14} /> : <XCircle size={14} />}
                    {v.passed ? 'PASS' : 'FAIL'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* LAST EXPERIMENT CARD */}
      <Card className="p-0 bg-surface border border-subtle overflow-hidden relative">
        <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
        <div className="p-6">
          <h3 className="text-[10px] font-bold tracking-widest uppercase text-muted mb-6">Latest Experiment Verification</h3>
          
          {lastExperiment ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="space-y-4 lg:col-span-1">
                <div>
                  <div className="text-xl font-bold text-strong">
                    {lastExperiment.type === 'latency' ? 'Latency Degradation Test' : `${lastExperiment.type.toUpperCase()} Chaos Test`}
                  </div>
                  <div className="text-sm text-muted mt-1">Route ID: <span className="font-mono text-base-text">{lastExperiment.routeId}</span></div>
                  <div className="text-sm text-muted mt-1">Status: <span className="font-mono font-bold text-primary">{lastExperiment.status}</span></div>
                  <div className="text-sm text-muted mt-1">Config: <span className="font-mono text-base-text">{JSON.stringify(lastExperiment.config)}</span></div>
                </div>
              </div>

              <div className="space-y-3 lg:col-span-1 border-l border-subtle pl-8">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted">Created</span>
                  <span className="font-mono text-strong text-xs">{new Date(lastExperiment.createdAt).toLocaleTimeString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted">Started</span>
                  <span className="font-mono text-strong text-xs">{lastExperiment.startedAt ? new Date(lastExperiment.startedAt).toLocaleTimeString() : 'Pending'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted">Completed</span>
                  <span className="font-mono text-strong text-xs">{lastExperiment.completedAt ? new Date(lastExperiment.completedAt).toLocaleTimeString() : 'In Progress'}</span>
                </div>
              </div>

              <div className="space-y-4 lg:col-span-1 border-l border-subtle pl-8 flex flex-col justify-between">
                <div>
                  <div className="text-sm text-muted mb-1">State</div>
                  <div className="text-2xl font-mono text-strong">{lastExperiment.status}</div>
                </div>
                
                <div className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-bold tracking-widest uppercase border ${
                  lastExperiment.status === 'COMPLETED' 
                    ? 'bg-green-500/10 border-green-500/30 text-green-400' 
                    : lastExperiment.status === 'FAILED' 
                      ? 'bg-red-500/10 border-red-500/30 text-red-400' 
                      : 'bg-primary/10 border-primary/30 text-primary'
                }`}>
                  {lastExperiment.status === 'COMPLETED' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                  <span>{lastExperiment.status}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted">
              No chaos experiments executed yet for this project.
            </div>
          )}
        </div>
      </Card>
      
      {/* VERIFICATION EVIDENCE TIMELINE */}
      <Card className="p-6 bg-surface border border-subtle mt-4">
        <h3 className="text-[10px] font-bold tracking-widest uppercase text-muted mb-6">Verification Evidence Timeline</h3>
        {lastExperiment ? (
          <div className="relative border-l-2 border-subtle ml-3 space-y-6">
            <div className="relative pl-6">
              <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-surface bg-subtle"></div>
              <div className="flex items-center gap-4">
                <div className="font-mono text-xs text-muted w-24">{new Date(lastExperiment.createdAt).toLocaleTimeString()}</div>
                <div className="text-xs font-bold tracking-widest uppercase text-strong">EXPERIMENT CREATED</div>
              </div>
            </div>
            {lastExperiment.startedAt && (
              <div className="relative pl-6">
                <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-surface bg-primary"></div>
                <div className="flex items-center gap-4">
                  <div className="font-mono text-xs text-muted w-24">{new Date(lastExperiment.startedAt).toLocaleTimeString()}</div>
                  <div className="text-xs font-bold tracking-widest uppercase text-primary">FAULT INJECTION ACTIVE</div>
                </div>
              </div>
            )}
            {lastExperiment.completedAt && (
              <div className="relative pl-6">
                <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-surface bg-green-500"></div>
                <div className="flex items-center gap-4">
                  <div className="font-mono text-xs text-muted w-24">{new Date(lastExperiment.completedAt).toLocaleTimeString()}</div>
                  <div className="text-xs font-bold tracking-widest uppercase text-green-500">EVALUATION COMPLETE ({lastExperiment.status})</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-muted">
            Timeline activates upon launching an experiment.
          </div>
        )}
      </Card>
      
    </div>
  );
}
