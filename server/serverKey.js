import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ed25519 } from '@noble/curves/ed25519.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_PATH = path.join(__dirname, 'server_signing_key.json');

export function getServerSigningKey() {
  if (process.env.SERVER_SIGNING_KEY_B64) {
    try {
      const secretKey = Buffer.from(process.env.SERVER_SIGNING_KEY_B64, 'base64');
      const publicKey = ed25519.getPublicKey(secretKey);
      return { publicKey, secretKey };
    } catch (e) {
      console.error("[SERVER] Failed to parse SERVER_SIGNING_KEY_B64 from env:", e.message);
    }
  }

  if (fs.existsSync(KEY_PATH)) {
    const data = JSON.parse(fs.readFileSync(KEY_PATH, 'utf-8'));
    return {
      publicKey: Buffer.from(data.publicKey, 'base64'),
      secretKey: Buffer.from(data.secretKey, 'base64')
    };
  }

  // Generate new key
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);

  const data = {
    publicKey: Buffer.from(publicKey).toString('base64'),
    secretKey: Buffer.from(secretKey).toString('base64')
  };

  try {
    fs.writeFileSync(KEY_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn("[SERVER] Could not write server_signing_key.json (ephemeral/read-only fs):", e.message);
  }

  return { publicKey, secretKey };
}
