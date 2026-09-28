import { useState, useEffect, useRef } from 'react';
import { getContacts, saveContact, saveMessage, getMessages, updateMessageStatus, updateMessageReactions, deleteMessage, getLocalPreKeys, saveLocalPreKeys, getGroups, saveGroup, deleteGroup, getGroup } from '../storage/db';
import { generatePreKeyBundle, generateOneTimePreKeys, verifyPreKeyBundle } from '../crypto/prekeys';
import { UserPlus, ShieldAlert, ShieldCheck, Send, Check, CheckCheck, Paperclip, Image, FileText, Download, X, Maximize2, Loader2, Smile, CornerUpLeft, Users, Link, Share2, Plus, MessageSquare, Info, LogOut, Mic, MicOff, Square, Play, Pause, Search, Trash2, Flame, Lock, Zap, Radio } from 'lucide-react';
import AddContactModal from './AddContactModal';
import SafetyNumberModal from './SafetyNumberModal';
import CreateGroupModal from './CreateGroupModal';
import GroupInfoModal from './GroupInfoModal';
import JoinGroupModal from './JoinGroupModal';
import EmojiGifPicker from './EmojiGifPicker';
import VoiceMemoPlayer from './VoiceMemoPlayer';
import PanicModal from './PanicModal';
import { computeInitiatorSession, computeReceiverSession } from '../crypto/handshake';
import { DoubleRatchet } from '../crypto/ratchet';
import { base64ToBytes, bytesToBase64, utf8ToBytes } from '../crypto/utils';
import { ed25519 } from '@noble/curves/ed25519.js';
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

export default function ChatLayout({ keys, myId, onLock, onPanicWipe }) {
  const [appMode, setAppMode] = useState(() => localStorage.getItem('veil_app_mode') || 'flow');
  const toggleAppMode = (mode) => {
    const next = mode || (appMode === 'flow' ? 'bunker' : 'flow');
    setAppMode(next);
    localStorage.setItem('veil_app_mode', next);
  };

  const [contacts, setContacts] = useState([]);
  const [activeContact, setActiveContact] = useState(null);
  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'direct' | 'groups'
  const [messages, setMessages] = useState([]);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [showAddContact, setShowAddContact] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [incomingInvite, setIncomingInvite] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const toastTimeoutRef = useRef(null);

  const [sidebarFilter, setSidebarFilter] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showPanicModal, setShowPanicModal] = useState(false);

  // Audio / Voice Note recording state
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3000);
  };

  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [inputText, setInputText] = useState('');
  
  // Media & Attachment State
  const [stagedAttachment, setStagedAttachment] = useState(null); // { file, name, size, isImage, previewUrl }
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [decryptedMedia, setDecryptedMedia] = useState({}); // id -> { loading, objectUrl, error, fileName, fileSize, mimeType }
  const [lightboxImage, setLightboxImage] = useState(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  const handleSendVoiceNote = async (audioBlob) => {
    if (!activeContact && !activeGroup) return;
    setUploadingAttachment(true);
    try {
      const fileName = `voice_note_${Date.now()}.webm`;
      const file = new File([audioBlob], fileName, { type: audioBlob.type || 'audio/webm' });
      const encrypted = await encryptAttachment(file);
      const apiBase = getApiBaseUrl();
      const attachmentId = await uploadEncryptedAttachment(apiBase, encrypted.ciphertextBuffer);
      const audioUrl = URL.createObjectURL(audioBlob);

      const attachmentMetadata = {
        id: attachmentId,
        key: encrypted.keyB64,
        iv: encrypted.ivB64,
        fileName: encrypted.fileName,
        fileSize: encrypted.fileSize,
        mimeType: encrypted.mimeType,
        isVoiceMemo: true
      };

      setDecryptedMedia(prev => ({
        ...prev,
        [attachmentId]: {
          loading: false,
          objectUrl: audioUrl,
          fileName: encrypted.fileName,
          fileSize: encrypted.fileSize,
          mimeType: encrypted.mimeType,
          isVoiceMemo: true
        }
      }));

      await sendEncryptedPayload('', attachmentMetadata);
      showToast("Voice memo encrypted & transmitted!");
    } catch (err) {
      console.error("[VEIL] Failed to send voice memo:", err);
      showToast("Voice memo transmission failed");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const startAudioRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        showToast("Audio recording not supported in this browser");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm'))
        ? 'audio/webm' 
        : ((typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4')) ? 'audio/mp4' : '');
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecordingAudio(true);
      setAudioDuration(0);

      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setAudioDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("[AUDIO] Microphone access denied or error:", err);
      showToast("Microphone permission denied");
    }
  };

  const cancelAudioRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    audioChunksRef.current = [];
    setIsRecordingAudio(false);
    setAudioDuration(0);
  };

  const finishAndSendAudioRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (!mediaRecorderRef.current) return;

    const recorder = mediaRecorderRef.current;
    recorder.onstop = () => {
      const mime = recorder.mimeType || 'audio/webm';
      const blob = new Blob(audioChunksRef.current, { type: mime });
      audioChunksRef.current = [];
      setIsRecordingAudio(false);
      setAudioDuration(0);
      if (blob.size > 0) {
        handleSendVoiceNote(blob);
      }
    };

    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  };

  // Emoji Reaction State
  const [activeReactionSeq, setActiveReactionSeq] = useState(null);
  const [showInputEmojiPicker, setShowInputEmojiPicker] = useState(false);
  const [reactionEmojiPickerSeq, setReactionEmojiPickerSeq] = useState(null);

  // Message Quoting / Replying State
  const [replyingTo, setReplyingTo] = useState(null); // { seq, senderId, senderName, text, hasAttachment }

  const startReply = (m) => {
    let targetId = m.fromMe ? myId : (m.senderId || activeContact?.id || activeGroup?.id);
    let targetName = m.fromMe ? 'YOU' : (m.senderName || activeContact?.name || activeGroup?.name || 'Member');
    setReplyingTo({
      seq: m.seq,
      senderId: targetId,
      senderName: targetName,
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
  const groupsRef = useRef([]);
  const activeGroupRef = useRef(null);
  const pendingBundleRequests = useRef({});
  const serverIdentityPubRef = useRef(null);
  const mySenderCertRef = useRef(null);

  // Mobile Resilience refs
  const reconnectAttemptRef = useRef(0);
  const pingIntervalRef = useRef(null);
  const pingTimeoutRef = useRef(null);

  // Per-Peer Concurrency Lock to eliminate Double Ratchet race conditions
  const peerLocks = useRef(new Map());
  const withPeerLock = (peerId, fn) => {
    if (!peerId) return fn();
    const currentLock = peerLocks.current.get(peerId) || Promise.resolve();
    const nextLock = currentLock.then(() => fn()).catch((err) => {
      console.error(`[VEIL] Mutex error for peer ${peerId}:`, err);
      throw err;
    });
    peerLocks.current.set(peerId, nextLock.catch(() => {}));
    return nextLock;
  };

  // RAM Media Cleanup to prevent memory bloat
  const cleanupDecryptedMedia = () => {
    setDecryptedMedia(prev => {
      Object.values(prev).forEach(item => {
        if (item?.objectUrl) {
          revokeAttachmentUrl(item.objectUrl);
        }
      });
      return {};
    });
  };

  useEffect(() => {
    return () => {
      cleanupDecryptedMedia();
    };
  }, []);

  useEffect(() => {
    loadContacts();
    loadGroups();
    connectWs();

    // Check URL for ?joinGroup=...
    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      const joinPayload = params.get('joinGroup');
      if (joinPayload) {
        try {
          const decoded = JSON.parse(decodeURIComponent(escape(atob(joinPayload))));
          if (decoded && decoded.id && decoded.name) {
            setIncomingInvite(decoded);
          }
        } catch (err) {
          console.warn("[VEIL] Failed to decode group invite:", err);
        }
      }
    }

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
    cleanupDecryptedMedia();
    if (activeContact) {
      activeGroupRef.current = null;
      setActiveGroup(null);
      getMessages(activeContact.id).then(setMessages);
    }
  }, [activeContact]);

  useEffect(() => {
    activeGroupRef.current = activeGroup;
    cleanupDecryptedMedia();
    if (activeGroup) {
      activeContactRef.current = null;
      setActiveContact(null);
      getMessages(activeGroup.id).then(setMessages);
    }
  }, [activeGroup]);

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
              const activeId = activeContactRef.current?.id || activeGroupRef.current?.id;
              if (activeId) deleteMessage(activeId, m.seq).catch(()=>{});
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

  const loadGroups = async () => {
    try {
      const g = await getGroups();
      groupsRef.current = g;
      setGroups(g);
    } catch (e) {
      console.error("Failed to load groups:", e);
    }
  };

  const ensureGroupExists = async (groupId, groupName, senderId, senderName) => {
    if (!groupsRef.current.some(g => g.id === groupId)) {
      const myDisplayName = localStorage.getItem('veil_my_name') || `Agent-${myId.slice(0, 4)}`;
      const newGroup = {
        id: groupId,
        name: groupName || 'Encrypted Group',
        members: [
          { id: myId, name: myDisplayName, role: 'member' },
          { id: senderId, name: senderName || 'Member', role: 'member' }
        ],
        createdBy: senderId,
        createdAt: Date.now()
      };
      await saveGroup(newGroup);
      const updated = await getGroups();
      groupsRef.current = updated;
      setGroups(updated);
    }
  };

  const encryptAndSendToPeer = (targetContact, payloadData, ttl = 0) => {
    return withPeerLock(targetContact.id, async () => {
      const peerId = targetContact.id;
      let ratchet = sessionKeys.current[peerId];
      let ekpub = undefined, kemct = undefined, opkId = undefined;

      if (!ratchet) {
        const bundle = await new Promise((resolve) => {
          if (pendingBundleRequests.current[peerId]) {
            const existing = pendingBundleRequests.current[peerId];
            pendingBundleRequests.current[peerId] = (b) => {
              existing(b);
              resolve(b);
            };
          } else {
            pendingBundleRequests.current[peerId] = resolve;
            if (ws.current?.readyState === WebSocket.OPEN) {
              ws.current.send(JSON.stringify({ type: 'get_prekeys', targetCipherId: peerId }));
            } else {
              resolve(null);
            }
          }
          setTimeout(() => {
            if (pendingBundleRequests.current[peerId]) {
              delete pendingBundleRequests.current[peerId];
              resolve(null);
            }
          }, 5000);
        });

        if (!bundle) throw new Error(`Could not fetch prekeys for peer ${peerId.slice(0, 8)}`);

        if (!sessionKeys.current[peerId]) {
          const idPub = targetContact.ed25519Pub || bundle.identity?.identityEd25519Pub;
          if (idPub) {
            try {
              verifyPreKeyBundle(bundle, idPub);
            } catch (verr) {
              console.warn("[VEIL] PreKey bundle signature check:", verr.message);
            }
          }
          const sess = computeInitiatorSession(bundle, keys.x25519.secretKeyB64, myId, peerId);
          const theirPub = base64ToBytes(bundle.signedPreKey.pub);
          ratchet = new DoubleRatchet(sess.sessionKey, true, theirPub);
          ratchet.ekpub = sess.ephemeralX25519PubB64;
          ratchet.kemct = sess.kemCiphertextB64;
          ratchet.opkId = sess.opkId;
          sessionKeys.current[peerId] = ratchet;
        } else {
          ratchet = sessionKeys.current[peerId];
        }
      }

      if (ratchet.ekpub && ratchet.kemct) {
        ekpub = ratchet.ekpub;
        kemct = ratchet.kemct;
        opkId = ratchet.opkId;
        delete ratchet.ekpub;
        delete ratchet.kemct;
        delete ratchet.opkId;
      }

      const seq = Date.now() + Math.floor(Math.random() * 1000);
      const ts = Date.now();

      const innerPayloadStr = typeof payloadData === 'string' ? payloadData : JSON.stringify(payloadData);
      const { header, iv, ct } = await ratchet.encryptMessage(innerPayloadStr);

      const { saveRatchetState } = await import('../crypto/keyStorage.js');
      await saveRatchetState(peerId, ratchet.serialize());

      const myDisplayName = localStorage.getItem('veil_my_name') || `Agent-${myId.slice(0, 4)}`;

      const envelope = {
        v: 1,
        type: 'msg',
        from: myId,
        to: peerId,
        seq,
        ts,
        iv,
        ct,
        rh: header,
        ttl: ttl || 0,
        senderX25519Pub: keys.x25519.publicKeyB64,
        senderEd25519Pub: keys.ed25519.publicKeyB64,
        senderName: myDisplayName
      };

      if (ekpub && kemct) {
        envelope.ekpub = ekpub;
        envelope.kemct = kemct;
        if (opkId) envelope.opkId = opkId;
      }

      let finalPayload = envelope;
      if (targetContact.deliveryToken && mySenderCertRef.current) {
        const { sealMessage } = await import('../crypto/sealedSender.js');
        delete envelope.from;
        const sealedEnvelope = await sealMessage(
          targetContact.x25519Pub,
          mySenderCertRef.current,
          JSON.stringify(envelope)
        );
        finalPayload = {
          type: 'sealed_msg',
          to: peerId,
          ephemeralPublicKey: sealedEnvelope.ephemeralPublicKey,
          envelopeCiphertext: sealedEnvelope.envelopeCiphertext,
          mac: sealedEnvelope.mac,
          iv: sealedEnvelope.iv,
          deliveryToken: targetContact.deliveryToken
        };
      }

      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify(finalPayload));
      } else {
        const { saveToOutbox } = await import('../storage/db.js');
        await saveToOutbox(finalPayload);
      }

      return { seq, ts };
    });
  };

  const handleCreateGroup = async (groupName, selectedMembers) => {
    const groupId = 'group-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now();
    const myDisplayName = localStorage.getItem('veil_my_name') || `Agent-${myId.slice(0, 4)}`;
    const newGroup = {
      id: groupId,
      name: groupName,
      createdBy: myId,
      createdAt: Date.now(),
      members: [
        { id: myId, name: myDisplayName, role: 'admin' },
        ...selectedMembers
      ]
    };

    await saveGroup(newGroup);
    const updated = await getGroups();
    groupsRef.current = updated;
    setGroups(updated);
    setShowCreateGroup(false);

    // Notify selected members
    const initPayload = {
      type: 'group_event',
      action: 'create',
      groupId,
      groupName,
      members: newGroup.members,
      senderId: myId,
      senderName: myDisplayName,
      text: `Created group "${groupName}"`
    };

    for (const member of selectedMembers) {
      try {
        const target = contacts.find(c => c.id === member.id) || member;
        await encryptAndSendToPeer(target, initPayload, 0);
      } catch (err) {
        console.warn(`[VEIL] Initial group notify failed to ${member.name}:`, err);
      }
    }

    setActiveContact(null);
    setActiveGroup(newGroup);
    showToast(`Encrypted group "${groupName}" created!`);
  };

  const handleAddMembersToGroup = async (groupId, newMembers) => {
    const group = await getGroup(groupId);
    if (!group) return;

    const existingIds = new Set((group.members || []).map(m => m.id));
    const merged = [...(group.members || [])];
    newMembers.forEach(m => {
      if (!existingIds.has(m.id)) merged.push(m);
    });

    const updatedGroup = { ...group, members: merged };
    await saveGroup(updatedGroup);
    const allGroups = await getGroups();
    groupsRef.current = allGroups;
    setGroups(allGroups);
    if (activeGroup?.id === groupId) setActiveGroup(updatedGroup);

    const myDisplayName = localStorage.getItem('veil_my_name') || `Agent-${myId.slice(0, 4)}`;
    const eventPayload = {
      type: 'group_event',
      action: 'add_members',
      groupId,
      groupName: group.name,
      members: merged,
      senderId: myId,
      senderName: myDisplayName,
      text: `Added ${newMembers.map(m => m.name).join(', ')} to the group`
    };

    for (const member of merged.filter(m => m.id !== myId)) {
      try {
        const target = contacts.find(c => c.id === member.id) || member;
        await encryptAndSendToPeer(target, eventPayload, 0);
      } catch (e) {}
    }

    showToast(`Added ${newMembers.length} friend${newMembers.length > 1 ? 's' : ''} to group!`);
  };

  const handleAddFriendFromGroup = async (member) => {
    if (!member || !member.id || member.id === myId) return;
    const newContact = {
      id: member.id,
      name: member.name || `Agent-${member.id.slice(0, 4)}`,
      verified: true,
      addedAt: Date.now()
    };
    await saveContact(newContact);
    const updated = await getContacts();
    contactsRef.current = updated;
    setContacts(updated);
    showToast(`Added ${newContact.name} to friends list!`);
  };

  const handleLeaveGroup = async (groupId) => {
    await deleteGroup(groupId);
    const allGroups = await getGroups();
    groupsRef.current = allGroups;
    setGroups(allGroups);
    if (activeGroup?.id === groupId) {
      setActiveGroup(null);
      setMessages([]);
    }
    showToast(`Left and removed group channel.`);
  };

  const handleConfirmJoinGroup = async () => {
    if (!incomingInvite) return;
    const existing = groups.find(g => g.id === incomingInvite.id);
    let targetGroup = existing;
    if (!existing) {
      const myDisplayName = localStorage.getItem('veil_my_name') || `Agent-${myId.slice(0, 4)}`;
      targetGroup = {
        id: incomingInvite.id,
        name: incomingInvite.name,
        createdBy: incomingInvite.createdBy || incomingInvite.inviterId || 'unknown',
        members: [
          { id: myId, name: myDisplayName, role: 'member' },
          ...(incomingInvite.inviterId ? [{ id: incomingInvite.inviterId, name: incomingInvite.inviterName || 'Inviter', role: 'admin' }] : [])
        ],
        createdAt: Date.now()
      };
      await saveGroup(targetGroup);
      const updated = await getGroups();
      groupsRef.current = updated;
      setGroups(updated);
    }
    
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
    }

    setIncomingInvite(null);
    setActiveContact(null);
    setActiveGroup(targetGroup);
    showToast(`Joined group "${targetGroup.name}"!`);
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
      showToast(`Attachment exceeds 15MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB)`);
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
        const timestamp = Date.now();
        const popMessage = utf8ToBytes(`VEIL-REGISTER:${myId}:${timestamp}`);
        const registrationSig = bytesToBase64(ed25519.sign(popMessage, base64ToBytes(keys.ed25519.secretKeyB64)));

        socket.send(JSON.stringify({
          type: 'register',
          cipherId: myId,
          mlkemPub: keys.mlkem.publicKeyB64,
          x25519Pub: keys.x25519.publicKeyB64,
          ed25519Pub: keys.ed25519.publicKeyB64,
          deliveryToken: keys.profile.deliveryTokenB64,
          fcmToken,
          bundle,
          registrationSig,
          timestamp
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

      await withPeerLock(senderId, async () => {
        const contact = contactsRef.current.find(c => c.id === senderId);

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
              localPreKeys.oneTimePreKeys.splice(opkIndex, 1);
              saveLocalPreKeys(localPreKeys).catch(() => {});
            }
          }

          let senderX25519Pub = contact?.x25519Pub || msgData.senderX25519Pub;
          if (!senderX25519Pub) {
            // Fetch prekeys from server as fallback
            const bundle = await new Promise(resolve => {
              pendingBundleRequests.current[senderId] = resolve;
              if (ws.current?.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify({ type: 'get_prekeys', targetCipherId: senderId }));
              } else {
                resolve(null);
              }
              setTimeout(() => {
                if (pendingBundleRequests.current[senderId]) {
                  delete pendingBundleRequests.current[senderId];
                  resolve(null);
                }
              }, 4000);
            });
            if (bundle?.identity?.identityX25519Pub) {
              senderX25519Pub = bundle.identity.identityX25519Pub;
            }
          }

          if (!senderX25519Pub) throw new Error("Missing sender public key for session handshake");

          const sess = computeReceiverSession(
            msgData.ekpub, msgData.kemct, senderX25519Pub, msgData.opkId,
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
        let isGroupMsg = false;
        let groupPayload = null;

        try {
          const payload = JSON.parse(decrypted);

          if (payload.action === 'reaction') {
            const { targetSeq, emoji, groupId } = payload;
            const targetChatId = groupId || senderId;
            if (targetSeq && emoji) {
              const applyReaction = (curMsgs) => curMsgs.map(m => {
                if (m.seq === targetSeq) {
                  const curReactions = { ...(m.reactions || {}) };
                  const curUsers = curReactions[emoji] || [];
                  if (curUsers.includes(senderId)) {
                    curReactions[emoji] = curUsers.filter(id => id !== senderId);
                    if (curReactions[emoji].length === 0) delete curReactions[emoji];
                  } else {
                    curReactions[emoji] = [...curUsers, senderId];
                  }
                  updateMessageReactions(targetChatId, targetSeq, curReactions).catch(console.error);
                  return { ...m, reactions: curReactions };
                }
                return m;
              });

              setMessages(prev => applyReaction(prev));

              const isCurrentChat = (groupId && activeGroupRef.current?.id === groupId) || (!groupId && activeContactRef.current?.id === senderId);
              if (!isCurrentChat) {
                getMessages(targetChatId).then(allMsgs => {
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
                    updateMessageReactions(targetChatId, targetSeq, curReactions).catch(console.error);
                  }
                });
              }
            }
            return;
          }

          if (payload.type === 'group_event') {
            if (payload.groupId) {
              let g = await getGroup(payload.groupId);
              const myDisplayName = localStorage.getItem('veil_my_name') || `Agent-${myId.slice(0, 4)}`;
              if (!g) {
                g = {
                  id: payload.groupId,
                  name: payload.groupName || 'Encrypted Group',
                  createdBy: payload.senderId || senderId,
                  createdAt: Date.now(),
                  members: payload.members || [
                    { id: myId, name: myDisplayName, role: 'member' },
                    { id: senderId, name: payload.senderName || `Agent-${senderId.slice(0, 4)}`, role: 'member' }
                  ]
                };
              } else if (payload.members) {
                const existingIds = new Set(g.members.map(m => m.id));
                const merged = [...g.members];
                payload.members.forEach(m => {
                  if (!existingIds.has(m.id)) merged.push(m);
                });
                g.members = merged;
              }
              await saveGroup(g);
              const allG = await getGroups();
              groupsRef.current = allG;
              setGroups(allG);
              if (activeGroupRef.current?.id === g.id) setActiveGroup(g);
              showToast(`Group: ${payload.text || payload.groupName}`);
            }
            return;
          }

          if (payload.groupId) {
            isGroupMsg = true;
            groupPayload = payload;
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

        if (isGroupMsg && groupPayload) {
          const gId = groupPayload.groupId;
          let g = await getGroup(gId);
          const myDisplayName = localStorage.getItem('veil_my_name') || `Agent-${myId.slice(0, 4)}`;
          const senderDisplayName = groupPayload.senderName || msgData.senderName || (contact ? contact.name : `Agent-${senderId.slice(0, 4)}`);

          if (!g) {
            g = {
              id: gId,
              name: groupPayload.groupName || 'Encrypted Group',
              createdBy: groupPayload.senderId || senderId,
              createdAt: Date.now(),
              members: [
                { id: myId, name: myDisplayName, role: 'member' },
                { id: senderId, name: senderDisplayName, role: 'member' }
              ]
            };
            await saveGroup(g);
            const allG = await getGroups();
            groupsRef.current = allG;
            setGroups(allG);
          } else {
            const hasMember = g.members.some(m => m.id === senderId);
            if (!hasMember) {
              g.members.push({ id: senderId, name: senderDisplayName, role: 'member' });
              await saveGroup(g);
              const allG = await getGroups();
              groupsRef.current = allG;
              setGroups(allG);
              if (activeGroupRef.current?.id === g.id) setActiveGroup(g);
            }
          }

          const groupMsgObj = {
            contactId: gId,
            groupId: gId,
            fromMe: false,
            senderId,
            senderName: senderDisplayName,
            senderX25519Pub: groupPayload.senderX25519Pub || (contact ? contact.x25519Pub : null),
            senderEd25519Pub: groupPayload.senderEd25519Pub || (contact ? contact.ed25519Pub : null),
            text,
            attachment,
            replyTo: replyTo || undefined,
            reactions: {},
            ts: msgData.ts,
            seq: msgData.seq,
            ttl: msgData.ttl || 0
          };
          await saveMessage(groupMsgObj);

          if (activeGroupRef.current && activeGroupRef.current.id === gId) {
            setMessages(prev => [...prev, groupMsgObj]);
            setTypingUsers(prev => ({ ...prev, [senderId]: false }));
          } else {
            showToast(`New message in ${g.name}: ${senderDisplayName}`);
          }
          return;
        }

        // Direct 1-on-1 Message Flow
        if (!contact && senderId) {
          const newContact = {
            id: senderId,
            name: msgData.senderName || `Agent-${senderId.slice(0, 4)}`,
            deliveryToken: contactToken || undefined,
            x25519Pub: msgData.senderX25519Pub,
            ed25519Pub: msgData.senderEd25519Pub
          };
          await saveContact(newContact);
          await loadContacts();
        } else if (contact && contactToken && contact.deliveryToken !== contactToken) {
          const updated = { ...contact, deliveryToken: contactToken };
          await saveContact(updated);
          const idx = contactsRef.current.findIndex(c => c.id === senderId);
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
      });
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

  const sendEncryptedPayload = async (text, attachmentMetadata = null) => {
    if (!activeContact && !activeGroup) return;

    try {
      const myDisplayName = localStorage.getItem('veil_my_name') || `Agent-${myId.slice(0, 4)}`;
      const seq = Date.now();
      const ts = Date.now();

      const replyPayload = replyingTo ? {
        seq: replyingTo.seq,
        senderId: replyingTo.senderId,
        senderName: replyingTo.senderName,
        text: (replyingTo.text || '').slice(0, 200),
        hasAttachment: !!replyingTo.hasAttachment
      } : undefined;

      if (activeContact) {
        const ttl = vanishModes[activeContact.id] || 0;
        const innerPayload = {
          text: text,
          attachment: attachmentMetadata || undefined,
          deliveryToken: keys.profile.deliveryTokenB64,
          replyTo: replyPayload,
          senderName: myDisplayName
        };

        await encryptAndSendToPeer(activeContact, innerPayload, ttl);

        const msgObj = {
          contactId: activeContact.id,
          fromMe: true,
          text: text,
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
      } else if (activeGroup) {
        const group = activeGroup;
        const ttl = vanishModes[group.id] || 0;
        const innerPayload = {
          groupId: group.id,
          groupName: group.name,
          senderId: myId,
          senderName: myDisplayName,
          senderX25519Pub: keys.x25519.publicKeyB64,
          senderEd25519Pub: keys.ed25519.publicKeyB64,
          text: text,
          attachment: attachmentMetadata || undefined,
          replyTo: replyPayload
        };

        const otherMembers = (group.members || []).filter(m => m.id !== myId);
        for (const member of otherMembers) {
          try {
            const target = contacts.find(c => c.id === member.id) || member;
            await encryptAndSendToPeer(target, innerPayload, ttl);
          } catch (err) {
            console.warn(`[VEIL] Fan-out error to ${member.name}:`, err);
          }
        }

        const msgObj = {
          contactId: group.id,
          groupId: group.id,
          fromMe: true,
          senderId: myId,
          senderName: myDisplayName,
          text: text,
          attachment: attachmentMetadata || undefined,
          replyTo: replyPayload,
          reactions: {},
          ts,
          seq,
          status: 'delivered',
          ttl
        };
        await saveMessage(msgObj);
        setMessages(prev => [...prev, msgObj]);
      }

      setReplyingTo(null);
    } catch (err) {
      showToast("Transmission failed: network or encryption session error");
      console.error(err);
    }
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if ((!inputText.trim() && !stagedAttachment) || (!activeContact && !activeGroup)) return;

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
        showToast("Attachment upload failed: network or relay error");
        setUploadingAttachment(false);
        return;
      }
      setUploadingAttachment(false);
    }

    await sendEncryptedPayload(inputText, attachmentMetadata);
    setInputText('');
    setStagedAttachment(null);
  };

  const handleInsertEmoji = (emoji) => {
    setInputText(prev => prev + emoji);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleSendGif = async (gif) => {
    setShowInputEmojiPicker(false);
    const attachmentMetadata = {
      isGif: true,
      gifUrl: gif.url,
      previewUrl: gif.preview || gif.url,
      fileName: (gif.title || 'cyber_gif') + '.gif',
      mimeType: 'image/gif'
    };
    await sendEncryptedPayload('', attachmentMetadata);
  };

  const handleSendSticker = async (st) => {
    setShowInputEmojiPicker(false);
    const attachmentMetadata = {
      isSticker: true,
      icon: st.icon,
      title: st.title,
      sub: st.sub
    };
    await sendEncryptedPayload('', attachmentMetadata);
  };

  const handleToggleReaction = async (targetSeq, emoji) => {
    const targetChat = activeContact || activeGroup;
    if (!targetChat) return;

    const chatId = targetChat.id;
    const isGroup = !!activeGroup;

    let nextReactions = {};
    setMessages(prev => prev.map(m => {
      if (m.seq === targetSeq) {
        const curReactions = { ...(m.reactions || {}) };
        const curUsers = curReactions[emoji] || [];
        if (curUsers.includes(myId)) {
          curReactions[emoji] = curUsers.filter(id => id !== myId);
          if (curReactions[emoji].length === 0) delete curReactions[emoji];
        } else {
          curReactions[emoji] = [...curUsers, myId];
        }
        nextReactions = curReactions;
        return { ...m, reactions: curReactions };
      }
      return m;
    }));

    setActiveReactionSeq(null);

    await updateMessageReactions(chatId, targetSeq, nextReactions).catch(console.error);

    try {
      if (isGroup) {
        const reactionPayload = {
          action: 'reaction',
          groupId: targetChat.id,
          targetSeq,
          emoji,
          senderId: myId
        };
        for (const member of (targetChat.members || []).filter(m => m.id !== myId)) {
          try {
            const target = contacts.find(c => c.id === member.id) || member;
            await encryptAndSendToPeer(target, reactionPayload, 0);
          } catch (e) {}
        }
      } else {
        const reactionPayload = {
          action: 'reaction',
          targetSeq,
          emoji,
          deliveryToken: keys.profile.deliveryTokenB64
        };
        await encryptAndSendToPeer(activeContact, reactionPayload, 0);
      }
    } catch (err) {
      console.error("[VEIL] Failed to send reaction:", err);
    }
  };

  const isFlow = appMode === 'flow';

  const filteredGroups = groups.filter(g => 
    !sidebarFilter.trim() || g.name.toLowerCase().includes(sidebarFilter.toLowerCase().trim())
  );
  const filteredContacts = contacts.filter(c => 
    !sidebarFilter.trim() || 
    c.name.toLowerCase().includes(sidebarFilter.toLowerCase().trim()) || 
    c.id.toLowerCase().includes(sidebarFilter.toLowerCase().trim())
  );

  return (
    <div className={`flex-1 flex overflow-hidden p-2 md:p-4 gap-4 ${isFlow ? 'bg-[#111b21]' : ''}`}>
      {/* Sidebar */}
      <div 
        className={`w-full md:w-80 flex-col transition-all duration-200 ${(activeContact || activeGroup) ? 'hidden md:flex' : 'flex'} ${
          isFlow 
            ? 'bg-[#111b21] border border-[#222e35] rounded-xl shadow-lg' 
            : 'bg-stark-surface border border-arc-cyan/20 shadow-glow-cyan'
        }`} 
        style={!isFlow ? { clipPath: "polygon(0 0, 100% 0, 100% 100%, 5% 100%, 0 95%)" } : {}}
      >
        {/* App Header & Dual Mode Switcher */}
        <div className={`p-3 border-b flex flex-col gap-2.5 ${isFlow ? 'bg-[#202c33] border-[#222e35]' : 'bg-arc-cyan/5 border-arc-cyan/20'}`}>
          <div className="flex justify-between items-center">
            {/* Mode Switcher Segmented Control */}
            <div className={`flex items-center p-0.5 rounded-lg border ${
              isFlow ? 'bg-[#111b21] border-[#2a3942]' : 'bg-black/60 border-arc-cyan/30'
            }`}>
              <button
                type="button"
                onClick={() => toggleAppMode('flow')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${
                  isFlow
                    ? 'bg-[#00a884] text-white shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
                title="Veil Flow: WhatsApp-Style Secure Messenger"
              >
                <MessageSquare size={13} />
                <span>Veil Flow</span>
              </button>
              <button
                type="button"
                onClick={() => toggleAppMode('bunker')}
                className={`px-2.5 py-1 rounded-md text-xs font-hud font-bold tracking-wider flex items-center gap-1.5 transition-all ${
                  !isFlow
                    ? 'bg-arc-cyan/20 text-arc-cyan border border-arc-cyan shadow-glow-cyan'
                    : 'text-gray-400 hover:text-white'
                }`}
                title="Veil Bunker: Zero-Trust Cyberpunk Quantum Fortress"
              >
                <ShieldCheck size={13} />
                <span>Bunker</span>
              </button>
            </div>

            {/* Quick Actions (Panic Wipe + Lock) */}
            <div className="flex items-center gap-1.5">
              {!isFlow && (
                <button
                  type="button"
                  onClick={() => setShowPanicModal(true)}
                  className="px-2 py-1 bg-stark-crimson/20 hover:bg-stark-crimson/40 border border-stark-crimson text-stark-crimson hover:text-white rounded text-[10px] font-hud font-bold tracking-wider flex items-center gap-1 transition-all shadow-[0_0_8px_rgba(255,42,95,0.3)]"
                  title="Zero-Forensic Emergency Kill-Switch"
                >
                  <Flame size={12} className="animate-pulse" />
                  <span className="hidden sm:inline">PANIC</span>
                </button>
              )}
              {onLock && (
                <button
                  type="button"
                  onClick={onLock}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                  title="Lock Vault"
                >
                  <Lock size={15} />
                </button>
              )}
              <button 
                onClick={() => setShowCreateGroup(true)} 
                className={`p-1.5 rounded transition-colors flex items-center gap-0.5 ${
                  isFlow 
                    ? 'text-gray-300 hover:text-white hover:bg-white/10' 
                    : 'text-arc-cyan hover:bg-arc-cyan/20 border border-arc-cyan/30'
                }`}
                title="Create Group"
              >
                <Users size={16} />
                <Plus size={10} className="-ml-1" />
              </button>
              <button 
                onClick={() => setShowAddContact(true)} 
                className={`p-1.5 rounded transition-colors ${
                  isFlow 
                    ? 'text-gray-300 hover:text-white hover:bg-white/10' 
                    : 'text-arc-cyan hover:bg-arc-cyan/20 border border-transparent hover:border-arc-cyan/30'
                }`}
                title="Add Contact / QR Scanner"
              >
                <UserPlus size={17} />
              </button>
            </div>
          </div>

          {/* Subtitle & Status */}
          <div className="flex justify-between items-center text-[10px] font-mono">
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
              className={`flex items-center gap-1.5 cursor-pointer hover:underline ${
                isFlow ? 'text-gray-400' : 'text-arc-cyan/70'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? (isFlow ? 'bg-[#00a884]' : 'bg-arc-cyan shadow-glow-cyan animate-pulse') : 'bg-stark-crimson'}`} />
              <span>{wsStatus === 'connected' ? (isFlow ? 'E2EE Relay Active' : 'ML-KEM-768 ENCRYPTED') : 'Offline (Configure)'}</span>
            </div>
            <span className={isFlow ? 'text-gray-500' : 'text-arc-cyan/50'}>ID: {myId.slice(0, 8)}...</span>
          </div>

          {/* Contact Search Bar (WhatsApp style) */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${
            isFlow 
              ? 'bg-[#111b21] border-[#222e35] text-white focus-within:border-[#00a884]' 
              : 'bg-black/50 border-arc-cyan/20 text-arc-cyan focus-within:border-arc-cyan'
          }`}>
            <Search size={14} className={isFlow ? 'text-gray-400' : 'text-arc-cyan/60'} />
            <input
              type="text"
              value={sidebarFilter}
              onChange={(e) => setSidebarFilter(e.target.value)}
              placeholder={isFlow ? "Search or start new chat" : "FILTER CHANNELS..."}
              className={`w-full bg-transparent text-xs outline-none ${
                isFlow ? 'text-white placeholder:text-gray-500' : 'font-mono text-arc-cyan placeholder:text-arc-cyan/40'
              }`}
            />
            {sidebarFilter && (
              <button type="button" onClick={() => setSidebarFilter('')} className="text-gray-400 hover:text-white">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
        
        {/* Navigation Tabs: ALL / DIRECT / GROUPS */}
        <div className={`flex border-b text-[10px] font-medium tracking-wide ${
          isFlow ? 'bg-[#111b21] border-[#222e35]' : 'border-arc-cyan/20 bg-black/40 font-hud tracking-wider'
        }`}>
          <button
            onClick={() => setActiveTab('all')}
            className={`flex-1 py-2.5 text-center border-b-2 transition-all ${
              activeTab === 'all'
                ? (isFlow ? 'border-[#00a884] text-[#00a884] font-semibold bg-[#202c33]/40' : 'border-arc-cyan text-arc-cyan bg-arc-cyan/10 font-bold shadow-[inset_0_-2px_6px_rgba(0,240,255,0.3)]')
                : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            ALL ({filteredContacts.length + filteredGroups.length})
          </button>
          <button
            onClick={() => setActiveTab('direct')}
            className={`flex-1 py-2.5 text-center border-b-2 transition-all ${
              activeTab === 'direct'
                ? (isFlow ? 'border-[#00a884] text-[#00a884] font-semibold bg-[#202c33]/40' : 'border-arc-cyan text-arc-cyan bg-arc-cyan/10 font-bold shadow-[inset_0_-2px_6px_rgba(0,240,255,0.3)]')
                : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            CHATS ({filteredContacts.length})
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={`flex-1 py-2.5 text-center border-b-2 transition-all ${
              activeTab === 'groups'
                ? (isFlow ? 'border-[#00a884] text-[#00a884] font-semibold bg-[#202c33]/40' : 'border-arc-cyan text-arc-cyan bg-arc-cyan/10 font-bold shadow-[inset_0_-2px_6px_rgba(0,240,255,0.3)]')
                : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            GROUPS ({filteredGroups.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredContacts.length === 0 && filteredGroups.length === 0 ? (
            <div className="p-6 text-center flex flex-col items-center justify-center h-full opacity-50">
              <UserPlus size={32} className={isFlow ? 'text-[#00a884] mb-3' : 'text-arc-cyan mb-3'} />
              <div className={`text-xs ${isFlow ? 'text-gray-300 font-sans' : 'font-hud tracking-widest text-arc-cyan'}`}>
                {sidebarFilter ? 'NO RESULTS MATCHING SEARCH' : 'NO CHANNELS FOUND'}
              </div>
              <div className={`text-[10px] mt-1 ${isFlow ? 'text-gray-500' : 'font-mono text-arc-cyan/60'}`}>
                Add a contact or start an encrypted group
              </div>
            </div>
          ) : (
            <>
              {/* Groups List (if in 'all' or 'groups' tab) */}
              {(activeTab === 'all' || activeTab === 'groups') && filteredGroups.length > 0 && (
                <>
                  {activeTab === 'all' && (
                    <div className={`px-4 py-1.5 border-b text-[9px] uppercase flex items-center justify-between ${
                      isFlow ? 'bg-[#182229] border-[#222e35] text-gray-400 font-sans font-medium' : 'bg-arc-cyan/5 border-arc-cyan/10 font-hud tracking-widest text-arc-cyan/70'
                    }`}>
                      <span>GROUPS ({filteredGroups.length})</span>
                      <button 
                        onClick={() => setShowCreateGroup(true)}
                        className={`text-[9px] hover:underline flex items-center gap-0.5 ${isFlow ? 'text-[#00a884]' : 'text-arc-cyan'}`}
                      >
                        <Plus size={10} /> NEW
                      </button>
                    </div>
                  )}
                  {filteredGroups.map(g => {
                    const isSelected = activeGroup?.id === g.id;
                    return (
                      <button
                        key={g.id}
                        onClick={() => {
                          setActiveContact(null);
                          setActiveGroup(g);
                        }}
                        className={`w-full p-3 text-left border-b transition-all flex items-center justify-between ${
                          isFlow
                            ? `border-[#222e35] hover:bg-[#202c33] ${isSelected ? 'bg-[#2a3942]' : ''}`
                            : `border-arc-cyan/10 hover:bg-arc-cyan/5 ${isSelected ? 'bg-arc-cyan/15 border-l-2 border-l-arc-cyan shadow-[inset_0_0_15px_rgba(0,240,255,0.15)]' : ''}`
                        }`}
                      >
                        <div className="flex items-center gap-3 truncate">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            isFlow 
                              ? 'bg-[#00a884]/20 text-[#00a884] border border-[#00a884]/40 font-bold' 
                              : 'rounded bg-arc-cyan/10 border border-arc-cyan/40 text-arc-cyan'
                          }`}>
                            <Users size={18} />
                          </div>
                          <div className="truncate">
                            <div className={`font-bold text-sm truncate ${isFlow ? 'text-white font-sans' : 'font-hud tracking-wider text-white'}`}>{g.name}</div>
                            <div className={`text-[11px] truncate ${isFlow ? 'text-[#8696a0]' : 'text-[10px] text-arc-cyan/60 font-mono'}`}>
                              {g.members?.length || 1} participants • E2EE
                            </div>
                          </div>
                        </div>
                        <div className={`text-[8px] px-1.5 py-0.5 rounded uppercase shrink-0 ${
                          isFlow 
                            ? 'bg-[#00a884]/10 text-[#00a884] border border-[#00a884]/30' 
                            : 'font-mono text-arc-cyan border border-arc-cyan/30'
                        }`}>
                          GROUP
                        </div>
                      </button>
                    );
                  })}
                </>
              )}

              {/* Direct Contacts List (if in 'all' or 'direct' tab) */}
              {(activeTab === 'all' || activeTab === 'direct') && (
                <>
                  {activeTab === 'all' && filteredGroups.length > 0 && filteredContacts.length > 0 && (
                    <div className={`px-4 py-1.5 border-b text-[9px] uppercase ${
                      isFlow ? 'bg-[#182229] border-[#222e35] text-gray-400 font-sans font-medium' : 'bg-arc-cyan/5 border-arc-cyan/10 font-hud tracking-widest text-arc-cyan/70'
                    }`}>
                      DIRECT CHATS ({filteredContacts.length})
                    </div>
                  )}
                  {filteredContacts.map(c => {
                    const isSelected = activeContact?.id === c.id;
                    const initials = (c.name || 'AG').slice(0, 2).toUpperCase();
                    return (
                      <button 
                        key={c.id} 
                        onClick={() => {
                          setActiveGroup(null);
                          setActiveContact(c);
                        }}
                        className={`w-full p-3 text-left border-b transition-all flex items-center justify-between ${
                          isFlow
                            ? `border-[#222e35] hover:bg-[#202c33] ${isSelected ? 'bg-[#2a3942]' : ''}`
                            : `border-arc-cyan/10 hover:bg-arc-cyan/5 ${isSelected ? 'bg-arc-cyan/15 border-l-2 border-l-arc-cyan shadow-[inset_0_0_15px_rgba(0,240,255,0.15)]' : ''}`
                        }`}
                      >
                        <div className="flex items-center gap-3 truncate">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold ${
                            isFlow 
                              ? 'bg-gradient-to-br from-emerald-600 to-teal-800 text-white shadow-sm' 
                              : 'rounded bg-arc-cyan/10 border border-arc-cyan/40 text-arc-cyan font-mono text-xs'
                          }`}>
                            {initials}
                          </div>
                          <div className="truncate">
                            <div className={`text-sm truncate font-medium ${isFlow ? 'text-white font-sans' : 'font-hud tracking-widest font-bold text-white'}`}>{c.name}</div>
                            <div className={`text-[11px] truncate ${isFlow ? 'text-[#8696a0]' : 'text-[10px] text-arc-cyan/50 font-mono mt-0.5'}`}>
                              {c.id.slice(0, 10)}...
                            </div>
                          </div>
                        </div>
                        {c.verified ? (
                          <div className="flex flex-col items-end shrink-0">
                            <ShieldCheck size={15} className={isFlow ? 'text-[#00a884]' : 'text-arc-cyan'} />
                            <span className={`text-[8px] mt-0.5 ${isFlow ? 'text-[#00a884]' : 'font-mono text-arc-cyan'}`}>VERIFIED</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-end shrink-0">
                            <ShieldAlert size={14} className="text-stark-gold" />
                            <span className="text-[8px] font-mono text-stark-gold mt-0.5 animate-pulse">UNVERIFIED</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Chat Area */}
      {(activeContact || activeGroup) ? (
        <div 
          className={`flex-1 flex flex-col overflow-hidden transition-all duration-200 ${
            isFlow ? 'bg-[#0b141a] border border-[#222e35] rounded-xl' : 'bg-stark-surface border border-arc-cyan/20 shadow-glow-cyan'
          }`} 
          style={!isFlow ? { clipPath: "polygon(0 5%, 5% 0, 100% 0, 100% 100%, 0 100%)" } : {}}
        >
          {/* Header */}
          <div className={`p-2.5 md:p-3.5 border-b flex justify-between items-center transition-colors ${
            isFlow ? 'bg-[#202c33] border-[#222e35]' : 'bg-stark-bg/80 border-arc-cyan/20 backdrop-blur-md'
          }`}>
            {activeGroup ? (
              <>
                <div className="flex items-center gap-2.5 md:gap-3">
                  <button onClick={() => setActiveGroup(null)} className="md:hidden p-1.5 text-gray-300 hover:text-white rounded transition-colors">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                  </button>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    isFlow 
                      ? 'bg-[#00a884]/20 text-[#00a884] border border-[#00a884]/40 font-bold' 
                      : 'rounded bg-arc-cyan/15 border border-arc-cyan/40 text-arc-cyan'
                  }`}>
                    <Users size={18} />
                  </div>
                  <div>
                    <div className={`font-bold text-base md:text-lg flex items-center gap-2 ${
                      isFlow ? 'text-white font-sans' : 'font-hud tracking-widest text-white'
                    }`}>
                      <span>{activeGroup.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded uppercase ${
                        isFlow ? 'bg-[#00a884]/20 text-[#00a884] border border-[#00a884]/30' : 'font-mono text-arc-cyan border border-arc-cyan/30'
                      }`}>E2EE GROUP</span>
                    </div>
                    <div className={`text-[11px] mt-0.5 ${
                      isFlow ? 'text-[#8696a0]' : 'text-[10px] text-arc-cyan/70 font-mono'
                    }`}>
                      {activeGroup.members?.length || 1} PARTICIPANTS • ZERO-KNOWLEDGE
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowSearch(!showSearch)}
                    className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                    title="Search in conversation"
                  >
                    <Search size={17} />
                  </button>
                  <button
                    onClick={() => {
                      const invitePayload = btoa(unescape(encodeURIComponent(JSON.stringify({
                        id: activeGroup.id,
                        name: activeGroup.name,
                        createdBy: activeGroup.createdBy
                      }))));
                      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://veil-relay.onrender.com';
                      const inviteUrl = `${origin}/?joinGroup=${invitePayload}`;
                      navigator.clipboard.writeText(inviteUrl).then(() => {
                        showToast("Group invite link copied to clipboard!");
                      }).catch(() => {
                        prompt("Group Invite Link:", inviteUrl);
                      });
                    }}
                    className={`px-2.5 py-1 md:px-3 md:py-1.5 border text-[10px] md:text-xs flex items-center gap-1.5 transition-all ${
                      isFlow 
                        ? 'border-[#00a884]/40 bg-[#00a884]/10 text-[#00a884] hover:bg-[#00a884]/20 rounded-md font-sans' 
                        : 'border-arc-cyan/40 bg-arc-cyan/10 text-arc-cyan hover:bg-arc-cyan/20 font-hud tracking-wider shadow-glow-cyan'
                    }`}
                    title="Copy Shareable Invite Link"
                  >
                    <Share2 size={13} />
                    <span className="hidden md:inline">INVITE</span>
                  </button>
                  <button
                    onClick={() => setShowGroupInfo(true)}
                    className={`px-2.5 py-1 md:px-3 md:py-1.5 border text-[10px] md:text-xs flex items-center gap-1.5 transition-all ${
                      isFlow 
                        ? 'border-gray-600 bg-transparent text-gray-300 hover:text-white rounded-md font-sans' 
                        : 'border-arc-cyan/40 bg-stark-bg text-arc-cyan hover:border-arc-cyan font-hud tracking-wider'
                    }`}
                    title="View Group Info & Members"
                  >
                    <Info size={13} />
                    <span className="hidden md:inline">MEMBERS</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5 md:gap-3">
                  <button onClick={() => setActiveContact(null)} className="md:hidden p-1.5 text-gray-300 hover:text-white rounded transition-colors">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                  </button>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                    isFlow 
                      ? 'bg-gradient-to-br from-emerald-600 to-teal-800 text-white shadow-sm' 
                      : 'rounded bg-arc-cyan/15 border border-arc-cyan/40 text-arc-cyan font-mono'
                  }`}>
                    {(activeContact.name || 'AG').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className={`font-bold text-base md:text-lg text-white ${
                      isFlow ? 'font-sans' : 'font-hud tracking-widest'
                    }`}>{activeContact.name}</div>
                    <div className={`text-[11px] ${
                      isFlow ? 'text-[#00a884]' : 'text-[10px] text-arc-cyan/70 font-mono'
                    }`}>
                      {typingUsers[activeContact.id] 
                        ? 'typing...' 
                        : (isFlow ? 'Online • End-to-End Encrypted' : `TARGET: ${activeContact.id.slice(0, 8)}... [ML-KEM + X25519]`)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSearch(!showSearch)}
                    className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                    title="Search in conversation"
                  >
                    <Search size={17} />
                  </button>
                  <div className="relative">
                    <button 
                      onClick={() => setShowVanishMenu(!showVanishMenu)}
                      className={`px-2 py-1 md:px-3 md:py-1.5 border text-[9px] md:text-[10px] transition-all rounded ${
                        (vanishModes[activeContact.id] || 0) > 0 
                          ? 'bg-stark-gold/10 border-stark-gold text-stark-gold shadow-glow-gold font-bold' 
                          : (isFlow ? 'bg-[#111b21] border-[#2a3942] text-gray-300 hover:border-gray-400 font-sans' : 'bg-stark-bg border-arc-cyan/30 text-arc-cyan/70 hover:border-arc-cyan font-mono tracking-widest')
                      }`}
                    >
                      {(vanishModes[activeContact.id] || 0) === 0 ? 'VANISH: OFF' : 
                       (vanishModes[activeContact.id] === 5000) ? 'VANISH: 5s' : 
                       (vanishModes[activeContact.id] === 60000) ? 'VANISH: 1m' : 'VANISH: 1h'}
                    </button>
                    {showVanishMenu && (
                      <div className={`absolute top-full right-0 mt-1 w-32 border z-50 flex flex-col shadow-xl rounded ${
                        isFlow ? 'bg-[#202c33] border-[#2a3942]' : 'bg-stark-bg border-arc-cyan shadow-glow-cyan'
                      }`}>
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
                            className={`text-left px-3 py-2 text-[10px] tracking-wider transition-colors ${
                              (vanishModes[activeContact.id] || 0) === opt.value 
                                ? (isFlow ? 'bg-[#00a884] text-white font-bold' : 'bg-arc-cyan text-stark-bg font-bold font-mono')
                                : (isFlow ? 'text-gray-300 hover:bg-[#2a3942]' : 'text-arc-cyan hover:bg-arc-cyan/20 font-mono')
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={() => setShowSafetyNumber(true)} 
                    className={`px-2 py-1 md:px-3 md:py-1.5 rounded border transition-all text-[10px] md:text-xs flex items-center gap-1 md:gap-1.5 ${
                      activeContact.verified 
                        ? (isFlow ? 'bg-[#00a884]/15 border-[#00a884] text-[#00a884]' : 'bg-arc-cyan/10 border-arc-cyan text-arc-cyan shadow-glow-cyan font-hud tracking-[0.1em]') 
                        : 'bg-stark-gold/10 border-stark-gold text-stark-gold shadow-glow-gold hover:bg-stark-gold/20'
                    }`}
                  >
                    {activeContact.verified ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                    <span className="hidden md:inline">{activeContact.verified ? 'VERIFIED' : 'AUTHENTICATE'}</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* In-Chat Search Bar */}
          {showSearch && (
            <div className={`p-2.5 px-4 flex items-center gap-2 border-b animate-in slide-in-from-top-2 duration-150 ${
              isFlow ? 'bg-[#202c33] border-[#2a3942]' : 'bg-stark-bg border-arc-cyan/30'
            }`}>
              <Search size={15} className={isFlow ? 'text-gray-400' : 'text-arc-cyan'} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search in conversation..."
                className={`flex-1 bg-transparent text-xs outline-none ${
                  isFlow ? 'text-white placeholder-gray-400' : 'text-arc-cyan placeholder-arc-cyan/40 font-mono'
                }`}
                autoFocus
              />
              {searchQuery && (
                <span className="text-[10px] font-mono text-gray-400">
                  {messages.filter(m => (m.text && m.text.toLowerCase().includes(searchQuery.toLowerCase())) || (m.attachment?.fileName && m.attachment.fileName.toLowerCase().includes(searchQuery.toLowerCase()))).length} match(es)
                </span>
              )}
              <button
                type="button"
                onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                className="p-1 text-gray-400 hover:text-white rounded"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Messages */}
          <div 
            className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 flex flex-col gap-4 relative"
            onClick={() => { if (activeReactionSeq) setActiveReactionSeq(null); }}
          >
            {(searchQuery.trim() 
              ? messages.filter(m => (m.text && m.text.toLowerCase().includes(searchQuery.toLowerCase())) || (m.attachment?.fileName && m.attachment.fileName.toLowerCase().includes(searchQuery.toLowerCase()))) 
              : messages
            ).map(m => (
              <SwipeableMessageRow 
                key={m.seq} 
                onReply={() => startReply(m)}
              >
                <div 
                  id={`msg-${m.seq}`}
                  className={`group relative max-w-[85%] md:max-w-[75%] p-3 md:p-3.5 transition-all duration-200 ${
                    isFlow
                      ? (m.fromMe
                          ? 'bg-[#005c4b] text-white rounded-2xl rounded-tr-xs shadow-sm ml-auto border border-emerald-600/20'
                          : 'bg-[#202c33] text-gray-100 rounded-2xl rounded-tl-xs shadow-sm mr-auto border border-slate-700/40')
                      : (m.fromMe
                          ? 'bg-gradient-to-r from-arc-cyan/15 to-arc-cyan/5 border border-arc-cyan/30 ml-auto rounded-tl-xl rounded-bl-xl rounded-br-xl shadow-[inset_0_0_15px_rgba(0,240,255,0.05)]'
                          : 'bg-stark-card border-l-2 border-slate-500 mr-auto rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-lg')
                  }`}
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
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveReactionSeq(null);
                          setReactionEmojiPickerSeq(m.seq);
                        }}
                        className="text-xs md:text-sm text-arc-cyan hover:text-white p-1 hover:bg-arc-cyan/20 rounded-full transition-colors flex items-center justify-center font-bold"
                        title="All Emojis (WhatsApp style)"
                      >
                        <Plus size={14} />
                      </button>
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

                  {/* Group Sender Attribution with 1-click [+ ADD FRIEND] button */}
                  {activeGroup && !m.fromMe && (
                    <div className="flex items-center justify-between gap-2 mb-2 pb-1 border-b border-arc-cyan/15">
                      <div className="flex items-center gap-1 font-hud text-[11px] text-arc-cyan font-bold tracking-wider">
                        <span>{m.senderName || `AGENT-${(m.senderId || '').slice(0, 4)}`}</span>
                      </div>
                      {/* If sender is NOT ourself and NOT in our contacts list, show [+ ADD FRIEND] */}
                      {m.senderId && m.senderId !== myId && !contacts.some(c => c.id === m.senderId) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddFriendFromGroup({
                              id: m.senderId,
                              name: m.senderName || `Agent-${m.senderId.slice(0, 4)}`,
                              x25519Pub: m.senderX25519Pub,
                              ed25519Pub: m.senderEd25519Pub
                            });
                          }}
                          className="text-[9px] font-mono tracking-wider text-stark-gold hover:text-white bg-stark-gold/15 hover:bg-stark-gold/30 border border-stark-gold/50 px-2 py-0.5 rounded flex items-center gap-1 transition-all shadow-glow-gold"
                          title="Add user to direct friends list"
                        >
                          <Plus size={10} /> ADD FRIEND
                        </button>
                      )}
                    </div>
                  )}

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
                      if (m.attachment.isSticker) {
                        return (
                          <div className="p-3 bg-stark-bg/90 border border-arc-cyan/50 rounded shadow-glow-cyan flex flex-col gap-1 max-w-xs animate-in zoom-in-95 duration-200">
                            <div className="text-3xl">{m.attachment.icon}</div>
                            <div className="font-hud font-bold text-xs tracking-wider text-arc-cyan uppercase">{m.attachment.title}</div>
                            <div className="font-mono text-[9px] text-gray-400">{m.attachment.sub}</div>
                          </div>
                        );
                      }
                      if (m.attachment.isGif) {
                        const rawUrl = m.attachment.gifUrl || m.attachment.previewUrl;
                        const isTrusted = typeof rawUrl === 'string' && /^https:\/\/(media[0-9]?|i)\.giphy\.com\//i.test(rawUrl);
                        if (!isTrusted) {
                          return (
                            <div className="p-2.5 bg-red-950/40 border border-red-500/40 rounded text-xs text-red-400 font-mono flex items-center gap-2">
                              <span>⚠️</span>
                              <span>Blocked untrusted media source</span>
                            </div>
                          );
                        }
                        const gifSrc = rawUrl;
                        return (
                          <div className="relative group overflow-hidden border border-arc-cyan/30 rounded max-w-sm bg-black/40">
                            <img 
                              src={gifSrc} 
                              alt={m.attachment.fileName || 'Encrypted GIF'}
                              className="w-full max-h-64 object-contain cursor-pointer hover:opacity-95 transition-opacity duration-200 rounded"
                              onClick={() => setLightboxImage(gifSrc)}
                              loading="lazy"
                            />
                            <div className="p-1 bg-black/70 flex justify-between items-center text-[9px] font-mono text-arc-cyan border-t border-arc-cyan/20">
                              <span className="truncate max-w-[150px]">{m.attachment.fileName || 'QUANTUM_GIF'}</span>
                              <span className="opacity-60 uppercase text-[8px] bg-arc-cyan/20 px-1 py-0.5 rounded">ENCRYPTED GIF</span>
                            </div>
                          </div>
                        );
                      }
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
                      const isAudio = media.mimeType?.startsWith('audio/') || m.attachment.isVoiceMemo;
                      if (isAudio && media.objectUrl) {
                        return (
                          <VoiceMemoPlayer
                            audioUrl={media.objectUrl}
                            appMode={appMode}
                            fileName={media.fileName}
                          />
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

                {m.text && <div className={`font-sans leading-relaxed text-sm ${m.fromMe ? 'text-white' : (isFlow ? 'text-gray-100' : 'text-gray-200')} break-words`}>{m.text}</div>}

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

                <div className={`text-[9px] md:text-[10px] mt-1.5 flex justify-end items-center gap-1.5 ${
                  isFlow ? 'text-gray-400 font-sans' : 'font-mono text-arc-cyan/50'
                }`}>
                  {m.ttl > 0 && m.status === 'read' && m.readAt && (
                    <span className="text-stark-gold font-bold flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      {Math.max(0, Math.ceil((m.ttl - (Date.now() - m.readAt)) / 1000))}s
                    </span>
                  )}
                  <span className="opacity-70">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {m.fromMe && (
                    <div className="flex items-center gap-1 font-hud tracking-widest">
                      {isFlow ? (
                        m.status === 'read' ? (
                          <CheckCheck size={15} className="text-[#53bdeb]" title="Read" />
                        ) : m.status === 'delivered' ? (
                          <CheckCheck size={15} className="text-[#8696a0]" title="Delivered" />
                        ) : (
                          <Check size={15} className="text-[#8696a0]" title="Sent" />
                        )
                      ) : (
                        m.status === 'read' ? (
                           <><CheckCheck size={12} className="text-[#3b82f6]" /> <span className="text-[#3b82f6]">READ</span></>
                        ) : m.status === 'delivered' ? (
                           <><CheckCheck size={12} className="text-arc-cyan" /> <span className="text-arc-cyan">ROUTED</span></>
                        ) : (
                           <><Check size={12} className="text-arc-cyan/50" /> <span className="text-arc-cyan/50">QUEUED</span></>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            </SwipeableMessageRow>
          ))}
            
            {/* Typing Indicator */}
            {((activeContact && typingUsers[activeContact.id]) || (activeGroup && Object.entries(typingUsers).some(([uid, t]) => t && uid !== myId && activeGroup.members?.some(m => m.id === uid)))) && (
              <div className="bg-stark-card border-l-2 border-arc-cyan/50 mr-auto p-3 rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-lg animate-pulse max-w-[80%]">
                <div className="font-mono text-[10px] text-arc-cyan flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-arc-cyan rounded-full animate-bounce" style={{animationDelay: '0ms'}}/>
                  <span className="w-1.5 h-1.5 bg-arc-cyan rounded-full animate-bounce" style={{animationDelay: '150ms'}}/>
                  <span className="w-1.5 h-1.5 bg-arc-cyan rounded-full animate-bounce" style={{animationDelay: '300ms'}}/>
                  <span className="ml-2 uppercase tracking-widest">
                    {activeGroup ? 'GROUP TRANSMITTING...' : 'TRANSMITTING...'}
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Dock */}
          <div className={`p-2 md:p-3 border-t transition-colors ${
            isFlow ? 'bg-[#202c33] border-[#222e35]' : 'bg-stark-bg/80 backdrop-blur-xl border-arc-cyan/20'
          }`}>
            <input 
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              accept="image/*,video/*,audio/*,application/pdf,text/*"
            />
            {isRecordingAudio ? (
              <div className={`flex items-center justify-between p-2 rounded-full transition-all ${
                isFlow ? 'bg-[#111b21] border border-[#00a884]/40' : 'bg-stark-surface border border-stark-crimson shadow-[0_0_15px_rgba(255,42,95,0.3)]'
              }`}>
                <div className="flex items-center gap-3 pl-3">
                  <div className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
                  <span className="font-mono text-xs font-bold text-red-400">
                    REC {Math.floor(audioDuration / 60)}:{(audioDuration % 60 < 10 ? '0' : '') + (audioDuration % 60)}
                  </span>
                  <div className="flex items-center gap-1">
                    {[40, 75, 30, 90, 60, 100, 50, 80, 45, 95].map((h, idx) => (
                      <span
                        key={idx}
                        className={`w-[2.5px] rounded-full animate-pulse ${isFlow ? 'bg-[#00a884]' : 'bg-arc-cyan'}`}
                        style={{ height: `${h * 0.22}px`, animationDelay: `${idx * 100}ms` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 pr-1">
                  <button
                    type="button"
                    onClick={cancelAudioRecording}
                    className="p-2 text-gray-400 hover:text-red-400 hover:bg-white/10 rounded-full transition-colors"
                    title="Discard voice memo"
                  >
                    <Trash2 size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={finishAndSendAudioRecording}
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-white transition-all shadow-md ${
                      isFlow ? 'bg-[#00a884] hover:bg-[#02906f]' : 'bg-arc-cyan text-black hover:bg-white'
                    }`}
                    title="Send voice memo"
                  >
                    <Send size={15} fill="currentColor" />
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSend} className="flex flex-col gap-2 relative">
                {/* Emoji / GIF / Sticker Dock Tray */}
                {showInputEmojiPicker && (
                  <div className="mb-2">
                    <EmojiGifPicker 
                      mode="all"
                      onSelectEmoji={handleInsertEmoji}
                      onSelectGif={handleSendGif}
                      onSelectSticker={handleSendSticker}
                      onClose={() => setShowInputEmojiPicker(false)}
                    />
                  </div>
                )}

                {/* Replying Context Banner */}
                {replyingTo && (
                  <div className={`flex items-center justify-between p-2 rounded text-xs animate-in fade-in slide-in-from-bottom-2 duration-150 ${
                    isFlow ? 'bg-[#111b21] border-l-4 border-[#00a884] border-y border-r border-[#222e35]' : 'bg-stark-card border-l-2 border-arc-cyan border-y border-r border-arc-cyan/30 font-mono shadow-glow-cyan'
                  }`}>
                    <div className="flex items-center gap-2 truncate">
                      <CornerUpLeft size={14} className={isFlow ? 'text-[#00a884] shrink-0' : 'text-arc-cyan shrink-0'} />
                      <div className="truncate">
                        <div className={`text-[10px] font-bold tracking-wider uppercase ${isFlow ? 'text-[#00a884]' : 'text-arc-cyan'}`}>
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
                      className="text-gray-400 hover:text-white p-1 hover:bg-white/10 rounded transition-colors"
                      title="Cancel Reply"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Staged Attachment Banner */}
                {stagedAttachment && (
                  <div className={`flex items-center justify-between p-2 text-xs rounded ${
                    isFlow ? 'bg-[#111b21] border border-[#222e35] text-white' : 'bg-arc-cyan/10 border border-arc-cyan/40 font-mono text-arc-cyan'
                  }`}>
                    <div className="flex items-center gap-2 truncate">
                      {stagedAttachment.isImage ? <Image size={14} /> : <FileText size={14} />}
                      <span className="truncate max-w-[200px]">{stagedAttachment.name}</span>
                      <span className="text-[10px] opacity-60">({(stagedAttachment.size / 1024).toFixed(1)} KB)</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                        isFlow ? 'bg-[#00a884]/20 text-[#00a884]' : 'bg-arc-cyan/20 text-arc-cyan border border-arc-cyan/40 font-hud tracking-wider'
                      }`}>AES-256-GCM READY</span>
                    </div>
                    <button 
                      type="button" 
                      onClick={() => setStagedAttachment(null)}
                      className="text-red-400 hover:text-white p-1 transition-colors"
                      title="Remove Attachment"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {!isFlow && (
                  <div className="flex justify-between px-2 text-[9px] md:text-[10px] font-mono text-arc-cyan/50 uppercase">
                    <span>TX_CONSOLE</span>
                    <span>{((inputText.length + (stagedAttachment ? stagedAttachment.size : 0)) / 1024).toFixed(2)} KB / 15.00 MB MAX</span>
                  </div>
                )}

                <div className="flex items-center gap-1.5 md:gap-2">
                  <button 
                    type="button"
                    onClick={() => setShowInputEmojiPicker(!showInputEmojiPicker)}
                    className={`p-2.5 flex items-center justify-center transition-all ${
                      isFlow 
                        ? 'text-gray-400 hover:text-white hover:bg-white/10 rounded-full' 
                        : `border rounded ${showInputEmojiPicker ? 'bg-arc-cyan/30 text-white border-arc-cyan shadow-glow-cyan' : 'bg-arc-cyan/10 hover:bg-arc-cyan/20 border-arc-cyan/30 text-arc-cyan'}`
                    }`}
                    title="Emojis & Stickers"
                  >
                    <Smile size={18} />
                  </button>

                  <button 
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAttachment}
                    className={`p-2.5 flex items-center justify-center transition-all ${
                      isFlow 
                        ? 'text-gray-400 hover:text-white hover:bg-white/10 rounded-full' 
                        : 'bg-arc-cyan/10 hover:bg-arc-cyan/20 border border-arc-cyan/30 text-arc-cyan rounded hover:shadow-glow-cyan'
                    }`}
                    title="Attach Media / Files"
                  >
                    {uploadingAttachment ? <Loader2 size={18} className="animate-spin text-stark-gold" /> : <Paperclip size={18} />}
                  </button>

                  <input 
                    ref={inputRef}
                    value={inputText}
                    onChange={e => {
                      setInputText(e.target.value);
                      if (ws.current?.readyState === WebSocket.OPEN) {
                        if (!window.lastTypingTime || Date.now() - window.lastTypingTime > 1500) {
                          window.lastTypingTime = Date.now();
                          if (activeContact) {
                            ws.current.send(JSON.stringify({ type: 'typing', from: myId, to: activeContact.id }));
                          } else if (activeGroup) {
                            for (const m of (activeGroup.members || []).filter(x => x.id !== myId)) {
                              ws.current.send(JSON.stringify({ type: 'typing', from: myId, to: m.id }));
                            }
                          }
                        }
                      }
                    }}
                    className={`flex-1 p-2.5 md:p-3 text-xs outline-none transition-all ${
                      isFlow 
                        ? 'bg-[#2a3942] text-white rounded-full px-4 placeholder:text-gray-400 border border-transparent focus:border-[#00a884]' 
                        : 'bg-stark-surface border border-arc-cyan/30 font-mono text-arc-cyan placeholder:text-arc-cyan/30 focus:border-arc-cyan focus:ring-1 focus:ring-arc-cyan/50'
                    }`}
                    placeholder={uploadingAttachment ? "Encrypting attachment..." : (isFlow ? "Type a message" : (activeGroup ? `> Transmit to "${activeGroup.name}"...` : "> Enter transmission..."))}
                    maxLength={8000}
                  />

                  {/* Send or Voice Note Mic Button */}
                  {(inputText.trim() || stagedAttachment) ? (
                    <button 
                      type="submit" 
                      disabled={uploadingAttachment} 
                      className={`p-2.5 md:p-3 flex items-center justify-center transition-all ${
                        isFlow 
                          ? 'w-10 h-10 md:w-11 md:h-11 rounded-full bg-[#00a884] hover:bg-[#02906f] text-white shadow-md' 
                          : 'w-12 md:w-14 bg-arc-cyan/10 hover:bg-arc-cyan/20 border border-arc-cyan text-arc-cyan hover:shadow-glow-cyan'
                      }`}
                      title="Send encrypted message"
                    >
                      {uploadingAttachment ? <Loader2 size={16} className="animate-spin text-stark-gold" /> : <Send size={16} fill={isFlow ? "currentColor" : "none"} />}
                    </button>
                  ) : (
                    <button 
                      type="button" 
                      onClick={startAudioRecording}
                      className={`p-2.5 md:p-3 flex items-center justify-center transition-all ${
                        isFlow 
                          ? 'w-10 h-10 md:w-11 md:h-11 rounded-full bg-[#00a884] hover:bg-[#02906f] text-white shadow-md' 
                          : 'w-12 md:w-14 bg-arc-cyan/10 hover:bg-arc-cyan/20 border border-arc-cyan text-arc-cyan hover:shadow-glow-cyan'
                      }`}
                      title="Hold / Tap to Record Encrypted Voice Memo"
                    >
                      <Mic size={18} />
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 flex-col items-center justify-center text-arc-cyan/30 border border-arc-cyan/10 bg-stark-surface" style={{clipPath: "polygon(0 5%, 5% 0, 100% 0, 100% 100%, 0 100%)"}}>
          <ShieldCheck size={48} className="mb-4 opacity-20" />
          <div className="font-hud tracking-[0.3em] text-sm">NO ACTIVE TRANSMISSION</div>
          <div className="font-mono text-[10px] mt-2 opacity-50">Select a friend or encrypted group to establish quantum uplink</div>
        </div>
      )}

      {showAddContact && (
        <AddContactModal 
          myId={myId} 
          keys={keys}
          onClose={() => setShowAddContact(false)}
          onAdd={async (contact, autoStartChat = false) => {
            await saveContact(contact);
            await loadContacts();
            setShowAddContact(false);
            if (autoStartChat) {
              setActiveGroup(null);
              setActiveContact(contact);
              showToast(`Uplink established with ${contact.name}!`);
            }
          }}
        />
      )}

      {showCreateGroup && (
        <CreateGroupModal 
          contacts={contacts} 
          myId={myId}
          onClose={() => setShowCreateGroup(false)}
          onCreateGroup={handleCreateGroup}
        />
      )}

      {showGroupInfo && activeGroup && (
        <GroupInfoModal 
          group={activeGroup} 
          contacts={contacts} 
          myId={myId}
          onClose={() => setShowGroupInfo(false)}
          onAddMembers={handleAddMembersToGroup}
          onAddFriendFromGroup={handleAddFriendFromGroup}
          onDirectMessage={(contact) => {
            setShowGroupInfo(false);
            setActiveGroup(null);
            setActiveContact(contact);
          }}
          onLeaveGroup={handleLeaveGroup}
        />
      )}

      {incomingInvite && (
        <JoinGroupModal 
          inviteData={incomingInvite}
          onConfirmJoin={handleConfirmJoinGroup}
          onDecline={() => setIncomingInvite(null)}
        />
      )}

      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-stark-bg/95 border border-arc-cyan text-arc-cyan px-4 py-2 rounded-full font-mono text-xs shadow-glow-cyan flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <div className="w-2 h-2 rounded-full bg-arc-cyan animate-ping" />
          <span>{toastMessage}</span>
        </div>
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

      {/* Full WhatsApp Emoji Picker for Reactions */}
      {reactionEmojiPickerSeq && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setReactionEmojiPickerSeq(null)}
        >
          <div className="w-full max-w-sm sm:max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center bg-stark-bg border border-arc-cyan/40 px-3 py-2 text-xs font-hud text-arc-cyan border-b-0">
              <span className="tracking-widest">TRANSMISSION REACTION</span>
              <button 
                onClick={() => setReactionEmojiPickerSeq(null)} 
                className="text-arc-cyan hover:text-stark-crimson p-1 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <EmojiGifPicker
              mode="emoji-only"
              onSelectEmoji={(emoji) => {
                handleToggleReaction(reactionEmojiPickerSeq, emoji);
                setReactionEmojiPickerSeq(null);
              }}
              onClose={() => setReactionEmojiPickerSeq(null)}
            />
          </div>
        </div>
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

      {/* Zero-Trace Panic Wipe Modal */}
      <PanicModal
        isOpen={showPanicModal}
        onClose={() => setShowPanicModal(false)}
        onConfirm={() => {
          setShowPanicModal(false);
          if (onPanicWipe) onPanicWipe();
        }}
      />
    </div>
  );
}
