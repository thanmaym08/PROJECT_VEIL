import { argon2id } from '@noble/hashes/argon2.js';
import { utf8ToBytes, bytesToBase64, base64ToBytes } from './utils.js';

// IndexedDB helpers
function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("veil_vault", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("keys")) {
        db.createObjectStore("keys");
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function setStore(key, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");
    tx.objectStore("keys").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getStore(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readonly");
    const req = tx.objectStore("keys").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
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
