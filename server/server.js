import { WebSocketServer } from 'ws';
import { checkConnectionRateLimit, checkMessageRateLimit, validateOrigin } from './rateLimit.js';
import { savePreKeyBundle, fetchPreKeyBundle, getRemainingOpkCount, statements } from './db.js';
import { getServerSigningKey } from './serverKey.js';
import { ed25519 } from '@noble/curves/ed25519.js';

// Load server key
const serverKey = getServerSigningKey();
console.log('Server Identity (Ed25519 Pub):', Buffer.from(serverKey.publicKey).toString('base64'));

// Configuration
const MAX_PAYLOAD_SIZE = 65536; // 64 KB
const MAX_QUEUE_SIZE = 50;
const MESSAGE_TTL = 86400000; // 24 hours (increased from 1 hr)
const IDENTITY_TTL = 259200000; // 72 hours

import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync, existsSync, mkdirSync, createWriteStream, createReadStream, statSync, unlink, readdir, stat } from 'fs';
import http from 'http';
import path from 'path';
import { randomUUID } from 'crypto';

let firebaseEnabled = false;
try {
  const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json', 'utf8'));
  initializeApp({
    credential: cert(serviceAccount)
  });
  firebaseEnabled = true;
  console.log("Firebase Admin initialized for Zero-Knowledge Push");
} catch(e) {
  console.warn("Firebase Admin failed to init, skipping push capabilities. Error:", e.message);
}

// Attachment Storage Configuration (24-hour ephemeral retention)
const ATTACHMENT_DIR = path.resolve('attachments');
if (!existsSync(ATTACHMENT_DIR)) {
  mkdirSync(ATTACHMENT_DIR, { recursive: true });
}
const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024; // 15 MB
const ATTACHMENT_TTL = 86400000; // 24 hours

// MIME type mapping for static frontend serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm'
};

const STATIC_DIR = [
  path.resolve('public'),
  path.resolve('../client/dist'),
  path.resolve('client/dist')
].find(dir => existsSync(dir) && existsSync(path.join(dir, 'index.html')));

if (STATIC_DIR) {
  console.log('[STATIC] Serving frontend web assets from:', STATIC_DIR);
}

// HTTP Server for Attachments, Health & Web Frontend
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Health check
  if (url.pathname === '/health' || url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
    return;
  }

  // Upload Encrypted Attachment: POST /api/attachment
  if (req.method === 'POST' && url.pathname === '/api/attachment') {
    const attachmentId = randomUUID();
    const filePath = path.join(ATTACHMENT_DIR, `${attachmentId}.enc`);
    const fileStream = createWriteStream(filePath);
    let totalSize = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_ATTACHMENT_SIZE) {
        aborted = true;
        fileStream.destroy();
        unlink(filePath, () => {});
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Attachment exceeds maximum limit of 15MB' }));
        }
        req.destroy();
      } else {
        fileStream.write(chunk);
      }
    });

    req.on('end', () => {
      if (aborted) return;
      fileStream.end(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ attachmentId, size: totalSize }));
      });
    });

    req.on('error', (err) => {
      fileStream.destroy();
      unlink(filePath, () => {});
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upload streaming failed' }));
      }
    });
    return;
  }

  // Download Encrypted Attachment: GET /api/attachment/:id
  if (req.method === 'GET' && url.pathname.startsWith('/api/attachment/')) {
    const id = url.pathname.split('/')[3];
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid attachment ID format' }));
      return;
    }

    const filePath = path.join(ATTACHMENT_DIR, `${id}.enc`);
    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Attachment not found or expired' }));
      return;
    }

    try {
      const stat = statSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'private, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      });
      createReadStream(filePath).pipe(res);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Failed to read attachment' }));
      }
    }
    return;
  }

  // Serve static client frontend if available
  if (STATIC_DIR && (req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
    let safePath = path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '\\') safePath = 'index.html';
    let targetPath = path.join(STATIC_DIR, safePath);

    if (existsSync(targetPath) && statSync(targetPath).isFile()) {
      const ext = path.extname(targetPath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*'
      });
      if (req.method === 'HEAD') return res.end();
      return createReadStream(targetPath).pipe(res);
    }

    // SPA fallback: return index.html for application routes
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (existsSync(indexPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      if (req.method === 'HEAD') return res.end();
      return createReadStream(indexPath).pipe(res);
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

const wss = new WebSocketServer({ 
  server,
  maxPayload: MAX_PAYLOAD_SIZE,
  verifyClient: (info, cb) => {
    const ip = info.req.socket.remoteAddress;
    const origin = info.req.headers.origin;
    console.log(`[AUTH] Connection attempt from IP: ${ip}, Origin: ${origin}`);

    if (!validateOrigin(origin)) {
      console.log(`[AUTH] REJECTED - Forbidden Origin: ${origin}`);
      cb(false, 403, 'Forbidden Origin');
      return;
    }

    if (!checkConnectionRateLimit(ip)) {
      console.log(`[AUTH] REJECTED - Rate Limit: ${ip}`);
      cb(false, 429, 'Rate Limit Exceeded');
      return;
    }

    cb(true);
  }
});

// Periodic WebSocket heartbeat to weed out dead connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeatInterval));

// State Structures (Strictly In-Memory)
const identities = new Map();
const offlineQueues = new Map();
// Mapping ws -> cipherId for cleanup on disconnect
const connectionMap = new WeakMap(); 

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] Client connected from ${ip}`);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message, isBinary) => {
    // We only process JSON strings here
    if (isBinary) {
      ws.terminate();
      return;
    }

    const msgStr = message.toString();
    if (msgStr === 'ping') {
      ws.send('pong');
      return;
    }

    if (!checkMessageRateLimit(ip)) {
      ws.close(1008, 'Rate limit exceeded');
      return;
    }

    let data;
    try {
      // Basic depth limit check (rudimentary JSON bomb defense)
      if ((msgStr.match(/\[/g) || []).length > 5000 || (msgStr.match(/\{/g) || []).length > 5000) {
         throw new Error("JSON too deep");
      }
      data = JSON.parse(msgStr);
    } catch (e) {
      console.log('JSON parse error or bomb check failed:', e.message, 'Length:', msgStr.length, 'Braces:', (msgStr.match(/\{/g) || []).length);
      ws.close(1007, 'Invalid JSON');
      return;
    }

    switch (data.type) {
      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      }
      case 'register': {
        const { cipherId, mlkemPub, x25519Pub, ed25519Pub, deliveryToken, fcmToken, bundle } = data;
        if (!cipherId || !mlkemPub || !x25519Pub) return;

        // Save into DB
        savePreKeyBundle(cipherId, mlkemPub, x25519Pub, ed25519Pub, deliveryToken, fcmToken, bundle || {});

        // Keep ws memory mapping for realtime delivery
        identities.set(cipherId, {
          mlkemPub, x25519Pub, ed25519Pub, deliveryToken, ws, fcmToken, lastSeen: Date.now()
        });
        
        connectionMap.set(ws, cipherId);

        // Check remaining OPKs and ask for replenish if needed
        const remainingOpks = getRemainingOpkCount(cipherId);
        
        ws.send(JSON.stringify({ 
          type: 'register_ack', 
          serverIdentityPub: Buffer.from(serverKey.publicKey).toString('base64'),
          replenishOpks: remainingOpks < 20 ? 100 - remainingOpks : 0
        }));

        // Flush offline queue if any
        if (offlineQueues.has(cipherId)) {
          const queue = offlineQueues.get(cipherId);
          for (const item of queue) {
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
      
      case 'upload_opk': {
        const { cipherId, oneTimePreKeys } = data;
        if (connectionMap.get(ws) !== cipherId) return; // auth check
        savePreKeyBundle(cipherId, null, null, null, { oneTimePreKeys });
        break;
      }

      case 'get_prekeys': {
        const { targetCipherId } = data;
        const bundle = fetchPreKeyBundle(targetCipherId);
        if (bundle) {
          ws.send(JSON.stringify({
            type: 'prekeys_res',
            targetCipherId,
            bundle
          }));
        } else {
          ws.send(JSON.stringify({ type: 'prekeys_res', targetCipherId, error: 'Not found' }));
        }
        break;
      }

      case 'lookup': {
        const { targetCipherId } = data;
        // Check DB instead of just volatile RAM for lookup
        const bundle = fetchPreKeyBundle(targetCipherId);
        if (bundle && bundle.identity) {
          const target = identities.get(targetCipherId);
          ws.send(JSON.stringify({
            type: 'lookup_res',
            found: true,
            mlkemPub: bundle.identity.identityMlkemPub,
            x25519Pub: bundle.identity.identityX25519Pub,
            ed25519Pub: bundle.identity.identityEd25519Pub,
            online: target && target.ws !== null && target.ws.readyState === ws.OPEN
          }));
        } else {
          ws.send(JSON.stringify({ type: 'lookup_res', found: false }));
        }
        break;
      }

      case 'get_sender_cert': {
        const senderId = connectionMap.get(ws);
        if (!senderId) return; // Must be authenticated
        
        const identity = identities.get(senderId);
        if (!identity) return;

        const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
        
        // Structure: [len16(senderId)] || senderId || [len16(identityX25519Pub)] || identityX25519Pub || expiresAt (8 bytes BE)
        const senderIdBuf = Buffer.from(senderId, 'utf-8');
        const x25519PubBuf = Buffer.from(identity.x25519Pub, 'base64');
        const expiresBuf = Buffer.alloc(8);
        expiresBuf.writeBigInt64BE(BigInt(expiresAt));
        
        const len1 = Buffer.alloc(2);
        len1.writeUInt16BE(senderIdBuf.length);
        
        const len2 = Buffer.alloc(2);
        len2.writeUInt16BE(x25519PubBuf.length);
        
        const msgToSign = Buffer.concat([len1, senderIdBuf, len2, x25519PubBuf, expiresBuf]);
        const signature = ed25519.sign(msgToSign, serverKey.secretKey);
        
        ws.send(JSON.stringify({
          type: 'sender_cert_res',
          cert: {
            senderId,
            identityPublicKey: identity.x25519Pub,
            expiresAt,
            serverSignature: Buffer.from(signature).toString('base64')
          }
        }));
        break;
      }

      case 'sealed_msg': {
        const { to, ephemeralPublicKey, envelopeCiphertext, mac, iv, deliveryToken } = data;
        if (!to || !deliveryToken) return;

        // Rate limit and token check
        let targetId = identities.get(to);
        if (!targetId) {
          // If offline, check DB
          const stmt = statements.getUserIdentity.get(to);
          if (stmt) {
             targetId = { deliveryToken: stmt.deliveryToken, fcmToken: stmt.fcmToken, ws: null };
          }
        }
        
        if (!targetId || targetId.deliveryToken !== deliveryToken) {
          // Drop message. Token mismatch or unknown target.
          console.warn(`Sealed sender token mismatch for target ${to}`);
          return;
        }
        
        // Pass to target unchanged (blind routing)
        if (targetId.ws && targetId.ws.readyState === ws.OPEN) {
           targetId.ws.send(JSON.stringify({
             type: 'sealed_msg',
             to, ephemeralPublicKey, envelopeCiphertext, iv, mac
           }));
        } else {
           // Queue for offline
           if (!offlineQueues.has(to)) offlineQueues.set(to, []);
           offlineQueues.get(to).push({ 
             queuedAt: Date.now(), 
             envelope: { type: 'sealed_msg', to, ephemeralPublicKey, envelopeCiphertext, iv, mac } 
           });
           
           if (targetId.fcmToken && firebaseEnabled) {
             getMessaging().send({
               token: targetId.fcmToken,
               notification: { title: "PROJECT VEIL", body: "Incoming Encrypted Transmission" },
               data: { wakeup: "true" },
               android: { priority: "high" }
             }).catch(e => console.error("FCM Error:", e.message));
           }
        }
        break;
      }
      case 'typing':
      case 'read':
      case 'vanish_mode':
      case 'session_repair': {
        const { from, to } = data;
        if (!from || !to) return;
        const target = identities.get(to);
        if (target && target.ws !== null && target.ws.readyState === ws.OPEN) {
          target.ws.send(JSON.stringify(data));
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

          // Trigger Zero-Knowledge Push Notification
          if (target && target.fcmToken && firebaseEnabled) {
            getMessaging().send({
              token: target.fcmToken,
              notification: {
                title: "PROJECT VEIL",
                body: "Incoming Encrypted Transmission"
              },
              data: { wakeup: "true" },
              android: { priority: "high" }
            }).catch(e => console.error("FCM Error:", e.message));
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

  // Clean expired encrypted attachments (older than 24h TTL)
  readdir(ATTACHMENT_DIR, (err, files) => {
    if (err || !files) return;
    files.forEach((file) => {
      const p = path.join(ATTACHMENT_DIR, file);
      stat(p, (err, stats) => {
        if (!err && now - stats.mtimeMs > ATTACHMENT_TTL) {
          unlink(p, () => {});
        }
      });
    });
  });
}, 60000);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`VEIL Relay & Attachment Server running on port ${PORT} (HTTP + WSS)`);
});
