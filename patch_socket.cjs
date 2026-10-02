const fs = require('fs');
const code = `import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { db } from './db/index.js';
import { projects } from './db/schema.js';
import { eq, and } from 'drizzle-orm';

let io: Server;
// Buffer for telemetry batching
const eventBuffer = new Map<string, any[]>();
let batchInterval: NodeJS.Timeout | null = null;

export function setupWebSockets(server: HttpServer) {
  io = new Server(server, { cors: { origin: '*' } });
  
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
       return next(new Error('Authentication error'));
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'dev-secret', (err: any, decoded: any) => {
      if (err) {
         return next(new Error('Authentication error'));
      }
      socket.data.user = decoded;
      next();
    });
  });

  io.on('connection', (socket) => {
    socket.on('subscribe:project', async (projectId) => {
      try {
        if (!projectId || typeof projectId !== 'string') {
          return socket.emit('error', { message: 'Invalid projectId' });
        }
        
        // Verify ownership
        const [project] = await db.select().from(projects).where(
          and(eq(projects.id, projectId), eq(projects.userId, socket.data.user.id))
        ).limit(1);
        
        if (!project) {
          return socket.emit('error', { message: 'Unauthorized access to project' });
        }

        socket.join(\`project:\${projectId}\`);
        socket.emit('system:health', { status: 'CONNECTED', projectId });
      } catch (err) {
        socket.emit('error', { message: 'Internal server error' });
      }
    });
  });

  // Start the background batch emission loop
  if (!batchInterval) {
    batchInterval = setInterval(() => {
      if (!io) return;
      
      eventBuffer.forEach((events, roomKey) => {
        if (events.length > 0) {
          io.to(roomKey).emit('metric:batch', events);
        }
      });
      eventBuffer.clear();
    }, 1000);
  }
}

export function broadcast(projectId: string, event: string, data: any) {
  if (!io) return;
  
  const roomKey = \`project:\${projectId}\`;
  
  const payload = {
    eventId: Date.now().toString() + Math.random().toString(36).substring(2, 9),
    projectId,
    timestamp: Date.now(),
    eventType: event,
    payload: data
  };

  if (event === 'metric:new') {
    if (!eventBuffer.has(roomKey)) {
      eventBuffer.set(roomKey, []);
    }
    eventBuffer.get(roomKey)!.push(payload);
  } else {
    // Non-telemetry events (like security alerts)
    io.to(roomKey).emit(event, payload);
    // Legacy support for older tests if needed
    io.to(roomKey).emit('security:event', payload);
  }
}
`;
fs.writeFileSync('src/socket.ts', code);
