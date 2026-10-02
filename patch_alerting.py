import re
content = open('src/components/AlertingSettings.tsx').read()

if 'export function AlertingSettings({' not in content:
    content = content.replace('export function AlertingSettings() {', 'export function AlertingSettings({ user }: { user?: any }) {')

# Find the start of the `<div className="p-6 space-y-4">`
parts = content.split('<div className="p-6 space-y-4">')

disabled_ui = """<div className="p-6 space-y-4">
          {user?.role !== 'ADMIN' ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-gray-500/10 text-gray-500 rounded-full flex items-center justify-center mx-auto mb-3">
                <Trash2 size={24} className="opacity-0" />
                <span className="text-xl">🔒</span>
              </div>
              <h4 className="text-lg font-bold text-white mb-2">Pro Feature: Alert Webhooks</h4>
              <p className="text-sm text-[#8E8E93] max-w-md mx-auto mb-4">
                Upgrade to the ADMIN / PRO ENTITLEMENT plan to configure and monitor outbound webhook notifications.
              </p>
              <button disabled className="px-4 py-2 bg-[#2A2A2C] text-[#8E8E93] rounded text-xs font-bold tracking-widest uppercase">
                Upgrade to Pro
              </button>
            </div>
          ) : ("""

end_disabled_ui = """          )}
        </div>"""

if "{user?.role !== 'ADMIN' ?" not in content:
    new_content = parts[0] + disabled_ui + parts[1].replace('</div>\n      </section>', end_disabled_ui + '\n      </section>')
    open('src/components/AlertingSettings.tsx', 'w').write(new_content)
    print("Patched UI")
else:
    print("Already patched")
