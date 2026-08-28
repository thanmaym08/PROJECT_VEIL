import { base64ToBytes, bytesToBase64, utf8ToBytes } from './utils.js';

export function buildAAD(version, fromCipherId, toCipherId, seqBigInt, timestampBigInt) {
  const versionByte = new Uint8Array([version]);
  const fromBytes = utf8ToBytes(fromCipherId);
  const toBytes = utf8ToBytes(toCipherId);
  
  const seqBytes = new Uint8Array(8);
  const seqView = new DataView(seqBytes.buffer);
  seqView.setBigUint64(0, seqBigInt, false); // false for Big-Endian
  
  const tsBytes = new Uint8Array(8);
  const tsView = new DataView(tsBytes.buffer);
  tsView.setBigUint64(0, timestampBigInt, false);

  const aad = new Uint8Array(
    versionByte.length + 
    fromBytes.length + 
    toBytes.length + 
    seqBytes.length + 
    tsBytes.length
  );
  
  let offset = 0;
  aad.set(versionByte, offset); offset += versionByte.length;
  aad.set(fromBytes, offset); offset += fromBytes.length;
  aad.set(toBytes, offset); offset += toBytes.length;
  aad.set(seqBytes, offset); offset += seqBytes.length;
  aad.set(tsBytes, offset);
  
  return aad;
}

export async function encryptMessage(sessionKeyBytes, plaintextStr, fromCipherId, toCipherId, seq, ts) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const key = await crypto.subtle.importKey(
    "raw",
    sessionKeyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const aad = buildAAD(1, fromCipherId, toCipherId, BigInt(seq), BigInt(ts));
  const rawPlaintext = utf8ToBytes(plaintextStr);
  
  // TRAFFIC ANALYSIS PADDING: Pad to next 512-byte boundary
  const targetSize = Math.ceil((rawPlaintext.length + 1) / 512) * 512;
  const paddedPlaintext = new Uint8Array(targetSize);
  
  // Fill with random noise first (to obscure padding length if ever exposed)
  crypto.getRandomValues(paddedPlaintext);
  
  // Insert original message
  paddedPlaintext.set(rawPlaintext, 0);
  
  // Insert NULL byte terminator
  paddedPlaintext[rawPlaintext.length] = 0;

  const ciphertextBuf = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
      additionalData: aad
    },
    key,
    encodedPlaintext
  );

  return {
    ivB64: bytesToBase64(new Uint8Array(iv)),
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertextBuf))
  };
}

export async function decryptMessage(sessionKeyBytes, ivB64, ciphertextB64, fromCipherId, toCipherId, seq, ts) {
  const iv = base64ToBytes(ivB64);
  const ciphertext = base64ToBytes(ciphertextB64);

  const key = await crypto.subtle.importKey(
    "raw",
    sessionKeyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const aad = buildAAD(1, fromCipherId, toCipherId, BigInt(seq), BigInt(ts));

  try {
    const plaintextBuf = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
        additionalData: aad
      },
      key,
      ciphertext
    );
    
    // Strip Padding (find first NULL byte)
    const paddedArray = new Uint8Array(plaintextBuf);
    const nullIdx = paddedArray.indexOf(0);
    const unpaddedArray = nullIdx !== -1 ? paddedArray.slice(0, nullIdx) : paddedArray;
    
    return new TextDecoder().decode(unpaddedArray);
  } catch (err) {
    throw new Error("Decryption failed: Integrity or AAD mismatch.");
  }
}

export class ReplayWindow {
  constructor(windowSize = 32) {
    this.windowSize = windowSize;
    this.highestSeq = 0n;
    this.seen = new Set();
  }

  checkAndAdd(seq) {
    const seqBig = BigInt(seq);
    if (seqBig <= this.highestSeq - BigInt(this.windowSize)) {
      throw new Error("Sequence number too old");
    }
    if (this.seen.has(seqBig)) {
      throw new Error("Duplicate sequence number");
    }
    
    this.seen.add(seqBig);
    if (seqBig > this.highestSeq) {
      this.highestSeq = seqBig;
      
      // cleanup old sequences
      for (const seenSeq of this.seen) {
        if (seenSeq <= this.highestSeq - BigInt(this.windowSize)) {
          this.seen.delete(seenSeq);
        }
      }
    }
    return true;
  }
}
