import { useState, useEffect, useRef } from 'react';
import { getContacts, saveContact, saveMessage, getMessages } from '../storage/db';
import { UserPlus, Settings, ShieldAlert, ShieldCheck, Send, Check, CheckCheck } from 'lucide-react';
import AddContactModal from './AddContactModal';
import SafetyNumberModal from './SafetyNumberModal';
import { computeInitiatorSession, computeReceiverSession } from '../crypto/handshake';
import { encryptMessage, decryptMessage, ReplayWindow } from '../crypto/cipher';
import { bytesToBase64 } from '../crypto/utils';
import { Capacitor } from '@capacitor/core';

export default function ChatLayout({ keys, myId }) {
  const [contacts, setContacts] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [showAddContact, setShowAddContact] = useState(false);
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [inputText, setInputText] = useState('');
  
  const ws = useRef(null);
  const sessionKeys = useRef({}); // contactId -> sessionKey
  const messagesEndRef = useRef(null);

  useEffect(() => {
    loadContacts();
    connectWs();
    return () => { if (ws.current) ws.current.close(); };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (activeContact) {
      getMessages(activeContact.id).then(setMessages);
    }
  }, [activeContact]);

  const loadContacts = async () => {
    const c = await getContacts();
    setContacts(c);
  };

  const connectWs = () => {
    // Android Emulator uses 10.0.2.2 to point to the host machine's localhost
    const wsUrl = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' 
      ? 'ws://10.0.2.2:8080' 
      : 'ws://localhost:8080';
      
    ws.current = new WebSocket(wsUrl);
    ws.current.onopen = async () => {
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
            // Remove listeners so they don't stack on reconnect
            await PushNotifications.removeAllListeners();
          }
        } catch (e) {
          console.error("Push Error", e);
        }
      }

      ws.current.send(JSON.stringify({
        type: 'register',
        cipherId: myId,
        mlkemPub: keys.mlkem.publicKeyB64,
        x25519Pub: keys.x25519.publicKeyB64,
        fcmToken
      }));
    };
    ws.current.onclose = () => {
      setWsStatus('disconnected');
      setTimeout(connectWs, 5000);
    };
    ws.current.onmessage = async (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'msg') {
        handleIncomingMessage(data);
      } else if (data.type === 'ack') {
        // Update message status
        setMessages(prev => prev.map(m => m.seq === data.seq ? { ...m, status: data.status } : m));
      } else if (data.type === 'lookup_res') {
        if (data.found && data.target) { // We passed target in request? Not in server.js. We need to handle lookup differently or add contact manually.
          // For simplicity, we add contacts manually.
        }
      }
    };
  };

  const handleIncomingMessage = async (data) => {
    const contact = contacts.find(c => c.id === data.from);
    if (!contact) return; // Drop messages from unknown contacts for now

    try {
      let sessionKey = sessionKeys.current[data.from];
      if (!sessionKey && data.ekpub && data.kemct) {
        // We are receiver, establish session
        const sess = computeReceiverSession(
          data.kemct, data.ekpub, 
          keys.mlkem.secretKeyB64, keys.x25519.secretKeyB64, 
          data.from, myId
        );
        sessionKey = sess.sessionKey;
        sessionKeys.current[data.from] = sessionKey;
      }
      
      if (!sessionKey) throw new Error("No session key");

      const decrypted = await decryptMessage(sessionKey, data.iv, data.ct, data.from, myId, data.seq, data.ts);
      
      const msgObj = {
        contactId: data.from,
        fromMe: false,
        text: decrypted,
        ts: data.ts,
        seq: data.seq
      };
      await saveMessage(msgObj);
      
      if (activeContact && activeContact.id === data.from) {
        setMessages(prev => [...prev, msgObj]);
      }
    } catch (e) {
      console.error("Message decryption failed");
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeContact) return;

    let sessionKey = sessionKeys.current[activeContact.id];
    let ekpub = undefined, kemct = undefined;

    if (!sessionKey) {
      const sess = computeInitiatorSession(
        activeContact.mlkemPub, activeContact.x25519Pub,
        myId, activeContact.id
      );
      sessionKey = sess.sessionKey;
      sessionKeys.current[activeContact.id] = sessionKey;
      ekpub = sess.ephemeralX25519PubB64;
      kemct = sess.kemCiphertextB64;
    }

    const seq = Date.now(); // simple seq generator
    const ts = Date.now();
    
    // Pad to 8KB (optional, skipping for simple UI)
    const { ivB64, ciphertextB64 } = await encryptMessage(sessionKey, inputText, myId, activeContact.id, seq, ts);

    const envelope = {
      v: 1, type: 'msg',
      from: myId, to: activeContact.id,
      seq, ts, iv: ivB64, ct: ciphertextB64
    };
    
    if (ekpub && kemct) {
      envelope.ekpub = ekpub;
      envelope.kemct = kemct;
    }

    ws.current.send(JSON.stringify(envelope));
    
    const msgObj = { contactId: activeContact.id, fromMe: true, text: inputText, ts, seq, status: 'sending' };
    await saveMessage(msgObj);
    setMessages(prev => [...prev, msgObj]);
    setInputText('');
  };

  return (
    <div className="flex-1 flex overflow-hidden p-2 md:p-4 gap-4">
      {/* Sidebar */}
      <div className={`w-full md:w-80 bg-stark-surface border border-arc-cyan/20 flex-col shadow-glow-cyan ${activeContact ? 'hidden md:flex' : 'flex'}`} style={{clipPath: "polygon(0 0, 100% 0, 100% 100%, 5% 100%, 0 95%)"}}>
        <div className="p-4 border-b border-arc-cyan/20 flex justify-between items-center bg-arc-cyan/5">
          <div>
            <h2 className="font-hud font-bold tracking-[0.2em] text-arc-cyan text-lg md:text-xl">PROJECT VEIL // QUANTUM RELAY</h2>
            <div className="text-xs text-arc-cyan/70 font-mono flex items-center gap-2 mt-1">
              <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-arc-cyan animate-pulse shadow-glow-cyan' : 'bg-stark-crimson shadow-glow-crimson'}`} />
              STATUS: {wsStatus === 'connected' ? 'ENCRYPTED (ML-KEM-768)' : 'OFFLINE'}
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
            <button onClick={() => setShowSafetyNumber(true)} className={`px-2 py-1 md:px-4 md:py-2 rounded-sm border transition-all text-[10px] md:text-xs font-hud tracking-[0.1em] flex items-center gap-1 md:gap-2 ${activeContact.verified ? 'bg-arc-cyan/10 border-arc-cyan text-arc-cyan shadow-glow-cyan' : 'bg-stark-gold/10 border-stark-gold text-stark-gold shadow-glow-gold hover:bg-stark-gold/20'}`}>
              {activeContact.verified ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
              <span className="hidden md:inline">{activeContact.verified ? 'LINK SECURED' : 'AUTHENTICATE'}</span>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 flex flex-col gap-4 relative">
            {messages.map(m => (
              <div key={m.seq} className={`max-w-[85%] md:max-w-[80%] p-3 md:p-4 ${m.fromMe ? 'bg-gradient-to-r from-arc-cyan/15 to-arc-cyan/5 border border-arc-cyan/30 ml-auto rounded-tl-xl rounded-bl-xl rounded-br-xl shadow-[inset_0_0_15px_rgba(0,240,255,0.05)]' : 'bg-stark-card border-l-2 border-slate-500 mr-auto rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-lg'}`}>
                <div className={`font-sans leading-relaxed text-sm ${m.fromMe ? 'text-white' : 'text-gray-200'} break-words`}>{m.text}</div>
                <div className="text-[9px] md:text-[10px] font-mono text-arc-cyan/50 mt-2 flex justify-end items-center gap-2">
                  <span className="opacity-50 uppercase">{new Date(m.ts).toLocaleTimeString()}</span>
                  {m.fromMe && (
                    <div className="flex items-center gap-1 font-hud tracking-widest text-arc-cyan">
                      {m.status === 'delivered' ? (
                         <><CheckCheck size={12} /> ROUTED</>
                      ) : (
                         <><Check size={12} className="opacity-50" /> QUEUED</>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
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
                  onChange={e => setInputText(e.target.value)}
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
