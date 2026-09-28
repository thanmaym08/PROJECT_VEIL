import { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, RotateCcw, Volume2, ShieldCheck, User } from 'lucide-react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export default function CallModal({
  callState, // null | { mode: 'outgoing' | 'incoming' | 'connected', callType: 'audio' | 'video', peer: { id, name }, offerData, sdp }
  myId,
  sendSignalingMessage, // (type, data) => void
  onClose
}) {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(callState?.callType === 'video');
  const [facingMode, setFacingMode] = useState('user');
  const [callDuration, setCallDuration] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState(callState?.mode || 'calling');

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const timerRef = useRef(null);

  // Initialize or handle call state changes
  useEffect(() => {
    if (!callState) {
      cleanupCall();
      return;
    }

    if (callState.mode === 'incoming') {
      setConnectionStatus('ringing_incoming');
    } else if (callState.mode === 'outgoing') {
      setConnectionStatus('calling_outgoing');
      startOutgoingCall();
    } else if (callState.mode === 'connected') {
      setConnectionStatus('connected');
    }

    return () => {
      cleanupCall();
    };
  }, [callState?.mode]);

  // ICE candidate event listener
  useEffect(() => {
    const handleCandidate = (e) => {
      if (e.detail?.candidate && pcRef.current) {
        pcRef.current.addIceCandidate(new RTCIceCandidate(e.detail.candidate)).catch(console.warn);
      }
    };
    window.addEventListener('veil_ice_candidate', handleCandidate);
    return () => window.removeEventListener('veil_ice_candidate', handleCandidate);
  }, []);

  // Duration timer
  useEffect(() => {
    if (connectionStatus === 'connected') {
      timerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [connectionStatus]);

  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  };

  const getMediaStream = async (type = 'video', face = 'user') => {
    const constraints = {
      audio: true,
      video: type === 'video' ? { facingMode: face, width: { ideal: 1280 }, height: { ideal: 720 } } : false
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      if (localVideoRef.current && type === 'video') {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (err) {
      console.warn("[WEBRTC] Video/Audio access error, falling back to audio only:", err);
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = audioStream;
        return audioStream;
      } catch (e) {
        console.error("[WEBRTC] Microphone access denied:", e);
        return null;
      }
    }
  };

  const initPeerConnection = () => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && callState?.peer?.id) {
        sendSignalingMessage('call_ice_candidate', {
          to: callState.peer.id,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setConnectionStatus('connected');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        handleEndCall();
      }
    };

    return pc;
  };

  const startOutgoingCall = async () => {
    try {
      const pc = initPeerConnection();
      const stream = await getMediaStream(callState.callType, facingMode);
      if (stream) {
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendSignalingMessage('call_offer', {
        to: callState.peer.id,
        sdp: offer,
        callType: callState.callType
      });
    } catch (err) {
      console.error("[WEBRTC] Outgoing call initiation failed:", err);
      handleEndCall();
    }
  };

  const handleAcceptCall = async (acceptedType = callState?.callType || 'audio') => {
    try {
      setConnectionStatus('connecting');
      setIsVideoEnabled(acceptedType === 'video');
      const pc = initPeerConnection();
      const stream = await getMediaStream(acceptedType, facingMode);
      if (stream) {
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
      }

      if (callState?.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(callState.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        sendSignalingMessage('call_answer', {
          to: callState.peer.id,
          sdp: answer
        });
        setConnectionStatus('connected');
      }
    } catch (err) {
      console.error("[WEBRTC] Accept call failed:", err);
      handleEndCall();
    }
  };

  const handleEndCall = () => {
    if (callState?.peer?.id) {
      sendSignalingMessage('call_end', { to: callState.peer.id });
    }
    cleanupCall();
    if (onClose) onClose();
  };

  const handleRejectCall = () => {
    if (callState?.peer?.id) {
      sendSignalingMessage('call_reject', { to: callState.peer.id, reason: 'declined' });
    }
    cleanupCall();
    if (onClose) onClose();
  };

  const cleanupCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(t => { t.enabled = !t.enabled; });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = async () => {
    if (isVideoEnabled) {
      if (localStreamRef.current) {
        const videoTracks = localStreamRef.current.getVideoTracks();
        videoTracks.forEach(t => {
          t.stop();
          localStreamRef.current.removeTrack(t);
        });
      }
      setIsVideoEnabled(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && pcRef.current) {
          localStreamRef.current.addTrack(videoTrack);
          const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(videoTrack);
          } else {
            pcRef.current.addTrack(videoTrack, localStreamRef.current);
          }
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
          }
          setIsVideoEnabled(true);
        }
      } catch (e) {
        console.error("Failed to enable video track:", e);
      }
    }
  };

  const flipCamera = async () => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    if (isVideoEnabled && localStreamRef.current) {
      try {
        localStreamRef.current.getVideoTracks().forEach(t => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: nextFacing, width: { ideal: 1280 } }
        });
        const newTrack = stream.getVideoTracks()[0];
        if (newTrack && pcRef.current) {
          const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(newTrack);
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.warn("Camera flip failed:", err);
      }
    }
  };

  if (!callState) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#070b13]/95 backdrop-blur-xl flex flex-col items-center justify-between p-4 sm:p-8 animate-in fade-in duration-300">
      {/* Top Bar: Security & Peer Identity */}
      <div className="w-full max-w-2xl flex items-center justify-between border-b border-arc-cyan/20 pb-4">
        <div className="flex items-center gap-2 text-xs font-mono text-arc-cyan">
          <ShieldCheck size={18} className="text-[#00a884] animate-pulse" />
          <span className="font-hud tracking-wider">E2EE PEER-TO-PEER WEBRTC</span>
        </div>
        <div className="text-xs font-mono text-gray-400">
          {connectionStatus === 'connected' ? (
            <span className="text-[#00a884] font-bold font-hud tracking-widest">{formatTime(callDuration)}</span>
          ) : connectionStatus === 'ringing_incoming' ? (
            <span className="text-amber-400 font-hud tracking-wider animate-pulse">INCOMING CALL...</span>
          ) : (
            <span className="text-arc-cyan font-hud tracking-wider animate-pulse">DIALING PEER...</span>
          )}
        </div>
      </div>

      {/* Main Center Stage: Video or Avatar */}
      <div className="relative w-full max-w-3xl flex-1 flex items-center justify-center my-4 overflow-hidden rounded-2xl bg-black/60 border border-white/10 shadow-2xl">
        {/* Remote Video Stream */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-cover rounded-2xl transition-opacity duration-300 ${
            connectionStatus === 'connected' ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Audio / Fallback Avatar Stage */}
        {(!isVideoEnabled || connectionStatus !== 'connected') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-[#0b1322] to-[#040810]">
            <div className="relative">
              <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full bg-[#1e293b] border-2 border-arc-cyan/40 flex items-center justify-center shadow-[0_0_40px_rgba(0,240,255,0.2)]">
                <User size={64} className="text-arc-cyan/70" />
              </div>
              {connectionStatus === 'calling_outgoing' && (
                <div className="absolute inset-0 rounded-full border-2 border-arc-cyan animate-ping opacity-30 pointer-events-none"></div>
              )}
            </div>
            <div className="text-center">
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-wide">{callState.peer?.name || "Peer"}</h2>
              <p className="text-xs font-mono text-arc-cyan/80 mt-1">
                {connectionStatus === 'connected' ? 'SECURE CHANNEL ACTIVE' : connectionStatus === 'ringing_incoming' ? 'Calling you...' : 'Establishing post-quantum route...'}
              </p>
            </div>
          </div>
        )}

        {/* Local PiP Video Stream */}
        {isVideoEnabled && connectionStatus === 'connected' && (
          <div className="absolute top-4 right-4 w-32 h-44 sm:w-44 sm:h-60 rounded-xl overflow-hidden border-2 border-arc-cyan/50 shadow-glow-cyan bg-black">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover -scale-x-100"
            />
          </div>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div className="w-full max-w-xl flex items-center justify-center gap-4 sm:gap-6 py-4">
        {connectionStatus === 'ringing_incoming' ? (
          // Incoming Call Controls (Accept Audio / Accept Video / Decline)
          <div className="flex items-center gap-6">
            <button
              onClick={() => handleAcceptCall('audio')}
              className="flex flex-col items-center gap-1.5 p-4 bg-[#00a884] hover:bg-[#00c69d] text-white rounded-full shadow-[0_0_25px_rgba(0,168,132,0.5)] transition-transform hover:scale-105"
              title="Accept Voice Call"
            >
              <Phone size={24} />
              <span className="text-[10px] font-hud uppercase tracking-wider font-bold">Voice</span>
            </button>

            <button
              onClick={() => handleAcceptCall('video')}
              className="flex flex-col items-center gap-1.5 p-4 bg-arc-cyan hover:bg-cyan-400 text-black rounded-full shadow-[0_0_25px_rgba(0,240,255,0.5)] transition-transform hover:scale-105"
              title="Accept Video Call"
            >
              <Video size={24} />
              <span className="text-[10px] font-hud uppercase tracking-wider font-bold">Video</span>
            </button>

            <button
              onClick={handleRejectCall}
              className="flex flex-col items-center gap-1.5 p-4 bg-stark-crimson hover:bg-red-600 text-white rounded-full shadow-[0_0_25px_rgba(255,42,95,0.5)] transition-transform hover:scale-105"
              title="Decline Call"
            >
              <PhoneOff size={24} />
              <span className="text-[10px] font-hud uppercase tracking-wider font-bold">Decline</span>
            </button>
          </div>
        ) : (
          // In-Call / Outgoing Controls
          <div className="flex items-center gap-3 sm:gap-5 bg-white/5 border border-white/10 px-6 py-3 rounded-full backdrop-blur-md">
            {/* Mute Mic */}
            <button
              onClick={toggleMute}
              className={`p-3.5 rounded-full transition-all ${
                isMuted
                  ? 'bg-stark-crimson/30 text-stark-crimson border border-stark-crimson'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
              title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            {/* Toggle Video */}
            <button
              onClick={toggleVideo}
              className={`p-3.5 rounded-full transition-all ${
                !isVideoEnabled
                  ? 'bg-white/10 text-gray-400 hover:text-white'
                  : 'bg-arc-cyan/20 text-arc-cyan border border-arc-cyan shadow-glow-cyan'
              }`}
              title={isVideoEnabled ? "Turn Video Off" : "Turn Video On"}
            >
              {isVideoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
            </button>

            {/* Flip Camera */}
            {isVideoEnabled && (
              <button
                onClick={flipCamera}
                className="p-3.5 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                title="Flip Camera"
              >
                <RotateCcw size={20} />
              </button>
            )}

            {/* End Call Button */}
            <button
              onClick={handleEndCall}
              className="p-4 rounded-full bg-stark-crimson hover:bg-red-600 text-white shadow-[0_0_20px_rgba(255,42,95,0.5)] transition-transform hover:scale-105 ml-2"
              title="End Call"
            >
              <PhoneOff size={22} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
