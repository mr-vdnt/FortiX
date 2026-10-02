import os

content = """import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';

let io: Server;

// Buffer for telemetry batching
const eventBuffer = new Map<string, any[]>();
let batchInterval: NodeJS.Timeout | null = null;

export function setupWebSockets(server: HttpServer) {
  io = new Server(server, { cors: { origin: '*' } });

  io.use((socket, next) => {
    // In a real production scenario, this token comes from standard auth headers
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    
    jwt.verify(token, process.env.JWT_SECRET || 'dev-secret', (err: any, decoded: any) => {
      if (err) return next(new Error('Authentication error'));
      socket.data.user = decoded;
      next();
    });
  });

  io.on('connection', (socket) => {
    console.log(`User connected to WS: ${socket.data.user?.email || 'unknown'}`);
    
    socket.on('subscribe:project', (projectId) => {
      socket.join(`project:${projectId}`);
      console.log(`Joined project room: ${projectId}`);
    });
    
    socket.on('disconnect', () => {
      console.log('User disconnected from WS');
    });
  });

  // Start the background batch emission loop
  if (!batchInterval) {
    batchInterval = setInterval(() => {
      if (!io) return;
      
      eventBuffer.forEach((events, roomKey) => {
        if (events.length > 0) {
          io.to(roomKey).emit('metric:batch', events);
          // Also emit to the legacy event for backwards compatibility with UI if needed
          events.forEach(e => io.to(roomKey).emit('metric:new', e));
        }
      });
      // Clear the buffer after emission
      eventBuffer.clear();
    }, 1000);
  }
}

export function broadcast(projectId: string, event: string, data: any) {
  if (!io) return;
  
  const roomKey = `project:${projectId}`;
  
  if (event === 'metric:new') {
    if (!eventBuffer.has(roomKey)) {
      eventBuffer.set(roomKey, []);
    }
    eventBuffer.get(roomKey)!.push(data);
  } else {
    // Non-telemetry events (like security alerts) can be emitted immediately
    io.to(roomKey).emit(event, data);
  }
}
"""

with open('src/socket.ts', 'w') as f:
    f.write(content)

print("Socket batching patched successfully.")
