import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { bytesToBase64 } from './utils.js';

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
  const mlkemKeys = ml_kem768.keygen();
  const x25519Priv = x25519.utils.randomSecretKey();
  const x25519Pub = x25519.getPublicKey(x25519Priv);

  return {
    mlkem: {
      publicKey: mlkemKeys.publicKey,
      publicKeyB64: bytesToBase64(mlkemKeys.publicKey),
      secretKey: mlkemKeys.secretKey,
      secretKeyB64: bytesToBase64(mlkemKeys.secretKey),
    },
    x25519: {
      publicKey: x25519Pub,
      publicKeyB64: bytesToBase64(x25519Pub),
      secretKey: x25519Priv,
      secretKeyB64: bytesToBase64(x25519Priv),
    }
  };
}
