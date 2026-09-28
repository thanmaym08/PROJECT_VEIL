# Project VEIL — Operational Knowledge Base (MEMORY.md)

**Project Name:** Project VEIL (Veil Flow & Veil Bunker)  
**Primary Repository:** `thanmaym08/PROJECT_VEIL`  
**Target Environment:** Web (Vite + React) & Android Mobile (Capacitor)  

---

## 1. System Overview & Architectural Invariants

Project VEIL is an end-to-end encrypted messaging system that pairs **NIST FIPS 203 ML-KEM-768** with **X25519 Double Ratchet** to guarantee forward secrecy, post-compromise security, and post-quantum resistance.

### Crucial Architectural Invariants:
1. **The Server is Untrusted:** The Node.js server (`server/server.js`) only routes envelopes and stores one-time prekeys. It NEVER has access to plaintexts, ratchet keys, or identity secrets.
2. **Encrypted at Rest:** All messages saved in client IndexedDB (`db.js`) are encrypted under a device master key with AES-256-GCM. Unencrypted plaintext is never committed to disk.
3. **Dual-Mode Parity:** The app provides two interfaces (**Veil Flow** and **Veil Bunker**) backed by the same state and encryption engine in `ChatLayout.jsx`. Switching modes does not reload or reset active sessions.
4. **RAM-Only View Once:** View Once attachments are decrypted directly into memory (`Blob` URL) and revoked immediately upon closing the modal, updating the local record to remove the attachment.

---

## 2. Directory Structure & Key Files

```
PROJECT_VEIL/
├── client/
│   ├── src/
│   │   ├── crypto/
│   │   │   ├── handshake.js       # Hybrid PQXDH: ML-KEM-768 + X25519 HKDF derivation
│   │   │   ├── ratchet.js         # Double Ratchet: DH Ratchet + Symmetric KDF Chains
│   │   │   ├── prekeys.js         # One-time & Signed Prekey generation/validation
│   │   │   ├── mediaCipher.js     # AES-256-GCM attachment encryption & chunking
│   │   │   ├── sealedSender.js    # Envelope packing/unpacking with delivery tokens
│   │   │   ├── keyStorage.js      # Master key derivation (Argon2id/PBKDF2) & biometric store
│   │   │   └── utils.js           # Base64, Hex, and Uint8Array cryptographic helpers
│   │   ├── storage/
│   │   │   └── db.js              # IndexedDB with AES-256-GCM at-rest encryption & backups
│   │   ├── components/
│   │   │   ├── ChatLayout.jsx     # Master dual-mode UI, socket routing & message loop
│   │   │   ├── CallModal.jsx      # WebRTC P2P audio/video calling interface
│   │   │   ├── CameraSnapModal.jsx# In-app camera viewfinder & instant snap
│   │   │   ├── CreatePollModal.jsx# Interactive in-chat poll creator
│   │   │   ├── StarredMessagesModal.jsx # Starred messages search drawer
│   │   │   ├── ForwardModal.jsx   # Multi-target message forwarding dialog
│   │   │   ├── WallpaperModal.jsx # 6 customizable chat wallpaper themes
│   │   │   ├── BackupModal.jsx    # AES-256-GCM encrypted vault backup & restore
│   │   │   ├── CreateBroadcastModal.jsx # Broadcast list fan-out manager
│   │   │   ├── GroupInfoModal.jsx # Admin permissions, "Announcement Only" & member controls
│   │   │   ├── PanicModal.jsx     # Zero-trace vault destruction dialog
│   │   │   ├── SafetyNumberModal.jsx # 60-digit fingerprint mutual verification
│   │   │   └── AddContactModal.jsx   # QR scanner & manual contact onboarding
│   │   ├── App.jsx                # Lifecycle router & passphrase gate
│   │   └── index.css              # Tailwind CSS styles & HUD animations
│   ├── test/
│   │   └── crypto.test.js         # Comprehensive 4-vector cryptographic test suite
│   ├── capacitor.config.ts        # Android mobile configuration
│   └── package.json
├── server/
│   ├── server.js                  # In-memory WebSocket relay & SQLite prekey storage
│   ├── public/                    # Built web client assets served by relay
│   └── package.json
├── PRD.md                         # Product Requirements Document
├── ARCHITECTURE.md                # System Architecture & Cryptographic Specs
├── RULES.md                       # Engineering & Security Rules
├── DESIGN.md                      # UI/UX Design System & Tokens
├── TASKS.md                       # Task Tracking & Milestone Roadmap
└── MEMORY.md                      # This Knowledge Base
```

---

## 3. Cryptographic State Machine & Concurrency

### 3.1 Double Ratchet Lifecycle
- **Initialization:** Initiator executes `computeInitiatorSession()` using recipient's prekey bundle. Receiver executes `computeReceiverSession()` upon receiving the handshake envelope.
- **Ratcheting:** Each message sent ratchets the sending symmetric chain (`advanceSendingChain`). Each message received ratchets the receiving symmetric chain (`advanceReceivingChain`).
- **Turn Switch:** Receiving an incoming message with a new sender DH ephemeral key triggers an asymmetric ratchet step, generating a fresh DH keypair and updating the root key.
- **Session Persistence:** After every ratchet step, the serialized session is written to IndexedDB.

### 3.2 Concurrency & Message Ordering
- WebSocket frames are processed asynchronously. To prevent race conditions where out-of-order execution could desynchronize ratchet chains:
  - `activeContactRef` and `contactsRef` are maintained in `ChatLayout.jsx` to avoid stale closures.
  - Skipped message keys are indexed by `(dhPublicKey, sequenceNumber)` with a TTL so late arrivals can still be decrypted.
  - If a message arrives that cannot be decrypted due to session desync, the client emits an automated `session_repair` signal requesting re-keying.

---

## 4. WebRTC Call Flow & Authenticated Signaling

1. **Initiation:** Caller emits `call_offer` containing SDP offer over WebSocket.
2. **Server Routing:** The server checks `connectionMap.get(ws) === from`. If validated, it forwards `call_offer` to the callee. If the callee is offline, the server immediately replies with `call_reject { reason: 'offline' }`.
3. **Response:** Callee answers (`call_answer`) and both peers exchange ICE candidates (`call_ice_candidate`).
4. **Media Stream:** Browsers establish direct peer-to-peer DTLS-SRTP encrypted audio/video streams.
5. **Termination:** Either peer emitting `call_end` closes the peer connection and stops all camera/mic hardware tracks.

---

## 5. Mobile (Capacitor Android) Operations

- **Asset Synchronization:** Whenever frontend code is modified, run:
  ```bash
  cd client
  npm run build
  npx cap copy
  ```
- **Android Security Features:**
  - `FLAG_SECURE` is active in `android/app/src/main/java/.../MainActivity.java`.
  - Android Keystore wraps master keys via `capacitor-secure-storage-plugin`.
  - Content Security Policy forbids non-local script execution.

---

## 6. Verification & Health Check Procedures

### Run Crypto Integrity Test
```bash
cd client
node test/crypto.test.js
```
Expected output:
- `[1] Handshake + Message 1 (Alice -> Bob): ✅ PASS`
- `[2] Multi-turn Reply (Bob -> Alice): ✅ PASS`
- `[3] Follow-up Message (Alice -> Bob): ✅ PASS`
- `[4] Header AAD Tamper Rejection (MitM Deflection): ✅ PASS`
- `✅ ALL 4 CRYPTOGRAPHIC PIPELINES VERIFIED 100%`

### Run Client Production Build
```bash
cd client
npm run build
```

### Sync Web Client to Server
```powershell
Copy-Item -Path "client/dist/*" -Destination "server/public/" -Recurse -Force
```

### Git Check & Push
```bash
git status
git add .
git commit -m "..."
git push origin main
```
