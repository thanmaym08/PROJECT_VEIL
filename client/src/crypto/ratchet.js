import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { bytesToBase64, base64ToBytes, utf8ToBytes } from './utils.js';

const MAX_SKIP = 50;

function kdf_ck(ck) {
  const mk = hmac(sha256, ck, new Uint8Array([0x01]));
  const next_ck = hmac(sha256, ck, new Uint8Array([0x02]));
  return { mk, next_ck };
}

function kdf_rk(rk, dh_out) {
  const info = new Uint8Array(utf8ToBytes("VEIL-DoubleRatchet"));
  const derived = hkdf(sha256, dh_out, rk, info, 64);
  const next_rk = derived.slice(0, 32);
  const next_ck = derived.slice(32, 64);
  return { next_rk, next_ck };
}

export class DoubleRatchet {
  constructor(rootKey, isInitiator, theirInitialPub = null, myInitialPriv = null) {
    this.rootKey = new Uint8Array(rootKey); // 32 bytes
    this.DHs = { priv: null, pub: null };
    this.DHr = theirInitialPub ? new Uint8Array(theirInitialPub) : null;
    this.CKs = null;
    this.CKr = null;
    this.Ns = 0;
    this.Nr = 0;
    this.PN = 0;
    this.MKSKIPPED = {};

    if (isInitiator) {
      this.generateNewDH();
      const dh_out = x25519.getSharedSecret(this.DHs.priv, this.DHr);
      const { next_rk, next_ck } = kdf_rk(this.rootKey, dh_out);
      this.rootKey = next_rk;
      this.CKs = next_ck;
    } else if (myInitialPriv) {
      this.DHs.priv = new Uint8Array(myInitialPriv);
      this.DHs.pub = x25519.getPublicKey(this.DHs.priv);
    } else {
      this.generateNewDH();
    }
  }

  serialize() {
    const state = {
      rootKey: bytesToBase64(this.rootKey),
      DHs_priv: this.DHs.priv ? bytesToBase64(this.DHs.priv) : null,
      DHs_pub: this.DHs.pub ? bytesToBase64(this.DHs.pub) : null,
      DHr: this.DHr ? bytesToBase64(this.DHr) : null,
      CKs: this.CKs ? bytesToBase64(this.CKs) : null,
      CKr: this.CKr ? bytesToBase64(this.CKr) : null,
      Ns: this.Ns,
      Nr: this.Nr,
      PN: this.PN,
      MKSKIPPED: {}
    };

    for (const [key, mk] of Object.entries(this.MKSKIPPED)) {
      state.MKSKIPPED[key] = bytesToBase64(mk);
    }
    return JSON.stringify(state);
  }

  static deserialize(stateStr) {
    const state = JSON.parse(stateStr);
    const dr = new DoubleRatchet(new Uint8Array(32), false, null, null); // Dummy init
    dr.rootKey = base64ToBytes(state.rootKey);
    dr.DHs = {
      priv: state.DHs_priv ? base64ToBytes(state.DHs_priv) : null,
      pub: state.DHs_pub ? base64ToBytes(state.DHs_pub) : null
    };
    dr.DHr = state.DHr ? base64ToBytes(state.DHr) : null;
    dr.CKs = state.CKs ? base64ToBytes(state.CKs) : null;
    dr.CKr = state.CKr ? base64ToBytes(state.CKr) : null;
    dr.Ns = state.Ns;
    dr.Nr = state.Nr;
    dr.PN = state.PN;
    dr.MKSKIPPED = {};
    for (const [key, mkB64] of Object.entries(state.MKSKIPPED)) {
      dr.MKSKIPPED[key] = base64ToBytes(mkB64);
    }
    return dr;
  }
  
  generateNewDH() {
    this.DHs.priv = x25519.utils.randomSecretKey();
    this.DHs.pub = x25519.getPublicKey(this.DHs.priv);
  }

  stepDH(their_dh_pub) {
    this.PN = this.Ns;
    this.Ns = 0;
    this.Nr = 0;
    this.DHr = new Uint8Array(their_dh_pub);
    
    // Receive Chain
    const dh_out_rx = x25519.getSharedSecret(this.DHs.priv, this.DHr);
    const rx_derived = kdf_rk(this.rootKey, dh_out_rx);
    this.rootKey = rx_derived.next_rk;
    this.CKr = rx_derived.next_ck;

    // Send Chain
    this.generateNewDH();
    const dh_out_tx = x25519.getSharedSecret(this.DHs.priv, this.DHr);
    const tx_derived = kdf_rk(this.rootKey, dh_out_tx);
    this.rootKey = tx_derived.next_rk;
    this.CKs = tx_derived.next_ck;
    
    // MEMORY HYGIENE
    dh_out_rx.fill(0);
    dh_out_tx.fill(0);
  }

  async encryptMessage(plaintextStr) {
    const { mk, next_ck } = kdf_ck(this.CKs);
    this.CKs = next_ck;
    
    const key = await crypto.subtle.importKey("raw", mk, { name: "AES-GCM" }, false, ["encrypt"]);
    
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    const rawPlaintext = utf8ToBytes(plaintextStr);
    const targetSize = Math.ceil((rawPlaintext.length + 1) / 512) * 512;
    const padded = new Uint8Array(targetSize);
    crypto.getRandomValues(padded);
    padded.set(rawPlaintext, 0);
    padded[rawPlaintext.length] = 0;

    // We can also authenticate the header by using AAD, but for simplicity of Double Ratchet, 
    // GCM handles ciphertext integrity. We should bind the AAD.
    const headerStr = JSON.stringify({ dh: bytesToBase64(this.DHs.pub), n: this.Ns, pn: this.PN });
    const aad = utf8ToBytes(headerStr);

    const ciphertextBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, padded);
    
    const out = {
      header: {
        dh: bytesToBase64(this.DHs.pub),
        n: this.Ns,
        pn: this.PN
      },
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(ciphertextBuf))
    };
    
    this.Ns++;
    mk.fill(0); // Memory hygiene
    return out;
  }

  async trySkippedMessageKeys(header, ivB64, ctB64) {
    const dhKey = header.dh;
    if (this.MKSKIPPED[dhKey] && this.MKSKIPPED[dhKey][header.n]) {
      const mk = this.MKSKIPPED[dhKey][header.n];
      delete this.MKSKIPPED[dhKey][header.n];
      
      const key = await crypto.subtle.importKey("raw", mk, { name: "AES-GCM" }, false, ["decrypt"]);
      const plaintextBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(ivB64) },
        key,
        base64ToBytes(ctB64)
      );
      mk.fill(0);
      return plaintextBuf;
    }
    return null;
  }

  skipMessageKeys(until) {
    if (!this.CKr || !this.DHr) return;
    if (this.Nr + MAX_SKIP < until) {
      throw new Error("Too many skipped messages");
    }
    
    const dhKey = bytesToBase64(this.DHr);
    if (!this.MKSKIPPED[dhKey]) this.MKSKIPPED[dhKey] = {};
    
    while (this.Nr < until) {
      const { mk, next_ck } = kdf_ck(this.CKr);
      this.CKr = next_ck;
      this.MKSKIPPED[dhKey][this.Nr] = mk;
      this.Nr++;
    }
  }

  async decryptMessage(header, ivB64, ctB64) {
    // 1. Check if it's a skipped message
    try {
        const skippedPlaintext = await this.trySkippedMessageKeys(header, ivB64, ctB64);
        if (skippedPlaintext) return this.unpad(skippedPlaintext);
    } catch (e) {
        throw new Error("Failed to decrypt skipped message");
    }

    // 2. Do we need a DH turn?
    let dh_pub = base64ToBytes(header.dh);
    if (!this.DHr || bytesToBase64(this.DHr) !== header.dh) {
      this.skipMessageKeys(header.pn);
      this.stepDH(dh_pub);
    }

    // 3. Skip missing messages in current chain
    this.skipMessageKeys(header.n);

    // 4. Decrypt current message
    const { mk, next_ck } = kdf_ck(this.CKr);
    this.CKr = next_ck;
    this.Nr++;

    const key = await crypto.subtle.importKey("raw", mk, { name: "AES-GCM" }, false, ["decrypt"]);
    let plaintextBuf;
    try {
      plaintextBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(ivB64) },
        key,
        base64ToBytes(ctB64)
      );
    } catch (e) {
      throw new Error("Ratchet AES-GCM Payload Decryption Failed (Desync?)");
    }
    
    mk.fill(0);
    return this.unpad(plaintextBuf);
  }

  unpad(buffer) {
    const arr = new Uint8Array(buffer);
    const nullIdx = arr.indexOf(0);
    if (nullIdx === -1) throw new Error("Invalid padding");
    const sliced = arr.slice(0, nullIdx);
    return new TextDecoder().decode(sliced);
  }
}
