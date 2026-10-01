import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { base64ToBytes, bytesToBase64, utf8ToBytes } from './utils.js';

/**
 * Secondary device generates ephemeral session credentials and QR payload
 */
export function generateDeviceLinkSession() {
  const sessionId = typeof crypto !== 'undefined' && crypto.randomUUID 
    ? crypto.randomUUID() 
    : 'link_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

  const priv = x25519.utils.randomSecretKey();
  const pub = x25519.getPublicKey(priv);

  const ephemeralPrivB64 = bytesToBase64(priv);
  const ephemeralPubB64 = bytesToBase64(pub);

  const qrPayload = JSON.stringify({
    type: 'veil_device_link',
    sessionId,
    pubKey: ephemeralPubB64,
    created: Date.now()
  });

  return {
    sessionId,
    ephemeralPrivB64,
    ephemeralPubB64,
    qrPayload
  };
}

/**
 * Primary device encrypts the identity bundle with an ECDH-derived AES-256-GCM key
 */
export async function encryptDeviceLinkPayload(secondaryPubKeyB64, identityKeyBundle) {
  const primPriv = x25519.utils.randomSecretKey();
  const primPub = x25519.getPublicKey(primPriv);
  const secPub = base64ToBytes(secondaryPubKeyB64);

  const dh = x25519.getSharedSecret(primPriv, secPub);
  const salt = new Uint8Array(32); // zero salt
  const info = utf8ToBytes('VEIL-DEVICE-LINK-v1');
  const encKeyBytes = hkdf(sha256, dh, salt, info, 32);

  const aesKey = await crypto.subtle.importKey(
    'raw',
    encKeyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const plaintextBytes = utf8ToBytes(JSON.stringify(identityKeyBundle));
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintextBytes
  );

  return {
    ephemeralPubB64: bytesToBase64(primPub),
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertextBuf)),
    ivB64: bytesToBase64(iv)
  };
}

/**
 * Secondary device decrypts the identity bundle with its ephemeral private key
 */
export async function decryptDeviceLinkPayload(secondaryPrivKeyB64, primaryPubKeyB64, ciphertextB64, ivB64) {
  const secPriv = base64ToBytes(secondaryPrivKeyB64);
  const primPub = base64ToBytes(primaryPubKeyB64);

  const dh = x25519.getSharedSecret(secPriv, primPub);
  const salt = new Uint8Array(32);
  const info = utf8ToBytes('VEIL-DEVICE-LINK-v1');
  const encKeyBytes = hkdf(sha256, dh, salt, info, 32);

  const aesKey = await crypto.subtle.importKey(
    'raw',
    encKeyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const ciphertext = base64ToBytes(ciphertextB64);
  const iv = base64ToBytes(ivB64);

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext
  );

  const decryptedJson = new TextDecoder().decode(decryptedBuf);
  return JSON.parse(decryptedJson);
}
