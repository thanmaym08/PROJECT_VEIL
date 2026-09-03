import { x25519 } from '@noble/curves/ed25519.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64ToBytes, bytesToBase64, utf8ToBytes } from './utils.js';

async function deriveSealedSenderKeys(sharedSecret, recipientIdentityPubB64, ephemeralPubB64) {
  const saltPrefix = utf8ToBytes("SealedSender-v1");
  const recipPub = base64ToBytes(recipientIdentityPubB64);
  const ephPub = base64ToBytes(ephemeralPubB64);
  
  const salt = new Uint8Array(saltPrefix.length + recipPub.length + ephPub.length);
  salt.set(saltPrefix, 0);
  salt.set(recipPub, saltPrefix.length);
  salt.set(ephPub, saltPrefix.length + recipPub.length);
  
  const okm = hkdf(sha256, sharedSecret, salt, new Uint8Array(0), 64);
  const encKey = okm.slice(0, 32);
  const macKey = okm.slice(32, 64);
  return { encKey, macKey };
}

export async function sealMessage(recipientIdentityX25519PubB64, senderCert, innerPlaintextStr) {
  // 1. Generate ephemeral keypair
  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);
  const ephemeralPubB64 = bytesToBase64(ephemeralPub);
  
  // 2. ECDH
  const sharedSecret = x25519.getSharedSecret(ephemeralPriv, base64ToBytes(recipientIdentityX25519PubB64));
  
  // 3. Derive keys
  const { encKey, macKey } = await deriveSealedSenderKeys(sharedSecret, recipientIdentityX25519PubB64, ephemeralPubB64);
  
  // 4. Encrypt inner plaintext (cert + ratchet ciphertext)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const innerPlaintextBytes = utf8ToBytes(JSON.stringify({
    cert: senderCert,
    payload: innerPlaintextStr
  }));
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encKey, { name: 'AES-GCM' }, false, ['encrypt']
  );
  
  // We use the recipient's public key as AAD to bind it
  const aad = base64ToBytes(recipientIdentityX25519PubB64);
  
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    cryptoKey,
    innerPlaintextBytes
  );
  const ciphertextBytes = new Uint8Array(ciphertextBuf);
  
  // 5. Compute MAC
  const cryptoMacKey = await crypto.subtle.importKey(
    'raw', macKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  
  const macBuf = await crypto.subtle.sign(
    'HMAC', cryptoMacKey, ciphertextBytes
  );
  
  // 6. Cleanup memory
  ephemeralPriv.fill(0);
  sharedSecret.fill(0);
  encKey.fill(0);
  macKey.fill(0);
  
  return {
    ephemeralPublicKey: ephemeralPubB64,
    envelopeCiphertext: bytesToBase64(ciphertextBytes),
    iv: bytesToBase64(iv),
    mac: bytesToBase64(new Uint8Array(macBuf))
  };
}

export async function unsealMessage(ephemeralPubB64, envelopeCiphertextB64, ivB64, macB64, myIdentityX25519PrivB64, serverIdentityPubB64) {
  const ephPub = base64ToBytes(ephemeralPubB64);
  const myPriv = base64ToBytes(myIdentityX25519PrivB64);
  
  // 1. ECDH
  const sharedSecret = x25519.getSharedSecret(myPriv, ephPub);
  const myPubB64 = bytesToBase64(x25519.getPublicKey(myPriv));
  
  // 2. Derive keys
  const { encKey, macKey } = await deriveSealedSenderKeys(sharedSecret, myPubB64, ephemeralPubB64);
  
  const ciphertextBytes = base64ToBytes(envelopeCiphertextB64);
  
  // 3. Verify MAC
  const cryptoMacKey = await crypto.subtle.importKey(
    'raw', macKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const isValidMac = await crypto.subtle.verify(
    'HMAC', cryptoMacKey, base64ToBytes(macB64), ciphertextBytes
  );
  if (!isValidMac) throw new Error("Sealed Sender MAC validation failed");
  
  // 4. Decrypt
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encKey, { name: 'AES-GCM' }, false, ['decrypt']
  );
  
  const aad = base64ToBytes(myPubB64);
  const iv = base64ToBytes(ivB64);
  let plaintextBuf;
  try {
    plaintextBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      cryptoKey,
      ciphertextBytes
    );
  } catch (e) {
    throw new Error("Sealed Sender AES-GCM Envelope Decryption Failed");
  }
  
  const plaintextStr = new TextDecoder().decode(plaintextBuf);
  const parsed = JSON.parse(plaintextStr);
  
  // 5. Verify Sender Certificate
  const cert = parsed.cert;
  if (!cert || !cert.senderId || !cert.serverSignature) throw new Error("Invalid Sender Certificate");
  
  if (Date.now() > cert.expiresAt) throw new Error("Sender Certificate Expired");
  
  const senderIdBuf = utf8ToBytes(cert.senderId);
  const x25519PubBuf = base64ToBytes(cert.identityPublicKey);
  
  // Create 8-byte BE array for expiresAt
  const expiresBuf = new Uint8Array(8);
  const dataView = new DataView(expiresBuf.buffer);
  dataView.setBigInt64(0, BigInt(cert.expiresAt), false);
  
  const msgToVerify = new Uint8Array(2 + senderIdBuf.length + 2 + x25519PubBuf.length + expiresBuf.length);
  const verifyDataView = new DataView(msgToVerify.buffer);
  
  verifyDataView.setUint16(0, senderIdBuf.length, false);
  msgToVerify.set(senderIdBuf, 2);
  
  verifyDataView.setUint16(2 + senderIdBuf.length, x25519PubBuf.length, false);
  msgToVerify.set(x25519PubBuf, 2 + senderIdBuf.length + 2);
  
  msgToVerify.set(expiresBuf, 2 + senderIdBuf.length + 2 + x25519PubBuf.length);
  const serverPub = base64ToBytes(serverIdentityPubB64);
  
  const sigValid = ed25519.verify(base64ToBytes(cert.serverSignature), msgToVerify, serverPub);
  if (!sigValid) throw new Error("Sender Certificate Signature Invalid");
  
  // 6. Cleanup
  sharedSecret.fill(0);
  encKey.fill(0);
  macKey.fill(0);
  
  return {
    senderId: cert.senderId,
    senderIdentityPubB64: cert.identityPublicKey,
    payload: parsed.payload
  };
}
