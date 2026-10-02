import os

replacements = {
    'border-border-subtle': 'border-subtle',
    'border-border-strong': 'border-strong',
    'border-[#2A2A2C]': 'border-subtle',
    'border-[#4A4A4C]': 'border-strong',
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
print("Replaced colors 2")
