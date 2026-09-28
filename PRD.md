# Project VEIL — Product Requirements Document (PRD)

**Product Name:** Project VEIL (Veil Flow & Veil Bunker)  
**Version:** 2.0.0-PROD  
**Document Status:** Approved & Implemented  
**Classification:** Zero-Knowledge Cryptographic Communication System  

---

## 1. Executive Summary & Vision

Project VEIL is a next-generation, post-quantum encrypted communication platform designed to provide mathematical privacy guarantees against both contemporary surveillance states and future quantum adversaries equipped with Shor's algorithm.

Unlike traditional encrypted messengers that force users to choose between extreme usability compromises and metadata leakage, Project VEIL introduces a **Dual-Mode Architectural Paradigm**:

1. **Veil Flow:** An intuitive, modern messaging experience designed for everyday high-productivity communication with the familiar fluidity of WhatsApp, enriched with ephemeral rich media, voice notes, WebRTC calls, polls, and message controls.
2. **Veil Bunker:** A hardened, tactical zero-trust HUD engineered for high-threat environments, displaying real-time cryptographic telemetry, raw cipher nonces, identity fingerprints, and instantaneous zero-trace panic wipe controls.

Underneath both interfaces resides the exact same uncompromising cryptographic core: **NIST FIPS 203 ML-KEM-768 (Kyber)** hybrid key encapsulation combined with classical **X25519 Extended Triple Diffie-Hellman (PQXDH)** and the **Signal Double Ratchet**, shielded by **Sealed Sender metadata blinding**.

---

## 2. Target Personas & Use Cases

### Persona A: Privacy-Conscious Everyday User ("Flow")
- **Profile:** Needs seamless everyday communication with friends, family, and colleagues without corporate surveillance, behavioral ad profiling, or cloud data harvesting.
- **Pain Points:** Existing privacy apps feel austere, lack rich media capabilities (interactive polls, voice memos, call indicators), or have awkward key management.
- **Needs:** Fast contact adding via QR codes, voice messages with audio waveforms, encrypted voice/video calling, view-once photos, chat wallpapers, and message search.

### Persona B: Tactical Operator / Whistleblower / Journalist ("Bunker")
- **Profile:** Operates in hostile environments subject to active interception, device seizure, man-in-the-middle attacks, and forensic physical extraction.
- **Pain Points:** Closed-source protocols, centralized metadata tracking (who talks to whom, when, and how often), and cloud backups that leak private keys.
- **Needs:** Post-quantum future-proof secrecy (Store-Now-Decrypt-Later defense), zero server-side message persistence, biometric & passphrase gated vaults, and one-click panic memory wipe.

---

## 3. Product Modes & Functional Specifications

### 3.1 Dual-Mode Switcher
- **Requirement:** Seamless single-click switching between *Veil Flow* and *Veil Bunker* directly from the header without session reset or key re-derivation.
- **Persistence:** App mode selection persisted in client storage (`veil_app_mode`).

---

### 3.2 Veil Flow Functional Requirements

#### A. Rich Media & Calling
- **WebRTC 1-on-1 Encrypted Calls:**
  - P2P direct audio and video calling with STUN fallback (`stun.l.google.com:19302`).
  - Signaling payloads (`call_offer`, `call_answer`, `call_ice_candidate`, `call_end`, `call_reject`, `call_busy`) authenticated over the secure WebSocket relay.
  - Controls: Camera flip (front/back), microphone mute, video mute, call duration timer, and picture-in-picture local preview.
- **"View Once" Ephemeral Photos & Media:**
  - Sender toggles `(1)` icon on staged image attachments.
  - Decrypted into volatile client RAM memory only via ephemeral `Blob` URLs.
  - Opening modal displays the photo once; closing permanently revokes the blob and updates the vault record to `{ viewed: true, attachment: null }`.
- **In-App Camera Snap:**
  - Viewfinder modal allowing instant camera capture with camera switching, image preview, and direct staging into the AES-256-GCM encryption pipeline.
- **Voice Memos:**
  - In-line audio recording with waveform animation, live duration timer, discard, and custom audio player with playback speed and scrubber.
- **Stickers & Emojis:**
  - Full emoji/sticker picker modal with category tabs, search, and reaction popovers.

#### B. Chat Productivity & Messaging
- **Pinned Chats:** Ability to pin high-priority contacts or groups to the top of the chat list with visual pin indicators.
- **Starred Messages Drawer:** Bookmark important messages across any conversation; accessible via a dedicated search drawer with text copy and unstar actions.
- **Message Editing (15-Minute Window):** Edit previously sent messages within 15 minutes of transmission. Transmits an E2E encrypted `{ type: 'edit', targetSeq, newText }` packet.
- **Delete for Everyone & Delete for Me:**
  - *Delete for Me:* Local IndexedDB deletion and RAM shredding.
  - *Delete for Everyone:* Transmits an authenticated E2E encrypted `{ type: 'delete', targetSeq }` packet that replaces content with a universal tombstone.
- **Message Forwarding:** Multi-select forward dialog targeting any contact or group with automatic `Forwarded` attribution.
- **Chat Wallpapers:** 6 built-in themes (WhatsApp Classic Doodle, Deep Emerald, Slate Minimal, Cyberpunk HUD, Pitch Obsidian, Cosmic Indigo).

#### C. Group Superpowers
- **In-Chat Interactive Polls:** Create polls with up to 6 custom options and single/multi-choice settings. Real-time encrypted vote fan-out with live percentage progress bars.
- **Member `@mentions`:** Real-time auto-complete dropdown when typing `@` in group chats; mention tags highlighted in accent colors.
- **Group Admin Permissions:** Creator/admin controls including promote/demote members and "Announcement Only" mode (restricting message sending to admins).
- **Broadcast Lists:** Send announcements to multiple recipients simultaneously. Zero metadata leakage: the client fans out independent 1-on-1 Double Ratchet messages to each recipient.

---

### 3.3 Veil Bunker Functional Requirements

#### A. Cryptographic Transparency & HUD
- **Real-Time Telemetry:** Displays ratchet sequence numbers, public key hashes, cipher suite (`ML-KEM-768 + X25519 + AES-256-GCM`), and handshake state.
- **Vanish Mode:** Ephemeral timers (5s, 1m, 1h) with countdown indicators and automatic message shredding upon read receipt confirmation.
- **Safety Number Verification:** 60-digit deterministic cryptographic fingerprint and QR code for out-of-band mutual identity verification.

#### B. Hardened Zero-Trace Defense
- **Zero-Trace Panic Wipe:** Prompts for zero-confirmation emergency wipe (`DESTROY VAULT`). Clears IndexedDB, LocalStorage, SessionStorage, WebWorker crypto keys, and closes all WebSockets.
- **Volatile In-Memory Mode:** Option to run strictly in volatile RAM memory without persisting decrypted messages to IndexedDB.
- **Locked Chats (Hidden Folder):** Sensitive contacts and groups can be locked into a hidden folder that remains invisible until unlocked by the master passphrase.

---

## 4. Cryptographic & Security Requirements

| Component | Standard / Algorithm | Security Guarantee |
| :--- | :--- | :--- |
| **Post-Quantum KEM** | NIST FIPS 203 ML-KEM-768 (Kyber) | Quantum resistance against Shor's algorithm (Store-Now-Decrypt-Later defense). |
| **Classical Asymmetric** | Curve25519 (X25519) | 128-bit classical security against discrete log cryptanalysis. |
| **Digital Signatures** | Ed25519 (RFC 8032) | Authenticated identity verification and prekey bundle signing. |
| **Symmetric Encryption** | AES-256-GCM | Authenticated Encryption with Associated Data (AEAD) with strict 96-bit unique IVs. |
| **Key Derivation** | HKDF-SHA256 (RFC 5869) | Cryptographically strong pseudo-random key expansion. |
| **Session Ratchet** | Signal Double Ratchet | Forward Secrecy (compromised current keys cannot decrypt past messages) and Post-Compromise Security (self-healing after temporary compromise). |
| **Metadata Protection**| Sealed Sender & Delivery Tokens | Relay server cannot determine sender identity from packet envelopes. |
| **Storage at Rest** | PBKDF2 (100k iter) + AES-256-GCM | Encrypted IndexedDB vault protecting messages, prekeys, and contacts. |

---

## 5. Non-Functional Requirements

### 5.1 Performance
- End-to-end message encryption and transmission latency: `< 150ms` on broadband, `< 400ms` on mobile 4G/5G.
- Key generation and hybrid handshake completion: `< 80ms` on standard mobile processors.
- Database query and message view rendering: `< 16ms` (maintaining 60 FPS scrolling).

### 5.2 Client Compatibility & Portability
- **Web:** Modern Evergreen browsers (Chrome, Firefox, Safari, Edge) supporting WebCrypto API and IndexedDB.
- **Mobile:** Android 8.0+ via Apache Cordova / Capacitor, bundled with:
  - `FLAG_SECURE` enabled to prevent OS screenshots and task switcher previews.
  - Native Biometric Authentication (Fingerprint / Face Unlock).
  - Encrypted SharedPreferences via `capacitor-secure-storage-plugin`.

### 5.3 Server Footprint
- Fully stateless WebSocket relay in Node.js.
- Zero server-side message persistence (in-memory queues limited to 50 items with 1-hour TTL for offline delivery).
- Token-bucket rate limiting per IP and client connection.
