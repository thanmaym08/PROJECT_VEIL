import { useState, useEffect, useRef } from 'react';
import { getContacts, saveContact, saveMessage, getMessages, updateMessageStatus, updateMessageReactions, deleteMessage, getLocalPreKeys, saveLocalPreKeys } from '../storage/db';
import { generatePreKeyBundle, generateOneTimePreKeys, verifyPreKeyBundle } from '../crypto/prekeys';
import { UserPlus, ShieldAlert, ShieldCheck, Send, Check, CheckCheck, Paperclip, Image, FileText, Download, X, Maximize2, Loader2, Smile, CornerUpLeft } from 'lucide-react';
import AddContactModal from './AddContactModal';
import SafetyNumberModal from './SafetyNumberModal';
import { computeInitiatorSession, computeReceiverSession } from '../crypto/handshake';
import { DoubleRatchet } from '../crypto/ratchet';
import { base64ToBytes } from '../crypto/utils';
import { encryptAttachment, uploadEncryptedAttachment, downloadEncryptedAttachment, decryptAttachment, revokeAttachmentUrl } from '../crypto/mediaCipher';
import { Capacitor } from '@capacitor/core';

const EMOJI_LIST = ['👍', '❤️', '🔥', '😂', '😮', '👏'];
const DEFAULT_CLOUD_HTTP = 'https://veil-relay.onrender.com';
const DEFAULT_CLOUD_WS = 'wss://veil-relay.onrender.com';

function SwipeableMessageRow({ children, onReply, disabled }) {
  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const isLocked = useRef(false);
  const isHorizontal = useRef(false);
  const isDragging = useRef(false);

  const handlePointerDown = (e) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('img')) return;
    
    startPos.current = { x: e.clientX, y: e.clientY };
    isLocked.current = false;
    isHorizontal.current = false;
    isDragging.current = true;
    setIsSwiping(true);
  };

  const handlePointerMove = (e) => {
    if (!isDragging.current) return;
    const diffX = e.clientX - startPos.current.x;
    const diffY = e.clientY - startPos.current.y;

    if (!isLocked.current) {
      if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
        isLocked.current = true;
        isHorizontal.current = Math.abs(diffX) > Math.abs(diffY);
      }
    }

    if (!isHorizontal.current) return;

    if (diffX > 0) {
      // Swiping to the right with rubber-band curve
      const damped = diffX > 60 ? 60 + (diffX - 60) * 0.25 : diffX;
      setOffset(Math.min(damped, 85));
    } else {
      setOffset(0);
    }
  };

  const handlePointerEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (offset >= 45) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(25); } catch {}
      }
      onReply();
    }
    setIsSwiping(false);
    setOffset(0);
  };

  return (
    <div 
      className="relative w-full overflow-visible select-none"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {/* Background Reply Arrow Icon */}
      <div 
        className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-10 transition-all duration-100"
        style={{
          opacity: Math.min(offset / 35, 1),
          transform: `scale(${Math.min(Math.max(offset / 45, 0.4), 1)}) translateY(-50%)`
        }}
      >
        <div className={`p-2 rounded-full border transition-all ${offset >= 45 ? 'bg-arc-cyan text-stark-bg border-arc-cyan shadow-glow-cyan scale-110' : 'bg-stark-surface/90 border-arc-cyan/40 text-arc-cyan'}`}>
          <CornerUpLeft size={16} />
        </div>
      </div>

      {/* Message Bubble Container with Translation */}
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: isSwiping ? 'none' : 'transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function ChatLayout({ keys, myId }) {
  const [contacts, setContacts] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [showAddContact, setShowAddContact] = useState(false);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [inputText, setInputText] = useState('');
  
  // Media & Attachment State
  const [stagedAttachment, setStagedAttachment] = useState(null); // { file, name, size, isImage, previewUrl }
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [decryptedMedia, setDecryptedMedia] = useState({}); // id -> { loading, objectUrl, error, fileName, fileSize, mimeType }
  const [lightboxImage, setLightboxImage] = useState(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  // Emoji Reaction State
  const [activeReactionSeq, setActiveReactionSeq] = useState(null);

  // Message Quoting / Replying State
  const [replyingTo, setReplyingTo] = useState(null); // { seq, senderId, senderName, text, hasAttachment }

  const startReply = (m) => {
    setReplyingTo({
      seq: m.seq,
      senderId: m.fromMe ? myId : activeContact.id,
      senderName: m.fromMe ? 'YOU' : activeContact.name,
      fromMe: m.fromMe,
      text: m.text,
      hasAttachment: !!m.attachment
    });
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const [typingUsers, setTypingUsers] = useState({});
  const typingTimeouts = useRef({});
  
  const [vanishModes, setVanishModes] = useState({}); // contactId -> ttl in ms
  const [showVanishMenu, setShowVanishMenu] = useState(false);
  
  const ws = useRef(null);
  const sessionKeys = useRef({}); // contactId -> sessionKey
  const messagesEndRef = useRef(null);
  // CRITICAL FIX: ref to contacts so WebSocket handlers always see fresh list
  const contactsRef = useRef([]);
  const activeContactRef = useRef(null);
  const pendingBundleRequests = useRef({});
  const serverIdentityPubRef = useRef(null);
  const mySenderCertRef = useRef(null);

  // Mobile Resilience refs
  const reconnectAttemptRef = useRef(0);
  const pingIntervalRef = useRef(null);
  const pingTimeoutRef = useRef(null);

  useEffect(() => {
    loadContacts();
    connectWs();

    const handleResume = () => {
      if (!ws.current || ws.current.readyState === WebSocket.CLOSED || ws.current.readyState === WebSocket.CLOSING) {
        console.log("[VEIL] Visibility/Online event triggered socket reconnect");
        connectWs();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleResume();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleResume);

    return () => { 
      if (ws.current) ws.current.close();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleResume);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    activeContactRef.current = activeContact;
    if (activeContact) {
      getMessages(activeContact.id).then(setMessages);
    }
  }, [activeContact]);

  // Read Receipts & Self-Destruct trigger
  useEffect(() => {
    if (activeContact && ws.current?.readyState === WebSocket.OPEN) {
      const unread = messages.filter(m => !m.fromMe && m.status !== 'read');
      if (unread.length > 0) {
        const seqs = unread.map(m => m.seq);
        ws.current.send(JSON.stringify({ type: 'read', from: myId, to: activeContact.id, seqs }));
        
        const now = Date.now();
        setMessages(prev => prev.map(m => seqs.includes(m.seq) ? { ...m, status: 'read', readAt: now } : m));
        seqs.forEach(seq => updateMessageStatus(activeContact.id, seq, 'read', { readAt: now }));
      }
    }
  }, [messages, activeContact, myId]);

  // Self-Destruct Sweeper
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1); // Force re-render for countdown UI
      setMessages(prev => {
        let changed = false;
        const now = Date.now();
        const filtered = prev.filter(m => {
          if (m.ttl > 0 && m.status === 'read' && m.readAt) {
            if (now - m.readAt >= m.ttl) {
              changed = true;
              deleteMessage(activeContactRef.current?.id, m.seq).catch(()=>{});
              return false;
            }
          }
          return true;
        });
        return changed ? filtered : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const loadContacts = async () => {
    const c = await getContacts();
    contactsRef.current = c;
    setContacts(c);
    
    // Load ratchet states
    const { getRatchetState } = await import('../crypto/keyStorage.js');
    const { DoubleRatchet } = await import('../crypto/ratchet.js');
    for (const contact of c) {
      try {
        const stateStr = await getRatchetState(contact.id);
        if (stateStr) {
          sessionKeys.current[contact.id] = DoubleRatchet.deserialize(stateStr);
        }
      } catch (e) {
        console.error("Failed to load ratchet state for", contact.id, e);
      }
    }
  };

  const getApiBaseUrl = () => {
    try {
      const saved = localStorage.getItem('veil_relay_url');
      if (saved && !saved.includes('10.136.97.31') && !saved.includes('10.0.2.2')) {
        return saved.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://').replace(/\/ws\/?$/, '');
      }
    } catch {}

    if (Capacitor.isNativePlatform()) {
      return DEFAULT_CLOUD_HTTP;
    }

    if (typeof window !== 'undefined' && window.location) {
      const { hostname, origin } = window.location;
      if (hostname.includes('trycloudflare.com')) {
        return origin;
      }
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:8080';
      }
      return DEFAULT_CLOUD_HTTP;
    }

    return DEFAULT_CLOUD_HTTP;
  };

  const loadAttachment = async (att) => {
    if (!att || !att.id) return;
    setDecryptedMedia(prev => {
      if (prev[att.id] && !prev[att.id].error && !prev[att.id].loading) return prev;
      return { ...prev, [att.id]: { loading: true, error: null } };
    });

    try {
      const apiBase = getApiBaseUrl();
      console.log(`[VEIL] Downloading attachment ${att.id} from ${apiBase}`);
      const ciphertextBuffer = await downloadEncryptedAttachment(apiBase, att.id);
      const decrypted = await decryptAttachment(ciphertextBuffer, att.key, att.iv, att.mimeType);
      setDecryptedMedia(prev => ({
        ...prev,
        [att.id]: {
          loading: false,
          objectUrl: decrypted.objectUrl,
          fileName: att.fileName,
          fileSize: att.fileSize,
          mimeType: att.mimeType
        }
      }));
    } catch (e) {
      console.warn("[VEIL] Failed to decrypt attachment:", att.id, e.message);
      setDecryptedMedia(prev => ({
        ...prev,
        [att.id]: {
          loading: false,
          error: e.message || 'Decryption failed'
        }
      }));
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      alert(`File size ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds maximum 15MB limit.`);
      e.target.value = '';
      return;
    }

    const isImage = file.type.startsWith('image/');
    const previewUrl = isImage ? URL.createObjectURL(file) : null;
    setStagedAttachment({
      file,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      isImage,
      previewUrl
    });
    e.target.value = '';
  };

  const getWsUrl = () => {
    try {
      const saved = localStorage.getItem('veil_relay_url');
      if (saved && !saved.includes('10.136.97.31') && !saved.includes('10.0.2.2')) return saved;
    } catch {}

    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      const relayParam = params.get('relay');
      if (relayParam) return relayParam;
    }

    if (Capacitor.isNativePlatform()) {
      return DEFAULT_CLOUD_WS;
    }

    if (typeof window !== 'undefined' && window.location) {
      const { hostname, protocol, host } = window.location;
      if (hostname.includes('trycloudflare.com')) {
        return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/ws`;
      }
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'ws://localhost:8080';
      }
      return DEFAULT_CLOUD_WS;
    }

    return DEFAULT_CLOUD_WS;
  };

  const connectWs = async (urlOverride = null) => {
    let wsUrl = urlOverride || getWsUrl();
    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    socket.onopen = async () => {
      if (ws.current !== socket) return;
      setWsStatus('connected');
      reconnectAttemptRef.current = 0; // reset backoff

      // Heartbeat ping/pong (every 25s) with 10s watchdog timeout
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(JSON.stringify({ type: 'ping' }));
            if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);
            pingTimeoutRef.current = setTimeout(() => {
              console.warn("[VEIL] Heartbeat watchdog timeout (10s)! Reconnecting stale socket...");
              socket.close();
            }, 10000);
          } catch {}
        }
      }, 25000);

      let fcmToken = null;
      if (Capacitor.isNativePlatform()) {
        try {
          const { PushNotifications } = await import('@capacitor/push-notifications');
          let permStatus = await PushNotifications.checkPermissions();
          if (permStatus.receive === 'prompt') {
            permStatus = await PushNotifications.requestPermissions();
          }
          if (permStatus.receive === 'granted') {
            await PushNotifications.register();
            fcmToken = await new Promise((resolve) => {
              PushNotifications.addListener('registration', (token) => resolve(token.value));
              PushNotifications.addListener('registrationError', () => resolve(null));
              setTimeout(() => resolve(null), 3000);
            });
            await PushNotifications.removeAllListeners();
          }
        } catch (e) {
          console.error("Push Error", e);
        }
      }

      let localPreKeys = await getLocalPreKeys();
      let bundle = null;
      if (!localPreKeys || !localPreKeys.publicBundle) {
        const generated = generatePreKeyBundle(base64ToBytes(keys.ed25519.secretKeyB64));
        localPreKeys = { ...generated.privateMaterial, publicBundle: generated.publicBundle };
        await saveLocalPreKeys(localPreKeys);
        bundle = generated.publicBundle;
      } else {
        bundle = localPreKeys.publicBundle;
      }

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'register',
          cipherId: myId,
          mlkemPub: keys.mlkem.publicKeyB64,
          x25519Pub: keys.x25519.publicKeyB64,
          ed25519Pub: keys.ed25519.publicKeyB64,
          deliveryToken: keys.profile.deliveryTokenB64,
          fcmToken,
          bundle
        }));
      }
    };

    socket.onclose = () => {
      if (ws.current !== socket) return;
      setWsStatus('disconnected');
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (pingTimeoutRef.current) clearTimeout(pingTimeoutRef.current);

      if (!urlOverride && Capacitor.isNativePlatform() && wsUrl === 'ws://10.0.2.2:8080') {
        console.log('[VEIL] Emulator loopback failed, trying WiFi IP fallback...');
        setTimeout(() => connectWs('ws://10.136.97.31:8080'), 1000);
        return;
      }

      // Exponential backoff with jitter: 1s, 2s, 4s, 8s, up to 15s max
      const attempt = reconnectAttemptRef.current;
      const baseDelay = Math.min(15000, Math.pow(1.8, attempt) * 1000);
      const jitter = Math.random() * 500;
      const delay = Math.round(baseDelay + jitter);
      reconnectAttemptRef.current++;

      console.log(`[VEIL] Socket closed. Reconnecting in ${delay}ms (attempt ${attempt + 1})...`);
      setTimeout(() => {
        if (ws.current === socket || !ws.current || ws.current.readyState === WebSocket.CLOSED) {
          connectWs(urlOverride);
        }
      }, delay);
    };

    socket.onerror = (e) => {
      console.warn("WebSocket error:", e);
    };

    socket.onmessage = async (e) => {
      if (ws.current !== socket) return;

      // Clear ping watchdog upon any message reception
      if (pingTimeoutRef.current) {
        clearTimeout(pingTimeoutRef.current);
        pingTimeoutRef.current = null;
      }

      const data = JSON.parse(e.data);
      if (data.type === 'pong') return;
      if (data.type === 'typing') {
        const from = data.from;
        setTypingUsers(prev => ({ ...prev, [from]: true }));
        if (typingTimeouts.current[from]) clearTimeout(typingTimeouts.current[from]);
        typingTimeouts.current[from] = setTimeout(() => {
          setTypingUsers(prev => ({ ...prev, [from]: false }));
        }, 3000);
      } else if (data.type === 'msg') {
        handleIncomingMessage(data);
      } else if (data.type === 'ack') {
        // Update message status in UI and DB
        setMessages(prev => prev.map(m => m.seq === data.seq ? { ...m, status: data.status } : m));
        await updateMessageStatus(data.to, data.seq, data.status);
      } else if (data.type === 'read') {
        const now = Date.now();
        setMessages(prev => prev.map(m => data.seqs.includes(m.seq) ? { ...m, status: 'read', readAt: now } : m));
        for (const seq of data.seqs) {
          await updateMessageStatus(data.from, seq, 'read', { readAt: now });
        }
      } else if (data.type === 'vanish_mode') {
        setVanishModes(prev => ({ ...prev, [data.from]: data.ttl }));
      } else if (data.type === 'prekeys_res') {
        const resolver = pendingBundleRequests.current[data.targetCipherId];
        if (resolver) {
          resolver(data.bundle || null);
          delete pendingBundleRequests.current[data.targetCipherId];
        }
      } else if (data.type === 'register_ack') {
        serverIdentityPubRef.current = data.serverIdentityPub;
        if (data.replenishOpks > 0) {
          const { privs, pubs } = generateOneTimePreKeys(data.replenishOpks);
          getLocalPreKeys().then(local => {
            if (local) {
              local.oneTimePreKeys = [...local.oneTimePreKeys, ...privs];
              saveLocalPreKeys(local);
            }
          });
          ws.current.send(JSON.stringify({ type: 'upload_opk', cipherId: myId, oneTimePreKeys: pubs }));
        }
        // Fetch sender cert after registering
        ws.current.send(JSON.stringify({ type: 'get_sender_cert' }));
        
        // Flush outbox
        import('../storage/db.js').then(({ getAndClearOutbox }) => {
          getAndClearOutbox().then(outbox => {
            outbox.forEach(env => {
              if (ws.current?.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify(env));
              }
            });
          });
        });
      } else if (data.type === 'sender_cert_res') {
        mySenderCertRef.current = data.cert;
      } else if (data.type === 'session_repair') {
        const from = data.from;
        console.warn("Session repair requested by:", from);
        delete sessionKeys.current[from];
        import('../crypto/keyStorage.js').then(({ saveRatchetState }) => {
          saveRatchetState(from, null).catch(() => {});
        });
      } else if (data.type === 'sealed_msg') {
        handleIncomingMessage(data, true);
      }
    };
  };

  const handleIncomingMessage = async (data, isSealed = false) => {
    let senderId = data.from;
    try {
      let msgData = data;

      if (isSealed) {
        const { unsealMessage } = await import('../crypto/sealedSender.js');
        const unsealed = await unsealMessage(
          data.ephemeralPublicKey, 
          data.envelopeCiphertext, 
          data.iv,
          data.mac, 
          keys.x25519.secretKeyB64, 
          serverIdentityPubRef.current
        );
        senderId = unsealed.senderId;
        msgData = JSON.parse(unsealed.payload);
      }

      const contact = contactsRef.current.find(c => c.id === senderId);
      if (!contact) return; // Drop messages from unknown contacts

      let ratchet = sessionKeys.current[senderId];
      if (msgData.ekpub && msgData.kemct) {
        // Handshake packet from sender - always compute fresh receiver session
        const localPreKeys = await getLocalPreKeys();
        if (!localPreKeys) throw new Error("No local prekeys found");
        
        let opkPrivB64 = null;
        if (msgData.opkId) {
          const opkIndex = localPreKeys.oneTimePreKeys.findIndex(k => k.id === msgData.opkId);
          if (opkIndex !== -1) {
            opkPrivB64 = localPreKeys.oneTimePreKeys[opkIndex].priv;
            // Delete consumed OPK from local storage immediately for forward secrecy
            localPreKeys.oneTimePreKeys.splice(opkIndex, 1);
            saveLocalPreKeys(localPreKeys).catch(() => {});
          }
        }

        const sess = computeReceiverSession(
          msgData.ekpub, msgData.kemct, contact.x25519Pub, msgData.opkId,
          keys.x25519.secretKeyB64,
          localPreKeys.signedPreKey,
          localPreKeys.signedPqPreKey,
          opkPrivB64,
          senderId, myId
        );
        const mySpkPriv = base64ToBytes(localPreKeys.signedPreKey);
        const senderEkPub = base64ToBytes(msgData.ekpub);
        ratchet = new DoubleRatchet(sess.sessionKey, false, senderEkPub, mySpkPriv);
        sessionKeys.current[senderId] = ratchet;
      }
      
      if (!ratchet) throw new Error("No session key");

      const decrypted = await ratchet.decryptMessage(msgData.rh, msgData.iv, msgData.ct);
      
      const { saveRatchetState } = await import('../crypto/keyStorage.js');
      await saveRatchetState(senderId, ratchet.serialize());

      let text = decrypted;
      let contactToken = null;
      let attachment = null;
      let replyTo = null;
      try {
        const payload = JSON.parse(decrypted);
        if (payload.action === 'reaction') {
          const { targetSeq, emoji } = payload;
          if (targetSeq && emoji) {
            setMessages(prev => prev.map(m => {
              if (m.seq === targetSeq) {
                const curReactions = { ...(m.reactions || {}) };
                const curUsers = curReactions[emoji] || [];
                if (curUsers.includes(senderId)) {
                  curReactions[emoji] = curUsers.filter(id => id !== senderId);
                  if (curReactions[emoji].length === 0) {
                    delete curReactions[emoji];
                  }
                } else {
                  curReactions[emoji] = [...curUsers, senderId];
                }
                updateMessageReactions(senderId, targetSeq, curReactions).catch(console.error);
                return { ...m, reactions: curReactions };
              }
              return m;
            }));

            if (!activeContactRef.current || activeContactRef.current.id !== senderId) {
              getMessages(senderId).then(allMsgs => {
                const target = allMsgs.find(m => m.seq === targetSeq);
                if (target) {
                  const curReactions = { ...(target.reactions || {}) };
                  const curUsers = curReactions[emoji] || [];
                  if (curUsers.includes(senderId)) {
                    curReactions[emoji] = curUsers.filter(id => id !== senderId);
                    if (curReactions[emoji].length === 0) delete curReactions[emoji];
                  } else {
                    curReactions[emoji] = [...curUsers, senderId];
                  }
                  updateMessageReactions(senderId, targetSeq, curReactions).catch(console.error);
                }
              });
            }
          }

          if (payload.deliveryToken) contactToken = payload.deliveryToken;
          if (contactToken && contact.deliveryToken !== contactToken) {
            const updated = { ...contact, deliveryToken: contactToken };
            await saveContact(updated);
            setContacts(prev => prev.map(c => c.id === contact.id ? updated : c));
            const idx = contactsRef.current.findIndex(c => c.id === contact.id);
            if (idx !== -1) contactsRef.current[idx] = updated;
          }
          return;
        }

        if (payload.text !== undefined) text = payload.text;
        if (payload.attachment) {
          attachment = payload.attachment;
          loadAttachment(payload.attachment);
        }
        if (payload.deliveryToken) contactToken = payload.deliveryToken;
        if (payload.replyTo) replyTo = payload.replyTo;
      } catch (e) {
        // legacy plaintext
      }
      
      if (contactToken && contact.deliveryToken !== contactToken) {
        const updated = { ...contact, deliveryToken: contactToken };
        await saveContact(updated);
        // Need to update state too
        setContacts(prev => prev.map(c => c.id === contact.id ? updated : c));
        // Update ref immediately
        const idx = contactsRef.current.findIndex(c => c.id === contact.id);
        if (idx !== -1) contactsRef.current[idx] = updated;
      }
      
      const msgObj = {
        contactId: senderId,
        fromMe: false,
        text,
        attachment,
        replyTo: replyTo || undefined,
        reactions: {},
        ts: msgData.ts,
        seq: msgData.seq,
        ttl: msgData.ttl || 0
      };
      await saveMessage(msgObj);
      
      if (activeContactRef.current && activeContactRef.current.id === senderId) {
        setMessages(prev => [...prev, msgObj]);
        setTypingUsers(prev => ({ ...prev, [senderId]: false }));
      }
    } catch (e) {
      console.error("Message processing failed:", e);
      const errMsg = e.message || e.name || "Unknown WebCrypto Error";
      
      // Auto-repair signal: If decryption failed, request session repair from sender
      if (senderId && ws.current?.readyState === WebSocket.OPEN) {
        delete sessionKeys.current[senderId];
        import('../crypto/keyStorage.js').then(({ saveRatchetState }) => {
          saveRatchetState(senderId, null).catch(() => {});
        });
        ws.current.send(JSON.stringify({ type: 'session_repair', from: myId, to: senderId }));
      }

      if (activeContactRef.current && (activeContactRef.current.id === senderId || activeContactRef.current.id === data.from || data.type === 'sealed_msg')) {
        setMessages(prev => [...prev, { contactId: activeContactRef.current?.id || 'unknown', fromMe: false, text: `[AUTO-REPAIR]: Session desync detected. Requesting automatic re-key... (${errMsg})`, ts: Date.now(), seq: Date.now(), ttl: 0 }]);
      }
    }
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if ((!inputText.trim() && !stagedAttachment) || !activeContact) return;

    let attachmentMetadata = null;
    if (stagedAttachment) {
      setUploadingAttachment(true);
      try {
        const encrypted = await encryptAttachment(stagedAttachment.file);
        const apiBase = getApiBaseUrl();
        const attachmentId = await uploadEncryptedAttachment(apiBase, encrypted.ciphertextBuffer);
        attachmentMetadata = {
          id: attachmentId,
          key: encrypted.keyB64,
          iv: encrypted.ivB64,
          fileName: encrypted.fileName,
          fileSize: encrypted.fileSize,
          mimeType: encrypted.mimeType
        };
        // Cache decrypted blob locally so sender sees their own media instantly
        if (stagedAttachment.previewUrl) {
          setDecryptedMedia(prev => ({
            ...prev,
            [attachmentId]: {
              loading: false,
              objectUrl: stagedAttachment.previewUrl,
              fileName: encrypted.fileName,
              fileSize: encrypted.fileSize,
              mimeType: encrypted.mimeType
            }
          }));
        }
      } catch (err) {
        console.error("[VEIL] Attachment upload failed:", err);
        alert("Attachment upload failed: " + err.message);
        setUploadingAttachment(false);
        return;
      }
      setUploadingAttachment(false);
    }

    try {
      let ratchet = sessionKeys.current[activeContact.id];
      let ekpub = undefined, kemct = undefined;

      let opkId = undefined;

      if (!ratchet) {
        // Fetch bundle (will hit prefetch or wait for it)
        const bundle = await new Promise((resolve) => {
          if (pendingBundleRequests.current[activeContact.id]) {
            // Already fetching, intercept it
            const existing = pendingBundleRequests.current[activeContact.id];
            pendingBundleRequests.current[activeContact.id] = (b) => {
              existing(b);
              resolve(b);
            };
          } else {
            pendingBundleRequests.current[activeContact.id] = resolve;
            ws.current.send(JSON.stringify({ type: 'get_prekeys', targetCipherId: activeContact.id }));
          }
          setTimeout(() => {
            if (pendingBundleRequests.current[activeContact.id]) {
              delete pendingBundleRequests.current[activeContact.id];
              resolve(null);
            }
          }, 5000); // 5 sec timeout
        });

        if (!bundle) throw new Error("Could not fetch prekeys");
        
        // Wait a tick for prefetch to finish calculating, or calculate ourselves if we initiated it
        if (!sessionKeys.current[activeContact.id]) {
          verifyPreKeyBundle(bundle, activeContact.ed25519Pub);
          const sess = computeInitiatorSession(bundle, keys.x25519.secretKeyB64, myId, activeContact.id);
          const theirPub = base64ToBytes(bundle.signedPreKey.pub);
          ratchet = new DoubleRatchet(sess.sessionKey, true, theirPub);
          ratchet.ekpub = sess.ephemeralX25519PubB64;
          ratchet.kemct = sess.kemCiphertextB64;
          ratchet.opkId = sess.opkId;
          sessionKeys.current[activeContact.id] = ratchet;
        } else {
          ratchet = sessionKeys.current[activeContact.id];
        }
      }

      // Check if this is the first message for this session where we need to attach handshake material
      if (ratchet.ekpub && ratchet.kemct) {
        ekpub = ratchet.ekpub;
        kemct = ratchet.kemct;
        opkId = ratchet.opkId;
        // Do not delete them yet, keep them in case the first message is lost? 
        // Signal attaches them to *every* message until a reply is received, but for now we'll just attach once
        delete ratchet.ekpub;
        delete ratchet.kemct;
        delete ratchet.opkId;
      }

      const seq = Date.now(); // simple seq generator
      const ts = Date.now();
      
      const ttl = vanishModes[activeContact.id] || 0;
      
      const replyPayload = replyingTo ? {
        seq: replyingTo.seq,
        senderId: replyingTo.senderId,
        senderName: replyingTo.senderName,
        text: (replyingTo.text || '').slice(0, 200),
        hasAttachment: !!replyingTo.hasAttachment
      } : undefined;

      // Include delivery token and reply context in plaintext payload
      const innerPayload = JSON.stringify({
         text: inputText,
         attachment: attachmentMetadata || undefined,
         deliveryToken: keys.profile.deliveryTokenB64,
         replyTo: replyPayload
      });
      
      const { header, iv, ct } = await ratchet.encryptMessage(innerPayload);

      const { saveRatchetState } = await import('../crypto/keyStorage.js');
      await saveRatchetState(activeContact.id, ratchet.serialize());

      const envelope = {
        v: 1, type: 'msg',
        from: myId, to: activeContact.id, // we will strip from if sealed
        seq, ts, iv, ct, rh: header, ttl
      };
      
      if (ekpub && kemct) {
        envelope.ekpub = ekpub;
        envelope.kemct = kemct;
        if (opkId) envelope.opkId = opkId;
      }

      let finalPayload = envelope;
      if (activeContact.deliveryToken && mySenderCertRef.current) {
        // Sealed Sender Flow!
        const { sealMessage } = await import('../crypto/sealedSender.js');
        
        // Remove from entirely!
        delete envelope.from;
        
        const sealedEnvelope = await sealMessage(
           activeContact.x25519Pub,
           mySenderCertRef.current,
           JSON.stringify(envelope) // The inner ratchet msg is the inner payload
        );
        
        finalPayload = {
          type: 'sealed_msg',
          to: activeContact.id,
          ephemeralPublicKey: sealedEnvelope.ephemeralPublicKey,
          envelopeCiphertext: sealedEnvelope.envelopeCiphertext,
          mac: sealedEnvelope.mac,
          iv: sealedEnvelope.iv,
          deliveryToken: activeContact.deliveryToken
        };
      }
      
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify(finalPayload));
      } else {
        const { saveToOutbox } = await import('../storage/db.js');
        await saveToOutbox(finalPayload);
      }
      
      const msgObj = { 
        contactId: activeContact.id, 
        fromMe: true, 
        text: inputText, 
        attachment: attachmentMetadata || undefined,
        replyTo: replyPayload,
        reactions: {},
        ts, 
        seq, 
        status: 'sending', 
        ttl 
      };
      await saveMessage(msgObj);
      setMessages(prev => [...prev, msgObj]);
      setInputText('');
      setStagedAttachment(null);
      setReplyingTo(null);
    } catch (err) {
      alert("Encryption or Socket Error: " + err.message);
      console.error(err);
    }
  };

  const handleToggleReaction = async (targetSeq, emoji) => {
    if (!activeContact) return;

    let nextReactions = {};
    setMessages(prev => prev.map(m => {
      if (m.seq === targetSeq) {
        const curReactions = { ...(m.reactions || {}) };
        const curUsers = curReactions[emoji] || [];
        if (curUsers.includes(myId)) {
          curReactions[emoji] = curUsers.filter(id => id !== myId);
          if (curReactions[emoji].length === 0) {
            delete curReactions[emoji];
          }
        } else {
          curReactions[emoji] = [...curUsers, myId];
        }
        nextReactions = curReactions;
        return { ...m, reactions: curReactions };
      }
      return m;
    }));

    setActiveReactionSeq(null);

    await updateMessageReactions(activeContact.id, targetSeq, nextReactions).catch(console.error);

    try {
      let ratchet = sessionKeys.current[activeContact.id];
      if (!ratchet) {
        const bundle = await new Promise((resolve) => {
          if (pendingBundleRequests.current[activeContact.id]) {
            const existing = pendingBundleRequests.current[activeContact.id];
            pendingBundleRequests.current[activeContact.id] = (b) => {
              existing(b);
              resolve(b);
            };
          } else {
            pendingBundleRequests.current[activeContact.id] = resolve;
            ws.current.send(JSON.stringify({ type: 'get_prekeys', targetCipherId: activeContact.id }));
          }
          setTimeout(() => {
            if (pendingBundleRequests.current[activeContact.id]) {
              delete pendingBundleRequests.current[activeContact.id];
              resolve(null);
            }
          }, 5000);
        });
        if (!bundle) return;
        if (!sessionKeys.current[activeContact.id]) {
          verifyPreKeyBundle(bundle, activeContact.ed25519Pub);
          const sess = computeInitiatorSession(bundle, keys.x25519.secretKeyB64, myId, activeContact.id);
          const theirPub = base64ToBytes(bundle.signedPreKey.pub);
          ratchet = new DoubleRatchet(sess.sessionKey, true, theirPub);
          ratchet.ekpub = sess.ephemeralX25519PubB64;
          ratchet.kemct = sess.kemCiphertextB64;
          ratchet.opkId = sess.opkId;
          sessionKeys.current[activeContact.id] = ratchet;
        } else {
          ratchet = sessionKeys.current[activeContact.id];
        }
      }

      let ekpub = undefined, kemct = undefined, opkId = undefined;
      if (ratchet.ekpub && ratchet.kemct) {
        ekpub = ratchet.ekpub;
        kemct = ratchet.kemct;
        opkId = ratchet.opkId;
        delete ratchet.ekpub;
        delete ratchet.kemct;
        delete ratchet.opkId;
      }

      const seq = Date.now();
      const ts = Date.now();

      const innerPayload = JSON.stringify({
        action: 'reaction',
        targetSeq,
        emoji,
        deliveryToken: keys.profile.deliveryTokenB64
      });

      const { header, iv, ct } = await ratchet.encryptMessage(innerPayload);

      const { saveRatchetState } = await import('../crypto/keyStorage.js');
      await saveRatchetState(activeContact.id, ratchet.serialize());

      const envelope = {
        v: 1, type: 'msg',
        from: myId, to: activeContact.id,
        seq, ts, iv, ct, rh: header, ttl: 0
      };

      if (ekpub && kemct) {
        envelope.ekpub = ekpub;
        envelope.kemct = kemct;
        if (opkId) envelope.opkId = opkId;
      }

      let finalPayload = envelope;
      if (activeContact.deliveryToken && mySenderCertRef.current) {
        const { sealMessage } = await import('../crypto/sealedSender.js');
        delete envelope.from;
        const sealedEnvelope = await sealMessage(
          activeContact.x25519Pub,
          mySenderCertRef.current,
          JSON.stringify(envelope)
        );
        finalPayload = {
          type: 'sealed_msg',
          to: activeContact.id,
          ephemeralPublicKey: sealedEnvelope.ephemeralPublicKey,
          envelopeCiphertext: sealedEnvelope.envelopeCiphertext,
          mac: sealedEnvelope.mac,
          iv: sealedEnvelope.iv,
          deliveryToken: activeContact.deliveryToken
        };
      }

      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify(finalPayload));
      } else {
        const { saveToOutbox } = await import('../storage/db.js');
        await saveToOutbox(finalPayload);
      }
    } catch (err) {
      console.error("[VEIL] Failed to send reaction:", err);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden p-2 md:p-4 gap-4">
      {/* Sidebar */}
      <div className={`w-full md:w-80 bg-stark-surface border border-arc-cyan/20 flex-col shadow-glow-cyan ${activeContact ? 'hidden md:flex' : 'flex'}`} style={{clipPath: "polygon(0 0, 100% 0, 100% 100%, 5% 100%, 0 95%)"}}>
        <div className="p-4 border-b border-arc-cyan/20 flex justify-between items-center bg-arc-cyan/5">
          <div>
            <h2 className="font-hud font-bold tracking-[0.2em] text-arc-cyan text-lg md:text-xl">PROJECT VEIL // QUANTUM RELAY</h2>
            <div 
              onClick={() => {
                const current = localStorage.getItem('veil_relay_url') || getWsUrl();
                const newUrl = window.prompt("VEIL Relay WebSocket URL:", current);
                if (newUrl !== null && newUrl.trim() !== '') {
                  localStorage.setItem('veil_relay_url', newUrl.trim());
                  if (ws.current) ws.current.close();
                  connectWs(newUrl.trim());
                }
              }}
              title="Click to view/change Relay Server URL"
              className="text-xs text-arc-cyan/70 font-mono flex items-center gap-2 mt-1 cursor-pointer hover:underline"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-arc-cyan animate-pulse shadow-glow-cyan' : 'bg-stark-crimson shadow-glow-crimson'}`} />
              STATUS: {wsStatus === 'connected' ? 'ENCRYPTED (ML-KEM-768)' : 'OFFLINE (TAP TO CONFIGURE)'}
            </div>
            <div className="text-[10px] text-arc-cyan/50 font-mono mt-1 border border-arc-cyan/20 px-1 inline-block">ID: {myId.slice(0, 12)}...</div>
          </div>
          <button onClick={() => setShowAddContact(true)} className="p-2 text-arc-cyan hover:bg-arc-cyan/20 border border-transparent hover:border-arc-cyan/30 rounded transition-colors">
            <UserPlus size={22} />
          </button>
        </div>
        
        {/* Friends List Header */}
        <div className="px-4 py-3 border-b border-arc-cyan/10 bg-arc-cyan/5">
          <div className="text-sm font-hud tracking-[0.2em] text-arc-cyan/70 uppercase">FRIENDS REGISTERED</div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {contacts.length === 0 ? (
            <div className="p-6 text-center flex flex-col items-center justify-center h-full opacity-50">
              <UserPlus size={32} className="text-arc-cyan mb-3" />
              <div className="font-hud tracking-widest text-[10px] text-arc-cyan">NO FRIENDS ADDED</div>
              <div className="font-mono text-[9px] text-arc-cyan mt-2">Click [+] to add a friend</div>
            </div>
          ) : (
            contacts.map(c => (
              <button 
                key={c.id} 
                onClick={() => setActiveContact(c)}
                className={`w-full p-4 text-left border-b border-arc-cyan/10 hover:bg-arc-cyan/5 flex items-center justify-between transition-all ${activeContact?.id === c.id ? 'bg-arc-cyan/10 border-l-2 border-l-arc-cyan shadow-[inset_0_0_15px_rgba(0,240,255,0.1)]' : ''}`}
              >
                <div>
                  <div className="font-hud tracking-widest font-bold text-white text-sm">{c.name}</div>
                  <div className="text-[10px] text-arc-cyan/50 font-mono mt-1">{c.id.slice(0, 9)}...</div>
                </div>
                {c.verified ? (
                  <div className="flex flex-col items-end">
                    <ShieldCheck size={14} className="text-arc-cyan" />
                    <span className="text-[8px] font-mono text-arc-cyan mt-1">PQ-OK</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-end">
                    <ShieldAlert size={14} className="text-stark-gold" />
                    <span className="text-[8px] font-mono text-stark-gold mt-1 animate-pulse">UNVERIFIED</span>
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      {activeContact ? (
        <div className="flex-1 flex flex-col bg-stark-surface border border-arc-cyan/20 shadow-glow-cyan overflow-hidden" style={{clipPath: "polygon(0 5%, 5% 0, 100% 0, 100% 100%, 0 100%)"}}>
          {/* Header */}
          <div className="p-2 md:p-4 border-b border-arc-cyan/20 flex justify-between items-center bg-stark-bg/80 backdrop-blur-md">
            <div className="flex items-center gap-2 md:gap-3">
              <button onClick={() => setActiveContact(null)} className="md:hidden p-2 text-arc-cyan hover:bg-arc-cyan/20 border border-transparent rounded transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <div>
                <div className="font-hud tracking-widest font-bold text-base md:text-lg text-white">{activeContact.name}</div>
                <div className="hidden md:inline-block text-[10px] text-arc-cyan/70 font-mono mt-1 border border-arc-cyan/20 px-1">TARGET: {activeContact.id}</div>
                <div className="hidden md:inline-block text-[10px] text-arc-cyan/50 font-mono ml-2">[HYBRID: ML-KEM + X25519]</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button 
                  onClick={() => setShowVanishMenu(!showVanishMenu)}
                  className={`px-2 py-1 md:px-3 md:py-2 border text-[9px] md:text-[10px] font-mono tracking-widest transition-all ${
                    (vanishModes[activeContact.id] || 0) > 0 
                      ? 'bg-stark-gold/10 border-stark-gold text-stark-gold shadow-glow-gold' 
                      : 'bg-stark-bg border-arc-cyan/30 text-arc-cyan/70 hover:border-arc-cyan'
                  }`}
                >
                  {(vanishModes[activeContact.id] || 0) === 0 ? 'VANISH: OFF' : 
                   (vanishModes[activeContact.id] === 5000) ? 'VANISH: 5s' : 
                   (vanishModes[activeContact.id] === 60000) ? 'VANISH: 1m' : 'VANISH: 1h'}
                </button>
                {showVanishMenu && (
                  <div className="absolute top-full right-0 mt-1 w-32 bg-stark-bg border border-arc-cyan shadow-glow-cyan z-50 flex flex-col">
                    {[
                      { label: 'OFF', value: 0 },
                      { label: '5 SECONDS', value: 5000 },
                      { label: '1 MINUTE', value: 60000 },
                      { label: '1 HOUR', value: 3600000 }
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          const ttl = opt.value;
                          setVanishModes(prev => ({ ...prev, [activeContact.id]: ttl }));
                          if (ws.current?.readyState === WebSocket.OPEN) {
                            ws.current.send(JSON.stringify({ type: 'vanish_mode', from: myId, to: activeContact.id, ttl }));
                          }
                          setShowVanishMenu(false);
                        }}
                        className={`text-left px-3 py-2 text-[10px] font-mono tracking-wider transition-colors ${
                          (vanishModes[activeContact.id] || 0) === opt.value 
                            ? 'bg-arc-cyan text-stark-bg font-bold' 
                            : 'text-arc-cyan hover:bg-arc-cyan/20'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => setShowSafetyNumber(true)} className={`px-2 py-1 md:px-4 md:py-2 rounded-sm border transition-all text-[10px] md:text-xs font-hud tracking-[0.1em] flex items-center gap-1 md:gap-2 ${activeContact.verified ? 'bg-arc-cyan/10 border-arc-cyan text-arc-cyan shadow-glow-cyan' : 'bg-stark-gold/10 border-stark-gold text-stark-gold shadow-glow-gold hover:bg-stark-gold/20'}`}>
                {activeContact.verified ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                <span className="hidden md:inline">{activeContact.verified ? 'LINK SECURED' : 'AUTHENTICATE'}</span>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div 
            className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 flex flex-col gap-4 relative"
            onClick={() => { if (activeReactionSeq) setActiveReactionSeq(null); }}
          >
            {messages.map(m => (
              <SwipeableMessageRow 
                key={m.seq} 
                onReply={() => startReply(m)}
              >
                <div 
                  id={`msg-${m.seq}`}
                  className={`group relative max-w-[85%] md:max-w-[80%] p-3 md:p-4 transition-all duration-300 ${m.fromMe ? 'bg-gradient-to-r from-arc-cyan/15 to-arc-cyan/5 border border-arc-cyan/30 ml-auto rounded-tl-xl rounded-bl-xl rounded-br-xl shadow-[inset_0_0_15px_rgba(0,240,255,0.05)]' : 'bg-stark-card border-l-2 border-slate-500 mr-auto rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-lg'}`}
                >
                  {/* Floating Emoji Picker Popover */}
                  {activeReactionSeq === m.seq && (
                    <div 
                      className={`absolute z-30 -top-11 ${m.fromMe ? 'right-0' : 'left-0'} flex items-center gap-1.5 px-2.5 py-1.5 bg-stark-bg/95 backdrop-blur-md border border-arc-cyan/50 rounded-full shadow-glow-cyan animate-in fade-in zoom-in-95 duration-150`}
                      onClick={e => e.stopPropagation()}
                    >
                      {EMOJI_LIST.map(emoji => {
                        const reacted = m.reactions?.[emoji]?.includes(myId);
                        return (
                          <button
                            key={emoji}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleReaction(m.seq, emoji);
                            }}
                            className={`text-base md:text-lg hover:scale-125 transform transition-transform p-1 rounded-full ${reacted ? 'bg-arc-cyan/30 ring-1 ring-arc-cyan' : 'hover:bg-white/10'}`}
                            title={reacted ? "Remove reaction" : "React"}
                          >
                            {emoji}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Reaction Trigger Button (Smile Icon) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveReactionSeq(activeReactionSeq === m.seq ? null : m.seq);
                    }}
                    className={`absolute -top-3 ${m.fromMe ? 'left-2' : 'right-2'} p-1 rounded-full bg-stark-surface/90 border border-arc-cyan/30 text-arc-cyan/70 hover:text-arc-cyan hover:border-arc-cyan transition-all shadow-sm opacity-60 md:opacity-0 group-hover:opacity-100 ${activeReactionSeq === m.seq ? '!opacity-100' : ''}`}
                    title="Add reaction"
                  >
                    <Smile size={12} />
                  </button>

                  {/* Reply Trigger Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      startReply(m);
                    }}
                    className={`absolute -top-3 ${m.fromMe ? 'left-9' : 'right-9'} p-1 rounded-full bg-stark-surface/90 border border-arc-cyan/30 text-arc-cyan/70 hover:text-arc-cyan hover:border-arc-cyan transition-all shadow-sm opacity-60 md:opacity-0 group-hover:opacity-100`}
                    title="Reply to message"
                  >
                    <CornerUpLeft size={12} />
                  </button>

                {/* Quoted Message Citation */}
                {m.replyTo && (
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      const el = document.getElementById(`msg-${m.replyTo.seq}`);
                      if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.classList.add('ring-2', 'ring-arc-cyan');
                        setTimeout(() => el.classList.remove('ring-2', 'ring-arc-cyan'), 1500);
                      }
                    }}
                    className="mb-2 p-2 bg-black/40 border-l-2 border-arc-cyan/80 rounded-r text-xs font-mono cursor-pointer hover:bg-black/60 transition-colors"
                    title="Click to view original message"
                  >
                    <div className="text-[10px] text-arc-cyan font-bold tracking-wider uppercase flex items-center gap-1">
                      <CornerUpLeft size={10} />
                      <span>{m.replyTo.senderName || 'CONTACT'}</span>
                    </div>
                    <div className="text-gray-300 text-xs truncate max-w-full mt-0.5">
                      {m.replyTo.hasAttachment ? '📎 ' : ''}{m.replyTo.text || '[Encrypted Media]'}
                    </div>
                  </div>
                )}

                {/* Encrypted Attachment Rendering */}
                {m.attachment && (
                  <div className="mb-2.5">
                    {(() => {
                      const media = decryptedMedia[m.attachment.id];
                      if (!media || media.loading) {
                        return (
                          <div className="p-3 bg-stark-surface border border-arc-cyan/30 rounded flex items-center gap-3 animate-pulse">
                            <Loader2 size={16} className="text-arc-cyan animate-spin" />
                            <div className="font-mono text-xs text-arc-cyan/80">
                              [DECRYPTING QUANTUM CIPHERTEXT...]
                            </div>
                          </div>
                        );
                      }
                      if (media.error) {
                        return (
                          <div className="p-2.5 bg-stark-crimson/10 border border-stark-crimson/40 rounded text-stark-crimson font-mono text-xs flex items-center justify-between">
                            <span className="truncate FAILED TO DECRYPT ({media.error})">FAILED TO DECRYPT ({media.error})</span>
                            <button onClick={() => loadAttachment(m.attachment)} className="underline ml-2 uppercase text-[10px]">RETRY</button>
                          </div>
                        );
                      }
                      const isImg = media.mimeType?.startsWith('image/');
                      if (isImg) {
                        return (
                          <div className="relative group overflow-hidden border border-arc-cyan/30 rounded max-w-sm bg-black/40">
                            <img 
                              src={media.objectUrl} 
                              alt={media.fileName}
                              className="w-full max-h-64 object-cover cursor-pointer hover:opacity-95 transition-opacity duration-200 rounded"
                              onClick={() => setLightboxImage(media.objectUrl)}
                            />
                            <div className="p-1.5 bg-stark-bg/90 backdrop-blur-md flex justify-between items-center text-[10px] font-mono text-arc-cyan border-t border-arc-cyan/20">
                              <span className="truncate max-w-[150px]">{media.fileName}</span>
                              <div className="flex items-center gap-2">
                                <span className="opacity-60">{(media.fileSize / 1024).toFixed(1)} KB</span>
                                <button 
                                  onClick={() => setLightboxImage(media.objectUrl)}
                                  className="p-1 hover:text-white transition-colors"
                                  title="Expand"
                                >
                                  <Maximize2 size={12} />
                                </button>
                                <a 
                                  href={media.objectUrl} 
                                  download={media.fileName}
                                  className="p-1 hover:text-white transition-colors"
                                  title="Save locally"
                                >
                                  <Download size={12} />
                                </a>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      // Generic Document / Media Card
                      return (
                        <div className="p-2.5 bg-stark-surface border border-arc-cyan/30 rounded flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 truncate">
                            <FileText size={20} className="text-arc-cyan shrink-0" />
                            <div className="truncate">
                              <div className="font-mono text-xs text-white truncate">{media.fileName}</div>
                              <div className="font-mono text-[10px] text-arc-cyan/60">{(media.fileSize / 1024).toFixed(1)} KB • AES-256-GCM</div>
                            </div>
                          </div>
                          <a 
                            href={media.objectUrl} 
                            download={media.fileName}
                            className="p-1.5 bg-arc-cyan/10 hover:bg-arc-cyan/20 border border-arc-cyan/40 text-arc-cyan hover:shadow-glow-cyan rounded transition-all shrink-0"
                            title="Download decrypted file"
                          >
                            <Download size={14} />
                          </a>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {m.text && <div className={`font-sans leading-relaxed text-sm ${m.fromMe ? 'text-white' : 'text-gray-200'} break-words`}>{m.text}</div>}

                {/* Reaction Pills */}
                {m.reactions && Object.keys(m.reactions).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {Object.entries(m.reactions).map(([emoji, users]) => {
                      if (!users || users.length === 0) return null;
                      const hasMine = users.includes(myId);
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleReaction(m.seq, emoji);
                          }}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono transition-all border ${
                            hasMine 
                              ? 'bg-arc-cyan/20 border-arc-cyan text-arc-cyan shadow-[0_0_8px_rgba(0,240,255,0.25)]' 
                              : 'bg-stark-surface/80 border-slate-700 text-gray-300 hover:border-slate-500'
                          }`}
                          title={`${users.length} reaction${users.length > 1 ? 's' : ''}`}
                        >
                          <span>{emoji}</span>
                          <span className="text-[10px] font-bold">{users.length}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="text-[9px] md:text-[10px] font-mono text-arc-cyan/50 mt-2 flex justify-end items-center gap-2">
                  {m.ttl > 0 && m.status === 'read' && m.readAt && (
                    <span className="text-stark-gold font-bold flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      {Math.max(0, Math.ceil((m.ttl - (Date.now() - m.readAt)) / 1000))}s
                    </span>
                  )}
                  <span className="opacity-50 uppercase">{new Date(m.ts).toLocaleTimeString()}</span>
                  {m.fromMe && (
                    <div className="flex items-center gap-1 font-hud tracking-widest">
                      {m.status === 'read' ? (
                         <><CheckCheck size={12} className="text-[#3b82f6]" /> <span className="text-[#3b82f6]">READ</span></>
                      ) : m.status === 'delivered' ? (
                         <><CheckCheck size={12} className="text-arc-cyan" /> <span className="text-arc-cyan">ROUTED</span></>
                      ) : (
                         <><Check size={12} className="text-arc-cyan/50" /> <span className="text-arc-cyan/50">QUEUED</span></>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </SwipeableMessageRow>
          ))}
            
            {/* Typing Indicator */}
            {typingUsers[activeContact.id] && (
              <div className="bg-stark-card border-l-2 border-arc-cyan/50 mr-auto p-3 rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-lg animate-pulse max-w-[80%]">
                <div className="font-mono text-[10px] text-arc-cyan flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-arc-cyan rounded-full animate-bounce" style={{animationDelay: '0ms'}}/>
                  <span className="w-1.5 h-1.5 bg-arc-cyan rounded-full animate-bounce" style={{animationDelay: '150ms'}}/>
                  <span className="w-1.5 h-1.5 bg-arc-cyan rounded-full animate-bounce" style={{animationDelay: '300ms'}}/>
                  <span className="ml-2 uppercase tracking-widest">TRANSMITTING...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Dock */}
          <div className="p-2 md:p-4 bg-stark-bg/80 backdrop-blur-xl border-t border-arc-cyan/20">
            <input 
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              accept="image/*,video/*,audio/*,application/pdf,text/*"
            />
            <form onSubmit={handleSend} className="flex flex-col gap-2 relative">
              {/* Replying Context Banner */}
              {replyingTo && (
                <div className="flex items-center justify-between p-2 bg-stark-card border-l-2 border-arc-cyan border-y border-r border-arc-cyan/30 text-xs font-mono shadow-glow-cyan animate-in fade-in slide-in-from-bottom-2 duration-150">
                  <div className="flex items-center gap-2 truncate">
                    <CornerUpLeft size={14} className="text-arc-cyan shrink-0" />
                    <div className="truncate">
                      <div className="text-[10px] text-arc-cyan font-bold tracking-wider uppercase">
                        REPLYING TO {replyingTo.senderName || (replyingTo.fromMe ? 'YOURSELF' : 'CONTACT')}
                      </div>
                      <div className="text-gray-300 text-xs truncate max-w-[260px] md:max-w-md">
                        {replyingTo.hasAttachment ? '📎 [ATTACHMENT] ' : ''}{replyingTo.text || 'Encrypted Media'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="text-arc-cyan/60 hover:text-white p-1 hover:bg-white/10 rounded transition-colors"
                    title="Cancel Reply"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Staged Attachment Banner */}
              {stagedAttachment && (
                <div className="flex items-center justify-between p-2 bg-arc-cyan/10 border border-arc-cyan/40 text-xs font-mono text-arc-cyan">
                  <div className="flex items-center gap-2 truncate">
                    {stagedAttachment.isImage ? <Image size={14} /> : <FileText size={14} />}
                    <span className="truncate max-w-[200px]">{stagedAttachment.name}</span>
                    <span className="text-[10px] text-arc-cyan/60">({(stagedAttachment.size / 1024).toFixed(1)} KB)</span>
                    <span className="text-[9px] bg-arc-cyan/20 text-arc-cyan px-1.5 py-0.5 border border-arc-cyan/40 font-hud tracking-wider uppercase">AES-256-GCM READY</span>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setStagedAttachment(null)}
                    className="text-stark-crimson hover:text-white p-1 transition-colors"
                    title="Remove Attachment"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="flex justify-between px-2 text-[9px] md:text-[10px] font-mono text-arc-cyan/50 uppercase">
                <span>TX_CONSOLE</span>
                <span>{((inputText.length + (stagedAttachment ? stagedAttachment.size : 0)) / 1024).toFixed(2)} KB / 15.00 MB MAX</span>
              </div>
              <div className="flex gap-2">
                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAttachment}
                  className="bg-arc-cyan/10 hover:bg-arc-cyan/20 border border-arc-cyan/30 disabled:opacity-50 p-2 md:p-3 text-arc-cyan flex items-center justify-center transition-all duration-200 hover:shadow-glow-cyan"
                  title="Encrypt & Attach Media"
                >
                  {uploadingAttachment ? <Loader2 size={16} className="animate-spin text-stark-gold" /> : <Paperclip size={16} />}
                </button>
                <input 
                  ref={inputRef}
                  value={inputText}
                  onChange={e => {
                    setInputText(e.target.value);
                    if (ws.current?.readyState === WebSocket.OPEN && activeContact) {
                      // Throttle typing indicators
                      if (!window.lastTypingTime || Date.now() - window.lastTypingTime > 1500) {
                        window.lastTypingTime = Date.now();
                        ws.current.send(JSON.stringify({ type: 'typing', from: myId, to: activeContact.id }));
                      }
                    }
                  }}
                  className="flex-1 bg-stark-surface border border-arc-cyan/30 p-2 md:p-3 font-mono text-xs text-arc-cyan placeholder:text-arc-cyan/30 focus:outline-none focus:border-arc-cyan focus:ring-1 focus:ring-arc-cyan/50 transition-all"
                  placeholder={uploadingAttachment ? "Encrypting & uploading attachment..." : "> Enter transmission or attach file..."}
                  maxLength={8000}
                />
                <button 
                  type="submit" 
                  disabled={(!inputText.trim() && !stagedAttachment) || uploadingAttachment} 
                  className="group bg-arc-cyan/10 hover:bg-arc-cyan/20 border border-arc-cyan disabled:opacity-50 p-2 md:p-3 text-arc-cyan flex items-center justify-center w-12 md:w-14 transition-all duration-200 hover:shadow-glow-cyan"
                >
                  {uploadingAttachment ? <Loader2 size={16} className="animate-spin text-stark-gold" /> : <Send size={16} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 flex-col items-center justify-center text-arc-cyan/30 border border-arc-cyan/10 bg-stark-surface" style={{clipPath: "polygon(0 5%, 5% 0, 100% 0, 100% 100%, 0 100%)"}}>
          <ShieldCheck size={48} className="mb-4 opacity-20" />
          <div className="font-hud tracking-[0.3em] text-sm">NO ACTIVE UPLINK</div>
          <div className="font-mono text-[10px] mt-2 opacity-50">Select target node to establish quantum relay</div>
        </div>
      )}

      {showAddContact && (
        <AddContactModal 
          myId={myId} 
          keys={keys}
          onClose={() => setShowAddContact(false)}
          onAdd={async (contact) => {
            await saveContact(contact);
            await loadContacts();
            setShowAddContact(false);
          }}
        />
      )}
      
      {showSafetyNumber && activeContact && (
        <SafetyNumberModal
          myId={myId}
          myKeys={keys}
          contact={activeContact}
          onClose={() => setShowSafetyNumber(false)}
          onVerify={async (verified) => {
            const updated = { ...activeContact, verified };
            await saveContact(updated);
            setActiveContact(updated);
            await loadContacts();
          }}
        />
      )}

      {/* Decrypted Media Lightbox Modal */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] border border-arc-cyan/40 p-2 bg-stark-surface shadow-glow-cyan flex flex-col items-end gap-2" onClick={e => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center text-xs font-hud tracking-widest text-arc-cyan border-b border-arc-cyan/20 pb-2">
              <span>PROJECT VEIL // DECRYPTED TRANSMISSION</span>
              <button 
                onClick={() => setLightboxImage(null)}
                className="text-arc-cyan hover:text-stark-crimson p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <img src={lightboxImage} alt="Decrypted transmission" className="max-h-[75vh] max-w-full object-contain rounded" />
            <div className="w-full flex justify-between items-center text-[10px] font-mono text-arc-cyan/60 pt-2">
              <span>ORIGIN: IN-MEMORY RAM DECRYPTION</span>
              <a 
                href={lightboxImage} 
                download="veil_transmission.jpg"
                className="flex items-center gap-1 text-arc-cyan hover:underline"
              >
                <Download size={12} /> SAVE TO DISK
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
