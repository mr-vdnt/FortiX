sed -i 's/const mockThreats = \[/const _mockThreats = \[/g' src/pages/Threats.tsx
sed -i '1i import { fetchWithAuth } from "../lib/api.js";\nimport { useEffect } from "react";' src/pages/Threats.tsx
sed -i 's/export default function Threats() {/export default function Threats() {\n  const [threats, setThreats] = useState<any[]>([]);\n  useEffect(() => {\n    fetchWithAuth('\''\/api\/control\/events'\'').then(r => r.json()).then(setThreats).catch(() => {});\n  }, []);/g' src/pages/Threats.tsx
sed -i 's/const sortedThreats = \[\.\.\.mockThreats\]/const sortedThreats = [...threats]/g' src/pages/Threats.tsx
