import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import "fake-indexeddb/auto";
import { generateCipherId, generateLongTermKeys } from '../src/crypto/identity.js';
import { computeInitiatorSession, computeReceiverSession } from '../src/crypto/handshake.js';
import { encryptMessage, decryptMessage, ReplayWindow } from '../src/crypto/cipher.js';
import { computeSafetyNumber } from '../src/crypto/safetyNumber.js';
import { wrapAndStoreKeys, unwrapKeys } from '../src/crypto/keyStorage.js';
import { base64ToBytes, bytesToBase64 } from '../src/crypto/utils.js';
import { WebSocketServer, WebSocket } from 'ws';

describe('Project VEIL Protocol Tests', () => {

  describe('1. Cryptographic Handshake & Round-Trip', () => {
    it('should compute identical session keys and encrypt/decrypt successfully', async () => {
      const aliceId = generateCipherId();
      const bobId = generateCipherId();
      const aliceKeys = generateLongTermKeys();
      const bobKeys = generateLongTermKeys();

      // Handshake
      const { sessionKey: aliceSessionKey, kemCiphertextB64, ephemeralX25519PubB64 } = 
        computeInitiatorSession(bobKeys.mlkem.publicKeyB64, bobKeys.x25519.publicKeyB64, aliceId, bobId);

      const { sessionKey: bobSessionKey } = 
        computeReceiverSession(kemCiphertextB64, ephemeralX25519PubB64, bobKeys.mlkem.secretKeyB64, bobKeys.x25519.secretKeyB64, aliceId, bobId);

      expect(aliceSessionKey).toEqual(bobSessionKey);

      // Encrypt
      const plaintext = "Hello Post-Quantum World";
      const seq = 1;
      const ts = Date.now();
      const { ivB64, ciphertextB64 } = await encryptMessage(aliceSessionKey, plaintext, aliceId, bobId, seq, ts);

      // Decrypt
      const decrypted = await decryptMessage(bobSessionKey, ivB64, ciphertextB64, aliceId, bobId, seq, ts);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('2. Negative Security & Tamper Tests', () => {
    let sessionKey, ivB64, ciphertextB64, aliceId, bobId, seq, ts;

    beforeAll(async () => {
      aliceId = generateCipherId();
      bobId = generateCipherId();
      sessionKey = new Uint8Array(32);
      crypto.getRandomValues(sessionKey);
      seq = 1;
      ts = Date.now();
      const enc = await encryptMessage(sessionKey, "Secret Data", aliceId, bobId, seq, ts);
      ivB64 = enc.ivB64;
      ciphertextB64 = enc.ciphertextB64;
    });

    it('should reject ciphertext tampering', async () => {
      const tamperedCt = base64ToBytes(ciphertextB64);
      tamperedCt[0] ^= 1; // flip 1 byte
      const tamperedB64 = bytesToBase64(tamperedCt);

      await expect(
        decryptMessage(sessionKey, ivB64, tamperedB64, aliceId, bobId, seq, ts)
      ).rejects.toThrow(/Integrity or AAD mismatch/);
    });

    it('should reject AAD spoofing', async () => {
      // Modify fromCipherId
      await expect(
        decryptMessage(sessionKey, ivB64, ciphertextB64, "SPOOFED-ID", bobId, seq, ts)
      ).rejects.toThrow(/Integrity or AAD mismatch/);

      // Modify seq
      await expect(
        decryptMessage(sessionKey, ivB64, ciphertextB64, aliceId, bobId, seq + 1, ts)
      ).rejects.toThrow(/Integrity or AAD mismatch/);
    });

    it('should prevent replays outside sliding window', () => {
      const replayWin = new ReplayWindow(32);
      expect(replayWin.checkAndAdd(10)).toBe(true);
      
      // Duplicate
      expect(() => replayWin.checkAndAdd(10)).toThrow(/Duplicate/);
      
      // Advance highest to 50
      replayWin.checkAndAdd(50);
      
      // Outside window (50 - 32 = 18)
      expect(() => replayWin.checkAndAdd(17)).toThrow(/too old/);
      expect(replayWin.checkAndAdd(20)).toBe(true);
    });

    it('should fail on wrong passphrase for key unwrapping', async () => {
      const keys = generateLongTermKeys();
      await wrapAndStoreKeys("correct-horse", keys);

      await expect(
        unwrapKeys("wrong-battery")
      ).rejects.toThrow(/Invalid passphrase or corrupted vault/);
    });
  });

  describe('3. Safety Number Determinism', () => {
    it('should compute identical safety numbers regardless of initiator', () => {
      const aliceId = "AAAA-AAAA-AAAA-AAAA";
      const bobId = "BBBB-BBBB-BBBB-BBBB";
      const aliceKeys = generateLongTermKeys();
      const bobKeys = generateLongTermKeys();

      const snAlice = computeSafetyNumber(
        aliceId, bobId,
        aliceKeys.mlkem.publicKeyB64, aliceKeys.x25519.publicKeyB64,
        bobKeys.mlkem.publicKeyB64, bobKeys.x25519.publicKeyB64
      );

      const snBob = computeSafetyNumber(
        bobId, aliceId,
        bobKeys.mlkem.publicKeyB64, bobKeys.x25519.publicKeyB64,
        aliceKeys.mlkem.publicKeyB64, aliceKeys.x25519.publicKeyB64
      );

      expect(snAlice).toBe(snBob);
      expect(snAlice.replace(/ /g, '').length).toBe(60);
    });

    it('should diverge if public key is modified', () => {
      const aliceId = "AAAA-AAAA-AAAA-AAAA";
      const bobId = "BBBB-BBBB-BBBB-BBBB";
      const aliceKeys = generateLongTermKeys();
      const bobKeys = generateLongTermKeys();

      const snOriginal = computeSafetyNumber(
        aliceId, bobId,
        aliceKeys.mlkem.publicKeyB64, aliceKeys.x25519.publicKeyB64,
        bobKeys.mlkem.publicKeyB64, bobKeys.x25519.publicKeyB64
      );

      // flip 1 byte of Bob's X25519 key
      const bobXBytes = base64ToBytes(bobKeys.x25519.publicKeyB64);
      bobXBytes[0] ^= 1;
      const bobTampered = bytesToBase64(bobXBytes);

      const snTampered = computeSafetyNumber(
        aliceId, bobId,
        aliceKeys.mlkem.publicKeyB64, aliceKeys.x25519.publicKeyB64,
        bobKeys.mlkem.publicKeyB64, bobTampered
      );

      expect(snOriginal).not.toBe(snTampered);
    });
  });

  describe('4. Full Integration via Mock WebSocket Relay', () => {
    let wss, port;
    const aliceId = "ALICE-1111-2222-3333";
    const bobId = "BOB-4444-5555-6666";

    beforeAll(() => {
      return new Promise((resolve) => {
        // Start minimal mock relay similar to Phase 2 for testing
        wss = new WebSocketServer({ port: 0 });
        wss.on('listening', () => {
          port = wss.address().port;
          resolve();
        });

        const identities = new Map();
        const offlineQueues = new Map();

        wss.on('connection', (ws) => {
          ws.on('message', (msg) => {
            const data = JSON.parse(msg.toString());
            if (data.type === 'register') {
              identities.set(data.cipherId, ws);
              if (offlineQueues.has(data.cipherId)) {
                for (let env of offlineQueues.get(data.cipherId)) {
                  ws.send(JSON.stringify(env));
                }
                offlineQueues.delete(data.cipherId);
              }
            } else if (data.type === 'msg') {
              const target = identities.get(data.to);
              if (target && target.readyState === target.OPEN) {
                target.send(JSON.stringify(data));
                ws.send(JSON.stringify({ type: 'ack', to: data.to, seq: data.seq, status: 'delivered' }));
              } else {
                if (!offlineQueues.has(data.to)) offlineQueues.set(data.to, []);
                offlineQueues.get(data.to).push(data);
                ws.send(JSON.stringify({ type: 'ack', to: data.to, seq: data.seq, status: 'queued' }));
              }
            }
          });
          ws.on('close', () => {
            for (let [id, sock] of identities.entries()) {
              if (sock === ws) identities.set(id, null);
            }
          });
        });
      });
    });

    afterAll(() => {
      wss.close();
    });

    it('should queue offline message and deliver upon reconnect', async () => {
      const aliceWs = new WebSocket(`ws://localhost:${port}`);
      await new Promise(r => aliceWs.on('open', r));
      
      // Register Alice
      aliceWs.send(JSON.stringify({ type: 'register', cipherId: aliceId, mlkemPub: "A", x25519Pub: "A" }));

      // Bob is disconnected, Alice sends message
      const msgEnvelope = {
        type: 'msg',
        from: aliceId,
        to: bobId,
        seq: 1,
        ts: Date.now(),
        iv: "iv",
        ct: "ct"
      };

      const ackPromise = new Promise(resolve => {
        aliceWs.on('message', msg => {
          const data = JSON.parse(msg.toString());
          if (data.type === 'ack') resolve(data.status);
        });
      });

      aliceWs.send(JSON.stringify(msgEnvelope));
      const status = await ackPromise;
      expect(status).toBe('queued');

      // Bob reconnects and registers
      const bobWs = new WebSocket(`ws://localhost:${port}`);
      await new Promise(r => bobWs.on('open', r));
      
      const receivePromise = new Promise(resolve => {
        bobWs.on('message', msg => {
          const data = JSON.parse(msg.toString());
          if (data.type === 'msg') resolve(data);
        });
      });

      bobWs.send(JSON.stringify({ type: 'register', cipherId: bobId, mlkemPub: "B", x25519Pub: "B" }));
      
      const receivedMsg = await receivePromise;
      expect(receivedMsg.from).toBe(aliceId);
      expect(receivedMsg.ct).toBe("ct");

      aliceWs.close();
      bobWs.close();
    });
  });
});
