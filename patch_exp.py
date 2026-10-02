import os
content = open('src/pages/Experiments.tsx').read()
old = """<div className="w-full md:w-64 space-y-4 border-t md:border-t-0 md:border-l border-subtle pt-6 md:pt-0 md:pl-8 flex flex-col justify-end">
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
        </div>"""
new = """<div className="w-full md:w-72 space-y-3 border-t md:border-t-0 md:border-l border-subtle pt-6 md:pt-0 md:pl-6 flex flex-col justify-end">
          <div className="text-[10px] font-bold tracking-widest uppercase text-muted mb-1">Experiment Safety Controls</div>
          <div className="bg-card p-3 rounded-xl border border-subtle space-y-2 text-xs">
            <div className="flex justify-between text-muted"><span className="uppercase text-[10px] tracking-widest">Target</span><span className="font-mono text-strong">{selectedRouteId ? '/api/payment' : '/api/*'}</span></div>
            <div className="flex justify-between text-muted"><span className="uppercase text-[10px] tracking-widest">Intensity</span><span className="font-mono text-strong">800 ms</span></div>
            <div className="flex justify-between text-muted"><span className="uppercase text-[10px] tracking-widest">Duration</span><span className="font-mono text-strong">15 seconds</span></div>
            <div className="flex justify-between text-muted"><span className="uppercase text-[10px] tracking-widest">Blast Radius</span><span className="font-mono text-strong">Single Route</span></div>
            <div className="flex justify-between text-muted border-t border-subtle/50 pt-2"><span className="uppercase text-[10px] tracking-widest">Cleanup</span><span className="font-mono text-green-500 font-bold flex items-center gap-1"><CheckCircle size={10}/> Automatic</span></div>
          </div>
          
          <label className="flex items-center gap-2 text-xs text-base-text cursor-pointer my-2">
            <input type="checkbox" checked={isAuthorized} onChange={e => setIsAuthorized(e.target.checked)} className="rounded bg-base border-subtle" />
            I authorize this fault injection test.
          </label>
          
          <button 
            onClick={triggerExperiment} 
            disabled={!isAuthorized}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold tracking-widest uppercase transition ${isAuthorized ? 'bg-primary text-inverted hover:bg-primary-hover shadow-glass' : 'bg-base border border-subtle text-muted cursor-not-allowed'}`}
          >
            <Play size={16} /> {isAuthorized ? 'Execute Chaos' : 'Safety Locked'}
          </button>
        </div>"""
content = content.replace(old, new)
open('src/pages/Experiments.tsx', 'w').write(content)
print("Updated Experiments safety panel")
