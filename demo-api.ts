import express from 'express';

const app = express();
app.use(express.json({ limit: '256kb' }));
const PORT = 3001;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'fortix-demo-api' });
});

app.all('/api/v1/data', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'fortix-demo-api',
    endpoint: '/api/v1/data',
    items: [
      { sku: 'FX-GW-01', stock: 142, region: 'ap-south-1' },
      { sku: 'FX-WAF-02', stock: 89, region: 'eu-central-1' },
    ],
    timestamp: new Date().toISOString(),
  });
});

app.all('/api/v1/orders', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'fortix-demo-api',
    endpoint: '/api/v1/orders',
    orders: [
      { orderId: 'ORD-1041', state: 'SETTLED', amountCents: 12900 },
      { orderId: 'ORD-1042', state: 'PROCESSING', amountCents: 4500 },
    ],
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/payment', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'fortix-demo-api',
    endpoint: '/api/payment',
    message: 'Payment authorization check completed',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/slow', (_req, res) => {
  setTimeout(() => {
    res.json({ status: 'ok', message: 'Slow response complete', simulatedDelayMs: 1200 });
  }, 1200);
});

app.get('/api/flaky', (_req, res) => {
  if (Math.random() < 0.5) {
    res.status(500).json({ status: 'error', message: 'Internal Server Error' });
  } else {
    res.json({ status: 'ok', message: 'Flaky response succeeded' });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`FortiX Demo API listening on http://0.0.0.0:${PORT}`);
});

server.on('error', (err: any) => {
  if (err?.code === 'EADDRINUSE') {
    console.warn(`[Demo API] Port ${PORT} already in use, continuing...`);
  } else {
    console.error('[Demo API] Server error:', err);
  }
});
