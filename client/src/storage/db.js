export function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("veil_data", 2);
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
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
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
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("prekeys", "readwrite");
    tx.objectStore("prekeys").put(prekeys, "private_material");
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getLocalPreKeys() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("prekeys", "readonly");
    const req = tx.objectStore("prekeys").get("private_material");
    req.onsuccess = () => resolve(req.result);
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

  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction("messages", "readwrite");
    tx.objectStore("messages").add(msg);
    tx.oncomplete = () => resolve();
  });
}

export async function getMessages(contactId) {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction("messages", "readonly");
    const index = tx.objectStore("messages").index("contactId");
    const req = index.getAll(IDBKeyRange.only(contactId));
    req.onsuccess = () => {
      const diskMsgs = req.result;
      const ramMsgs = volatileMemory.get(contactId) || [];
      // Merge and sort by timestamp
      const allMsgs = [...diskMsgs, ...ramMsgs].sort((a, b) => a.ts - b.ts);
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
