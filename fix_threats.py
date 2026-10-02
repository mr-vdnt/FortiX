content = open('src/pages/Threats.tsx').read()
content = content.replace("fetchWithAuth('/api/control/events').then(r => r.json()).then(setThreats).catch(() => {});", "fetchWithAuth('/api/control/events').then(r => r.json()).then(data => setThreats(data.events || [])).catch(() => {});")
open('src/pages/Threats.tsx', 'w').write(content)
