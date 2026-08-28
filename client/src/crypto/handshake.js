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

export function computeInitiatorSession(recipientMlkemPubB64, recipientX25519PubB64, senderCipherId, recipientCipherId) {
  // Ephemeral X25519
  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);

  // ML-KEM Encapsulation
  const recipientMlkemPub = base64ToBytes(recipientMlkemPubB64);
  const { cipherText: kemCiphertext, sharedSecret: mlkemSecret } = ml_kem768.encapsulate(recipientMlkemPub);

  // X25519 ECDH
  const recipientX25519Pub = base64ToBytes(recipientX25519PubB64);
  const x25519Secret = x25519.getSharedSecret(ephemeralPriv, recipientX25519Pub);

  // IKM
  const ikm = new Uint8Array(mlkemSecret.length + x25519Secret.length);
  ikm.set(mlkemSecret, 0);
  ikm.set(x25519Secret, mlkemSecret.length);

  // Salt
  const salt = computeSalt(senderCipherId, recipientCipherId);

  // HKDF
  const info = utf8ToBytes("VEIL-v1-session-key");
  const sessionKey = hkdf(sha256, ikm, salt, info, 32);

  return {
    sessionKey,
    kemCiphertextB64: bytesToBase64(kemCiphertext),
    ephemeralX25519PubB64: bytesToBase64(ephemeralPub),
  };
}

export function computeReceiverSession(kemCiphertextB64, senderEphemeralX25519PubB64, myMlkemPrivB64, myX25519PrivB64, senderCipherId, recipientCipherId) {
  const kemCiphertext = base64ToBytes(kemCiphertextB64);
  const myMlkemPriv = base64ToBytes(myMlkemPrivB64);
  const mlkemSecret = ml_kem768.decapsulate(kemCiphertext, myMlkemPriv);

  const senderEphemeralX25519Pub = base64ToBytes(senderEphemeralX25519PubB64);
  const myX25519Priv = base64ToBytes(myX25519PrivB64);
  const x25519Secret = x25519.getSharedSecret(myX25519Priv, senderEphemeralX25519Pub);

  const ikm = new Uint8Array(mlkemSecret.length + x25519Secret.length);
  ikm.set(mlkemSecret, 0);
  ikm.set(x25519Secret, mlkemSecret.length);

  const salt = computeSalt(senderCipherId, recipientCipherId);
  const info = utf8ToBytes("VEIL-v1-session-key");
  const sessionKey = hkdf(sha256, ikm, salt, info, 32);

  return { sessionKey };
}
