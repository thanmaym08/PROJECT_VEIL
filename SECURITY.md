# VEIL Security & Threat Model

VEIL is designed to provide robust, metadata-minimized, post-quantum end-to-end encrypted messaging. This document details the threat model, protections, and acknowledged limitations of the system.

## In-Scope Protections

### 1. Harvest-Now-Decrypt-Later (HNDL) Mitigation
VEIL utilizes a hybrid key exchange mechanism:
- **ML-KEM-768 (Kyber)**: Provides post-quantum encapsulation.
- **X25519**: Provides classical elliptic-curve Diffie-Hellman fallback.

Both secrets are concatenated and fed into HKDF-SHA256 to derive the AES-GCM session key. An attacker recording traffic today cannot decrypt it even if a Cryptographically Relevant Quantum Computer (CRQC) becomes available in the future, as the X25519 component still requires breaking classical ECC, and the ML-KEM component resists Shor's algorithm.

### 2. Protection Against Untrusted Relays
The VEIL relay server is stateless and in-memory. It only routes messages.
- The server cannot decrypt messages.
- Mutual authentication is verified using **Safety Numbers** (a 60-digit deterministic hash of both parties' ML-KEM and X25519 public keys).
- If the server attempts to MITM a connection by substituting its own keys during the initial key exchange, the Safety Numbers will diverge, alerting the users.

### 3. Replay & Tampering Prevention
- **Tampering**: AES-256-GCM provides Authenticated Encryption with Associated Data (AEAD). Any modified ciphertext or IV will fail the authentication tag check.
- **Replay**: Every message includes a monotonically increasing Sequence Number (Seq) and Timestamp strictly bound to the AAD. The receiver enforces a 32-message sliding window replay cache. Duplicate or old sequences are rejected immediately.
- **AAD Spoofing**: The sender/receiver Cipher IDs and Sequence numbers are bound into the AEAD. Changing the metadata without the symmetric key fails the integrity check.

## Out-of-Scope (What VEIL Does NOT Protect Against)

### 1. Network-Level IP Metadata
The current relay server uses standard WebSockets (`ws://` or `wss://`).
- The relay server observes IP addresses of connected clients.
- ISPs and network adversaries can see that two IP addresses are communicating with the relay server.
- **Mitigation**: Deploy the relay as a Tor Hidden Service (`.onion`) and connect clients via Tor Browser or Orbot. (See `DEPLOYMENT.md`).

### 2. Compromised Local Endpoints
- If a user's device is compromised with malware, screen-loggers, or keyloggers, the plaintext is exposed before encryption and after decryption.
- VEIL cannot protect against endpoint exploitation.

### 3. Malicious Browser Extensions
- Web-based clients are vulnerable to rogue browser extensions that can read the DOM or intercept Web Crypto API calls.
- **Mitigation**: Use a dedicated, clean browser profile or a hardened browser.

## Data at Rest
- Private keys are stored in the browser's IndexedDB.
- They are encrypted with AES-256-GCM.
- The wrapping key is derived from a user-provided passphrase using **Argon2id** (t=3, m=65536, p=1).
- If the passphrase is forgotten, keys cannot be recovered.
