export function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("veil_data", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("contacts")) {
        db.createObjectStore("contacts", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("messages")) {
        const msgStore = db.createObjectStore("messages", { autoIncrement: true });
        msgStore.createIndex("contactId", "contactId", { unique: false });
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

export async function saveMessage(msg) {
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
    req.onsuccess = () => resolve(req.result);
  });
}

export async function updateMessageStatus(contactId, seq, status) {
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
          const updatedMsg = { ...cursor.value, status };
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
