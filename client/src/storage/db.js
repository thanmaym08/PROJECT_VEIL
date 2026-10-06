import { getActiveVaultKey } from '../crypto/keyStorage.js';
import { utf8ToBytes, bytesToBase64, base64ToBytes } from '../crypto/utils.js';

async function encryptData(data) {
  const key = getActiveVaultKey();
  if (!key) return data;
  try {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const ctBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      utf8ToBytes(JSON.stringify(data))
    );
    return {
      __enc: true,
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(ctBuf))
    };
  } catch (err) {
    console.warn("Encryption fallback:", err);
    return data;
  }
}

async function decryptData(stored) {
  if (!stored || typeof stored !== 'object' || !stored.__enc || !stored.iv || !stored.ct) {
    return stored;
  }
  const key = getActiveVaultKey();
  if (!key) return stored;
  try {
    const ptBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(stored.iv) },
      key,
      base64ToBytes(stored.ct)
    );
    return JSON.parse(new TextDecoder().decode(ptBuf));
  } catch (e) {
    console.error("Decryption failed for stored entity:", e);
    return stored;
  }
}

async function packMessageForStorage(msg) {
  const key = getActiveVaultKey();
  if (!key) return msg;
  const sensitive = {
    text: msg.text,
    attachment: msg.attachment,
    replyTo: msg.replyTo,
    reactions: msg.reactions,
    poll: msg.poll,
    edited: msg.edited,
    deletedForEveryone: msg.deletedForEveryone,
    viewOnce: msg.viewOnce,
    viewed: msg.viewed,
    forwarded: msg.forwarded,
    starred: msg.starred
  };
  const enc = await encryptData(sensitive);
  return {
    ...msg,
    text: "[ENCRYPTED_AT_REST]",
    attachment: null,
    replyTo: null,
    reactions: null,
    poll: null,
    __enc: true,
    encPayload: enc
  };
}

async function unpackMessageFromStorage(storedMsg) {
  if (!storedMsg || !storedMsg.__enc || !storedMsg.encPayload) {
    return storedMsg;
  }
  const decrypted = await decryptData(storedMsg.encPayload);
  if (decrypted && typeof decrypted === 'object') {
    return {
      ...storedMsg,
      text: decrypted.text,
      attachment: decrypted.attachment,
      replyTo: decrypted.replyTo,
      reactions: decrypted.reactions,
      poll: decrypted.poll,
      edited: decrypted.edited,
      deletedForEveryone: decrypted.deletedForEveryone,
      viewOnce: decrypted.viewOnce,
      viewed: decrypted.viewed,
      forwarded: decrypted.forwarded,
      starred: decrypted.starred
    };
  }
  return storedMsg;
}

export function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("veil_data", 3);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("contacts")) {
        db.createObjectStore("contacts", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("messages")) {
        const msgStore = db.createObjectStore("messages", { autoIncrement: true });
        msgStore.createIndex("contactId", "contactId", { unique: false });
      }
      if (!db.objectStoreNames.contains("prekeys")) {
        db.createObjectStore("prekeys"); // key-value store for local private prekeys
      }
      if (!db.objectStoreNames.contains("groups")) {
        db.createObjectStore("groups", { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function getGroups() {
  const db = await getDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains("groups")) return resolve([]);
    const tx = db.transaction("groups", "readonly");
    const req = tx.objectStore("groups").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

export async function saveGroup(group) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("groups", "readwrite");
    tx.objectStore("groups").put(group);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function deleteGroup(groupId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const stores = ["groups"];
    if (db.objectStoreNames.contains("messages")) stores.push("messages");
    const tx = db.transaction(stores, "readwrite");
    tx.objectStore("groups").delete(groupId);
    
    if (db.objectStoreNames.contains("messages")) {
      const msgStore = tx.objectStore("messages");
      const index = msgStore.index("contactId");
      const req = index.openCursor(IDBKeyRange.only(groupId));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getGroup(groupId) {
  const db = await getDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains("groups")) return resolve(null);
    const tx = db.transaction("groups", "readonly");
    const req = tx.objectStore("groups").get(groupId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

export async function saveGroupTree(groupId, treeData) {
  const group = await getGroup(groupId);
  if (group) {
    group.treeKemData = treeData;
    await saveGroup(group);
  }
}

export async function getGroupTree(groupId) {
  const group = await getGroup(groupId);
  return group ? group.treeKemData || null : null;
}

export async function getContacts() {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction("contacts", "readonly");
    const req = tx.objectStore("contacts").getAll();
    req.onsuccess = () => resolve(req.result);
  });
}

export async function saveContact(contact) {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction("contacts", "readwrite");
    tx.objectStore("contacts").put(contact);
    tx.oncomplete = () => resolve();
  });
}

export async function saveLocalPreKeys(prekeys) {
  const toStore = await encryptData(prekeys);
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("prekeys", "readwrite");
    tx.objectStore("prekeys").put(toStore, "private_material");
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getLocalPreKeys() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("prekeys", "readonly");
    const req = tx.objectStore("prekeys").get("private_material");
    req.onsuccess = async () => {
      if (!req.result) return resolve(null);
      const decrypted = await decryptData(req.result);
      resolve(decrypted);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

// RAM-only storage for True Crypto-Shredding (Vanish Mode)
const volatileMemory = new Map();

export async function saveMessage(msg) {
  if (msg.ttl > 0) {
    if (!volatileMemory.has(msg.contactId)) volatileMemory.set(msg.contactId, []);
    volatileMemory.get(msg.contactId).push(msg);
    return Promise.resolve();
  }

  const packed = await packMessageForStorage(msg);
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    tx.objectStore("messages").add(packed);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getMessages(contactId) {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction("messages", "readonly");
    const index = tx.objectStore("messages").index("contactId");
    const req = index.getAll(IDBKeyRange.only(contactId));
    req.onsuccess = async () => {
      const diskMsgs = req.result || [];
      const unpackedDiskMsgs = await Promise.all(diskMsgs.map(m => unpackMessageFromStorage(m)));
      const ramMsgs = volatileMemory.get(contactId) || [];
      // Merge and sort by timestamp
      const allMsgs = [...unpackedDiskMsgs, ...ramMsgs].sort((a, b) => a.ts - b.ts);
      resolve(allMsgs);
    };
  });
}

export async function updateMessageStatus(contactId, seq, status, extraProps = {}) {
  const ramMsgs = volatileMemory.get(contactId);
  if (ramMsgs) {
    const idx = ramMsgs.findIndex(m => m.seq === seq);
    if (idx !== -1) {
      ramMsgs[idx] = { ...ramMsgs[idx], status, ...extraProps };
      return Promise.resolve();
    }
  }

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    const index = store.index("contactId");
    const req = index.openCursor(IDBKeyRange.only(contactId));
    
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.seq === seq) {
          const updatedMsg = { ...cursor.value, status, ...extraProps };
          cursor.update(updatedMsg);
          resolve();
          return;
        }
        cursor.continue();
      } else {
        resolve(); // Not found
      }
    };
    req.onerror = () => reject();
  });
}

export async function updateMessageReactions(contactId, seq, reactions) {
  const ramMsgs = volatileMemory.get(contactId);
  if (ramMsgs) {
    const idx = ramMsgs.findIndex(m => m.seq === seq);
    if (idx !== -1) {
      ramMsgs[idx] = { ...ramMsgs[idx], reactions };
      return Promise.resolve();
    }
  }

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    const index = store.index("contactId");
    const req = index.openCursor(IDBKeyRange.only(contactId));
    
    req.onsuccess = async (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.seq === seq) {
          const unpacked = await unpackMessageFromStorage(cursor.value);
          unpacked.reactions = reactions;
          const repacked = await packMessageForStorage(unpacked);
          cursor.update(repacked);
          resolve();
          return;
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject();
  });
}

export async function deleteMessage(contactId, seq) {
  const ramMsgs = volatileMemory.get(contactId);
  if (ramMsgs) {
    const idx = ramMsgs.findIndex(m => m.seq === seq);
    if (idx !== -1) {
      ramMsgs.splice(idx, 1);
      return Promise.resolve();
    }
  }

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    const index = store.index("contactId");
    const req = index.openCursor(IDBKeyRange.only(contactId));
    
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.seq === seq) {
          cursor.delete();
          resolve();
          return;
        }
        cursor.continue();
      } else {
        resolve(); // Not found
      }
    };
    req.onerror = () => reject();
  });
}

// Minimal Outbox for network retries
export async function saveToOutbox(envelope) {
  const db = await getDB();
  return new Promise((resolve) => {
    // Re-use messages store, or just use a generic localstorage for simplicity
    const outbox = JSON.parse(localStorage.getItem('veil_outbox') || '[]');
    outbox.push(envelope);
    localStorage.setItem('veil_outbox', JSON.stringify(outbox));
    resolve();
  });
}

export async function getAndClearOutbox() {
  const outbox = JSON.parse(localStorage.getItem('veil_outbox') || '[]');
  localStorage.setItem('veil_outbox', '[]');
  return outbox;
}

export async function updateMessageFields(contactId, seq, fieldsToUpdate) {
  const ramMsgs = volatileMemory.get(contactId);
  if (ramMsgs) {
    const idx = ramMsgs.findIndex(m => m.seq === seq);
    if (idx !== -1) {
      ramMsgs[idx] = { ...ramMsgs[idx], ...fieldsToUpdate };
      return Promise.resolve(ramMsgs[idx]);
    }
  }

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    const index = store.index("contactId");
    const req = index.openCursor(IDBKeyRange.only(contactId));
    
    req.onsuccess = async (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.seq === seq) {
          const unpacked = await unpackMessageFromStorage(cursor.value);
          const updated = { ...unpacked, ...fieldsToUpdate };
          const repacked = await packMessageForStorage(updated);
          cursor.update(repacked);
          resolve(updated);
          return;
        }
        cursor.continue();
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject();
  });
}

export async function getAllStarredMessages() {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction("messages", "readonly");
    const store = tx.objectStore("messages");
    const req = store.getAll();
    req.onsuccess = async () => {
      const allRaw = req.result || [];
      const allUnpacked = await Promise.all(allRaw.map(m => unpackMessageFromStorage(m)));
      const starred = allUnpacked.filter(m => m.starred);
      resolve(starred);
    };
    req.onerror = () => resolve([]);
  });
}

export async function exportEncryptedBackup(passphrase) {
  const db = await getDB();
  const contacts = await new Promise((res) => {
    const tx = db.transaction("contacts", "readonly");
    const req = tx.objectStore("contacts").getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => res([]);
  });
  const groups = await new Promise((res) => {
    if (!db.objectStoreNames.contains("groups")) return res([]);
    const tx = db.transaction("groups", "readonly");
    const req = tx.objectStore("groups").getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => res([]);
  });
  const rawMessages = await new Promise((res) => {
    const tx = db.transaction("messages", "readonly");
    const req = tx.objectStore("messages").getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => res([]);
  });
  const unpackedMessages = await Promise.all(rawMessages.map(m => unpackMessageFromStorage(m)));

  const backupPayload = {
    version: 1,
    exportedAt: Date.now(),
    contacts,
    groups,
    messages: unpackedMessages,
    settings: {
      veil_app_mode: localStorage.getItem('veil_app_mode'),
      veil_wallpaper: localStorage.getItem('veil_wallpaper'),
      veil_discreet_notifications: localStorage.getItem('veil_discreet_notifications')
    }
  };

  const enc = new TextEncoder();
  const passKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    passKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    enc.encode(JSON.stringify(backupPayload))
  );

  return JSON.stringify({
    magic: "VEIL_BACKUP_V1",
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ctBuf))
  });
}

export async function importEncryptedBackup(backupJsonString, passphrase) {
  const parsed = JSON.parse(backupJsonString);
  if (parsed.magic !== "VEIL_BACKUP_V1" || !parsed.salt || !parsed.iv || !parsed.ciphertext) {
    throw new Error("Invalid or corrupted backup archive format");
  }

  const enc = new TextEncoder();
  const passKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const salt = base64ToBytes(parsed.salt);
  const iv = base64ToBytes(parsed.iv);
  const ciphertext = base64ToBytes(parsed.ciphertext);

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    passKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertext
  );

  const payload = JSON.parse(new TextDecoder().decode(ptBuf));

  // Restore contacts
  if (Array.isArray(payload.contacts)) {
    for (const c of payload.contacts) {
      await saveContact(c);
    }
  }

  // Restore groups
  if (Array.isArray(payload.groups)) {
    for (const g of payload.groups) {
      await saveGroup(g);
    }
  }

  // Restore messages
  if (Array.isArray(payload.messages)) {
    for (const m of payload.messages) {
      await saveMessage(m);
    }
  }

  if (payload.settings) {
    if (payload.settings.veil_app_mode) localStorage.setItem('veil_app_mode', payload.settings.veil_app_mode);
    if (payload.settings.veil_wallpaper) localStorage.setItem('veil_wallpaper', payload.settings.veil_wallpaper);
    if (payload.settings.veil_discreet_notifications) localStorage.setItem('veil_discreet_notifications', payload.settings.veil_discreet_notifications);
  }

  return {
    contactsCount: payload.contacts?.length || 0,
    groupsCount: payload.groups?.length || 0,
    messagesCount: payload.messages?.length || 0
  };
}
