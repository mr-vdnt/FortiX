import React, { useEffect, useState } from 'react';
import { X, Shield, Activity, Clock, Server, ArrowRight, Lock } from 'lucide-react';
import { getEventDescription, getEventCategory } from './eventMetadata.js';
import { fetchWithAuth } from '../../lib/api.js';

export function LogDetailDrawer({ 
  eventId, 
  projectId, 
  onClose,
  onRelatedClick
}: { 
  eventId: string | null; 
  projectId: string; 
  onClose: () => void;
  onRelatedClick: (id: string) => void;
}) {
  const [event, setEvent] = useState<any>(null);
  const [relatedEvents, setRelatedEvents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!eventId) {
      setEvent(null);
      return;
    }
    
    let isMounted = true;
    const loadEvent = async () => {
      setIsLoading(true);
      try {
        const res = await fetchWithAuth(`/api/control/events?projectId=${projectId}&eventId=${eventId}`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setEvent(data);
            fetchRelated(data);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    
    const fetchRelated = async (ev: any) => {
      try {
        // Fetch a few events for the same route to simulate related events
        const res = await fetchWithAuth(`/api/control/events?projectId=${projectId}&limit=5`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            // filter out current
            setRelatedEvents(data.events.filter((e: any) => e.id !== ev.id && e.routeId === ev.routeId).slice(0, 4));
          }
        }
      } catch (e) {
        // ignore
      }
    };

    loadEvent();
    return () => { isMounted = false; };
  }, [eventId, projectId]);

  if (!eventId) return null;

  return (
    <div className={`fixed inset-y-0 right-0 w-[500px] max-w-full bg-elevated border-l border-subtle shadow-2xl z-50 transform transition-transform duration-300 ${eventId ? 'translate-x-0' : 'translate-x-full'} flex flex-col`}>
      <div className="flex items-center justify-between p-4 border-b border-subtle bg-card">
        <h2 className="text-sm font-bold uppercase tracking-widest text-strong">Event Details</h2>
        <button onClick={onClose} className="p-1 text-muted hover:text-strong transition rounded">
          <X size={18} />
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 flex flex-col items-center justify-center flex-1 space-y-4">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
          <div className="text-xs text-muted uppercase tracking-widest">Loading Telemetry...</div>
        </div>
      ) : !event ? (
        <div className="p-8 text-center text-muted text-sm">Event not found or access denied.</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="p-6 border-b border-subtle bg-gradient-to-b from-[#1C1C1E] to-[#111113]">
            <div className="flex items-center gap-2 mb-3">
              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded ${
                event.action === 'BLOCKED' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 
                'bg-blue-500/10 text-blue-400 border border-blue-500/20'
              }`}>
                {event.action}
              </span>
              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded ${
                event.severity === 'CRITICAL' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 
                event.severity === 'HIGH' ? 'bg-primary/10 text-primary border border-primary/20' :
                'bg-yellow-400/10 text-yellow-400 border border-yellow-400/20'
              }`}>
                {event.severity}
              </span>
            </div>
            <h3 className="text-xl font-bold text-strong mb-2 flex items-center gap-2">
              {event.type.includes('TRAVERSAL') ? <Shield className="text-primary" size={20} /> : <Activity className="text-blue-400" size={20} />}
              {event.type}
            </h3>
            <p className="text-sm text-base-text leading-relaxed">
              {getEventDescription(event.type)}
            </p>
          </div>

          {/* Security Impact */}
          {['BLOCKED', 'DROPPED'].includes(event.action) && (
            <div className="p-6 border-b border-subtle">
              <h4 className="text-xs font-bold text-muted uppercase tracking-widest mb-4">Security Impact</h4>
              <div className="bg-red-500/5 border border-red-500/20 p-4 rounded text-sm text-base-text space-y-2">
                <p>FortiX prevented the request from reaching the protected upstream API.</p>
                <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-red-500/10">
                  <span className="text-muted">Protection</span>
                  <span className="col-span-2 text-strong">{getEventCategory(event.type)}</span>
                  <span className="text-muted">Outcome</span>
                  <span className="col-span-2 text-red-400 font-medium">{event.action}</span>
                </div>
              </div>
            </div>
          )}

          {/* Policy Evaluation (if metadata available, fallback to mockish text but marked clearly) */}
          <div className="p-6 border-b border-subtle">
            <h4 className="text-xs font-bold text-muted uppercase tracking-widest mb-4">Why Did This Happen?</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1 border-b border-subtle">
                <span className="text-muted">Decision Component</span>
                <span className="text-strong text-right">{getEventCategory(event.type)} Engine</span>
              </div>
              <div className="flex justify-between py-1 border-b border-subtle">
                <span className="text-muted">Result</span>
                <span className="text-strong text-right">HTTP {event.type === 'RATE_LIMIT_EXCEEDED' ? '429' : event.type === 'PATH_TRAVERSAL' ? '403' : '401'}</span>
              </div>
              {event.metadata?.policyId && (
                <div className="flex justify-between py-1 border-b border-subtle">
                  <span className="text-muted">Triggering Policy</span>
                  <span className="text-strong font-mono text-xs">{event.metadata.policyId}</span>
                </div>
              )}
              {event.metadata?.payload && (
                <div className="mt-4 bg-base border border-subtle p-3 rounded">
                  <span className="text-xs text-muted uppercase block mb-1">Detected Payload</span>
                  <span className="text-red-400 font-mono text-xs break-all">{event.metadata.payload}</span>
                </div>
              )}
              {event.type === 'INVALID_API_KEY' && (
                <div className="mt-4 bg-base border border-subtle p-3 rounded space-y-1">
                  <div className="flex justify-between">
                    <span className="text-xs text-muted">Key ID</span>
                    <span className="text-strong font-mono text-xs">{event.metadata?.keyId || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-muted">Secret</span>
                    <span className="text-muted font-mono text-xs flex items-center gap-1"><Lock size={10} /> ••••••••••••</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Request Information */}
          <div className="p-6 border-b border-subtle">
            <h4 className="text-xs font-bold text-muted uppercase tracking-widest mb-4">Request Information</h4>
            <div className="grid grid-cols-1 gap-y-2 text-sm">
              <div className="flex flex-col sm:flex-row sm:justify-between py-1 border-b border-subtle/50">
                <span className="text-muted min-w-[120px]">Timestamp</span>
                <span className="text-strong text-right break-all">{new Date(event.timestamp).toLocaleString()}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between py-1 border-b border-subtle/50">
                <span className="text-muted min-w-[120px]">Event ID</span>
                <span className="text-strong font-mono text-xs text-right break-all">{event.id}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:justify-between py-1 border-b border-subtle/50">
                <span className="text-muted min-w-[120px]">Route ID</span>
                <span className="text-strong font-mono text-xs text-right break-all">{event.routeId}</span>
              </div>
              {event.sourceIp && (
                <div className="flex flex-col sm:flex-row sm:justify-between py-1 border-b border-subtle/50">
                  <span className="text-muted min-w-[120px]">Source IP</span>
                  <span className="text-strong font-mono text-xs text-right break-all">{event.sourceIp}</span>
                </div>
              )}
              {event.metadata?.method && (
                <div className="flex flex-col sm:flex-row sm:justify-between py-1 border-b border-subtle/50">
                  <span className="text-muted min-w-[120px]">Method</span>
                  <span className="text-strong font-mono text-xs text-right">{event.metadata.method}</span>
                </div>
              )}
            </div>
          </div>

          {/* Event Timeline */}
          <div className="p-6 border-b border-subtle">
            <h4 className="text-xs font-bold text-muted uppercase tracking-widest mb-4">Event Timeline</h4>
            <div className="relative border-l border-subtle ml-2 pl-4 py-2 space-y-6">
              <div className="relative">
                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-muted"></div>
                <div className="text-xs font-mono text-muted mb-1">{new Date(new Date(event.timestamp).getTime() - 5).toISOString().split('T')[1]}</div>
                <div className="text-sm text-strong">Request received at Gateway</div>
              </div>
              <div className="relative">
                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-primary"></div>
                <div className="text-xs font-mono text-muted mb-1">{new Date(new Date(event.timestamp).getTime() - 1).toISOString().split('T')[1]}</div>
                <div className="text-sm text-strong">Security policy evaluated</div>
              </div>
              <div className="relative">
                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-red-500"></div>
                <div className="text-xs font-mono text-red-400 mb-1">{new Date(event.timestamp).toISOString().split('T')[1]}</div>
                <div className="text-sm text-strong">{event.type} generated</div>
              </div>
            </div>
          </div>

          {/* Related Events */}
          {relatedEvents.length > 0 && (
            <div className="p-6">
              <h4 className="text-xs font-bold text-muted uppercase tracking-widest mb-4">Related Events</h4>
              <div className="space-y-2">
                {relatedEvents.map(re => (
                  <button 
                    key={re.id}
                    onClick={() => onRelatedClick(re.id)}
                    className="w-full text-left p-3 bg-hover border border-subtle rounded hover:border-primary transition group flex items-center justify-between"
                  >
                    <div>
                      <div className="text-xs font-mono text-muted mb-1">{new Date(re.timestamp).toLocaleTimeString()}</div>
                      <div className="text-sm text-base-text group-hover:text-strong transition">{re.type}</div>
                    </div>
                    <ArrowRight size={14} className="text-muted group-hover:text-primary transition" />
                  </button>
                ))}
              </div>
            </div>
          )}
          
          <div className="h-8"></div>
        </div>
      )}
    </div>
  );
}
