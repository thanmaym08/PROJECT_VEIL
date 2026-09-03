import { argon2id } from '@noble/hashes/argon2.js';
import { utf8ToBytes, bytesToBase64, base64ToBytes } from './utils.js';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

const memoryFallback = new Map();

function getStorage() {
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  return {
    getItem: (k) => memoryFallback.get(k) ?? null,
    setItem: (k, v) => memoryFallback.set(k, v),
    removeItem: (k) => memoryFallback.delete(k)
  };
}

async function setStore(key, value) {
  if (typeof window !== 'undefined' && window.Capacitor?.isNative) {
    try {
      await SecureStoragePlugin.set({ key, value: JSON.stringify(value) });
    } catch (e) {
      console.error("SecureStorage set error:", e);
      throw e;
    }
  } else {
    getStorage().setItem(`veil_${key}`, JSON.stringify(value));
  }
}

async function getStore(key) {
  if (typeof window !== 'undefined' && window.Capacitor?.isNative) {
    try {
      const { value } = await SecureStoragePlugin.get({ key });
      return JSON.parse(value);
    } catch (e) {
      return null;
    }
  } else {
    const val = getStorage().getItem(`veil_${key}`);
    return val ? JSON.parse(val) : null;
  }
}

export async function wrapAndStoreKeys(passphraseStr, identityKeyBundle) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const keyBytes = argon2id(
    utf8ToBytes(passphraseStr),
    salt,
    { t: 3, m: 65536, p: 1, dkLen: 32 }
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const payload = utf8ToBytes(JSON.stringify(identityKeyBundle));

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    aesKey,
    payload
  );

  await setStore("vault", {
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertextBuf)),
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv)
  });
}

export async function unwrapKeys(passphraseStr) {
  const vault = await getStore("vault");
  if (!vault) throw new Error("No keys found in vault.");

  const salt = base64ToBytes(vault.saltB64);
  const iv = base64ToBytes(vault.ivB64);
  const ciphertext = base64ToBytes(vault.ciphertextB64);

  const keyBytes = argon2id(
    utf8ToBytes(passphraseStr),
    salt,
    { t: 3, m: 65536, p: 1, dkLen: 32 }
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  try {
    const plaintextBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      aesKey,
      ciphertext
    );
    const plaintext = new TextDecoder().decode(plaintextBuf);
    return JSON.parse(plaintext);
  } catch (err) {
    throw new Error("Invalid passphrase or corrupted vault.");
  }
}

export async function hasVault() {
  try {
    const vault = await getStore("vault");
    return !!vault;
  } catch (e) {
    return false;
  }
}

export async function saveRatchetState(contactId, stateStr) {
  await setStore(`ratchet_${contactId}`, stateStr);
}

export async function getRatchetState(contactId) {
  return await getStore(`ratchet_${contactId}`);
}
