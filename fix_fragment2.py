content = open('src/components/AlertingSettings.tsx').read()
content = content.replace('          ) : (\n          <p className="text-xs', '          ) : (\n          <>\n          <p className="text-xs')
content = content.replace('          )}\n        </div>', '          </>\n          )}\n        </div>')
open('src/components/AlertingSettings.tsx', 'w').write(content)
