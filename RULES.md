# Project VEIL — Engineering & Security Rules (RULES.md)

**Classification:** Mandatory Engineering Directives  
**Enforcement:** Pre-commit Hooks, Automated CI/CD, Peer Review  

---

## 1. Cryptographic Directives (Zero-Tolerance)

### 1.1 Nonce & IV Hygiene
- **Rule 1.1.1:** Nonces and Initialization Vectors (IVs) for AES-256-GCM MUST ALWAYS be generated using a cryptographically secure pseudorandom number generator (`crypto.getRandomValues`).
- **Rule 1.1.2:** A 96-bit (12-byte) IV must NEVER be reused with the same key. Reusing an IV with the same AES-GCM key destroys authenticity and allows ciphertext recovery.

### 1.2 Memory Zeroization & Cleanup
- **Rule 1.2.1:** Ephemeral cryptographic material, shared secrets, decrypted attachment buffers, and private key representations in memory MUST be overwritten or unreferenced immediately after use.
- **Rule 1.2.2:** Ephemeral blob URLs created via `URL.createObjectURL()` MUST be revoked using `URL.revokeObjectURL()` as soon as the media is displayed or dismissed.

### 1.3 Authenticated Additional Data (AAD)
- **Rule 1.3.1:** Every encrypted message ciphertext MUST bind the sender identity, recipient identity, ratchet sequence number, and timestamp in the AAD.
- **Rule 1.3.2:** Decryption MUST reject any message where the AAD does not match the packet header byte-for-byte.

### 1.4 Post-Quantum Protocol Integrity
- **Rule 1.4.1:** Classical X25519 MUST NEVER be used in isolation without the companion ML-KEM-768 encapsulation secret. Both secrets must be combined via HKDF-Extract.
- **Rule 1.4.2:** Handshake downgrades to classical-only crypto MUST be rejected by default unless the remote peer's verified safety profile explicitly mandates legacy fallback.

---

## 2. Server & Network Security Rules

### 2.1 Zero-Knowledge Server Principle
- **Rule 2.1.1:** The server must NEVER receive, decrypt, log, or persist plaintext message contents, user passwords, or private keys.
- **Rule 2.1.2:** The server must NEVER store permanent message records. In-memory delivery queues must have an absolute maximum capacity of 50 messages per recipient and an enforced 1-hour expiration TTL.

### 2.2 Sender Authentication on WebSocket Signaling
- **Rule 2.2.1:** The relay server MUST validate that the `from` field of any incoming WebSocket frame matches the authenticated identity associated with that specific WebSocket connection (`connectionMap.get(ws) === from`).
- **Rule 2.2.2:** Any packet attempting to spoof sender identities (e.g. forged call offers or forged typing indicators) MUST result in immediate packet drop and rate-limit penalty.

### 2.3 Strict Content Security Policy (CSP)
- **Rule 2.3.1:** The client MUST enforce a strict CSP forbidding `eval()`, preventing external script injection, and restricting media sources strictly to trusted domains (`self`, `blob:`, `data:`, `giphy.com`).
- **Rule 2.3.2:** External fonts and CDNs must be pinned to verified subresource integrity hashes or loaded from local assets.

---

## 3. Client Storage & Vault Rules

### 3.1 Data-at-Rest Encryption
- **Rule 3.1.1:** Decrypted messages stored in IndexedDB MUST be encrypted at rest using AES-256-GCM with a device master key derived via PBKDF2 (minimum 100,000 iterations).
- **Rule 3.1.2:** Contacts and groups marked as `locked` MUST NOT be readable from storage or rendered in the DOM without prior master passphrase authentication.

### 3.2 Backup & Export Rules
- **Rule 3.2.1:** All exported vault files (`.veilbackup`) MUST be encrypted using PBKDF2 (100,000 iterations of SHA-256) + AES-256-GCM. Unencrypted plaintext backups are strictly forbidden.
- **Rule 3.2.2:** Backup imports must validate archive integrity, salt lengths, and magic headers (`VEIL_BACKUP_V1`) before attempting decryption.

---

## 4. UI/UX & Dual-Mode Directives

### 4.1 Dual-Mode Parity (Veil Flow vs. Veil Bunker)
- **Rule 4.1.1:** Any new messaging feature (e.g., calling, polls, view-once, forwards) MUST function equivalently in both **Veil Flow** and **Veil Bunker** modes.
- **Rule 4.1.2:** Switching between Flow and Bunker modes MUST be instant, preserving active socket connections, current open chats, and ongoing media playback without page reloads.

### 4.2 Mobile Responsiveness & Touch Targets
- **Rule 4.2.1:** All interactive controls (buttons, inputs, swipe actions) MUST adhere to a minimum touch target size of 44x44 CSS pixels on mobile viewports.
- **Rule 4.2.2:** Swipe-to-reply gestures must feature rubber-band resistance and haptic feedback (`navigator.vibrate`) where supported.

---

## 5. Coding Standards & Git Hygiene

### 5.1 Verification Checklist Before Commit
Before committing any changes to `main`:
1. Run `node test/crypto.test.js` — All 4 test vectors MUST pass 100%.
2. Run `npm run build` in `client/` — Build MUST compile with zero fatal errors.
3. Sync production assets to `server/public/` and run `npx cap copy` if mobile assets were affected.
4. Verify no `console.log` statements expose private keys, plaintexts, or master passwords.
