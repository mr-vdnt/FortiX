import re
content = open('src/pages/Settings.tsx').read()

# Add imports
if 'Bell' not in content:
    content = content.replace("AlertTriangle,", "AlertTriangle, Bell,")
if 'AlertingSettings' not in content:
    content = 'import { AlertingSettings } from "../components/AlertingSettings.js";\n' + content

# Fix tabs
tabs_replacement = """const TABS = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'account', label: 'Account', icon: User },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'gateway', label: 'Gateway', icon: Globe },
  { id: 'experiments', label: 'Experiments', icon: Activity },
  { id: 'alerting', label: 'Alerting', icon: Bell },
  { id: 'appearance', label: 'Appearance', icon: SettingsIcon },
  { id: 'system', label: 'System', icon: Server },
];"""
content = re.sub(r'const TABS = \[.*?\];', tabs_replacement, content, flags=re.DOTALL)

# Fix role text
content = content.replace('<div className="text-sm text-white">Administrator</div>', '<div className="text-sm text-white">{user?.role === \'ADMIN\' ? \'ADMINISTRATOR\' : \'DEVELOPER\'}</div>')

# Add FortiX Plan
fortix_plan = """              <section className="bg-[#111113] border border-[#2A2A2C] rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-[#2A2A2C] bg-[#161618]">
                  <h3 className="font-semibold text-white">FortiX Plan</h3>
                </div>
                <div className="p-6 space-y-4">
                  {user?.role === 'ADMIN' ? (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="text-xl font-bold text-[#F27D26]">ADMIN / PRO ENTITLEMENT</div>
                        <div className="px-2 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] font-bold uppercase tracking-widest rounded flex items-center gap-1">
                          <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div> ACTIVE
                        </div>
                      </div>
                      <p className="text-sm text-[#8E8E93]">All Pro capabilities are enabled for this account.</p>
                      
                      <div className="grid grid-cols-2 gap-y-3 mt-4 text-sm text-[#E0E0E0]">
                        <div className="flex items-center gap-2"><span className="text-green-400">✓</span> Advanced Experiments</div>
                        <div className="flex items-center gap-2"><span className="text-green-400">✓</span> Policy Verification</div>
                        <div className="flex items-center gap-2"><span className="text-green-400">✓</span> Advanced Analytics</div>
                        <div className="flex items-center gap-2"><span className="text-green-400">✓</span> Real-Time Telemetry</div>
                        <div className="flex items-center gap-2"><span className="text-green-400">✓</span> Topology</div>
                        <div className="flex items-center gap-2"><span className="text-green-400">✓</span> Advanced Security</div>
                        <div className="flex items-center gap-2"><span className="text-green-400">✓</span> Report Export</div>
                        <div className="flex items-center gap-2"><span className="text-green-400">✓</span> Experiment Controls</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="text-xl font-bold text-white">DEVELOPER PLAN</div>
                        <div className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest rounded flex items-center gap-1">
                          ACTIVE
                        </div>
                      </div>
                      <p className="text-sm text-[#8E8E93]">Basic security functionality. Upgrade to access Pro capabilities.</p>
                    </>
                  )}
                </div>
              </section>

"""
content = content.replace('<section className="bg-[#111113] border border-[#2A2A2C] rounded-lg overflow-hidden">\n                <div className="px-6 py-4 border-b border-[#2A2A2C] bg-[#161618]">\n                  <h3 className="font-semibold text-white">Change Password</h3>', fortix_plan + '<section className="bg-[#111113] border border-[#2A2A2C] rounded-lg overflow-hidden">\n                <div className="px-6 py-4 border-b border-[#2A2A2C] bg-[#161618]">\n                  <h3 className="font-semibold text-white">Change Password</h3>')

# Replace notifications with alerting
notifications_block = r"{activeTab === 'notifications' && \(.*?</div>\s*\)\s*}"
alerting_block = """{activeTab === 'alerting' && (
            <AlertingSettings user={user} />
          )}"""
content = re.sub(notifications_block, alerting_block, content, flags=re.DOTALL)

open('src/pages/Settings.tsx', 'w').write(content)
