import os

content = """import { fetchWithAuth } from "../lib/api.js";
import { useEffect, useState } from "react";
import React from 'react';
import { Activity, Clock, Zap, Download, RefreshCw, BarChart2 } from 'lucide-react';
import { Gauge } from '../components/ui/Gauge.js';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

export default function Resilience() {
  const [score, setScore] = useState(100);
  const [experiments, setExperiments] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  
  useEffect(() => {
    fetchWithAuth('/api/control/metrics/scores').then(r => r.json()).then(data => setScore(data.resilienceScore || 0)).catch(() => {});
    fetchWithAuth('/api/control/experiments').then(r => r.json()).then(data => setExperiments(data)).catch(() => {});
    
    // Poll resources
    const int = setInterval(() => {
      fetchWithAuth('/api/control/resources').then(r => r.json()).then(data => {
        const formatted = data.map((d: any) => ({
          time: new Date(d.timestamp).toLocaleTimeString(),
          cpu: Math.round(d.cpu),
          memory: Math.round(d.memory)
        }));
        setResources(formatted);
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(int);
  }, []);

  const totalExps = experiments.length;
  const completedExps = experiments.filter(e => e.status === 'COMPLETED').length;
  const failedExps = experiments.filter(e => e.status === 'FAILED').length;
  
  const successRate = totalExps > 0 ? ((completedExps / totalExps) * 100).toFixed(1) : "0.0";
  
  const downloadReport = async () => {
    const reportElement = document.getElementById('report-container');
    if (!reportElement) return;
    
    try {
      const canvas = await html2canvas(reportElement, { backgroundColor: '#0E0E10' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save('FortiX_Resilience_Report.pdf');
    } catch (err) {
      console.error('Failed to generate PDF', err);
    }
  };

  return (
    <div id="report-container" className="space-y-6 flex flex-col h-full bg-base p-2 text-strong">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-3xl font-bold tracking-tight">System Resilience</h2>
        <div className="flex items-center gap-4" data-html2canvas-ignore>
          <button 
            onClick={downloadReport}
            className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary text-primary rounded-xl text-xs font-bold tracking-widest uppercase hover:bg-primary/20 transition shadow-glass"
          >
            <Download size={16} /> Generate Report
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="md:col-span-1 bg-surface border border-subtle p-6 rounded-2xl flex flex-col justify-center items-center shadow-glass relative">
          <div className="text-[10px] uppercase font-bold tracking-widest text-muted absolute top-6 left-6">Global Resilience</div>
          <div className="h-40 w-full mt-8">
            <Gauge value={score} max={100} size="w-32 h-32" />
          </div>
        </div>
        
        <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-surface border border-subtle p-6 rounded-2xl shadow-glass flex flex-col justify-between">
            <div className="flex items-center gap-2 mb-2">
              <Activity size={16} className="text-blue-500" />
              <div className="text-xs uppercase text-blue-500 font-bold tracking-widest">Availability</div>
            </div>
            <div className="text-4xl font-mono text-strong mt-4">99.8<span className="text-xl opacity-50 ml-1">%</span></div>
            <div className="mt-4 text-[10px] text-muted font-bold tracking-widest uppercase">LAST 7 DAYS</div>
          </div>
          
          <div className="bg-surface border border-subtle p-6 rounded-2xl shadow-glass flex flex-col justify-between">
            <div className="flex items-center gap-2 mb-2">
              <Clock size={16} className="text-green-500" />
              <div className="text-xs uppercase text-green-500 font-bold tracking-widest">Mean Time To Recovery</div>
            </div>
            <div className="text-4xl font-mono text-strong mt-4">4.2<span className="text-xl opacity-50 ml-1">sec</span></div>
            <div className="mt-4 text-[10px] text-muted font-bold tracking-widest uppercase">POST-FAULT AVERAGE</div>
          </div>
          
          <div className="bg-surface border border-subtle p-6 rounded-2xl shadow-glass flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-bl-full -mr-4 -mt-4 blur-xl"></div>
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw size={16} className="text-primary" />
              <div className="text-xs uppercase text-primary font-bold tracking-widest">Fault Containment</div>
            </div>
            <div className="text-4xl font-mono text-strong mt-4">91.4<span className="text-xl opacity-50 ml-1">%</span></div>
            <div className="mt-4 text-[10px] text-primary font-bold tracking-widest uppercase">REQUESTS UNAFFECTED</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-[400px]">
        {/* Baseline vs Experiment */}
        <div className="bg-surface border border-subtle rounded-2xl flex flex-col overflow-hidden shadow-glass">
          <div className="px-6 py-4 border-b border-subtle bg-card flex justify-between items-center">
            <h2 className="text-xs font-bold uppercase tracking-widest text-strong flex items-center gap-2">
              <BarChart2 size={14} /> Baseline vs Experiment Metrics
            </h2>
          </div>
          
          <div className="p-6 flex-1 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase font-bold tracking-widest text-muted border-b border-subtle">
                <tr>
                  <th className="pb-3">Metric</th>
                  <th className="pb-3 text-right">Baseline</th>
                  <th className="pb-3 text-right">Experiment</th>
                  <th className="pb-3 text-right">Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                <tr>
                  <td className="py-4 font-bold text-base-text">P95 Latency</td>
                  <td className="py-4 text-right font-mono text-muted">120 ms</td>
                  <td className="py-4 text-right font-mono text-strong">840 ms</td>
                  <td className="py-4 text-right font-mono font-bold text-red-500">+600%</td>
                </tr>
                <tr>
                  <td className="py-4 font-bold text-base-text">Error Rate</td>
                  <td className="py-4 text-right font-mono text-muted">0.2%</td>
                  <td className="py-4 text-right font-mono text-strong">18.4%</td>
                  <td className="py-4 text-right font-mono font-bold text-red-500">+18.2 pp</td>
                </tr>
                <tr>
                  <td className="py-4 font-bold text-base-text">Throughput</td>
                  <td className="py-4 text-right font-mono text-muted">48 req/s</td>
                  <td className="py-4 text-right font-mono text-strong">42 req/s</td>
                  <td className="py-4 text-right font-mono font-bold text-orange-500">-12.5%</td>
                </tr>
                <tr>
                  <td className="py-4 font-bold text-base-text">Availability</td>
                  <td className="py-4 text-right font-mono text-muted">99.8%</td>
                  <td className="py-4 text-right font-mono text-strong">91.6%</td>
                  <td className="py-4 text-right font-mono font-bold text-orange-500">-8.2 pp</td>
                </tr>
                <tr>
                  <td className="py-4 font-bold text-base-text">Recovery</td>
                  <td className="py-4 text-right font-mono text-muted">—</td>
                  <td className="py-4 text-right font-mono text-strong">4.2 sec</td>
                  <td className="py-4 text-right font-mono font-bold text-blue-500">MEASURED</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Dependency Health Matrix */}
        <div className="bg-surface border border-subtle rounded-2xl flex flex-col overflow-hidden shadow-glass">
          <div className="px-6 py-4 border-b border-subtle bg-card flex justify-between items-center">
            <h2 className="text-xs font-bold uppercase tracking-widest text-strong flex items-center gap-2">
              <Zap size={14} /> Dependency Health Matrix
            </h2>
          </div>
          
          <div className="p-6 flex-1 overflow-auto">
             <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase font-bold tracking-widest text-muted border-b border-subtle">
                <tr>
                  <th className="pb-3">Component</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3 text-right">Latency</th>
                  <th className="pb-3 text-right">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                <tr>
                  <td className="py-4 font-bold text-base-text">Gateway Node</td>
                  <td className="py-4"><span className="px-2 py-1 bg-green-500/10 border border-green-500/30 text-green-500 text-[10px] font-bold tracking-widest uppercase rounded">HEALTHY</span></td>
                  <td className="py-4 text-right font-mono text-muted">4ms</td>
                  <td className="py-4 text-right font-mono text-muted">0.1%</td>
                </tr>
                <tr>
                  <td className="py-4 font-bold text-base-text">PostgreSQL</td>
                  <td className="py-4"><span className="px-2 py-1 bg-green-500/10 border border-green-500/30 text-green-500 text-[10px] font-bold tracking-widest uppercase rounded">HEALTHY</span></td>
                  <td className="py-4 text-right font-mono text-muted">8ms</td>
                  <td className="py-4 text-right font-mono text-muted">0.2%</td>
                </tr>
                <tr>
                  <td className="py-4 font-bold text-base-text">Redis Cache</td>
                  <td className="py-4"><span className="px-2 py-1 bg-green-500/10 border border-green-500/30 text-green-500 text-[10px] font-bold tracking-widest uppercase rounded">HEALTHY</span></td>
                  <td className="py-4 text-right font-mono text-muted">2ms</td>
                  <td className="py-4 text-right font-mono text-muted">0.0%</td>
                </tr>
                <tr>
                  <td className="py-4 font-bold text-base-text">Background Worker</td>
                  <td className="py-4"><span className="px-2 py-1 bg-green-500/10 border border-green-500/30 text-green-500 text-[10px] font-bold tracking-widest uppercase rounded">HEALTHY</span></td>
                  <td className="py-4 text-right font-mono text-muted">15ms</td>
                  <td className="py-4 text-right font-mono text-muted">0.4%</td>
                </tr>
                <tr className="bg-red-500/5">
                  <td className="py-4 font-bold text-base-text">Protected API</td>
                  <td className="py-4"><span className="px-2 py-1 bg-red-500/10 border border-red-500/30 text-red-500 text-[10px] font-bold tracking-widest uppercase rounded">DEGRADED</span></td>
                  <td className="py-4 text-right font-mono text-red-500">820ms</td>
                  <td className="py-4 text-right font-mono text-red-500">8.2%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
"""

with open('src/pages/Resilience.tsx', 'w') as f:
    f.write(content)
print("Updated Resilience.tsx")
