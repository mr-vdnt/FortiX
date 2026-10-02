import re

content = open('src/App.tsx').read()

old_layout = """  return (
    <div className="flex flex-col h-screen w-full bg-base text-base-text font-sans overflow-hidden">
      <CommandPalette isOpen={isPaletteOpen} setIsOpen={setIsPaletteOpen} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />"""

new_layout = """  return (
    <div className="flex flex-col h-screen w-full bg-transparent text-base-text font-sans overflow-hidden p-0 sm:p-3 md:p-4 lg:p-6">
      <div className="flex flex-col h-full w-full bg-base rounded-none sm:rounded-2xl md:rounded-3xl border-0 sm:border border-subtle overflow-hidden shadow-glass relative isolate">
      <CommandPalette isOpen={isPaletteOpen} setIsOpen={setIsPaletteOpen} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />"""

content = content.replace(old_layout, new_layout)
content = content.replace("          <div className=\"text-[10px] text-muted\">© 2026 Faultline Labs // All rights reserved. No feature development during freeze point.</div>\n        </footer>\n      </main>\n    </div>", "          <div className=\"text-[10px] text-muted\">© 2026 Faultline Labs // All rights reserved. No feature development during freeze point.</div>\n        </footer>\n      </main>\n      </div>\n    </div>")

# Adjust header to be transparent or slightly elevated
content = content.replace('bg-elevated shrink-0', 'bg-transparent shrink-0')
content = content.replace('border-b border-subtle bg-elevated', 'border-b border-subtle bg-transparent')
content = content.replace('border-b border-subtle bg-transparent', 'border-b border-subtle bg-surface')

# Change sidebar bg
content = content.replace('bg-surface p-4 flex flex-col', 'bg-transparent p-4 flex flex-col')

# Change footer bg
content = content.replace('bg-surface flex justify-between', 'bg-transparent flex justify-between')
content = content.replace('border-t border-subtle bg-transparent', 'border-t border-subtle bg-surface')

# Change active nav link bg
content = content.replace('bg-hover rounded-lg border border-subtle', 'bg-elevated rounded-lg border border-subtle shadow-glass')

with open('src/App.tsx', 'w') as f:
    f.write(content)
print("Updated Layout in App.tsx")
