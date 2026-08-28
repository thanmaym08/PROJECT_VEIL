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

All systems complete.
