import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { computeInitiatorSession, computeReceiverSession } from '../src/crypto/handshake.js';
import { DoubleRatchet } from '../src/crypto/ratchet.js';
import { sealMessage, unsealMessage } from '../src/crypto/sealedSender.js';
import { bytesToBase64, base64ToBytes } from '../src/crypto/utils.js';

console.log('═══════════════════════════════════════════════════');
console.log(' PROJECT VEIL — CRYPTOGRAPHIC INTEGRITY TEST SUITE');
console.log('═══════════════════════════════════════════════════\n');

function createCert(senderId, x25519PubB64, serverPriv) {
  const expiresAt = Date.now() + 86400000;
  const senderIdBuf = Buffer.from(senderId, 'utf-8');
  const x25519PubBuf = Buffer.from(x25519PubB64, 'base64');
  const expiresBuf = Buffer.alloc(8);
  expiresBuf.writeBigInt64BE(BigInt(expiresAt));
  const len1 = Buffer.alloc(2); len1.writeUInt16BE(senderIdBuf.length);
  const len2 = Buffer.alloc(2); len2.writeUInt16BE(x25519PubBuf.length);
  const msgToSign = Buffer.concat([len1, senderIdBuf, len2, x25519PubBuf, expiresBuf]);
  const signature = ed25519.sign(msgToSign, serverPriv);
  return {
    senderId,
    identityPublicKey: x25519PubB64,
    expiresAt,
    serverSignature: bytesToBase64(signature)
  };
}

async function runTests() {
  const serverPriv = ed25519.utils.randomSecretKey();
  const serverPub = ed25519.getPublicKey(serverPriv);
  const serverPubB64 = bytesToBase64(serverPub);

  // Alice (Device 1)
  const aliceId = 'alice_node';
  const aliceXPriv = x25519.utils.randomSecretKey();
  const aliceXPub = x25519.getPublicKey(aliceXPriv);
  const aliceCert = createCert(aliceId, bytesToBase64(aliceXPub), serverPriv);

  // Bob (Device 2)
  const bobId = 'bob_node';
  const bobXPriv = x25519.utils.randomSecretKey();
  const bobXPub = x25519.getPublicKey(bobXPriv);
  const bobSpkPriv = x25519.utils.randomSecretKey();
  const bobSpkPub = x25519.getPublicKey(bobSpkPriv);
  const bobPq = ml_kem768.keygen();
  const bobCert = createCert(bobId, bytesToBase64(bobXPub), serverPriv);

  const bobBundle = {
    identity: { identityX25519Pub: bytesToBase64(bobXPub) },
    signedPreKey: { pub: bytesToBase64(bobSpkPub) },
    signedPqPreKey: { pub: bytesToBase64(bobPq.publicKey) }
  };

  // Test 1: PQXDH Handshake + Double Ratchet Init
  const aliceSess = computeInitiatorSession(bobBundle, bytesToBase64(aliceXPriv), aliceId, bobId);
  const aliceRatchet = new DoubleRatchet(aliceSess.sessionKey, true, bobSpkPub);

  const inner1 = JSON.stringify({ text: 'Quantum Transmission 1', deliveryToken: 'alice_dt' });
  const ratchetEnc1 = await aliceRatchet.encryptMessage(inner1);

  const env1 = {
    type: 'msg',
    ekpub: aliceSess.ephemeralX25519PubB64,
    kemct: aliceSess.kemCiphertextB64,
    rh: ratchetEnc1.header,
    iv: ratchetEnc1.iv,
    ct: ratchetEnc1.ct
  };

  // Test 2: Sealed Sender Packaging
  const sealed1 = await sealMessage(bytesToBase64(bobXPub), aliceCert, JSON.stringify(env1));

  // Test 3: Unsealing + Receiver Decryption
  const unsealed1 = await unsealMessage(sealed1.ephemeralPublicKey, sealed1.envelopeCiphertext, sealed1.iv, sealed1.mac, bytesToBase64(bobXPriv), serverPubB64);
  const envRecv1 = JSON.parse(unsealed1.payload);

  const bobSess = computeReceiverSession(
    envRecv1.ekpub, envRecv1.kemct, bytesToBase64(aliceXPub), null,
    bytesToBase64(bobXPriv), bytesToBase64(bobSpkPriv), bytesToBase64(bobPq.secretKey), null,
    aliceId, bobId
  );
  const bobRatchet = new DoubleRatchet(bobSess.sessionKey, false, base64ToBytes(envRecv1.ekpub), bobSpkPriv);
  const dec1 = await bobRatchet.decryptMessage(envRecv1.rh, envRecv1.iv, envRecv1.ct);
  const parsed1 = JSON.parse(dec1);
  if (parsed1.text !== 'Quantum Transmission 1') throw new Error('Decryption mismatch on Message 1');
  console.log('[1] Handshake + Message 1 (Alice -> Bob): ✅ PASS');

  // Test 4: Sealed Sender Reply (Bob -> Alice)
  const inner2 = JSON.stringify({ text: 'Quantum Transmission 2 (Reply)', deliveryToken: 'bob_dt' });
  const ratchetEnc2 = await bobRatchet.encryptMessage(inner2);
  const env2 = { type: 'msg', rh: ratchetEnc2.header, iv: ratchetEnc2.iv, ct: ratchetEnc2.ct };
  const sealed2 = await sealMessage(bytesToBase64(aliceXPub), bobCert, JSON.stringify(env2));

  const unsealed2 = await unsealMessage(sealed2.ephemeralPublicKey, sealed2.envelopeCiphertext, sealed2.iv, sealed2.mac, bytesToBase64(aliceXPriv), serverPubB64);
  const envRecv2 = JSON.parse(unsealed2.payload);
  const dec2 = await aliceRatchet.decryptMessage(envRecv2.rh, envRecv2.iv, envRecv2.ct);
  const parsed2 = JSON.parse(dec2);
  if (parsed2.text !== 'Quantum Transmission 2 (Reply)') throw new Error('Decryption mismatch on Message 2');
  console.log('[2] Multi-turn Reply (Bob -> Alice): ✅ PASS');

  // Test 5: Follow-up Message (Alice -> Bob)
  const inner3 = JSON.stringify({ text: 'Quantum Transmission 3' });
  const ratchetEnc3 = await aliceRatchet.encryptMessage(inner3);
  const env3 = { type: 'msg', rh: ratchetEnc3.header, iv: ratchetEnc3.iv, ct: ratchetEnc3.ct };
  const sealed3 = await sealMessage(bytesToBase64(bobXPub), aliceCert, JSON.stringify(env3));

  const unsealed3 = await unsealMessage(sealed3.ephemeralPublicKey, sealed3.envelopeCiphertext, sealed3.iv, sealed3.mac, bytesToBase64(bobXPriv), serverPubB64);
  const envRecv3 = JSON.parse(unsealed3.payload);
  const dec3 = await bobRatchet.decryptMessage(envRecv3.rh, envRecv3.iv, envRecv3.ct);
  const parsed3 = JSON.parse(dec3);
  if (parsed3.text !== 'Quantum Transmission 3') throw new Error('Decryption mismatch on Message 3');
  console.log('[3] Follow-up Message (Alice -> Bob): ✅ PASS');

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' ✅ ALL 3 CRYPTOGRAPHIC PIPELINES VERIFIED 100%');
  console.log('═══════════════════════════════════════════════════\n');
}

runTests().catch(err => {
  console.error('❌ CRYPTO TEST FAILED:', err);
  process.exit(1);
});
