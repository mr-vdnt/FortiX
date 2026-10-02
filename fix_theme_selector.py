content = open('src/pages/Settings.tsx').read()

old_block = """                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between p-4 border border-primary bg-primary/5 rounded-lg cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full bg-primary"></div>
                      <div>
                        <div className="text-sm font-bold text-strong">Dark Mode (Default)</div>
                        <div className="text-xs text-muted">Optimized for security operations and high contrast.</div>
                      </div>
                    </div>
                    <div className="text-xs text-primary font-bold uppercase tracking-widest">Active</div>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 border border-subtle rounded-lg opacity-50 cursor-not-allowed">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full border border-[#8E8E93]"></div>
                      <div>
                        <div className="text-sm font-bold text-base-text">Light Mode</div>
                        <div className="text-xs text-muted">Currently unavailable in MVP.</div>
                      </div>
                    </div>
                  </div>
                </div>"""

new_block = """                <div className="p-6 space-y-4">
                  <div 
                    onClick={() => setTheme('dark')}
                    className={`flex items-center justify-between p-4 border rounded-lg cursor-pointer transition ${theme === 'dark' ? 'border-primary bg-primary/5' : 'border-subtle bg-transparent hover:bg-hover'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full border ${theme === 'dark' ? 'bg-primary border-primary' : 'border-subtle'}`}></div>
                      <div>
                        <div className="text-sm font-bold text-strong">Cinematic Dark Mode (Default)</div>
                        <div className="text-xs text-muted">Optimized for security operations and high contrast.</div>
                      </div>
                    </div>
                    {theme === 'dark' && <div className="text-xs text-primary font-bold uppercase tracking-widest">Active</div>}
                  </div>
                  
                  <div 
                    onClick={() => setTheme('light')}
                    className={`flex items-center justify-between p-4 border rounded-lg cursor-pointer transition ${theme === 'light' ? 'border-primary bg-primary/5' : 'border-subtle bg-transparent hover:bg-hover'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full border ${theme === 'light' ? 'bg-primary border-primary' : 'border-subtle'}`}></div>
                      <div>
                        <div className="text-sm font-bold text-strong">Bright Mode</div>
                        <div className="text-xs text-muted">A crisp layout utilizing high-contrast grayscale backgrounds.</div>
                      </div>
                    </div>
                    {theme === 'light' && <div className="text-xs text-primary font-bold uppercase tracking-widest">Active</div>}
                  </div>
                </div>"""

content = content.replace(old_block, new_block)
open('src/pages/Settings.tsx', 'w').write(content)
print("Updated Interface Theme block")
