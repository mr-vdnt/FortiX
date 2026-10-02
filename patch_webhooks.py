import re

content = open('src/pages/Settings.tsx').read()

old_webhooks = """                  <div className="opacity-50 pointer-events-none space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-[#8E8E93] uppercase tracking-widest mb-2">Slack Webhook URL</label>
                      <input type="text" disabled placeholder="https://hooks.slack.com/services/..." className="w-full max-w-md bg-[#0A0A0B] border border-[#2A2A2C] rounded p-2.5 text-sm text-[#8E8E93]" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#8E8E93] uppercase tracking-widest mb-2">Email Notifications</label>
                      <input type="text" disabled placeholder="security@fortix.dev" className="w-full max-w-md bg-[#0A0A0B] border border-[#2A2A2C] rounded p-2.5 text-sm text-[#8E8E93]" />
                    </div>
                    <button disabled className="px-4 py-2 bg-[#2A2A2C] text-[#8E8E93] rounded text-xs font-bold tracking-widest uppercase mt-2">Upgrade to Pro</button>
                  </div>"""

new_webhooks = """                  {user?.role === 'ADMIN' ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-[#8E8E93] uppercase tracking-widest mb-2">Slack Webhook URL</label>
                        <input type="text" placeholder="https://hooks.slack.com/services/..." className="w-full max-w-md bg-[#0A0A0B] border border-[#2A2A2C] rounded p-2.5 text-sm text-white focus:outline-none focus:border-[#F27D26]" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-[#8E8E93] uppercase tracking-widest mb-2">Email Notifications</label>
                        <input type="text" placeholder="security@fortix.dev" className="w-full max-w-md bg-[#0A0A0B] border border-[#2A2A2C] rounded p-2.5 text-sm text-white focus:outline-none focus:border-[#F27D26]" />
                      </div>
                      <button className="px-4 py-2 bg-[#F27D26] hover:bg-[#E06C15] transition text-white rounded text-xs font-bold tracking-widest uppercase mt-2">Save Configuration</button>
                    </div>
                  ) : (
                    <div className="opacity-50 pointer-events-none space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-[#8E8E93] uppercase tracking-widest mb-2">Slack Webhook URL</label>
                        <input type="text" disabled placeholder="https://hooks.slack.com/services/..." className="w-full max-w-md bg-[#0A0A0B] border border-[#2A2A2C] rounded p-2.5 text-sm text-[#8E8E93]" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-[#8E8E93] uppercase tracking-widest mb-2">Email Notifications</label>
                        <input type="text" disabled placeholder="security@fortix.dev" className="w-full max-w-md bg-[#0A0A0B] border border-[#2A2A2C] rounded p-2.5 text-sm text-[#8E8E93]" />
                      </div>
                      <button disabled className="px-4 py-2 bg-[#2A2A2C] text-[#8E8E93] rounded text-xs font-bold tracking-widest uppercase mt-2">Upgrade to Pro</button>
                    </div>
                  )}"""

if old_webhooks in content:
    content = content.replace(old_webhooks, new_webhooks)
    print("Replaced successfully")
else:
    print("Failed to find old webhooks block")

open('src/pages/Settings.tsx', 'w').write(content)
