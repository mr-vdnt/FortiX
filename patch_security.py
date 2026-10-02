import os

content = open('src/pages/Security.tsx').read()
content = content.replace('<option value="RATE_LIMIT">Rate Limit</option>', 
"""<option value="RATE_LIMIT">Rate Limit</option>
<option value="AUTH_REQUIRED">Enforce API Key Auth</option>
<option value="IP_DENYLIST">IP Denylist</option>
<option value="THREAT_DETECTION">Active Threat Inspection</option>""")
open('src/pages/Security.tsx', 'w').write(content)
print("Updated Security dropdown")
