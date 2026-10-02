import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { db } from './db/index.js';
import { projects, organizations } from './db/schema.js';
import { eq, and } from 'drizzle-orm';

let io: Server;

// Monotonic sequence counters per project for gap detection
const projectSequences = new Map<string, number>();

function getNextSequence(projectId: string): number {
  const current = projectSequences.get(projectId) || 0;
  const next = current + 1;
  projectSequences.set(projectId, next);
  return next;
}

// Telemetry operational metrics
const telemetryStats = {
  totalEventsEmitted: 0,
  batchesEmitted: 0,
  lastEventTime: 0,
  connectedSockets: 0,
  startedAt: Date.now()
};

export function getSocketStats() {
  return {
    ...telemetryStats,
    connectedSockets: io ? io.engine?.clientsCount || 0 : 0,
    uptimeSeconds: Math.floor((Date.now() - telemetryStats.startedAt) / 1000)
  };
}

// Buffer for telemetry batching
const eventBuffer = new Map<string, any[]>();
let batchInterval: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

export function setupWebSockets(server: HttpServer) {
  io = new Server(server, { cors: { origin: '*' } });
  
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
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
    telemetryStats.connectedSockets = io.engine.clientsCount;

    socket.on('subscribe:project', async (projectId) => {
      try {
        if (!projectId || typeof projectId !== 'string') {
          return socket.emit('error', { message: 'Invalid projectId' });
        }
        
        // Verify ownership
        const [project] = await db.select({ id: projects.id }).from(projects)
          .leftJoin(organizations, eq(projects.orgId, organizations.id))
          .where(
            and(eq(projects.id, projectId), eq(organizations.ownerId, socket.data.user.id))
          ).limit(1);
          
        if (!project) {
          return socket.emit('error', { message: 'Unauthorized access to project' });
        }

        const room = `project:${projectId}`;
        socket.join(room);
        
        const seq = getNextSequence(projectId);
        socket.emit('system:health', { status: 'CONNECTED', projectId, sequence: seq });
        socket.emit('telemetry:connected', { 
          status: 'CONNECTED', 
          projectId, 
          serverTime: Date.now(),
          sequence: seq 
        });
      } catch (err) {
        socket.emit('error', { message: 'Internal server error' });
      }
    });

    socket.on('ping', () => {
      socket.emit('pong', { serverTime: Date.now() });
    });

    socket.on('disconnect', () => {
      telemetryStats.connectedSockets = io.engine?.clientsCount || 0;
    });
  });

  // Start the background batch emission loop
  if (!batchInterval) {
    batchInterval = setInterval(() => {
      if (!io) return;
      
      eventBuffer.forEach((events, roomKey) => {
        if (events.length > 0) {
          const projectId = roomKey.replace('project:', '');
          const seq = getNextSequence(projectId);
          const batchPayload = {
            batchId: `batch_${Date.now()}_${seq}`,
            projectId,
            sequence: seq,
            timestamp: Date.now(),
            count: events.length,
            events
          };
          io.to(roomKey).emit('metric:batch', events);
          io.to(roomKey).emit('telemetry:metric', batchPayload);
          telemetryStats.batchesEmitted++;
          telemetryStats.totalEventsEmitted += events.length;
          telemetryStats.lastEventTime = Date.now();
        }
      });
      eventBuffer.clear();
    }, 1000);
  }

  // Periodic heartbeat every 10s for connection liveness
  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(() => {
      if (!io) return;
      io.emit('heartbeat', {
        serverTime: Date.now(),
        connectedClients: io.engine?.clientsCount || 0
      });
    }, 10000);
  }
}

export function broadcast(projectId: string, event: string, data: any) {
  if (!io) return;
  
  const roomKey = `project:${projectId}`;
  const seq = getNextSequence(projectId);
  
  const payload = {
    eventId: Date.now().toString() + Math.random().toString(36).substring(2, 9),
    projectId,
    sequence: seq,
    timestamp: Date.now(),
    eventType: event,
    payload: data
  };

  telemetryStats.totalEventsEmitted++;
  telemetryStats.lastEventTime = Date.now();

  if (event === 'metric:new') {
    if (!eventBuffer.has(roomKey)) {
      eventBuffer.set(roomKey, []);
    }
    eventBuffer.get(roomKey)!.push(payload);
  } else {
    // Non-telemetry events (e.g. security alerts, experiment updates, settings updates)
    io.to(roomKey).emit(event, payload);
    // Legacy support for older tests or handlers
    if (event === 'security:event' || event === 'telemetry:security') {
      io.to(roomKey).emit('security:event', payload);
      io.to(roomKey).emit('telemetry:security', payload);
    }
  }
}
