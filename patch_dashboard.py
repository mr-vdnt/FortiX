import os

content = open('src/pages/Dashboard.tsx').read()

# Replace the reduce block with a simple map because backend now pre-aggregates
old_reduce = """  const chartData = metrics.reduce((acc: any[], m) => {
    const time = m.timestamp;
    const existing = acc.find(x => x.time === time);
    const latencyVal = Number(m.latency) || 0;
    if (existing) {
      existing.latency = Math.max(existing.latency, latencyVal);
    } else {
      acc.push({ time, latency: latencyVal });
    }
    return acc;
  }, []).slice(-30); // last 30 data points"""

new_map = """  // Backend now returns pre-aggregated 1-second buckets with P50 and P95 latency
  const chartData = metrics.map(m => ({
    time: m.timestamp,
    latency: Number(m.latency) || 0, // P95
    p50: Number(m.p50) || 0          // P50
  })).slice(-30);"""

content = content.replace(old_reduce, new_map)

# Add P50 line to the chart
old_line = """<Line type="monotone" dataKey="latency" stroke="#F27D26" strokeWidth={2} dot={false} isAnimationActive={false} />"""
new_line = """<Line type="monotone" dataKey="latency" name="P95 Latency" stroke="#F27D26" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="p50" name="P50 Latency" stroke="#4A4A4C" strokeWidth={2} dot={false} isAnimationActive={false} strokeDasharray="3 3" />"""

content = content.replace(old_line, new_line)

with open('src/pages/Dashboard.tsx', 'w') as f:
    f.write(content)

print("Dashboard.tsx patched successfully.")
