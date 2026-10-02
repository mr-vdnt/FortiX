content = open('src/App.tsx').read()
content = content.replace('localStorage.getItem("fortix_theme") || "dark"', 'localStorage.getItem("fortix_theme") || "light"')
open('src/App.tsx', 'w').write(content)
