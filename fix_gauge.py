content = open('src/pages/Resilience.tsx').read()
content = content.replace('<Gauge value={score} max={100} size="w-32 h-32" />', '<Gauge value={score} label="Score" />')
open('src/pages/Resilience.tsx', 'w').write(content)
print("Fixed gauge")
