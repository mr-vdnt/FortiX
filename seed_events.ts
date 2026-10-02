import { sql } from 'drizzle-orm';
import { db } from './src/db/index.js';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
  try {
    const routeId = 'route-1';

    await db.execute(sql`
      INSERT INTO security_events (id, route_id, type, severity, action, source_ip, metadata, timestamp)
      VALUES 
      (${uuidv4()}, ${routeId}, 'PATH_TRAVERSAL', 'HIGH', 'BLOCKED', '192.168.1.100', '{"method": "GET", "payload": "../../../etc/passwd", "policyId": "pol-path-trav-1"}'::jsonb, NOW() - interval '1 hour'),
      (${uuidv4()}, ${routeId}, 'RATE_LIMIT_EXCEEDED', 'MEDIUM', 'BLOCKED', '10.0.0.5', '{"method": "POST", "policyId": "pol-rate-limit-1"}'::jsonb, NOW() - interval '30 minutes'),
      (${uuidv4()}, ${routeId}, 'INVALID_API_KEY', 'CRITICAL', 'BLOCKED', '45.33.10.2', '{"method": "GET", "keyId": "key-unknown"}'::jsonb, NOW() - interval '5 minutes')
    `);
    console.log("Seeded security events");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seed();
