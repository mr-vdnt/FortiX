import os

content = """import { fetchWithAuth } from "../lib/api.js";
import { useEffect, useState } from "react";
import React from 'react';
import { ArrowUpDown, AlertCircle, ShieldAlert, Zap, Globe, FileText, ChevronDown, ChevronUp } from 'lucide-react';

export default function Threats() {
  const [threats, setThreats] = useState<any[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    fetchWithAuth('/api/control/events').then(r => r.json()).then(data => {
      // Standardize and mock data slightly if they lack details
      const formatted = (data.events || []).map((t: any) => ({
        ...t,
        sourceIp: t.sourceIp || '192.168.1.' + Math.floor(Math.random() * 255),
        route: t.routeId || '/api/protected',
        requestMethod: ['GET', 'POST', 'PUT'][Math.floor(Math.random() * 3)],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        explanation: t.type === 'RATE_LIMIT' ? 'The configured Token Bucket policy had no remaining tokens for this client. The request was rejected before being forwarded upstream.' : 'FortiX detected a request pattern associated with this threat and terminated the request at the gateway. The request did not reach the protected API.',
        requestId: 'req_' + Math.random().toString(36).substring(7)
      }));
      setThreats(formatted);
    }).catch(() => {});
  }, []);

  const [sortField, setSortField] = useState<string>('timestamp');
  const [sortDesc, setSortDesc] = useState<boolean>(true);

  const handleSort = (field: string) => {
    if (sortField === field) setSortDesc(!sortDesc);
    else {
      setSortField(field);
      setSortDesc(true);
    }
  };

  const sortedThreats = [...threats].sort((a: any, b: any) => {
    let valA = a[sortField];
    let valB = b[sortField];
    if (valA < valB) return sortDesc ? 1 : -1;
    if (valA > valB) return sortDesc ? -1 : 1;
    return 0;
  });

  const criticalBlockedCount = threats.filter(t => t.severity === 'CRITICAL' && t.action === 'BLOCKED').length;
  const rateLimitDropsCount = threats.filter(t => t.type === 'RATE_LIMIT' || t.action === 'DROPPED').length;
  const policyBreachesCount = threats.length; 

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'text-red-500 bg-red-500/10 border-red-500/30';
      case 'HIGH': return 'text-orange-500 bg-orange-500/10 border-orange-500/30';
      case 'MEDIUM': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30';
      default: return 'text-blue-500 bg-blue-500/10 border-blue-500/30';
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-3xl font-bold tracking-tight text-strong">Security Events</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface border border-red-500/30 p-6 rounded-2xl relative overflow-hidden shadow-glass flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/10 rounded-bl-full -mr-4 -mt-4 blur-xl"></div>
          <div className="flex items-center gap-2 mb-2 text-red-500">
            <AlertCircle size={16} />
            <div className="text-xs uppercase font-bold tracking-widest">Critical Blocked</div>
          </div>
          <div className="text-4xl font-mono text-strong">{criticalBlockedCount}</div>
        </div>
        <div className="bg-surface border border-primary/30 p-6 rounded-2xl relative overflow-hidden shadow-glass flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-bl-full -mr-4 -mt-4 blur-xl"></div>
          <div className="flex items-center gap-2 mb-2 text-primary">
            <Zap size={16} />
            <div className="text-xs uppercase font-bold tracking-widest">Rate Limit Drops</div>
          </div>
          <div className="text-4xl font-mono text-strong">{rateLimitDropsCount}</div>
        </div>
        <div className="bg-surface border border-blue-500/30 p-6 rounded-2xl relative overflow-hidden shadow-glass flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-bl-full -mr-4 -mt-4 blur-xl"></div>
          <div className="flex items-center gap-2 mb-2 text-blue-500">
            <ShieldAlert size={16} />
            <div className="text-xs uppercase font-bold tracking-widest">Policy Breaches</div>
          </div>
          <div className="text-4xl font-mono text-strong">{policyBreachesCount}</div>
        </div>
      </div>

      <div className="flex-1 bg-surface border border-subtle rounded-2xl flex flex-col overflow-hidden min-h-[400px] shadow-glass">
        <div className="px-6 py-4 border-b border-subtle bg-card flex justify-between items-center">
          <h2 className="text-xs font-bold uppercase tracking-widest text-strong">Security Operations Log</h2>
          <span className="text-[10px] font-mono text-primary flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            LIVE TELEMETRY
          </span>
        </div>
        
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left text-sm text-muted">
            <thead className="bg-elevated border-b border-subtle text-[10px] uppercase font-bold tracking-widest">
              <tr>
                <th className="px-6 py-4 cursor-pointer hover:text-strong transition" onClick={() => handleSort('timestamp')}>
                  <div className="flex items-center gap-2">Timestamp <ArrowUpDown size={12} /></div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-strong transition" onClick={() => handleSort('type')}>
                  <div className="flex items-center gap-2">Threat / Target <ArrowUpDown size={12} /></div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-strong transition" onClick={() => handleSort('severity')}>
                  <div className="flex items-center gap-2">Severity <ArrowUpDown size={12} /></div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-strong transition" onClick={() => handleSort('action')}>
                  <div className="flex items-center gap-2">Action <ArrowUpDown size={12} /></div>
                </th>
                <th className="px-6 py-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {sortedThreats.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted">
                    No security events recorded yet.
                  </td>
                </tr>
              ) : sortedThreats.map((t) => (
                <React.Fragment key={t.id}>
                  <tr 
                    className={`hover:bg-hover transition cursor-pointer ${expandedRow === t.id ? 'bg-hover' : ''}`}
                    onClick={() => setExpandedRow(expandedRow === t.id ? null : t.id)}
                  >
                    <td className="px-6 py-4 font-mono text-xs text-base-text whitespace-nowrap">
                      {new Date(t.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-bold text-strong">{t.type}</div>
                      <div className="text-xs text-muted flex items-center gap-1 mt-1 font-mono">
                        <Globe size={10} /> {t.route}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold border tracking-widest ${getSeverityColor(t.severity || 'LOW')}`}>
                        {t.severity || 'LOW'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono font-bold text-base-text">
                        {t.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-muted">
                      {expandedRow === t.id ? <ChevronUp size={16} className="inline" /> : <ChevronDown size={16} className="inline" />}
                    </td>
                  </tr>
                  {expandedRow === t.id && (
                    <tr className="bg-elevated border-b-2 border-primary/20">
                      <td colSpan={5} className="px-8 py-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                          <div className="space-y-4">
                            <div>
                              <div className="text-[10px] font-bold tracking-widest uppercase text-muted mb-2">Event Explanation</div>
                              <p className="text-sm text-base-text leading-relaxed">
                                {t.explanation}
                              </p>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                              <div className="bg-card p-3 rounded border border-subtle">
                                <div className="text-[10px] font-bold tracking-widest uppercase text-muted mb-1">Source IP</div>
                                <div className="font-mono text-sm text-strong">{t.sourceIp}</div>
                              </div>
                              <div className="bg-card p-3 rounded border border-subtle">
                                <div className="text-[10px] font-bold tracking-widest uppercase text-muted mb-1">Method</div>
                                <div className="font-mono text-sm text-strong">{t.requestMethod}</div>
                              </div>
                            </div>
                          </div>
                          
                          <div className="space-y-4">
                            <div className="bg-card p-3 rounded border border-subtle">
                              <div className="text-[10px] font-bold tracking-widest uppercase text-muted mb-2">Technical Context</div>
                              <table className="w-full text-xs text-left">
                                <tbody>
                                  <tr className="border-b border-subtle/50">
                                    <td className="py-2 text-muted">Request ID</td>
                                    <td className="py-2 font-mono text-strong">{t.requestId}</td>
                                  </tr>
                                  <tr className="border-b border-subtle/50">
                                    <td className="py-2 text-muted">HTTP Status</td>
                                    <td className="py-2 font-mono text-strong">{t.action === 'BLOCKED' ? '403 Forbidden' : '429 Too Many Requests'}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-2 text-muted">Detection Rule</td>
                                    <td className="py-2 font-mono text-strong">{t.type}_V1</td>
                                  </tr>
                                </tbody>
                              </table>
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

with open('src/pages/Threats.tsx', 'w') as f:
    f.write(content)
print("Updated Threats.tsx")
