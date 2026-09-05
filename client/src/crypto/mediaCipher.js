import { base64ToBytes, bytesToBase64 } from './utils.js';

export const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024; // 15 MB

/**
 * Encrypt a file client-side in RAM using AES-256-GCM.
 * The server only receives unreadable ciphertext bytes.
 */
export async function encryptAttachment(file) {
  if (file.size > MAX_ATTACHMENT_SIZE) {
    throw new Error(`File size ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds maximum limit of 15MB`);
  }

  const rawBuffer = await file.arrayBuffer();
  const rawBytes = new Uint8Array(rawBuffer);

  // Generate ephemeral 256-bit symmetric key & 12-byte IV
  const keyBytes = new Uint8Array(32);
  const ivBytes = new Uint8Array(12);
  crypto.getRandomValues(keyBytes);
  crypto.getRandomValues(ivBytes);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBytes },
    cryptoKey,
    rawBytes
  );

  return {
    ciphertextBuffer,
    keyB64: bytesToBase64(keyBytes),
    ivB64: bytesToBase64(ivBytes),
    fileName: file.name || 'unnamed_file',
    fileSize: file.size,
    mimeType: file.type || 'application/octet-stream'
  };
}

/**
 * Upload encrypted binary ciphertext to relay server.
 * Returns the server-assigned random attachmentId.
 */
export async function uploadEncryptedAttachment(apiBaseUrl, ciphertextBuffer) {
  const url = (apiBaseUrl ? apiBaseUrl.replace(/\/+$/, '') : '') + '/api/attachment';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream'
    },
    body: ciphertextBuffer
  });

  if (!response.ok) {
    let errMsg = `Upload failed with HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error) errMsg = errJson.error;
    } catch {}
    throw new Error(errMsg);
  }

  const data = await response.json();
  return data.attachmentId;
}

/**
 * Download encrypted binary ciphertext from relay server.
 */
export async function downloadEncryptedAttachment(apiBaseUrl, attachmentId) {
  const url = (apiBaseUrl ? apiBaseUrl.replace(/\/+$/, '') : '') + `/api/attachment/${attachmentId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status} (expired or removed)`);
  }
  return await response.arrayBuffer();
}

/**
 * Decrypt binary ciphertext in RAM and construct a secure Blob URL for inline display.
 */
export async function decryptAttachment(ciphertextBuffer, keyB64, ivB64, mimeType = 'application/octet-stream') {
  const keyBytes = base64ToBytes(keyB64);
  const ivBytes = base64ToBytes(ivB64);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    cryptoKey,
    ciphertextBuffer
  );

  const blob = new Blob([decryptedBuffer], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);

  return {
    blob,
    objectUrl,
    size: blob.size,
    mimeType
  };
}

/**
 * Safely revoke Blob URL to purge plaintext media from memory.
 */
export function revokeAttachmentUrl(objectUrl) {
  if (objectUrl && objectUrl.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {}
  }
}
