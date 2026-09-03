import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ed25519 } from '@noble/curves/ed25519.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_PATH = path.join(__dirname, 'server_signing_key.json');

export function getServerSigningKey() {
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

  fs.writeFileSync(KEY_PATH, JSON.stringify(data, null, 2));

  return { publicKey, secretKey };
}
