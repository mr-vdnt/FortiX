import { fetchWithAuth } from "../lib/api.js";
import React, { useEffect, useState } from 'react';
import { Server, Database, Cloud, ArrowRight, ShieldCheck, Activity } from 'lucide-react';
import { motion } from 'motion/react';

export default function Topology() {
  const [healthStatus, setHealthStatus] = useState({ db: 'ok', redis: 'ok' });
  const [activeExperiments, setActiveExperiments] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [healthRes, expRes, routesRes] = await Promise.all([
          fetch('/api/health'),
          fetchWithAuth('/api/control/experiments'),
          fetchWithAuth('/api/control/routes')
        ]);
        
        if (healthRes.ok) {
          const data = await healthRes.json();
          setHealthStatus({ db: data.db, redis: data.redis });
        }
        
        if (expRes.ok) {
          const data = await expRes.json();
          setActiveExperiments(data.filter((e: any) => e.status === 'RUNNING' || e.status === 'ANALYZING'));
        }

        if (routesRes.ok) {
          const data = await routesRes.json();
          setRoutes(data);
        }
      } catch (e) {
        // network issue
      }
    };
    
    fetchData();
    const int = setInterval(fetchData, 5000);
    return () => clearInterval(int);
  }, []);

  const hasLatency = activeExperiments.some(e => e.type === 'latency');
  const hasError = activeExperiments.some(e => e.type === 'error_5xx');

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-3xl font-bold tracking-tight text-strong">System Topology</h2>
        <span className="text-[10px] font-mono text-muted border border-subtle px-3 py-1 rounded bg-card flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          LIVE MAPPING
        </span>
      </div>
      
      <div className="flex-1 bg-surface border border-subtle rounded-lg p-10 flex items-center justify-center overflow-auto relative min-h-[400px]">
        {/* Visual nodes */}
        <div className="flex items-center gap-4 md:gap-12 min-w-max">
          <Node icon={<Cloud size={32} />} label="Client Traffic" status="ok" />
          <Arrow active={true} />
          
          <Node 
            icon={<ShieldCheck size={32} />} 
            label="FortiX Gateway" 
            highlight 
            status="ok" 
          />
          
          <Arrow active={activeExperiments.length > 0} color={activeExperiments.length > 0 ? "text-primary" : "text-[#4A4A4C]"} />
          
          <div className="flex flex-col gap-12">
            <div className="flex items-center gap-4 md:gap-8 relative">
              <Node 
                icon={<Server size={32} />} 
                label={routes.length > 0 ? `Upstream APIs (${routes.length})` : "Protected API"} 
                status={hasError ? "error" : hasLatency ? "warn" : "ok"} 
                badge={hasError ? "FAULT: 503" : hasLatency ? "FAULT: LATENCY" : ""}
              />
              <Arrow active={healthStatus.db === 'ok'} />
              <Node 
                icon={<Database size={32} />} 
                label="PostgreSQL (Core DB)" 
                status={healthStatus.db === 'error' ? 'error' : 'ok'} 
              />
            </div>
            
            <div className="flex items-center gap-4 md:gap-8">
              <Node 
                icon={<Activity size={32} />} 
                label="BullMQ Worker" 
                status="ok" 
                badge={activeExperiments.length > 0 ? "PROCESSING" : ""}
              />
              <Arrow active={healthStatus.redis === 'ok'} />
              <Node 
                icon={<Database size={32} />} 
                label="Redis (Token Bucket)" 
                status={healthStatus.redis === 'error' ? 'error' : 'ok'} 
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Node({ icon, label, highlight, status, badge }: { icon: React.ReactNode, label: string, highlight?: boolean, status?: 'ok'|'warn'|'error', badge?: string }) {
  let borderColor = 'border-subtle';
  let bgColor = 'bg-card';
  let textColor = 'text-strong';
  
  if (highlight) {
    borderColor = 'border-primary';
    bgColor = 'bg-primary/10';
    textColor = 'text-primary';
  } else if (status === 'error') {
    borderColor = 'border-red-500';
    bgColor = 'bg-red-500/10';
    textColor = 'text-red-400';
  } else if (status === 'warn') {
    borderColor = 'border-yellow-500';
    bgColor = 'bg-yellow-500/10';
    textColor = 'text-yellow-400';
  }

  return (
    <div className={`flex flex-col items-center justify-center w-36 h-32 rounded-lg border ${borderColor} ${bgColor} relative z-10 transition-transform hover:scale-105 shadow-lg`}>
      {badge && (
        <span className="absolute -top-3 -right-3 bg-hover border border-subtle text-primary text-[9px] px-2 py-1 rounded-full font-bold tracking-widest animate-pulse z-20">
          {badge}
        </span>
      )}
      <div className={`mb-3 ${textColor}`}>{icon}</div>
      <div className="text-xs font-bold uppercase tracking-widest text-center px-2 text-base-text">{label}</div>
    </div>
  );
}

function Arrow({ active, color }: { active?: boolean, color?: string }) {
  return (
    <div className="relative flex items-center justify-center w-12">
      <div className={`absolute w-full h-0.5 ${color || (active ? 'bg-border-strong' : 'bg-border')}`}></div>
      <ArrowRight className={`${color || (active ? 'text-[#4A4A4C]' : 'text-[#2A2A2C]')} w-6 h-6 shrink-0 relative z-10 bg-surface px-1`} />
    </div>
  );
}
