import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { bytesToBase64, base64ToBytes, utf8ToBytes } from './utils.js';

/**
 * Generates a full PreKey bundle (public keys only) to upload to the server.
 * Private keys are returned so the caller can store them locally.
 * 
 * @param {Uint8Array} identityEd25519Priv - The user's long-term Ed25519 signing key
 */
export function generatePreKeyBundle(identityEd25519Priv) {
  // 1. Generate SignedPreKey (X25519)
  const spkPriv = x25519.utils.randomSecretKey();
  const spkPub = x25519.getPublicKey(spkPriv);
  const spkSig = ed25519.sign(spkPub, identityEd25519Priv);

  // 2. Generate SignedPQPreKey (ML-KEM-768)
  const pqKeys = ml_kem768.keygen();
  const pqSig = ed25519.sign(pqKeys.publicKey, identityEd25519Priv);

  // 3. Generate 100 One-Time PreKeys (X25519)
  const oneTimeKeysPrivate = [];
  const oneTimeKeysPublic = [];
  
  for (let i = 0; i < 100; i++) {
    const priv = x25519.utils.randomSecretKey();
    const pub = x25519.getPublicKey(priv);
    
    // We will use the timestamp as an ID (or just a sequential counter)
    // To ensure uniqueness, we use Date.now() + i
    const id = Date.now() + i; 
    
    oneTimeKeysPrivate.push({ id, priv });
    oneTimeKeysPublic.push({ id, pub: bytesToBase64(pub) });
  }

  // Public Bundle to upload
  const publicBundle = {
    signedPreKey: {
      pub: bytesToBase64(spkPub),
      sig: bytesToBase64(spkSig)
    },
    signedPqPreKey: {
      pub: bytesToBase64(pqKeys.publicKey),
      sig: bytesToBase64(pqSig)
    },
    oneTimePreKeys: oneTimeKeysPublic
  };

  // Private material to store locally
  const privateMaterial = {
    signedPreKey: bytesToBase64(spkPriv),
    signedPqPreKey: bytesToBase64(pqKeys.secretKey),
    oneTimePreKeys: oneTimeKeysPrivate.map(k => ({ id: k.id, priv: bytesToBase64(k.priv) }))
  };

  return { publicBundle, privateMaterial };
}

/**
 * Verify a downloaded PreKey bundle against the contact's known Identity Key.
 * 
 * @param {Object} bundle - The downloaded PreKey bundle
 * @param {string} identityEd25519PubB64 - The contact's long-term Ed25519 public key
 * @throws {Error} if signatures are invalid
 */
export function verifyPreKeyBundle(bundle, identityEd25519PubB64) {
  const identityPub = base64ToBytes(identityEd25519PubB64);
  
  // Verify SignedPreKey
  const spkPub = base64ToBytes(bundle.signedPreKey.pub);
  const spkSig = base64ToBytes(bundle.signedPreKey.sig);
  if (!ed25519.verify(spkSig, spkPub, identityPub)) {
    throw new Error("Invalid SignedPreKey signature!");
  }

  // Verify SignedPQPreKey
  const pqPub = base64ToBytes(bundle.signedPqPreKey.pub);
  const pqSig = base64ToBytes(bundle.signedPqPreKey.sig);
  if (!ed25519.verify(pqSig, pqPub, identityPub)) {
    throw new Error("Invalid SignedPQPreKey signature!");
  }

  return true;
}

export function generateOneTimePreKeys(count) {
  const privs = [];
  const pubs = [];
  for (let i = 0; i < count; i++) {
    const priv = x25519.utils.randomSecretKey();
    const pub = x25519.getPublicKey(priv);
    const id = Date.now() + i; 
    privs.push({ id, priv: bytesToBase64(priv) });
    pubs.push({ id, pub: bytesToBase64(pub) });
  }
  return { privs, pubs };
}
