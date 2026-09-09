import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { QRCodeSVG } from 'qrcode.react';
import { X, Camera, Image as ImageIcon, Download, Share2, CheckCircle2, AlertTriangle, Copy, ArrowRight, RefreshCw, Upload, Sparkles } from 'lucide-react';
import { Clipboard } from '@capacitor/clipboard';

export default function AddContactModal({ myId, keys, onClose, onAdd }) {
  const [tab, setTab] = useState('scan');
  const [scannedData, setScannedData] = useState('');
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [isDecoding, setIsDecoding] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [detectedTarget, setDetectedTarget] = useState(null);
  const [showManualInput, setShowManualInput] = useState(false);

  const fileInputRef = useRef(null);
  const html5QrCodeRef = useRef(null);

  // Stop camera when switching tabs or unmounting
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (tab !== 'scan') {
      stopCamera();
    }
  }, [tab]);

  const handleParsedQR = (text) => {
    setScannedData(text);
    setErrorMessage(null);
    try {
      const data = JSON.parse(text);
      if (data.id && (data.x25519Pub || data.identityX25519Pub)) {
        const parsed = {
          id: data.id,
          nickname: data.nickname || `Agent-${data.id.slice(0, 4)}`,
          mlkemPub: data.mlkemPub || data.identityMlkemPub || '',
          x25519Pub: data.x25519Pub || data.identityX25519Pub || '',
          ed25519Pub: data.ed25519Pub || data.identityEd25519Pub || '',
          deliveryToken: data.deliveryToken || undefined
        };
        setDetectedTarget(parsed);
        setName(parsed.nickname);
      } else {
        setErrorMessage("QR code decoded, but missing required Project Veil public keys.");
      }
    } catch (e) {
      setErrorMessage("Scanned code is not valid Project Veil JSON telemetry.");
    }
  };

  const requestCameraPermission = async () => {
    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      throw new Error("Camera requires a secure HTTPS connection. Please use 'SCAN FROM PHOTO' or visit via HTTPS.");
    }

    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error("Camera video capture is not supported in this browser. Please use 'SCAN FROM PHOTO' instead.");
    }

    // Explicitly prompts browser/Android OS for camera permission!
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }
    });

    // Immediately release the test stream so Html5Qrcode gets exclusive hardware access
    stream.getTracks().forEach(track => track.stop());
    return true;
  };

  const startCamera = async () => {
    setErrorMessage(null);
    setIsStartingCamera(true);

    try {
      if (html5QrCodeRef.current) {
        await stopCamera();
      }

      // Step 1: Explicitly trigger the browser's native camera permission dialog
      await requestCameraPermission();

      // Step 2: Show the reader viewport
      setIsCameraActive(true);

      // Step 3: Wait a tick for the DOM element to be ready
      await new Promise(resolve => setTimeout(resolve, 80));

      const html5QrCode = new Html5Qrcode("camera-reader");
      html5QrCodeRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: { ideal: "environment" } },
        { 
          fps: 15, 
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const qrEdge = Math.max(180, Math.floor(minEdge * 0.75));
            return { width: qrEdge, height: qrEdge };
          }
        },
        (decodedText) => {
          handleParsedQR(decodedText);
          stopCamera();
        },
        () => {} // Frame error ignore
      );
    } catch (err) {
      console.warn("Camera start failed:", err);
      setIsCameraActive(false);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage("Camera permission was denied. Please tap the lock icon 🔒 next to the website address to allow camera access, or use 'SCAN FROM PHOTO' below.");
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMessage("No physical camera detected on this device. Please use 'SCAN FROM PHOTO' to upload a QR screenshot.");
      } else {
        setErrorMessage(err.message || "Failed to access camera. Please use 'SCAN FROM PHOTO' to upload a QR screenshot.");
      }
    } finally {
      setIsStartingCamera(false);
    }
  };

  const stopCamera = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        await html5QrCodeRef.current.clear();
      } catch (e) {}
      html5QrCodeRef.current = null;
    }
    setIsCameraActive(false);
  };

  const handleImageFileScan = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsDecoding(true);
    setErrorMessage(null);
    stopCamera();

    try {
      const html5QrCode = new Html5Qrcode("hidden-file-reader");
      const decodedText = await html5QrCode.scanFile(file, false);
      try { await html5QrCode.clear(); } catch(e) {}
      handleParsedQR(decodedText);
    } catch (err) {
      console.warn("File scan error:", err);
      setErrorMessage("Could not detect a QR code in this image. Please ensure the QR code is centered and clear.");
    } finally {
      setIsDecoding(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleManualAdd = (e) => {
    if (e) e.preventDefault();
    try {
      const data = JSON.parse(scannedData);
      if (data.id && (data.x25519Pub || data.identityX25519Pub) && name) {
        onAdd({
          id: data.id,
          name: name.trim(),
          mlkemPub: data.mlkemPub || data.identityMlkemPub || '',
          x25519Pub: data.x25519Pub || data.identityX25519Pub || '',
          ed25519Pub: data.ed25519Pub || data.identityEd25519Pub || '',
          deliveryToken: data.deliveryToken || undefined,
          verified: true
        }, true);
      } else {
        setErrorMessage("Please fill in a nickname and valid telemetry JSON.");
      }
    } catch (e) {
      setErrorMessage("Invalid JSON format. Please paste a complete identity package.");
    }
  };

  const handleConnectDetected = () => {
    if (!detectedTarget) return;
    onAdd({
      id: detectedTarget.id,
      name: (name || detectedTarget.nickname || `Agent-${detectedTarget.id.slice(0, 4)}`).trim(),
      mlkemPub: detectedTarget.mlkemPub,
      x25519Pub: detectedTarget.x25519Pub,
      ed25519Pub: detectedTarget.ed25519Pub,
      deliveryToken: detectedTarget.deliveryToken,
      verified: true
    }, true);
  };

  const handleCopy = async () => {
    try {
      await Clipboard.write({ string: myData });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      try {
        navigator.clipboard.writeText(myData);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {}
    }
  };

  const handleDownloadQR = () => {
    const svg = document.getElementById('my-telemetry-qr');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new window.Image();
    img.onload = () => {
      canvas.width = 320;
      canvas.height = 380;
      // Dark cyberpunk background
      ctx.fillStyle = "#070B13";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Cyan accent borders
      ctx.strokeStyle = "#00F0FF";
      ctx.lineWidth = 2;
      ctx.strokeRect(12, 12, 296, 356);

      // Header Text
      ctx.fillStyle = "#00F0FF";
      ctx.font = "bold 15px 'Rajdhani', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PROJECT VEIL // QUANTUM ID", 160, 40);

      // Draw QR Code
      ctx.drawImage(img, 60, 60, 200, 200);

      // Nickname & ID
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 13px 'Rajdhani', sans-serif";
      ctx.fillText(keys.nickname ? `AGENT: ${keys.nickname.toUpperCase()}` : "VEIL AGENT NODE", 160, 290);

      ctx.fillStyle = "rgba(0, 240, 255, 0.7)";
      ctx.font = "10px monospace";
      ctx.fillText("ID: " + myId.slice(0, 22) + "...", 160, 310);

      ctx.fillStyle = "#00F0FF";
      ctx.font = "11px 'Rajdhani', sans-serif";
      ctx.fillText("SCAN TO CONNECT VIA PROJECT VEIL", 160, 340);

      const downloadLink = document.createElement("a");
      downloadLink.download = `veil_qr_${myId.slice(0, 6)}.png`;
      downloadLink.href = canvas.toDataURL("image/png");
      downloadLink.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };

  const handleShareTelemetry = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Project Veil Secure Node',
          text: `Connect with me on Project Veil!\nMy Node ID: ${myId}\nPackage: ${myData}`
        });
        return;
      } catch (e) {}
    }
    handleCopy();
  };

  const myData = JSON.stringify({
    id: myId,
    nickname: keys.nickname,
    mlkemPub: keys.mlkem.publicKeyB64,
    x25519Pub: keys.x25519.publicKeyB64,
    ed25519Pub: keys.ed25519.publicKeyB64
  });

  return (
    <div className="fixed inset-0 bg-stark-bg/90 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto">
      {/* Hidden container for Html5Qrcode file scanning */}
      <div id="hidden-file-reader" className="hidden" />

      <div className="bg-stark-surface border border-arc-cyan/40 w-full max-w-md flex flex-col shadow-glow-cyan my-auto" style={{clipPath: "polygon(0 0, 100% 0, 100% 95%, 95% 100%, 0 100%)"}}>
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-arc-cyan/20 bg-arc-cyan/5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-arc-cyan animate-pulse shadow-glow-cyan" />
            <h2 className="font-hud font-bold tracking-[0.2em] text-arc-cyan text-sm">ADD TARGET NODE</h2>
          </div>
          <button onClick={onClose} className="text-arc-cyan/50 hover:text-arc-cyan transition-colors"><X size={20} /></button>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b border-arc-cyan/20">
          <button 
            onClick={() => setTab('scan')} 
            className={`flex-1 py-3 text-xs font-hud tracking-[0.1em] ${tab === 'scan' ? 'bg-arc-cyan/15 text-arc-cyan border-b-2 border-arc-cyan font-bold' : 'text-gray-500 hover:text-gray-400'} transition-all`}
          >
            SCAN / IMPORT
          </button>
          <button 
            onClick={() => setTab('myid')} 
            className={`flex-1 py-3 text-xs font-hud tracking-[0.1em] ${tab === 'myid' ? 'bg-arc-cyan/15 text-arc-cyan border-b-2 border-arc-cyan font-bold' : 'text-gray-500 hover:text-gray-400'} transition-all`}
          >
            MY TELEMETRY
          </button>
        </div>

        <div className="p-4 md:p-6 space-y-4">
          {tab === 'myid' ? (
            <div className="flex flex-col items-center text-center">
              {/* QR Code Container */}
              <div className="bg-white p-4 mb-4 relative group border border-arc-cyan shadow-[0_0_25px_rgba(0,240,255,0.2)]" style={{clipPath: "polygon(5% 0, 100% 0, 100% 95%, 95% 100%, 0 100%, 0 5%)"}}>
                {/* Corner Brackets */}
                <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-arc-cyan"></div>
                <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-arc-cyan"></div>
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-arc-cyan"></div>
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-arc-cyan"></div>
                <QRCodeSVG id="my-telemetry-qr" value={myData} size={200} />
              </div>

              <div className="text-xs font-hud tracking-wider text-arc-cyan font-bold mb-1">
                {keys.nickname ? `AGENT // ${keys.nickname.toUpperCase()}` : 'YOUR QUANTUM TELEMETRY'}
              </div>
              <p className="text-[10px] font-mono text-arc-cyan/60 mb-4 uppercase">
                Share this QR image with friends or have them scan it to establish an encrypted uplink
              </p>

              {/* Action Buttons for Telemetry Sharing */}
              <div className="grid grid-cols-2 gap-2 w-full mb-3">
                <button
                  type="button"
                  onClick={handleDownloadQR}
                  className="px-3 py-2.5 bg-arc-cyan/10 hover:bg-arc-cyan/20 border border-arc-cyan/50 text-arc-cyan text-xs font-hud tracking-wider flex items-center justify-center gap-2 transition-all hover:shadow-glow-cyan"
                >
                  <Download size={15} />
                  <span>SAVE QR IMAGE</span>
                </button>
                <button
                  type="button"
                  onClick={handleShareTelemetry}
                  className="px-3 py-2.5 bg-arc-cyan/10 hover:bg-arc-cyan/20 border border-arc-cyan/50 text-arc-cyan text-xs font-hud tracking-wider flex items-center justify-center gap-2 transition-all hover:shadow-glow-cyan"
                >
                  <Share2 size={15} />
                  <span>SHARE QR / LINK</span>
                </button>
              </div>

              {/* JSON Payload View & Copy */}
              <div className="w-full relative group">
                <textarea 
                  readOnly 
                  value={myData} 
                  className="w-full h-16 bg-stark-bg border border-arc-cyan/30 p-2 text-[8px] font-mono text-arc-cyan/60 custom-scrollbar resize-none focus:outline-none" 
                />
                <button 
                  onClick={handleCopy} 
                  className={`absolute bottom-2 right-2 px-3 py-1 text-xs font-hud tracking-widest transition-all shadow-glow-cyan ${copied ? 'bg-arc-cyan text-stark-bg font-bold' : 'bg-arc-cyan/20 hover:bg-arc-cyan border border-arc-cyan text-arc-cyan hover:text-stark-bg'}`}
                >
                  {copied ? 'COPIED!' : 'COPY JSON'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Error Message */}
              {errorMessage && (
                <div className="p-3 bg-red-950/40 border border-red-500/50 rounded text-red-300 text-xs font-mono flex items-start gap-2">
                  <AlertTriangle size={16} className="shrink-0 text-red-400 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Target Detected Preview Card */}
              {detectedTarget ? (
                <div className="p-4 bg-arc-cyan/15 border-2 border-arc-cyan rounded shadow-glow-cyan flex flex-col gap-3 animate-in fade-in zoom-in-95">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-arc-cyan font-hud font-bold text-xs tracking-wider">
                      <CheckCircle2 size={16} className="text-arc-cyan" />
                      <span>TARGET NODE ACQUIRED</span>
                    </div>
                    <span className="text-[10px] font-mono text-arc-cyan/70">[HYBRID ML-KEM]</span>
                  </div>

                  <div className="bg-black/50 border border-arc-cyan/30 p-3 rounded space-y-2">
                    <div>
                      <label className="text-[9px] font-mono text-arc-cyan/70 uppercase block mb-1">Target Nickname</label>
                      <input 
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Enter contact nickname"
                        className="w-full bg-stark-bg border border-arc-cyan/50 p-2 text-sm text-white font-hud tracking-wider focus:outline-none focus:border-arc-cyan"
                      />
                    </div>
                    <div className="text-[10px] font-mono text-arc-cyan/60 truncate">
                      NODE ID: {detectedTarget.id}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleConnectDetected}
                      className="flex-1 bg-arc-cyan text-stark-bg font-hud font-bold py-3 text-xs tracking-[0.15em] hover:bg-white transition-all shadow-glow-cyan flex items-center justify-center gap-2"
                      style={{clipPath: "polygon(5% 0, 100% 0, 95% 100%, 0% 100%)"}}
                    >
                      <Sparkles size={16} />
                      <span>CONNECT & START CHAT</span>
                      <ArrowRight size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDetectedTarget(null); setScannedData(''); }}
                      className="px-3 py-2 border border-arc-cyan/30 text-arc-cyan/60 hover:text-arc-cyan text-xs font-mono"
                      title="Scan another code"
                    >
                      RESET
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Two Main Scan Buttons: Scan Image File OR Camera */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Hidden file picker input */}
                    <input 
                      type="file" 
                      accept="image/*" 
                      ref={fileInputRef} 
                      onChange={handleImageFileScan} 
                      className="hidden" 
                    />
                    
                    {/* Scan from Photo / Screenshot Button */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isDecoding}
                      className="p-3.5 bg-arc-cyan/15 hover:bg-arc-cyan/25 border border-arc-cyan text-arc-cyan text-xs font-hud font-bold tracking-wider flex flex-col items-center justify-center gap-2 transition-all hover:shadow-glow-cyan disabled:opacity-50"
                      style={{clipPath: "polygon(0 0, 100% 0, 95% 100%, 0 100%)"}}
                    >
                      <ImageIcon size={22} className="text-arc-cyan animate-pulse" />
                      <span>{isDecoding ? 'DECODING IMAGE...' : 'SCAN FROM PHOTO'}</span>
                      <span className="text-[9px] font-mono text-arc-cyan/60">Upload QR Screenshot</span>
                    </button>

                    {/* Camera Toggle Button */}
                    <button
                      type="button"
                      onClick={isCameraActive ? stopCamera : startCamera}
                      disabled={isStartingCamera}
                      className={`p-3.5 border text-xs font-hud font-bold tracking-wider flex flex-col items-center justify-center gap-2 transition-all ${isCameraActive ? 'bg-stark-crimson/20 border-stark-crimson text-stark-crimson shadow-glow-crimson' : 'bg-arc-cyan/10 hover:bg-arc-cyan/20 border-arc-cyan text-arc-cyan hover:shadow-glow-cyan'} disabled:opacity-50`}
                      style={{clipPath: "polygon(5% 0, 100% 0, 100% 100%, 0 100%)"}}
                    >
                      <Camera size={22} className={isStartingCamera ? 'animate-pulse text-arc-cyan' : ''} />
                      <span>{isCameraActive ? 'STOP CAMERA' : (isStartingCamera ? 'REQUESTING PERMISSION...' : 'OPEN CAMERA')}</span>
                      <span className="text-[9px] font-mono opacity-60">{isCameraActive ? 'Tap to close camera' : 'Prompt & scan live QR'}</span>
                    </button>
                  </div>

                  {/* Camera Scanner Viewport (Always in DOM so Html5Qrcode never throws element-not-found) */}
                  <div className={`relative mt-2 ${isCameraActive ? 'block' : 'hidden'}`}>
                    <div id="camera-reader" className="w-full bg-black border-2 border-arc-cyan overflow-hidden relative min-h-[260px] shadow-glow-cyan" />
                    {/* Cyber HUD Overlay */}
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-arc-cyan"></div>
                      <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-arc-cyan"></div>
                      <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-arc-cyan"></div>
                      <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-arc-cyan"></div>
                      <div className="absolute top-1/2 left-0 w-full h-[1px] bg-arc-cyan/50 shadow-glow-cyan animate-[scan_2s_ease-in-out_infinite]"></div>
                    </div>
                  </div>

                  {/* Collapsible Manual JSON Import */}
                  <div className="pt-2 border-t border-arc-cyan/15">
                    <button
                      type="button"
                      onClick={() => setShowManualInput(!showManualInput)}
                      className="text-[10px] font-hud tracking-wider text-arc-cyan/70 hover:text-arc-cyan flex items-center justify-between w-full py-1"
                    >
                      <span>{showManualInput ? '▼ HIDE MANUAL JSON IMPORT' : '▶ OR PASTE IDENTITY JSON MANUALLY'}</span>
                    </button>

                    {showManualInput && (
                      <form onSubmit={handleManualAdd} className="flex flex-col gap-3 mt-3">
                        <textarea 
                          value={scannedData}
                          onChange={e => {
                            setScannedData(e.target.value);
                            try {
                              const d = JSON.parse(e.target.value);
                              if (d.nickname && !name) setName(d.nickname);
                            } catch(err) {}
                          }}
                          placeholder="Paste the full identity JSON package here (starts with '{')..."
                          className="w-full bg-stark-bg border border-arc-cyan/30 p-2.5 text-xs font-mono text-arc-cyan h-24 placeholder:text-arc-cyan/30 focus:outline-none focus:border-arc-cyan focus:ring-1 focus:ring-arc-cyan/50 custom-scrollbar"
                        />
                        <input 
                          type="text"
                          value={name}
                          onChange={e => setName(e.target.value)}
                          placeholder="ENTER CONTACT NICKNAME (e.g. 'Bob')"
                          required
                          className="w-full bg-stark-bg border border-arc-cyan/30 p-2.5 text-white font-hud tracking-[0.1em] placeholder:text-arc-cyan/30 focus:outline-none focus:border-arc-cyan"
                        />
                        <button 
                          type="submit" 
                          disabled={!name || !scannedData} 
                          className="w-full bg-arc-cyan/15 hover:bg-arc-cyan/25 disabled:opacity-40 border border-arc-cyan p-3 font-hud font-bold tracking-[0.15em] text-arc-cyan transition-all"
                        >
                          REGISTER & CONNECT
                        </button>
                      </form>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
