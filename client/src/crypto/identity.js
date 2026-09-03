import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToBase64, utf8ToBytes } from './utils.js';

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function bytesToBase32Crockford(bytes) {
  let bits = 0;
  let bitCount = 0;
  let result = '';
  
  for (let i = 0; i < bytes.length; i++) {
    bits = (bits << 8) | bytes[i];
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      result += CROCKFORD_ALPHABET[(bits >>> bitCount) & 31];
    }
  }
  return result;
}

export function generateCipherId() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const b32 = bytesToBase32Crockford(bytes);
  return `${b32.slice(0,4)}-${b32.slice(4,8)}-${b32.slice(8,12)}-${b32.slice(12,16)}`;
}

export function generateLongTermKeys() {
  // 1. ML-KEM-768
  const mlkemKeys = ml_kem768.keygen();
  const kemPk = mlkemKeys.publicKey;
  const kemSk = mlkemKeys.secretKey;

  // 2. X25519
  const x25519Sk = x25519.utils.randomSecretKey();
  const x25519Pk = x25519.getPublicKey(x25519Sk);
  
  // 3. Ed25519 (for signing PreKeys)
  const ed25519Sk = ed25519.utils.randomSecretKey();
  const ed25519Pk = ed25519.getPublicKey(ed25519Sk);
  
  // 4. Profile Key
  const profileKey = new Uint8Array(32);
  crypto.getRandomValues(profileKey);
  
  const deliveryToken = hkdf(sha256, profileKey, utf8ToBytes("SealedSenderToken-v1"), new Uint8Array(0), 32);

  return {
    mlkem: {
      publicKey: kemPk,
      publicKeyB64: bytesToBase64(kemPk),
      secretKey: kemSk,
      secretKeyB64: bytesToBase64(kemSk)
    },
    x25519: {
      publicKey: x25519Pk,
      publicKeyB64: bytesToBase64(x25519Pk),
      secretKey: x25519Sk,
      secretKeyB64: bytesToBase64(x25519Sk)
    },
    ed25519: {
      publicKey: ed25519Pk,
      publicKeyB64: bytesToBase64(ed25519Pk),
      secretKey: ed25519Sk,
      secretKeyB64: bytesToBase64(ed25519Sk)
    },
    profile: {
      profileKeyB64: bytesToBase64(profileKey),
      deliveryTokenB64: bytesToBase64(deliveryToken)
    }
  };
}
