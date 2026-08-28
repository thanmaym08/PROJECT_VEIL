import { WebSocketServer } from 'ws';
import { checkConnectionRateLimit, checkMessageRateLimit, validateOrigin } from './rateLimit.js';

// Configuration
const MAX_PAYLOAD_SIZE = 65536; // 64 KB
const MAX_QUEUE_SIZE = 50;
const MESSAGE_TTL = 86400000; // 24 hours (increased from 1 hr)
const IDENTITY_TTL = 259200000; // 72 hours

const wss = new WebSocketServer({ 
  port: 8080,
  maxPayload: MAX_PAYLOAD_SIZE,
  verifyClient: (info, cb) => {
    const ip = info.req.socket.remoteAddress;
    const origin = info.req.headers.origin;

    if (!validateOrigin(origin)) {
      cb(false, 403, 'Forbidden Origin');
      return;
    }

    if (!checkConnectionRateLimit(ip)) {
      cb(false, 429, 'Rate Limit Exceeded');
      return;
    }

    cb(true);
  }
});

// State Structures (Strictly In-Memory)
const identities = new Map();
const offlineQueues = new Map();
// Mapping ws -> cipherId for cleanup on disconnect
const connectionMap = new WeakMap(); 

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;

  ws.on('message', (message, isBinary) => {
    // We only process JSON strings here
    if (isBinary) {
      ws.terminate();
      return;
    }

    if (!checkMessageRateLimit(ip)) {
      ws.close(1008, 'Rate limit exceeded');
      return;
    }

    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      ws.close(1007, 'Invalid JSON');
      return;
    }

    switch (data.type) {
      case 'register': {
        const { cipherId, mlkemPub, x25519Pub } = data;
        if (!cipherId || !mlkemPub || !x25519Pub) return;

        // Register identity
        identities.set(cipherId, {
          mlkemPub,
          x25519Pub,
          ws,
          lastSeen: Date.now()
        });
        
        connectionMap.set(ws, cipherId);

        // Flush offline queue if any
        if (offlineQueues.has(cipherId)) {
          const queue = offlineQueues.get(cipherId);
          for (const item of queue) {
            // Check TTL before sending
            if (Date.now() - item.queuedAt <= MESSAGE_TTL) {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(item.envelope));
              }
            }
          }
          offlineQueues.delete(cipherId);
        }
        break;
      }
      
      case 'lookup': {
        const { targetCipherId } = data;
        const target = identities.get(targetCipherId);
        if (target) {
          ws.send(JSON.stringify({
            type: 'lookup_res',
            found: true,
            mlkemPub: target.mlkemPub,
            x25519Pub: target.x25519Pub,
            online: target.ws !== null && target.ws.readyState === ws.OPEN
          }));
        } else {
          ws.send(JSON.stringify({ type: 'lookup_res', found: false }));
        }
        break;
      }

      case 'msg': {
        const { from, to, seq } = data;
        if (!from || !to) return; // Malformed

        // Update sender's lastSeen if registered
        const sender = identities.get(from);
        if (sender) sender.lastSeen = Date.now();

        const target = identities.get(to);
        
        if (target && target.ws !== null && target.ws.readyState === ws.OPEN) {
          // Deliver immediately
          target.ws.send(JSON.stringify(data));
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'ack', to, seq, status: 'delivered' }));
          }
        } else {
          // Queue offline
          if (!offlineQueues.has(to)) {
            offlineQueues.set(to, []);
          }
          const queue = offlineQueues.get(to);
          queue.push({ envelope: data, queuedAt: Date.now() });
          
          // Enforce max queue size (FIFO)
          if (queue.length > MAX_QUEUE_SIZE) {
            queue.shift();
          }
          
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'ack', to, seq, status: 'queued' }));
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const cipherId = connectionMap.get(ws);
    if (cipherId) {
      const identity = identities.get(cipherId);
      if (identity && identity.ws === ws) {
        identity.ws = null; // Mark offline
        identity.lastSeen = Date.now();
      }
    }
  });
});

// Garbage Collection Interval (every 60s)
setInterval(() => {
  const now = Date.now();
  
  // Clean identities
  for (const [cipherId, identity] of identities.entries()) {
    if (identity.ws === null && now - identity.lastSeen > IDENTITY_TTL) {
      identities.delete(cipherId);
    }
  }

  // Clean offline queues
  for (const [cipherId, queue] of offlineQueues.entries()) {
    const activeQueue = queue.filter(item => now - item.queuedAt <= MESSAGE_TTL);
    if (activeQueue.length === 0) {
      offlineQueues.delete(cipherId);
    } else {
      offlineQueues.set(cipherId, activeQueue);
    }
  }
}, 60000);

console.log('VEIL Relay Server running on port 8080');
