import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { generateLongTermKeys, generateCipherId } from '../crypto/identity.js';
import { generatePreKeyBundle, verifyPreKeyBundle, generateOneTimePreKeys } from '../crypto/prekeys.js';
import { computeInitiatorSession, computeReceiverSession } from '../crypto/handshake.js';
import { DoubleRatchet } from '../crypto/ratchet.js';
import { sealMessage, unsealMessage } from '../crypto/sealedSender.js';
import { getServerSigningKey } from '../../../server/serverKey.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { base64ToBytes, bytesToBase64, utf8ToBytes } from '../crypto/utils.js';

describe('Project VEIL - Complete Cryptographic & Security Verification', () => {
  let aliceKeys, bobKeys, aliceId, bobId;
  let bobPreKeys, serverKey;

  before(() => {
    aliceKeys = generateLongTermKeys();
    bobKeys = generateLongTermKeys();
    aliceId = generateCipherId();
    bobId = generateCipherId();
    serverKey = getServerSigningKey();
  });

  test('1. Identity & PreKey Bundle Generation & Signature Verification', () => {
    const bobEdPriv = base64ToBytes(bobKeys.ed25519.secretKeyB64);
    bobPreKeys = generatePreKeyBundle(bobEdPriv);

    assert.ok(bobPreKeys.publicBundle.signedPreKey.pub, 'Bob has signed prekey pub');
    assert.ok(bobPreKeys.publicBundle.signedPqPreKey.pub, 'Bob has signed PQ prekey pub');
    assert.strictEqual(bobPreKeys.publicBundle.oneTimePreKeys.length, 100, 'Bob has 100 OPKs');

    // Alice verifies Bob's bundle against Bob's long-term Ed25519 identity key
    const isValid = verifyPreKeyBundle(bobPreKeys.publicBundle, bobKeys.ed25519.publicKeyB64);
    assert.strictEqual(isValid, true, 'Bob bundle signature must be valid');

    // Tampering test: Tampered SignedPreKey pub should fail verification
    const tamperedBundle = JSON.parse(JSON.stringify(bobPreKeys.publicBundle));
    const tamperedBytes = base64ToBytes(tamperedBundle.signedPreKey.pub);
    tamperedBytes[0] ^= 0xff;
    tamperedBundle.signedPreKey.pub = bytesToBase64(tamperedBytes);
    assert.throws(() => {
      verifyPreKeyBundle(tamperedBundle, bobKeys.ed25519.publicKeyB64);
    }, /Invalid SignedPreKey signature/, 'Tampered bundle must fail signature check');
  });

  test('2. Hybrid PQXDH Handshake (ML-KEM-768 + X3DH)', () => {
    // Simulate server providing Bob's bundle with 1 OPK
    const bundleForAlice = {
      identity: {
        identityMlkemPub: bobKeys.mlkem.publicKeyB64,
        identityX25519Pub: bobKeys.x25519.publicKeyB64,
        identityEd25519Pub: bobKeys.ed25519.publicKeyB64
      },
      signedPreKey: bobPreKeys.publicBundle.signedPreKey,
      signedPqPreKey: bobPreKeys.publicBundle.signedPqPreKey,
      oneTimePreKey: bobPreKeys.publicBundle.oneTimePreKeys[0]
    };

    // Alice computes initiator session
    const aliceSession = computeInitiatorSession(
      bundleForAlice,
      aliceKeys.x25519.secretKeyB64,
      aliceId,
      bobId
    );

    assert.ok(aliceSession.sessionKey, 'Alice derives session key');
    assert.ok(aliceSession.ephemeralX25519PubB64, 'Alice has ephemeral pub');
    assert.ok(aliceSession.kemCiphertextB64, 'Alice has ML-KEM ciphertext');
    assert.strictEqual(aliceSession.opkId, bundleForAlice.oneTimePreKey.id);

    // Bob computes receiver session using consumed OPK private key
    const bobOpkPriv = bobPreKeys.privateMaterial.oneTimePreKeys.find(k => k.id === aliceSession.opkId).priv;

    const bobSession = computeReceiverSession(
      aliceSession.ephemeralX25519PubB64,
      aliceSession.kemCiphertextB64,
      aliceKeys.x25519.publicKeyB64,
      aliceSession.opkId,
      bobKeys.x25519.secretKeyB64,
      bobPreKeys.privateMaterial.signedPreKey,
      bobPreKeys.privateMaterial.signedPqPreKey,
      bobOpkPriv,
      aliceId,
      bobId
    );

    assert.deepStrictEqual(
      Buffer.from(aliceSession.sessionKey),
      Buffer.from(bobSession.sessionKey),
      'Alice and Bob derived session keys must match exactly'
    );
  });

  test('3. Double Ratchet Multi-Turn Conversation & Skipped Keys Handling', async () => {
    const rootKey = crypto.getRandomValues(new Uint8Array(32));
    
    // Bob's signed prekey pair
    const bobInitialPriv = x25519.utils.randomSecretKey();
    const bobInitialPub = x25519.getPublicKey(bobInitialPriv);

    const aliceRatchet = new DoubleRatchet(rootKey, true, bobInitialPub);
    const bobRatchet = new DoubleRatchet(rootKey, false, null, bobInitialPriv);

    // Turn 1: Alice -> Bob
    const msg1 = "Message 1: Top secret coordinates";
    const enc1 = await aliceRatchet.encryptMessage(msg1);
    const dec1 = await bobRatchet.decryptMessage(enc1.header, enc1.iv, enc1.ct);
    assert.strictEqual(dec1, msg1);

    // Turn 2: Bob -> Alice
    const msg2 = "Message 2: Coordinates received";
    const enc2 = await bobRatchet.encryptMessage(msg2);
    const dec2 = await aliceRatchet.decryptMessage(enc2.header, enc2.iv, enc2.ct);
    assert.strictEqual(dec2, msg2);

    // Turn 3: Alice sends 3 messages in a row
    const aMsg1 = await aliceRatchet.encryptMessage("Burst 1");
    const aMsg2 = await aliceRatchet.encryptMessage("Burst 2");
    const aMsg3 = await aliceRatchet.encryptMessage("Burst 3");

    // Bob receives Burst 3 FIRST (out-of-order delivery)
    const decBurst3 = await bobRatchet.decryptMessage(aMsg3.header, aMsg3.iv, aMsg3.ct);
    assert.strictEqual(decBurst3, "Burst 3");

    // Bob then receives Burst 1
    const decBurst1 = await bobRatchet.decryptMessage(aMsg1.header, aMsg1.iv, aMsg1.ct);
    assert.strictEqual(decBurst1, "Burst 1");

    // Bob then receives Burst 2
    const decBurst2 = await bobRatchet.decryptMessage(aMsg2.header, aMsg2.iv, aMsg2.ct);
    assert.strictEqual(decBurst2, "Burst 2");
  });

  test('4. Ratchet Serialization & Deserialization Persistence', async () => {
    const rootKey = crypto.getRandomValues(new Uint8Array(32));
    const bobInitialPriv = x25519.utils.randomSecretKey();
    const bobInitialPub = x25519.getPublicKey(bobInitialPriv);
    
    const originalAlice = new DoubleRatchet(rootKey, true, bobInitialPub);
    const enc1 = await originalAlice.encryptMessage("State test 1");

    // Serialize Alice ratchet state to string
    const serializedState = originalAlice.serialize();
    assert.ok(typeof serializedState === 'string' && serializedState.length > 50);

    // Restore Alice ratchet from serialized state (simulating app restart)
    const restoredAlice = DoubleRatchet.deserialize(serializedState);

    // Encrypt next message with restored ratchet
    const enc2 = await restoredAlice.encryptMessage("State test 2");

    // Bob receives both
    const bobRatchet = new DoubleRatchet(rootKey, false, null, bobInitialPriv);
    const dec1 = await bobRatchet.decryptMessage(enc1.header, enc1.iv, enc1.ct);
    const dec2 = await bobRatchet.decryptMessage(enc2.header, enc2.iv, enc2.ct);

    assert.strictEqual(dec1, "State test 1");
    assert.strictEqual(dec2, "State test 2");
  });

  test('5. Sealed Sender Envelope Encryption & Certificate Verification', async () => {
    // Generate server certificate for Alice
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const senderIdBuf = Buffer.from(aliceId, 'utf-8');
    const x25519PubBuf = Buffer.from(aliceKeys.x25519.publicKeyB64, 'base64');
    const expiresBuf = Buffer.alloc(8);
    expiresBuf.writeBigInt64BE(BigInt(expiresAt));

    const len1 = Buffer.alloc(2);
    len1.writeUInt16BE(senderIdBuf.length);
    const len2 = Buffer.alloc(2);
    len2.writeUInt16BE(x25519PubBuf.length);

    const msgToSign = Buffer.concat([len1, senderIdBuf, len2, x25519PubBuf, expiresBuf]);
    const serverSig = ed25519.sign(msgToSign, serverKey.secretKey);

    const aliceCert = {
      senderId: aliceId,
      identityPublicKey: aliceKeys.x25519.publicKeyB64,
      expiresAt,
      serverSignature: Buffer.from(serverSig).toString('base64')
    };

    const serverIdentityPubB64 = Buffer.from(serverKey.publicKey).toString('base64');

    // Alice seals a message for Bob
    const innerSecretMessage = JSON.stringify({ text: "Meet at 0400 hours", deliveryToken: "alice-token-xyz" });
    const sealed = await sealMessage(bobKeys.x25519.publicKeyB64, aliceCert, innerSecretMessage);

    assert.ok(sealed.ephemeralPublicKey);
    assert.ok(sealed.envelopeCiphertext);
    assert.ok(sealed.mac);
    assert.ok(sealed.iv);

    // Bob unseals the message using his Identity Private Key
    const unsealed = await unsealMessage(
      sealed.ephemeralPublicKey,
      sealed.envelopeCiphertext,
      sealed.iv,
      sealed.mac,
      bobKeys.x25519.secretKeyB64,
      serverIdentityPubB64
    );

    assert.strictEqual(unsealed.senderId, aliceId, 'Bob recovers verified senderId');
    assert.strictEqual(unsealed.senderIdentityPubB64, aliceKeys.x25519.publicKeyB64);
    assert.strictEqual(unsealed.payload, innerSecretMessage);
  });

  test('6. Sealed Sender Security Checks: MAC Tampering & Expired Certs', async () => {
    const expiresAt = Date.now() - 1000; // ALREADY EXPIRED
    const senderIdBuf = Buffer.from(aliceId, 'utf-8');
    const x25519PubBuf = Buffer.from(aliceKeys.x25519.publicKeyB64, 'base64');
    const expiresBuf = Buffer.alloc(8);
    expiresBuf.writeBigInt64BE(BigInt(expiresAt));

    const len1 = Buffer.alloc(2);
    len1.writeUInt16BE(senderIdBuf.length);
    const len2 = Buffer.alloc(2);
    len2.writeUInt16BE(x25519PubBuf.length);

    const msgToSign = Buffer.concat([len1, senderIdBuf, len2, x25519PubBuf, expiresBuf]);
    const serverSig = ed25519.sign(msgToSign, serverKey.secretKey);

    const expiredCert = {
      senderId: aliceId,
      identityPublicKey: aliceKeys.x25519.publicKeyB64,
      expiresAt,
      serverSignature: Buffer.from(serverSig).toString('base64')
    };

    const serverIdentityPubB64 = Buffer.from(serverKey.publicKey).toString('base64');
    const sealed = await sealMessage(bobKeys.x25519.publicKeyB64, expiredCert, "Test");

    // Bob must reject expired cert
    await assert.rejects(async () => {
      await unsealMessage(
        sealed.ephemeralPublicKey,
        sealed.envelopeCiphertext,
        sealed.iv,
        sealed.mac,
        bobKeys.x25519.secretKeyB64,
        serverIdentityPubB64
      );
    }, /Sender Certificate Expired/);

    // MAC Tampering test
    const validExpires = Date.now() + 60000;
    expiresBuf.writeBigInt64BE(BigInt(validExpires));
    const validMsgToSign = Buffer.concat([len1, senderIdBuf, len2, x25519PubBuf, expiresBuf]);
    const validSig = ed25519.sign(validMsgToSign, serverKey.secretKey);
    const validCert = {
      senderId: aliceId,
      identityPublicKey: aliceKeys.x25519.publicKeyB64,
      expiresAt: validExpires,
      serverSignature: Buffer.from(validSig).toString('base64')
    };

    const sealed2 = await sealMessage(bobKeys.x25519.publicKeyB64, validCert, "Test 2");
    
    // Tamper with envelope ciphertext
    const tamperedCtBytes = base64ToBytes(sealed2.envelopeCiphertext);
    tamperedCtBytes[0] ^= 0x01;
    const tamperedCtB64 = bytesToBase64(tamperedCtBytes);

    await assert.rejects(async () => {
      await unsealMessage(
        sealed2.ephemeralPublicKey,
        tamperedCtB64,
        sealed2.iv,
        sealed2.mac,
        bobKeys.x25519.secretKeyB64,
        serverIdentityPubB64
      );
    }, /Sealed Sender MAC validation failed/);
  });

  test('7. End-to-End Simulation: Handshake + Sealed Sender + Multi-Turn Ratchet Replies', async () => {
    // 1. Setup Bob's PreKey Bundle on Server
    const bobEdPriv = base64ToBytes(bobKeys.ed25519.secretKeyB64);
    const bobBundleGen = generatePreKeyBundle(bobEdPriv);
    const bobPublicBundle = bobBundleGen.publicBundle;
    const bobLocalPreKeys = bobBundleGen.privateMaterial;

    const serverIdentityPubB64 = Buffer.from(serverKey.publicKey).toString('base64');

    // Generate Alice's Server Certificate
    const aliceExpires = Date.now() + 86400000;
    const sIdBuf = Buffer.from(aliceId, 'utf-8');
    const sPubBuf = Buffer.from(aliceKeys.x25519.publicKeyB64, 'base64');
    const expBuf = Buffer.alloc(8);
    expBuf.writeBigInt64BE(BigInt(aliceExpires));
    const l1 = Buffer.alloc(2); l1.writeUInt16BE(sIdBuf.length);
    const l2 = Buffer.alloc(2); l2.writeUInt16BE(sPubBuf.length);
    const aMsgToSign = Buffer.concat([l1, sIdBuf, l2, sPubBuf, expBuf]);
    const aSig = ed25519.sign(aMsgToSign, serverKey.secretKey);
    const aliceCert = {
      senderId: aliceId,
      identityPublicKey: aliceKeys.x25519.publicKeyB64,
      expiresAt: aliceExpires,
      serverSignature: Buffer.from(aSig).toString('base64')
    };

    // Generate Bob's Server Certificate
    const bobExpires = Date.now() + 86400000;
    const bIdBuf = Buffer.from(bobId, 'utf-8');
    const bPubBuf = Buffer.from(bobKeys.x25519.publicKeyB64, 'base64');
    const bExpBuf = Buffer.alloc(8);
    bExpBuf.writeBigInt64BE(BigInt(bobExpires));
    const bl1 = Buffer.alloc(2); bl1.writeUInt16BE(bIdBuf.length);
    const bl2 = Buffer.alloc(2); bl2.writeUInt16BE(bPubBuf.length);
    const bMsgToSign = Buffer.concat([bl1, bIdBuf, bl2, bPubBuf, bExpBuf]);
    const bSig = ed25519.sign(bMsgToSign, serverKey.secretKey);
    const bobCert = {
      senderId: bobId,
      identityPublicKey: bobKeys.x25519.publicKeyB64,
      expiresAt: bobExpires,
      serverSignature: Buffer.from(bSig).toString('base64')
    };

    // 2. Alice fetches Bob's bundle & performs PQXDH Handshake
    verifyPreKeyBundle(bobPublicBundle, bobKeys.ed25519.publicKeyB64);
    const bundleForAlice = {
      identity: {
        identityMlkemPub: bobKeys.mlkem.publicKeyB64,
        identityX25519Pub: bobKeys.x25519.publicKeyB64,
        identityEd25519Pub: bobKeys.ed25519.publicKeyB64
      },
      signedPreKey: bobPublicBundle.signedPreKey,
      signedPqPreKey: bobPublicBundle.signedPqPreKey,
      oneTimePreKey: bobPublicBundle.oneTimePreKeys[0]
    };

    const aliceHandshake = computeInitiatorSession(bundleForAlice, aliceKeys.x25519.secretKeyB64, aliceId, bobId);
    const bobSpkPub = base64ToBytes(bundleForAlice.signedPreKey.pub);
    const aliceRatchet = new DoubleRatchet(aliceHandshake.sessionKey, true, bobSpkPub);

    // 3. Alice encrypts Message 1 with Double Ratchet
    const aliceMsg1Text = "Project VEIL Activated";
    const aliceInnerPayload = JSON.stringify({ text: aliceMsg1Text, deliveryToken: "alice-delivery-token" });
    const aliceEnc1 = await aliceRatchet.encryptMessage(aliceInnerPayload);

    const aliceWireEnvelope = {
      v: 1, type: 'msg', to: bobId,
      seq: 1, ts: Date.now(),
      iv: aliceEnc1.iv, ct: aliceEnc1.ct, rh: aliceEnc1.header,
      ekpub: aliceHandshake.ephemeralX25519PubB64,
      kemct: aliceHandshake.kemCiphertextB64,
      opkId: aliceHandshake.opkId
    };

    // 4. Alice seals the message (blind routing)
    const sealedFromAlice = await sealMessage(
      bobKeys.x25519.publicKeyB64,
      aliceCert,
      JSON.stringify(aliceWireEnvelope)
    );

    // 5. Bob receives Sealed Message, unseals envelope
    const bobUnsealed = await unsealMessage(
      sealedFromAlice.ephemeralPublicKey,
      sealedFromAlice.envelopeCiphertext,
      sealedFromAlice.iv,
      sealedFromAlice.mac,
      bobKeys.x25519.secretKeyB64,
      serverIdentityPubB64
    );

    assert.strictEqual(bobUnsealed.senderId, aliceId);
    const receivedWireMsg = JSON.parse(bobUnsealed.payload);

    // 6. Bob computes receiver session & initializes ratchet
    const opkIndex = bobLocalPreKeys.oneTimePreKeys.findIndex(k => k.id === receivedWireMsg.opkId);
    assert.ok(opkIndex !== -1, 'Bob finds his OPK');
    const bobOpkPriv = bobLocalPreKeys.oneTimePreKeys[opkIndex].priv;
    
    // Delete consumed OPK
    bobLocalPreKeys.oneTimePreKeys.splice(opkIndex, 1);
    assert.strictEqual(bobLocalPreKeys.oneTimePreKeys.length, 99, 'OPK consumed and deleted');

    const bobHandshake = computeReceiverSession(
      receivedWireMsg.ekpub,
      receivedWireMsg.kemct,
      aliceKeys.x25519.publicKeyB64,
      receivedWireMsg.opkId,
      bobKeys.x25519.secretKeyB64,
      bobLocalPreKeys.signedPreKey,
      bobLocalPreKeys.signedPqPreKey,
      bobOpkPriv,
      aliceId, bobId
    );

    const bobSpkPriv = base64ToBytes(bobLocalPreKeys.signedPreKey);
    const bobRatchet = new DoubleRatchet(bobHandshake.sessionKey, false, null, bobSpkPriv);

    const bobDecryptedRaw = await bobRatchet.decryptMessage(receivedWireMsg.rh, receivedWireMsg.iv, receivedWireMsg.ct);
    const bobDecryptedPayload = JSON.parse(bobDecryptedRaw);
    assert.strictEqual(bobDecryptedPayload.text, aliceMsg1Text);
    assert.strictEqual(bobDecryptedPayload.deliveryToken, "alice-delivery-token");

    // 7. Bob replies to Alice (Turn 2) with Sealed Sender
    const bobReplyText = "Roger that, VEIL is live.";
    const bobInnerPayload = JSON.stringify({ text: bobReplyText, deliveryToken: "bob-delivery-token" });
    const bobEnc = await bobRatchet.encryptMessage(bobInnerPayload);

    const bobWireEnvelope = {
      v: 1, type: 'msg', to: aliceId,
      seq: 2, ts: Date.now(),
      iv: bobEnc.iv, ct: bobEnc.ct, rh: bobEnc.header
    };

    const sealedFromBob = await sealMessage(
      aliceKeys.x25519.publicKeyB64,
      bobCert,
      JSON.stringify(bobWireEnvelope)
    );

    // 8. Alice receives Bob's sealed reply
    const aliceUnsealed = await unsealMessage(
      sealedFromBob.ephemeralPublicKey,
      sealedFromBob.envelopeCiphertext,
      sealedFromBob.iv,
      sealedFromBob.mac,
      aliceKeys.x25519.secretKeyB64,
      serverIdentityPubB64
    );

    assert.strictEqual(aliceUnsealed.senderId, bobId);
    const aliceReceivedWire = JSON.parse(aliceUnsealed.payload);
    const aliceDecryptedRaw = await aliceRatchet.decryptMessage(aliceReceivedWire.rh, aliceReceivedWire.iv, aliceReceivedWire.ct);
    const aliceDecryptedPayload = JSON.parse(aliceDecryptedRaw);
    assert.strictEqual(aliceDecryptedPayload.text, bobReplyText);

    // 9. Alice sends another message (Turn 3)
    const aliceMsg3Text = "Forward Secrecy verified.";
    const aliceEnc3 = await aliceRatchet.encryptMessage(JSON.stringify({ text: aliceMsg3Text }));
    const bobDecrypted3Raw = await bobRatchet.decryptMessage(aliceEnc3.header, aliceEnc3.iv, aliceEnc3.ct);
    assert.strictEqual(JSON.parse(bobDecrypted3Raw).text, aliceMsg3Text);
  });
});
