import os
content = open('src/api/metrics.ts').read()
old = """// Helper to calculate precise percentiles (e.g., P50, P95) from raw observations
function percentile(arr: number[], p: number) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return Math.round(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
  } else {
    return Math.round(sorted[base]);
  }
}"""
new = """import { percentile } from '../lib/math.js';"""
content = content.replace(old, new)
with open('src/api/metrics.ts', 'w') as f:
    f.write(content)
