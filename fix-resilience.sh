sed -i '1i import { fetchWithAuth } from "../lib/api.js";\nimport { useEffect, useState } from "react";' src/pages/Resilience.tsx
sed -i 's/export default function Resilience() {/export default function Resilience() {\n  const [score, setScore] = useState(100);\n  useEffect(() => {\n    fetchWithAuth('\''\/api\/control\/metrics\/scores'\'').then(r => r.json()).then(data => setScore(data.resilienceScore)).catch(() => {});\n  }, []);\n/g' src/pages/Resilience.tsx
sed -i 's/const score = 88;//g' src/pages/Resilience.tsx
