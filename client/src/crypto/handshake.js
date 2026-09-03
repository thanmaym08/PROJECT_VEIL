import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { base64ToBytes, bytesToBase64, utf8ToBytes } from './utils.js';

function computeSalt(cipherIdA, cipherIdB) {
  const sortedIds = [cipherIdA, cipherIdB].sort().join('');
  const idsBytes = utf8ToBytes(sortedIds);
  const versionByte = new Uint8Array([0x01]);
  const input = new Uint8Array(idsBytes.length + 1);
  input.set(idsBytes, 0);
  input.set(versionByte, idsBytes.length);
  return sha256(input);
}

export function computeInitiatorSession(bundle, myX25519PrivB64, senderCipherId, recipientCipherId) {
  const myXPriv = base64ToBytes(myX25519PrivB64);
  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);

  // Bob's public keys from bundle
  const bobIdX = base64ToBytes(bundle.identity.identityX25519Pub);
  const bobSpkX = base64ToBytes(bundle.signedPreKey.pub);
  
  // X3DH Steps
  const dh1 = x25519.getSharedSecret(ephemeralPriv, bobIdX);
  const dh2 = x25519.getSharedSecret(myXPriv, bobSpkX);
  const dh3 = x25519.getSharedSecret(ephemeralPriv, bobSpkX);
  
  let dh4 = new Uint8Array(0);
  let opkId = null;
  if (bundle.oneTimePreKey) {
    opkId = bundle.oneTimePreKey.id;
    const bobOpkX = base64ToBytes(bundle.oneTimePreKey.pub);
    dh4 = x25519.getSharedSecret(ephemeralPriv, bobOpkX);
  }

  // PQXDH Step
  const bobPqPub = base64ToBytes(bundle.signedPqPreKey.pub);
  const { cipherText: kemCiphertext, sharedSecret: pqSecret } = ml_kem768.encapsulate(bobPqPub);

  // Combine IKM
  const ikmLen = dh1.length + dh2.length + dh3.length + dh4.length + pqSecret.length;
  const ikm = new Uint8Array(ikmLen);
  let offset = 0;
  
  ikm.set(dh1, offset); offset += dh1.length;
  ikm.set(dh2, offset); offset += dh2.length;
  ikm.set(dh3, offset); offset += dh3.length;
  if (dh4.length > 0) {
    ikm.set(dh4, offset); offset += dh4.length;
  }
  ikm.set(pqSecret, offset);

  // Derive Session Key
  const salt = computeSalt(senderCipherId, recipientCipherId);
  const info = utf8ToBytes("VEIL-PQXDH-v1");
  const sessionKey = hkdf(sha256, ikm, salt, info, 32);

  // Hygiene
  ephemeralPriv.fill(0);
  pqSecret.fill(0);
  dh1.fill(0); dh2.fill(0); dh3.fill(0); 
  if (dh4.length > 0) dh4.fill(0);
  ikm.fill(0);
  myXPriv.fill(0);

  return {
    sessionKey,
    ephemeralX25519PubB64: bytesToBase64(ephemeralPub),
    kemCiphertextB64: bytesToBase64(kemCiphertext),
    opkId
  };
}

export function computeReceiverSession(
  senderEphemeralX25519PubB64, 
  kemCiphertextB64, 
  senderX25519PubB64, 
  opkId,
  myIdentityX25519PrivB64, 
  mySignedPreKeyPrivB64, 
  mySignedPqPreKeyPrivB64, 
  myOneTimePreKeyPrivB64, // Can be null
  senderCipherId, recipientCipherId
) {
  const senderEphemeralPub = base64ToBytes(senderEphemeralX25519PubB64);
  const senderIdPub = base64ToBytes(senderX25519PubB64);
  
  const myIdPriv = base64ToBytes(myIdentityX25519PrivB64);
  const mySpkPriv = base64ToBytes(mySignedPreKeyPrivB64);

  // X3DH Steps
  const dh1 = x25519.getSharedSecret(myIdPriv, senderEphemeralPub);
  const dh2 = x25519.getSharedSecret(mySpkPriv, senderIdPub);
  const dh3 = x25519.getSharedSecret(mySpkPriv, senderEphemeralPub);
  
  let dh4 = new Uint8Array(0);
  if (opkId && myOneTimePreKeyPrivB64) {
    const myOpkPriv = base64ToBytes(myOneTimePreKeyPrivB64);
    dh4 = x25519.getSharedSecret(myOpkPriv, senderEphemeralPub);
    myOpkPriv.fill(0);
  } else if (opkId && !myOneTimePreKeyPrivB64) {
    throw new Error("Sender used OPK but we don't have the private key");
  }

  // PQXDH Step
  const kemCiphertext = base64ToBytes(kemCiphertextB64);
  const myPqPriv = base64ToBytes(mySignedPqPreKeyPrivB64);
  const pqSecret = ml_kem768.decapsulate(kemCiphertext, myPqPriv);

  // Combine IKM
  const ikmLen = dh1.length + dh2.length + dh3.length + dh4.length + pqSecret.length;
  const ikm = new Uint8Array(ikmLen);
  let offset = 0;
  
  ikm.set(dh1, offset); offset += dh1.length;
  ikm.set(dh2, offset); offset += dh2.length;
  ikm.set(dh3, offset); offset += dh3.length;
  if (dh4.length > 0) {
    ikm.set(dh4, offset); offset += dh4.length;
  }
  ikm.set(pqSecret, offset);

  // Derive Session Key
  const salt = computeSalt(senderCipherId, recipientCipherId);
  const info = utf8ToBytes("VEIL-PQXDH-v1");
  const sessionKey = hkdf(sha256, ikm, salt, info, 32);

  // Hygiene
  pqSecret.fill(0);
  dh1.fill(0); dh2.fill(0); dh3.fill(0); 
  if (dh4.length > 0) dh4.fill(0);
  ikm.fill(0);
  myIdPriv.fill(0);
  mySpkPriv.fill(0);
  myPqPriv.fill(0);

  return { sessionKey };
}
