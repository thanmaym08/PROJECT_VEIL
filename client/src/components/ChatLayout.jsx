import { useState, useEffect, useRef } from 'react';
import { getContacts, saveContact, saveMessage, getMessages, updateMessageStatus, deleteMessage, getLocalPreKeys, saveLocalPreKeys } from '../storage/db';
import { generatePreKeyBundle, generateOneTimePreKeys, verifyPreKeyBundle } from '../crypto/prekeys';
import { UserPlus, ShieldAlert, ShieldCheck, Send, Check, CheckCheck } from 'lucide-react';
import AddContactModal from './AddContactModal';
import SafetyNumberModal from './SafetyNumberModal';
import { computeInitiatorSession, computeReceiverSession } from '../crypto/handshake';
import { DoubleRatchet } from '../crypto/ratchet';
import { base64ToBytes } from '../crypto/utils';
import { Capacitor } from '@capacitor/core';

export default function ChatLayout({ keys, myId }) {
  const [contacts, setContacts] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [showAddContact, setShowAddContact] = useState(false);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [inputText, setInputText] = useState('');
  
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

  useEffect(() => {
    loadContacts();
    connectWs();
    return () => { if (ws.current) ws.current.close(); };
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

  const getWsUrl = () => {
    try {
      const saved = localStorage.getItem('veil_relay_url');
      if (saved) return saved;
    } catch {}

    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      const relayParam = params.get('relay');
      if (relayParam) return relayParam;
    }

    if (Capacitor.isNativePlatform()) {
      return 'ws://10.0.2.2:8080';
    }

    if (typeof window !== 'undefined' && window.location) {
      const { hostname, protocol, host } = window.location;
      if (hostname.includes('trycloudflare.com')) {
        return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/ws`;
      }
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'ws://localhost:8080';
      }
      return `ws://${hostname}:8080`;
    }

    return 'ws://localhost:8080';
  };

  const connectWs = async (urlOverride = null) => {
    let wsUrl = urlOverride || getWsUrl();
    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    socket.onopen = async () => {
      if (ws.current !== socket) return;
      setWsStatus('connected');

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
      if (!urlOverride && Capacitor.isNativePlatform() && wsUrl === 'ws://10.0.2.2:8080') {
        console.log('[VEIL] Emulator loopback failed, trying WiFi IP fallback...');
        setTimeout(() => connectWs('ws://10.136.97.31:8080'), 1000);
        return;
      }
      setTimeout(() => {
        if (ws.current === socket || !ws.current || ws.current.readyState === WebSocket.CLOSED) {
          connectWs(urlOverride);
        }
      }, 3000);
    };

    socket.onerror = (e) => {
      console.warn("WebSocket error:", e);
    };

    socket.onmessage = async (e) => {
      if (ws.current !== socket) return;
      const data = JSON.parse(e.data);
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
      try {
        const payload = JSON.parse(decrypted);
        if (payload.text) text = payload.text;
        if (payload.deliveryToken) contactToken = payload.deliveryToken;
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
    e.preventDefault();
    if (!inputText.trim() || !activeContact) return;

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
      
      // Include delivery token in plaintext payload so contact can reply blindly
      const innerPayload = JSON.stringify({
         text: inputText,
         deliveryToken: keys.profile.deliveryTokenB64
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
      
      const msgObj = { contactId: activeContact.id, fromMe: true, text: inputText, ts, seq, status: 'sending', ttl };
      await saveMessage(msgObj);
      setMessages(prev => [...prev, msgObj]);
      setInputText('');
    } catch (err) {
      alert("Encryption or Socket Error: " + err.message);
      console.error(err);
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
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 flex flex-col gap-4 relative">
            {messages.map(m => (
              <div key={m.seq} className={`max-w-[85%] md:max-w-[80%] p-3 md:p-4 ${m.fromMe ? 'bg-gradient-to-r from-arc-cyan/15 to-arc-cyan/5 border border-arc-cyan/30 ml-auto rounded-tl-xl rounded-bl-xl rounded-br-xl shadow-[inset_0_0_15px_rgba(0,240,255,0.05)]' : 'bg-stark-card border-l-2 border-slate-500 mr-auto rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-lg'}`}>
                <div className={`font-sans leading-relaxed text-sm ${m.fromMe ? 'text-white' : 'text-gray-200'} break-words`}>{m.text}</div>
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
            <form onSubmit={handleSend} className="flex flex-col gap-2 relative">
              <div className="flex justify-between px-2 text-[9px] md:text-[10px] font-mono text-arc-cyan/50 uppercase">
                <span>TX_CONSOLE</span>
                <span>{(inputText.length / 1024).toFixed(2)} KB / 8.00 KB</span>
              </div>
              <div className="flex gap-2">
                <input 
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
                  placeholder="> Enter transmission..."
                  maxLength={8000}
                />
                <button type="submit" disabled={!inputText.trim()} className="group bg-arc-cyan/10 hover:bg-arc-cyan/20 border border-arc-cyan disabled:opacity-50 p-2 md:p-3 text-arc-cyan flex items-center justify-center w-12 md:w-14 transition-all duration-200 hover:shadow-glow-cyan">
                  <Send size={16} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
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
    </div>
  );
}
