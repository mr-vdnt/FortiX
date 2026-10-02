import re
content = open('src/pages/Settings.tsx').read()

# Remove notifications from tabs
content = re.sub(r"\s*{\s*id:\s*'notifications',\s*label:\s*'Notifications',\s*icon:\s*AlertTriangle\s*},", "", content)

# Remove the old notifications block entirely
notifications_block_pattern = r"{activeTab === 'notifications' && \(.*?</div>\s*\)\s*}"
content = re.sub(notifications_block_pattern, "", content, flags=re.DOTALL)

open('src/pages/Settings.tsx', 'w').write(content)
