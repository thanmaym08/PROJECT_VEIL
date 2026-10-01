import { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, RotateCcw, Volume2, ShieldCheck, Users, Radio } from 'lucide-react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export default function GroupCallModal({
  groupCallState, // { groupId, groupName, callType: 'audio' | 'video', members: [{id, name}], mode: 'initiating' | 'joined' | 'incoming' }
  myId,
  myName,
  appMode = 'flow',
  sendSignalingMessage, // (type, data) => void
  onClose
}) {
  const isFlow = appMode === 'flow';
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(groupCallState?.callType === 'video');
  const [facingMode, setFacingMode] = useState('user');
  const [callDuration, setCallDuration] = useState(0);

  // Map of peerId -> { pc, stream, name, isConnected }
  const [peers, setPeers] = useState({});
  const peersRef = useRef({});

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const timerRef = useRef(null);

  // Sync peersRef with state
  const updatePeersState = () => {
    const copy = {};
    for (const [id, p] of Object.entries(peersRef.current)) {
      copy[id] = {
        name: p.name,
        stream: p.stream,
        isConnected: p.isConnected
      };
    }
    setPeers(copy);
  };

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  };

  // Acquire local media stream
  const getMediaStream = async (type = 'video', face = 'user') => {
    const constraints = {
      audio: true,
      video: type === 'video' ? { facingMode: face, width: { ideal: 640 }, height: { ideal: 480 } } : false
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      if (localVideoRef.current && type === 'video') {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (err) {
      console.warn("[GROUP-WEBRTC] Video/Audio access error, falling back to audio only:", err);
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = audioStream;
        return audioStream;
      } catch (e) {
        console.error("[GROUP-WEBRTC] Media access denied completely:", e);
        return null;
      }
    }
  };

  // Create or retrieve PeerConnection for a specific remote peer
  const getOrCreatePeerConnection = (peerId, peerName) => {
    if (peersRef.current[peerId]?.pc) {
      return peersRef.current[peerId].pc;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current[peerId] = {
      pc,
      name: peerName || `Peer-${peerId.slice(0, 4)}`,
      stream: null,
      isConnected: false
    };

    // Attach local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignalingMessage('group_call_ice', {
          groupId: groupCallState.groupId,
          from: myId,
          to: peerId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        peersRef.current[peerId].stream = event.streams[0];
        peersRef.current[peerId].isConnected = true;
        updatePeersState();
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        peersRef.current[peerId].isConnected = true;
        updatePeersState();
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        delete peersRef.current[peerId];
        updatePeersState();
      }
    };

    return pc;
  };

  // Start Call lifecycle
  useEffect(() => {
    let mounted = true;

    async function initCall() {
      const stream = await getMediaStream(groupCallState.callType, facingMode);
      if (!mounted) return;

      const groupMembers = groupCallState.members || [];
      const recipientIds = groupMembers.map(m => m.id).filter(id => id !== myId);

      if (groupCallState.mode === 'initiating') {
        // Broadcast invite to all group members
        sendSignalingMessage('group_call_invite', {
          groupId: groupCallState.groupId,
          groupName: groupCallState.groupName,
          from: myId,
          name: myName,
          callType: groupCallState.callType,
          recipients: recipientIds
        });
      } else {
        // Notify others that we joined the mesh
        sendSignalingMessage('group_call_join', {
          groupId: groupCallState.groupId,
          from: myId,
          name: myName,
          recipients: recipientIds
        });
      }
    }

    initCall();

    return () => {
      mounted = false;
      cleanupGroupCall();
    };
  }, []);

  const cleanupGroupCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    for (const p of Object.values(peersRef.current)) {
      if (p.pc) {
        try { p.pc.close(); } catch {}
      }
    }
    peersRef.current = {};
    if (timerRef.current) clearInterval(timerRef.current);
  };

  // Global listener for group call signaling dispatched from ChatLayout
  useEffect(() => {
    const handleSignaling = async (e) => {
      const data = e.detail;
      if (!data || data.groupId !== groupCallState.groupId) return;

      const { from } = data;
      if (!from || from === myId) return;

      const member = (groupCallState.members || []).find(m => m.id === from);
      const peerName = member ? member.name : (data.name || `Peer-${from.slice(0, 4)}`);

      if (data.type === 'group_call_join') {
        // A new peer joined the group mesh -> create an offer to them
        const pc = getOrCreatePeerConnection(from, peerName);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignalingMessage('group_call_offer', {
            groupId: groupCallState.groupId,
            from: myId,
            to: from,
            callType: groupCallState.callType,
            sdp: offer
          });
        } catch (err) {
          console.warn("[GROUP-WEBRTC] Create offer error:", err);
        }
      } else if (data.type === 'group_call_offer' && data.to === myId) {
        // Received offer from a peer -> create answer
        const pc = getOrCreatePeerConnection(from, peerName);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignalingMessage('group_call_answer', {
            groupId: groupCallState.groupId,
            from: myId,
            to: from,
            sdp: answer
          });
        } catch (err) {
          console.warn("[GROUP-WEBRTC] Handle offer error:", err);
        }
      } else if (data.type === 'group_call_answer' && data.to === myId) {
        // Received answer from peer
        const pc = peersRef.current[from]?.pc;
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          } catch (err) {
            console.warn("[GROUP-WEBRTC] Handle answer error:", err);
          }
        }
      } else if (data.type === 'group_call_ice' && data.to === myId) {
        const pc = peersRef.current[from]?.pc;
        if (pc && data.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (err) {
            console.warn("[GROUP-WEBRTC] Add ICE error:", err);
          }
        }
      } else if (data.type === 'group_call_leave' && data.from) {
        if (peersRef.current[data.from]?.pc) {
          try { peersRef.current[data.from].pc.close(); } catch {}
          delete peersRef.current[data.from];
          updatePeersState();
        }
      }
    };

    window.addEventListener('veil_group_call_signal', handleSignaling);
    return () => window.removeEventListener('veil_group_call_signal', handleSignaling);
  }, [groupCallState.groupId]);

  const handleToggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const handleToggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  const handleEndCall = () => {
    const groupMembers = groupCallState.members || [];
    const recipientIds = groupMembers.map(m => m.id).filter(id => id !== myId);
    for (const rId of recipientIds) {
      sendSignalingMessage('group_call_leave', {
        groupId: groupCallState.groupId,
        from: myId,
        to: rId
      });
    }
    cleanupGroupCall();
    onClose();
  };

  const activePeerEntries = Object.entries(peers);
  const totalCount = activePeerEntries.length + 1; // peers + self

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col justify-between p-4 md:p-6">
      {/* Top Header */}
      <div className="flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${
            isFlow ? 'bg-[#00a884]/20 text-[#00a884]' : 'bg-arc-cyan/10 border border-arc-cyan/40 text-arc-cyan shadow-glow-cyan'
          }`}>
            <Users size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className={`font-bold text-base md:text-lg ${isFlow ? 'text-white' : 'font-hud tracking-widest text-arc-cyan'}`}>
                {groupCallState.groupName || 'Group Call'}
              </h2>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full flex items-center gap-1 ${
                isFlow ? 'bg-emerald-500/20 text-emerald-300' : 'bg-arc-cyan/20 text-arc-cyan border border-arc-cyan/40'
              }`}>
                <Radio size={10} className="animate-pulse" />
                MESH ENCRYPTED
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400 font-mono">
              <span>{formatTime(callDuration)}</span>
              <span>•</span>
              <span>{totalCount} participants in mesh</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1 text-[11px] font-mono text-gray-400 bg-white/5 px-3 py-1.5 rounded-full">
            <ShieldCheck size={14} className="text-emerald-400" />
            <span>P2P Full Mesh (No Relay Media)</span>
          </div>
        </div>
      </div>

      {/* Video Grid */}
      <div className="flex-1 my-4 flex items-center justify-center overflow-hidden">
        <div className={`w-full h-full max-h-[75vh] grid gap-3 ${
          totalCount <= 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2'
        }`}>
          {/* Local User Tile */}
          <div className={`relative rounded-2xl overflow-hidden flex items-center justify-center border ${
            isFlow ? 'bg-[#182229] border-[#222e35]' : 'bg-stark-surface border-arc-cyan/30 shadow-glow-cyan'
          }`}>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover -scale-x-100 ${!isVideoEnabled ? 'hidden' : ''}`}
            />
            {!isVideoEnabled && (
              <div className="flex flex-col items-center gap-2">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl ${
                  isFlow ? 'bg-[#00a884]/20 text-[#00a884]' : 'bg-arc-cyan/20 text-arc-cyan border border-arc-cyan'
                }`}>
                  {myName ? myName.slice(0, 2).toUpperCase() : 'ME'}
                </div>
                <span className="text-xs text-gray-400 font-mono">You (Camera off)</span>
              </div>
            )}
            <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 text-white">
              <span>You</span>
              {isMuted && <MicOff size={12} className="text-rose-400" />}
            </div>
          </div>

          {/* Remote Peer Tiles */}
          {activePeerEntries.map(([peerId, peer]) => (
            <RemotePeerTile
              key={peerId}
              peerId={peerId}
              peer={peer}
              callType={groupCallState.callType}
              isFlow={isFlow}
            />
          ))}

          {/* Empty slot placeholder if waiting for others */}
          {activePeerEntries.length === 0 && (
            <div className={`rounded-2xl border flex flex-col items-center justify-center p-6 text-center ${
              isFlow ? 'bg-[#182229]/50 border-dashed border-[#222e35]' : 'bg-stark-bg border-dashed border-arc-cyan/20'
            }`}>
              <Users size={32} className="text-gray-500 animate-pulse mb-2" />
              <p className="text-xs text-gray-400">Waiting for other group members to connect to the mesh...</p>
            </div>
          )}
        </div>
      </div>

      {/* Call Controls Footer */}
      <div className="flex items-center justify-center gap-4 z-10 pb-2">
        <button
          type="button"
          onClick={handleToggleMute}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
            isMuted 
              ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-lg' 
              : 'bg-white/10 hover:bg-white/20 text-white'
          }`}
          title={isMuted ? "Unmute microphone" : "Mute microphone"}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        {groupCallState.callType === 'video' && (
          <button
            type="button"
            onClick={handleToggleVideo}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              !isVideoEnabled 
                ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-lg' 
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title={isVideoEnabled ? "Disable camera" : "Enable camera"}
          >
            {isVideoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
        )}

        <button
          type="button"
          onClick={handleEndCall}
          className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-xl transition-transform hover:scale-105"
          title="Leave group call"
        >
          <PhoneOff size={24} />
        </button>
      </div>
    </div>
  );
}

// Remote Peer Tile component with dedicated video ref
function RemotePeerTile({ peerId, peer, callType, isFlow }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  const hasVideoTrack = peer.stream && peer.stream.getVideoTracks().some(t => t.enabled);

  return (
    <div className={`relative rounded-2xl overflow-hidden flex items-center justify-center border ${
      isFlow ? 'bg-[#182229] border-[#222e35]' : 'bg-stark-surface border-arc-cyan/30'
    }`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`w-full h-full object-cover ${!hasVideoTrack ? 'hidden' : ''}`}
      />
      {!hasVideoTrack && (
        <div className="flex flex-col items-center gap-2">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl ${
            isFlow ? 'bg-white/10 text-white' : 'bg-arc-cyan/20 text-arc-cyan border border-arc-cyan'
          }`}>
            {peer.name ? peer.name.slice(0, 2).toUpperCase() : 'PEER'}
          </div>
          <span className="text-xs text-gray-400 font-mono">{peer.name}</span>
        </div>
      )}
      <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5">
        <span>{peer.name}</span>
        {peer.isConnected && (
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" title="Connected"></span>
        )}
      </div>
    </div>
  );
}
