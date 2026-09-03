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
import { readFileSync } from 'fs';

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

const wss = new WebSocketServer({ 
  port: 8080,
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
}, 60000);

console.log('VEIL Relay Server running on port 8080');
