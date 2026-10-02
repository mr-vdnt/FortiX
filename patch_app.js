const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Add imports
if (!content.includes('import { CommandPalette }')) {
  content = content.replace(
    'import { ShieldAlert } from \'lucide-react\';',
    'import { ShieldAlert } from \'lucide-react\';\nimport { CommandPalette } from \'./components/CommandPalette.js\';\nimport Settings from \'./pages/Settings.js\';'
  );
}

// Add state for CommandPalette inside Layout
if (!content.includes('const [isPaletteOpen, setIsPaletteOpen]')) {
  content = content.replace(
    'const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);',
    'const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);\n  const [isPaletteOpen, setIsPaletteOpen] = React.useState(false);'
  );
}

// Add CommandPalette inside Layout return
if (!content.includes('<CommandPalette')) {
  content = content.replace(
    '<div className="flex flex-col h-screen w-full bg-[#0A0A0B] text-[#E0E0E0] font-sans overflow-hidden">',
    '<div className="flex flex-col h-screen w-full bg-[#0A0A0B] text-[#E0E0E0] font-sans overflow-hidden">\n      <CommandPalette isOpen={isPaletteOpen} setIsOpen={setIsPaletteOpen} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />'
  );
}

// Add route for Settings
if (!content.includes('<Route path="settings" element={<Settings />} />')) {
  content = content.replace(
    '<Route path="topology" element={<Topology />} />',
    '<Route path="topology" element={<Topology />} />\n          <Route path="settings" element={<Settings />} />'
  );
}

fs.writeFileSync('src/App.tsx', content);
console.log('App.tsx patched successfully');
