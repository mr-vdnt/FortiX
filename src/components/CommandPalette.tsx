import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Activity, Server, Shield, Play, ShieldAlert, BarChart, Settings, FileText, PanelLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function CommandPalette({ isOpen, setIsOpen, toggleSidebar }: { isOpen: boolean, setIsOpen: (v: boolean) => void, toggleSidebar: () => void }) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setIsOpen]);

  const actions = [
    { id: 'dashboard', title: 'Go to Dashboard', icon: <Activity size={16} />, onSelect: () => { navigate('/'); setIsOpen(false); } },
    { id: 'apis', title: 'Go to APIs', icon: <Server size={16} />, onSelect: () => { navigate('/apis'); setIsOpen(false); } },
    { id: 'security', title: 'Go to Security Policies', icon: <Shield size={16} />, onSelect: () => { navigate('/security'); setIsOpen(false); } },
    { id: 'experiments', title: 'Go to Experiments', icon: <Play size={16} />, onSelect: () => { navigate('/experiments'); setIsOpen(false); } },
    { id: 'threats', title: 'Go to Threats', icon: <ShieldAlert size={16} />, onSelect: () => { navigate('/threats'); setIsOpen(false); } },
    { id: 'resilience', title: 'Go to Resilience', icon: <BarChart size={16} />, onSelect: () => { navigate('/resilience'); setIsOpen(false); } },
    { id: 'topology', title: 'Go to Topology', icon: <Activity size={16} />, onSelect: () => { navigate('/topology'); setIsOpen(false); } },
    { id: 'settings', title: 'Go to Settings', icon: <Settings size={16} />, onSelect: () => { navigate('/settings'); setIsOpen(false); } },
    { id: 'toggle-sidebar', title: 'Toggle Sidebar', icon: <PanelLeft size={16} />, onSelect: () => { toggleSidebar(); setIsOpen(false); } },
  ];

  const filtered = actions.filter(a => (a.title || '').toLowerCase().includes((query || '').toLowerCase()));

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-base/80 backdrop-blur-sm z-[99]"
            onClick={() => setIsOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 w-[90%] max-w-xl bg-card border border-subtle rounded-lg shadow-2xl z-[100] overflow-hidden flex flex-col"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-subtle">
              <Search size={18} className="text-muted" />
              <input
                autoFocus
                type="text"
                placeholder="Type a command or search..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="flex-1 bg-transparent border-none text-strong focus:outline-none text-lg placeholder:text-[#4A4A4C]"
              />
              <div className="text-[10px] font-mono font-bold tracking-widest text-[#4A4A4C] border border-subtle px-2 py-1 rounded">ESC</div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {filtered.map((action, i) => (
                <button
                  key={action.id}
                  onClick={action.onSelect}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left rounded hover:bg-primary hover:text-inverted text-base-text transition group focus:outline-none focus:bg-primary focus:text-inverted"
                >
                  <span className="text-muted group-hover:text-inverted group-focus:text-inverted">{action.icon}</span>
                  <span className="font-medium text-sm">{action.title}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-4 py-8 text-center text-muted text-sm">
                  No results found for "{query}"
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
