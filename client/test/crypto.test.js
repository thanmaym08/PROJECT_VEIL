import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { computeInitiatorSession, computeReceiverSession } from '../src/crypto/handshake.js';
import { DoubleRatchet } from '../src/crypto/ratchet.js';
import { sealMessage, unsealMessage } from '../src/crypto/sealedSender.js';
import { bytesToBase64, base64ToBytes } from '../src/crypto/utils.js';
import { generateDeviceLinkSession, encryptDeviceLinkPayload, decryptDeviceLinkPayload } from '../src/crypto/deviceLink.js';
import { createGroupTree, initMemberFromInitialCommit, createTreeKemCommit, processTreeKemCommit, encryptGroupMlsMessage, decryptGroupMlsMessage } from '../src/crypto/treeKem.js';

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

  // Test 4: Header AAD Tamper Rejection Test (MitM Attack Simulation)
  let tamperCaught = false;
  try {
    const tamperedHeader = { ...envRecv3.rh, n: envRecv3.rh.n + 99 };
    await bobRatchet.decryptMessage(tamperedHeader, envRecv3.iv, envRecv3.ct);
  } catch (e) {
    tamperCaught = true;
  }
  if (!tamperCaught) throw new Error("CRITICAL: Tampered header was NOT rejected by AES-GCM AAD!");
  console.log('[4] Header AAD Tamper Rejection (MitM Deflection): ✅ PASS');

  // Test 5: Multi-Device Sync Ephemeral Key Exchange & E2EE Vault Transfer
  const secondarySession = generateDeviceLinkSession();
  const identityBundle = {
    cipherId: aliceId,
    nickname: 'Alice Node',
    identityX25519Pub: bytesToBase64(aliceXPub),
    identityX25519Priv: bytesToBase64(aliceXPriv)
  };

  const encryptedLink = await encryptDeviceLinkPayload(secondarySession.ephemeralPubB64, identityBundle);
  const decryptedBundle = await decryptDeviceLinkPayload(
    secondarySession.ephemeralPrivB64,
    encryptedLink.ephemeralPubB64,
    encryptedLink.ciphertextB64,
    encryptedLink.ivB64
  );

  if (decryptedBundle.cipherId !== aliceId || decryptedBundle.identityX25519Priv !== identityBundle.identityX25519Priv) {
    throw new Error("Multi-device sync payload decryption mismatch!");
  }

  // Verify tamper rejection on link ciphertext
  let linkTamperCaught = false;
  try {
    const corruptedCt = encryptedLink.ciphertextB64.slice(0, -4) + 'AAAA';
    await decryptDeviceLinkPayload(
      secondarySession.ephemeralPrivB64,
      encryptedLink.ephemeralPubB64,
      corruptedCt,
      encryptedLink.ivB64
    );
  } catch (e) {
    linkTamperCaught = true;
  }
  if (!linkTamperCaught) throw new Error("CRITICAL: Tampered device link ciphertext was NOT rejected!");
  console.log('[5] Multi-Device Ephemeral E2EE Link & Tamper Shield: ✅ PASS');

  // Test 6: Post-Quantum Group Ratchets (MLS / TreeKEM with ML-KEM-768)
  const groupMembers = Array.from({ length: 8 }, (_, i) => ({
    id: 'agent_' + i,
    name: 'Agent ' + i
  }));

  // 1. Creator (agent_0) creates TreeKEM tree
  const { groupTree: creatorTree, initialCommit } = createGroupTree('quantum_group_omega', groupMembers, 'agent_0');
  
  // 2. Members initialize trees from initial commit
  const memberTrees = groupMembers.map(m => {
    if (m.id === 'agent_0') return creatorTree;
    return initMemberFromInitialCommit(initialCommit, m.id);
  });

  // Verify all 8 members share identical Epoch 1 secret
  for (let i = 1; i < memberTrees.length; i++) {
    if (bytesToBase64(memberTrees[i].epochSecret) !== bytesToBase64(creatorTree.epochSecret)) {
      throw new Error(`Epoch 1 secret mismatch for ${memberTrees[i].myId}`);
    }
  }

  // 3. Member 3 performs a TreeKEM Commit (Epoch 1 -> Epoch 2) in O(log N)
  const { newGroupTree: committerTree2, commitPayload: commit2 } = createTreeKemCommit(memberTrees[3], 'agent_3');
  memberTrees[3] = committerTree2;

  // 4. All other 7 members process commit2
  for (let i = 0; i < memberTrees.length; i++) {
    if (i === 3) continue;
    memberTrees[i] = processTreeKemCommit(memberTrees[i], memberTrees[i].myId, commit2);
    if (bytesToBase64(memberTrees[i].epochSecret) !== bytesToBase64(committerTree2.epochSecret)) {
      throw new Error(`Epoch 2 secret mismatch for member ${memberTrees[i].myId}`);
    }
  }

  // 5. Member 5 sends an O(1) encrypted group message
  const secretPayload = { text: "Tactical post-quantum transmission to entire squad", code: 9942 };
  const mlsMsg = await encryptGroupMlsMessage(memberTrees[5], 'agent_5', secretPayload);

  // 6. Member 1 and Member 7 decrypt the message in O(1)
  const decrypted1 = await decryptGroupMlsMessage(memberTrees[1], mlsMsg);
  const decrypted7 = await decryptGroupMlsMessage(memberTrees[7], mlsMsg);

  if (decrypted1.text !== secretPayload.text || decrypted7.code !== secretPayload.code) {
    throw new Error("TreeKEM group message decryption content mismatch!");
  }

  // 7. Tamper Rejection Test (Corrupted ciphertext or AAD must fail)
  let mlsTamperCaught = false;
  try {
    const tamperedMlsMsg = { ...mlsMsg, ciphertextB64: mlsMsg.ciphertextB64.slice(0, -4) + 'AAAA' };
    await decryptGroupMlsMessage(memberTrees[2], tamperedMlsMsg);
  } catch (e) {
    mlsTamperCaught = true;
  }
  if (!mlsTamperCaught) throw new Error("CRITICAL: Tampered TreeKEM MLS ciphertext was NOT rejected!");

  // 8. Member 6 performs Epoch 3 commit with member update
  const { newGroupTree: committerTree3, commitPayload: commit3 } = createTreeKemCommit(memberTrees[6], 'agent_6');
  memberTrees[6] = committerTree3;

  for (let i = 0; i < memberTrees.length; i++) {
    if (i === 6) continue;
    memberTrees[i] = processTreeKemCommit(memberTrees[i], memberTrees[i].myId, commit3);
    if (bytesToBase64(memberTrees[i].epochSecret) !== bytesToBase64(committerTree3.epochSecret)) {
      throw new Error(`Epoch 3 secret mismatch for member ${memberTrees[i].myId}`);
    }
  }

  console.log('[6] Post-Quantum TreeKEM MLS (O(log N) Commit + O(1) Group AES-GCM): ✅ PASS');

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' ✅ ALL 6 CRYPTOGRAPHIC PIPELINES VERIFIED 100%');
  console.log('═══════════════════════════════════════════════════\n');
}

runTests().catch(err => {
  console.error('❌ CRYPTO TEST FAILED:', err);
  process.exit(1);
});
