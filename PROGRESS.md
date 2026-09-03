# VEIL Build Progress

## Phase 1: Environment & Cryptographic Engine
- [x] Initialized Vite React client with Tailwind and Lucide.
- [x] Implemented Identity generation (ML-KEM-768, X25519).
- [x] Implemented Handshake (Hybrid Post-Quantum Key Encapsulation, HKDF-SHA256).
- [x] Implemented Cipher (AES-256-GCM with strict AAD binding).
- [x] Implemented Safety Numbers (Deterministic hashing of public keys).
- [x] Implemented Key Storage (Argon2id derivation, AES-GCM wrapping, IndexedDB).

## Phase 2: In-Memory Stateless Relay Server
- [x] Implemented pure in-memory Node.js WebSocket server.
- [x] Implemented message routing and offline FIFO queues (Max 50 messages).
- [x] Implemented garbage collection for queues (1-hour TTL) and inactive identities (24-hour TTL).
- [x] Implemented token-bucket rate limiting (Conn: 30/min, Msg: 100/min).

## Phase 3: Headless Crypto & Integration Verification
- [x] Configured Vitest test suite.
- [x] Validated Cryptographic Handshake & Round-Trip encryption/decryption.
- [x] Validated Negative Security (Ciphertext tampering, AAD spoofing, Replay Window).
- [x] Validated Safety Number determinism and tamper-detection.
- [x] Validated Full Integration via Mock WebSocket Relay (queueing).

## Phase 4: Frontend UI/UX & Session Management
- [x] Built `PassphraseGate` for securely unlocking local keys.
- [x] Built `Onboarding` flow for identity generation.
- [x] Built `App` and `ChatLayout` for WebSocket and session management.
- [x] Built `AddContactModal` with html5-qrcode scanner integration.
- [x] Built `SafetyNumberModal` for mutual authentication.

## Phase 5: Hardening, Tor Documentation & Verification
- [x] Applied strict Content Security Policy (CSP) in `index.html`.
- [x] Verified zero `console.log` statements for sensitive materials.
- [x] Authored `SECURITY.md` detailing the threat model.
- [x] Authored `DEPLOYMENT.md` detailing Caddy, Nginx, and Tor Hidden Service deployments.
- [x] Compiled `PROGRESS.md`.

## Phase 6: Post-Quantum Extended Triple Diffie-Hellman (PQXDH) & Double Ratchet
- [x] Implemented One-Time Prekeys (OPKs) and Signed Prekeys (SPKs).
- [x] Implemented hybrid PQXDH combining ML-KEM-768 with classical X3DH.
- [x] Implemented Double Ratchet (symmetric KDF chain + Diffie-Hellman ratchet) with out-of-order skipped message keys.
- [x] Implemented ratchet session serialization and persistence in IndexedDB.

## Phase 7: Sealed Sender & Native Hardening
- [x] Implemented Sealed Sender envelope encryption and delivery tokens to blind sender metadata from the relay.
- [x] Implemented server-side Ed25519 signing key and short-lived sender certificates.
- [x] Integrated SQLite database for prekey bundle storage and replenishment.
- [x] Capacitor Android integration with biometric unlock, FLAG_SECURE privacy screen, and native clipboard.
- [x] Verified complete crypto test suite across Vitest, Node test runner, and production Vite build.

## Phase 8: Multi-Device Verification & Dynamic Connectivity
- [x] Implemented dynamic relay URL detection (localhost, Android emulator 10.0.2.2, Wi-Fi IP, and Cloudflare Tunnel).
- [x] Implemented tap-to-configure relay URL dialog in UI header.
- [x] Configured single-port WebSocket proxy in Vite dev server (`/ws`).
- [x] Built and synchronized production assets to Capacitor Android project.
- [x] Successfully verified live, real-time PQXDH + Double Ratchet messaging between native Android emulator and desktop browser.

All systems operational and verified.

