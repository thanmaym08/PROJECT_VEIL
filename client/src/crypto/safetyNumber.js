import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from './utils.js';

export function computeSafetyNumber(myCipherId, theirCipherId, myMlkemPubB64, myX25519PubB64, theirMlkemPubB64, theirX25519PubB64) {
  // Deterministic sorting of identities
  const isInitiator = myCipherId < theirCipherId;
  
  const idA = isInitiator ? myCipherId : theirCipherId;
  const idB = isInitiator ? theirCipherId : myCipherId;
  
  const mlkemA = isInitiator ? myMlkemPubB64 : theirMlkemPubB64;
  const x25519A = isInitiator ? myX25519PubB64 : theirX25519PubB64;
  
  const mlkemB = isInitiator ? theirMlkemPubB64 : myMlkemPubB64;
  const x25519B = isInitiator ? theirX25519PubB64 : myX25519PubB64;

  const payload = [idA, idB, mlkemA, x25519A, mlkemB, x25519B].join('|');
  const payloadBytes = utf8ToBytes(payload);
  
  const hashBytes = sha256(payloadBytes);
  
  // Convert 32-byte hash to a hexadecimal string
  const hashHex = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Convert to BigInt to get a massive decimal number
  const bigIntHash = BigInt("0x" + hashHex);
  
  // A 256-bit number in decimal is up to ~78 digits. Pad to 78 just in case.
  const decimalStr = bigIntHash.toString(10).padStart(78, '0');
  
  // Take the first 60 digits and chunk them into 12 groups of 5
  const chunks = [];
  for (let i = 0; i < 12; i++) {
    chunks.push(decimalStr.slice(i * 5, i * 5 + 5));
  }
  
  return chunks.join(' ');
}
