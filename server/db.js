import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'veil.db'));

// Initialize Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    cipherId TEXT PRIMARY KEY,
    identityMlkemPub TEXT NOT NULL,
    identityX25519Pub TEXT NOT NULL,
    identityEd25519Pub TEXT,
    deliveryToken TEXT,
    fcmToken TEXT,
    lastSeen INTEGER
  );

  CREATE TABLE IF NOT EXISTS signed_prekeys (
    cipherId TEXT PRIMARY KEY,
    signedPreKeyPub TEXT NOT NULL,
    signedPreKeySig TEXT NOT NULL,
    signedPqPreKeyPub TEXT NOT NULL,
    signedPqPreKeySig TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY(cipherId) REFERENCES users(cipherId)
  );

  CREATE TABLE IF NOT EXISTS onetime_prekeys (
    cipherId TEXT,
    keyId INTEGER,
    pubKey TEXT NOT NULL,
    PRIMARY KEY (cipherId, keyId),
    FOREIGN KEY(cipherId) REFERENCES users(cipherId)
  );
`);

export const statements = {
  upsertUser: db.prepare(`
    INSERT INTO users (cipherId, identityMlkemPub, identityX25519Pub, identityEd25519Pub, deliveryToken, fcmToken, lastSeen)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cipherId) DO UPDATE SET 
      identityMlkemPub=excluded.identityMlkemPub,
      identityX25519Pub=excluded.identityX25519Pub,
      identityEd25519Pub=excluded.identityEd25519Pub,
      deliveryToken=excluded.deliveryToken,
      fcmToken=excluded.fcmToken,
      lastSeen=excluded.lastSeen
  `),
  
  upsertSignedPreKeys: db.prepare(`
    INSERT INTO signed_prekeys (cipherId, signedPreKeyPub, signedPreKeySig, signedPqPreKeyPub, signedPqPreKeySig, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(cipherId) DO UPDATE SET
      signedPreKeyPub=excluded.signedPreKeyPub,
      signedPreKeySig=excluded.signedPreKeySig,
      signedPqPreKeyPub=excluded.signedPqPreKeyPub,
      signedPqPreKeySig=excluded.signedPqPreKeySig,
      timestamp=excluded.timestamp
  `),
  
  insertOneTimePreKey: db.prepare(`
    INSERT INTO onetime_prekeys (cipherId, keyId, pubKey) VALUES (?, ?, ?)
    ON CONFLICT(cipherId, keyId) DO NOTHING
  `),
  
  getOneTimePreKeyCount: db.prepare(`
    SELECT COUNT(*) as count FROM onetime_prekeys WHERE cipherId = ?
  `),

  popOneTimePreKey: db.prepare(`
    DELETE FROM onetime_prekeys 
    WHERE rowid = (
      SELECT rowid FROM onetime_prekeys WHERE cipherId = ? LIMIT 1
    )
    RETURNING keyId, pubKey
  `),

  getSignedPreKeys: db.prepare(`
    SELECT signedPreKeyPub, signedPreKeySig, signedPqPreKeyPub, signedPqPreKeySig 
    FROM signed_prekeys WHERE cipherId = ?
  `),

  getUserIdentity: db.prepare(`
    SELECT identityMlkemPub, identityX25519Pub, identityEd25519Pub, deliveryToken FROM users WHERE cipherId = ?
  `)
};

export function savePreKeyBundle(cipherId, identityMlkemPub, identityX25519Pub, identityEd25519Pub, deliveryToken, fcmToken, bundle) {
  const insertMany = db.transaction((cipherId, identMlkem, identX, identEd, deliv, fcm, b) => {
    statements.upsertUser.run(cipherId, identMlkem, identX, identEd, deliv, fcm, Date.now());
    
    if (b.signedPreKey) {
      statements.upsertSignedPreKeys.run(
        cipherId, 
        b.signedPreKey.pub, b.signedPreKey.sig, 
        b.signedPqPreKey.pub, b.signedPqPreKey.sig, 
        Date.now()
      );
    }
    
    if (b.oneTimePreKeys && b.oneTimePreKeys.length > 0) {
      for (const opk of b.oneTimePreKeys) {
        statements.insertOneTimePreKey.run(cipherId, opk.id, opk.pub);
      }
    }
  });
  
  insertMany(cipherId, identityMlkemPub, identityX25519Pub, identityEd25519Pub, deliveryToken, fcmToken, bundle);
}

export function fetchPreKeyBundle(cipherId) {
  const identity = statements.getUserIdentity.get(cipherId);
  if (!identity) return null;

  const signed = statements.getSignedPreKeys.get(cipherId);
  if (!signed) return null;

  const opk = statements.popOneTimePreKey.get(cipherId);

  return {
    identity,
    signedPreKey: {
      pub: signed.signedPreKeyPub,
      sig: signed.signedPreKeySig
    },
    signedPqPreKey: {
      pub: signed.signedPqPreKeyPub,
      sig: signed.signedPqPreKeySig
    },
    oneTimePreKey: opk ? { id: opk.keyId, pub: opk.pubKey } : null
  };
}

export function getRemainingOpkCount(cipherId) {
  const row = statements.getOneTimePreKeyCount.get(cipherId);
  return row ? row.count : 0;
}
