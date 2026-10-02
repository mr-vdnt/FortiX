const fs = require('fs');
let content = fs.readFileSync('src/pages/Resilience.tsx', 'utf8');

// Add BarChart, Bar, Cell imports and remove LineChart, Line
content = content.replace(
  "import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';",
  "import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';"
);

// Add threshold states
if (!content.includes('const [cpuThreshold')) {
  content = content.replace(
    'const [resources, setResources] = useState<any[]>([]);',
    `const [resources, setResources] = useState<any[]>([]);
  const [cpuThreshold, setCpuThreshold] = useState(80);
  const [memThreshold, setMemThreshold] = useState(80);
  
  useEffect(() => {
    const savedCpu = localStorage.getItem('fortix_cpu_threshold');
    const savedMem = localStorage.getItem('fortix_mem_threshold');
    if (savedCpu) setCpuThreshold(parseInt(savedCpu, 10));
    if (savedMem) setMemThreshold(parseInt(savedMem, 10));
  }, []);`
  );
}

// Replace LineChart with BarChart and conditionally color bars
content = content.replace(
  /<LineChart data=\{resources\}>[\s\S]*?<\/LineChart>/,
  `<BarChart data={resources}>
                <XAxis dataKey="time" hide />
                <YAxis stroke="#4A4A4C" tick={{ fill: '#8E8E93', fontSize: 10 }} domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: '#111113', borderColor: '#2A2A2C', color: '#E0E0E0' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
                <Bar name="CPU (%)" dataKey="cpu" isAnimationActive={false}>
                  {resources.map((entry, index) => (
                    <Cell key={\`cell-cpu-\${index}\`} fill={entry.cpu > cpuThreshold ? '#ef4444' : '#F27D26'} />
                  ))}
                </Bar>
                <Bar name="RAM (%)" dataKey="memory" isAnimationActive={false}>
                  {resources.map((entry, index) => (
                    <Cell key={\`cell-mem-\${index}\`} fill={entry.memory > memThreshold ? '#ef4444' : '#3B82F6'} />
                  ))}
                </Bar>
              </BarChart>`
);

// Add SystemLogs to the Resilience page so it's included in the report
if (!content.includes('import { SystemLogs }')) {
  content = content.replace(
    "import { Gauge } from '../components/ui/Gauge.js';",
    "import { Gauge } from '../components/ui/Gauge.js';\nimport { SystemLogs } from '../components/SystemLogs.js';"
  );
}

// Ensure the div includes system logs
if (!content.includes('<SystemLogs />')) {
  content = content.replace(
    '        </div>\n      </div>\n    </div>',
    '        </div>\n      </div>\n      <div className="h-[400px] mt-4"><SystemLogs /></div>\n    </div>'
  );
}

fs.writeFileSync('src/pages/Resilience.tsx', content);
console.log('Resilience.tsx patched successfully');
