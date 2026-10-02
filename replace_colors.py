import os

replacements = {
    'bg-[#0A0A0B]': 'bg-base',
    'bg-[#0E0E10]': 'bg-surface',
    'bg-[#111113]': 'bg-elevated',
    'bg-[#161618]': 'bg-card',
    'bg-[#1C1C1E]': 'bg-hover',
    'bg-[#2A2A2C]': 'bg-border',
    'bg-[#4A4A4C]': 'bg-border-strong',
    'bg-[#8E8E93]': 'bg-muted',
    'bg-[#F27D26]': 'bg-primary',
    'bg-[#3A3A3C]': 'bg-hover-strong',
    
    'hover:bg-[#1C1C1E]': 'hover:bg-hover',
    'hover:bg-[#2A2A2C]': 'hover:bg-border',
    'hover:bg-[#3A3A3C]': 'hover:bg-hover-strong',
    'hover:bg-[#E06C15]': 'hover:bg-primary-hover',
    'hover:bg-[#F27D26]': 'hover:bg-primary',
    
    'border-[#2A2A2C]': 'border-border-subtle',
    'border-[#4A4A4C]': 'border-border-strong',
    'border-[#F27D26]': 'border-primary',
    
    'text-[#0A0A0B]': 'text-inverted',
    'text-[#8E8E93]': 'text-muted',
    'text-[#E0E0E0]': 'text-base-text',
    'text-[#F27D26]': 'text-primary',
    
    'text-white': 'text-strong',
}

for root, _, files in os.walk('src'):
    for file in files:
        if file.endswith(('.tsx', '.ts')):
            path = os.path.join(root, file)
            with open(path, 'r') as f:
                content = f.read()
            
            for old, new in replacements.items():
                content = content.replace(old, new)
            
            with open(path, 'w') as f:
                f.write(content)
print("Replaced colors")
