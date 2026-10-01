import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Laptop, Smartphone, Tablet, Monitor, ShieldCheck, QrCode, Camera, CheckCircle2, AlertTriangle, Trash2, X, RefreshCw } from 'lucide-react';
import { generateDeviceLinkSession, encryptDeviceLinkPayload, decryptDeviceLinkPayload } from '../crypto/deviceLink';
import { wrapAndStoreKeys } from '../crypto/keyStorage';

export default function LinkedDevicesModal({
  myId,
  keys,
  appMode = 'flow',
  onClose,
  sendWsMessage, // (msgObj) => void
  onDeviceLinkedSuccess
}) {
  const isFlow = appMode === 'flow';
  const [tab, setTab] = useState('list'); // 'list' | 'scan' | 'show_qr'
  const [linkedDevices, setLinkedDevices] = useState(() => {
    try {
      const stored = localStorage.getItem('veil_linked_devices');
      return stored ? JSON.parse(stored) : [
        {
          id: 'dev_primary',
          name: typeof navigator !== 'undefined' && /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'Primary Mobile' : 'Primary Workstation',
          platform: typeof navigator !== 'undefined' ? navigator.platform : 'Node',
          linkedAt: Date.now() - 86400000,
          isCurrent: true
        }
      ];
    } catch {
      return [];
    }
  });

  // Scanner state (Primary scanning Secondary)
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [scannerError, setScannerError] = useState(null);
  const [pairingStatus, setPairingStatus] = useState(null); // 'pairing' | 'success' | 'error'
  const html5QrCodeRef = useRef(null);

  // Secondary QR state (Secondary showing QR to be linked)
  const [secondarySession, setSecondarySession] = useState(null);
  const [secondaryPassphrase, setSecondaryPassphrase] = useState('');
  const [pendingBundle, setPendingBundle] = useState(null);

  const saveDevices = (devs) => {
    setLinkedDevices(devs);
    try {
      localStorage.setItem('veil_linked_devices', JSON.stringify(devs));
    } catch (e) {
      console.warn("Could not save linked devices:", e);
    }
  };

  const handleRevokeDevice = (deviceId) => {
    if (confirm("Revoke this linked terminal's access?")) {
      const updated = linkedDevices.filter(d => d.id !== deviceId);
      saveDevices(updated);
    }
  };

  // Generate QR session when opening 'show_qr' tab
  useEffect(() => {
    if (tab === 'show_qr') {
      const sess = generateDeviceLinkSession();
      setSecondarySession(sess);
      if (sendWsMessage) {
        sendWsMessage({ type: 'device_link_init', sessionId: sess.sessionId });
      }
    } else {
      setSecondarySession(null);
    }
  }, [tab]);

  // Clean camera when leaving scan tab
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const stopCamera = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        await html5QrCodeRef.current.clear();
      } catch (err) {
        console.warn("[QR] Stop camera error:", err);
      }
      html5QrCodeRef.current = null;
    }
    setIsCameraActive(false);
  };

  const startCamera = async () => {
    setScannerError(null);
    setPairingStatus(null);
    try {
      if (html5QrCodeRef.current) {
        await stopCamera();
      }
      setIsCameraActive(true);
      await new Promise(r => setTimeout(r, 120));

      const qr = new Html5Qrcode("linked-device-reader", {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false
      });
      html5QrCodeRef.current = qr;

      const config = {
        fps: 20,
        qrbox: (w, h) => {
          const edge = Math.max(160, Math.floor(Math.min(w, h) * 0.85));
          return { width: edge, height: edge };
        }
      };

      const onScanSuccess = async (decodedText) => {
        await stopCamera();
        handleScannedSecondaryQR(decodedText);
      };

      try {
        await qr.start({ facingMode: "environment" }, config, onScanSuccess, () => {});
      } catch {
        await qr.start({ facingMode: "user" }, config, onScanSuccess, () => {});
      }
    } catch (err) {
      setScannerError(err.message || "Failed to initialize camera.");
      setIsCameraActive(false);
    }
  };

  const handleScannedSecondaryQR = async (qrText) => {
    try {
      const payload = JSON.parse(qrText);
      if (payload.type !== 'veil_device_link' || !payload.sessionId || !payload.pubKey) {
        setScannerError("Scanned code is not a valid Project Veil pairing token.");
        setPairingStatus('error');
        return;
      }

      setPairingStatus('pairing');

      // Primary encrypts its key bundle for the secondary device
      const bundleToShare = {
        cipherId: myId,
        keys: keys
      };

      const encrypted = await encryptDeviceLinkPayload(payload.pubKey, bundleToShare);

      if (sendWsMessage) {
        sendWsMessage({
          type: 'device_link_transfer',
          sessionId: payload.sessionId,
          ephemeralPub: encrypted.ephemeralPubB64,
          payload: encrypted.ciphertextB64,
          iv: encrypted.ivB64
        });
      }

      // Add to primary's linked devices list
      const newDev = {
        id: payload.sessionId,
        name: 'Secondary Linked Browser',
        platform: 'Linked via E2EE QR',
        linkedAt: Date.now(),
        isCurrent: false
      };
      saveDevices([...linkedDevices, newDev]);

      setPairingStatus('success');
      setTimeout(() => {
        setTab('list');
        setPairingStatus(null);
      }, 2000);
    } catch (e) {
      console.error("[LINK] Pairing error:", e);
      setScannerError("Decryption or pairing transmission failed.");
      setPairingStatus('error');
    }
  };

  // Listen for WebSocket pairing events
  useEffect(() => {
    const handleWsEvent = async (e) => {
      const data = e.detail;
      if (!data) return;

      if (data.type === 'device_link_transfer' && secondarySession && data.sessionId === secondarySession.sessionId) {
        try {
          const decrypted = await decryptDeviceLinkPayload(
            secondarySession.ephemeralPrivB64,
            data.ephemeralPub,
            data.payload,
            data.iv
          );

          if (decrypted && decrypted.cipherId && decrypted.keys) {
            setPendingBundle(decrypted);
          }
        } catch (err) {
          console.error("[LINK] Failed to decrypt incoming device link:", err);
          alert("Cryptographic verification failed for incoming link transfer.");
        }
      } else if (data.type === 'device_link_ack') {
        if (pairingStatus === 'pairing') {
          setPairingStatus('success');
        }
      }
    };

    window.addEventListener('veil_ws_message', handleWsEvent);
    return () => window.removeEventListener('veil_ws_message', handleWsEvent);
  }, [secondarySession, pairingStatus]);

  const handleFinishSecondaryLink = async (e) => {
    e.preventDefault();
    if (!pendingBundle || secondaryPassphrase.length < 8) return;

    try {
      const fullBundle = {
        cipherId: pendingBundle.cipherId,
        ...pendingBundle.keys
      };
      await wrapAndStoreKeys(secondaryPassphrase, fullBundle);

      if (sendWsMessage && secondarySession) {
        sendWsMessage({
          type: 'device_link_ack',
          sessionId: secondarySession.sessionId,
          ok: true,
          to: pendingBundle.cipherId
        });
      }

      if (onDeviceLinkedSuccess) {
        onDeviceLinkedSuccess(fullBundle);
      }
      onClose();
    } catch (err) {
      alert("Failed to encrypt and store local keystore: " + err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div 
        className={`w-full max-w-lg border flex flex-col max-h-[90vh] shadow-2xl relative ${
          isFlow 
            ? 'bg-[#111b21] border-[#222e35] text-gray-100 rounded-2xl' 
            : 'bg-stark-surface border-arc-cyan/40 text-arc-cyan shadow-glow-cyan'
        }`}
        style={!isFlow ? { clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%)" } : {}}
      >
        {/* Header */}
        <div className={`p-4 border-b flex items-center justify-between ${
          isFlow ? 'border-[#222e35]' : 'border-arc-cyan/30'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isFlow ? 'bg-[#00a884]/20 text-[#00a884]' : 'bg-arc-cyan/10 border border-arc-cyan/40 text-arc-cyan'}`}>
              <Laptop size={20} />
            </div>
            <div>
              <h2 className={`font-bold ${isFlow ? 'text-lg text-white' : 'font-hud text-lg tracking-widest text-arc-cyan'}`}>
                LINKED DEVICES
              </h2>
              <p className={`text-xs ${isFlow ? 'text-gray-400' : 'font-mono text-arc-cyan/60 tracking-wider'}`}>
                End-to-End Encrypted Terminal Synchronization
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className={`p-1.5 rounded-full hover:bg-white/10 transition-colors ${isFlow ? 'text-gray-400 hover:text-white' : 'text-arc-cyan/60 hover:text-arc-cyan'}`}
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Controls */}
        <div className={`flex border-b text-xs font-semibold ${isFlow ? 'border-[#222e35] bg-[#202c33]/50' : 'border-arc-cyan/20 bg-arc-cyan/5 font-hud tracking-wider'}`}>
          <button
            type="button"
            onClick={() => { stopCamera(); setTab('list'); }}
            className={`flex-1 py-3 text-center transition-all ${
              tab === 'list' 
                ? (isFlow ? 'text-[#00a884] border-b-2 border-[#00a884]' : 'text-arc-cyan border-b-2 border-arc-cyan bg-arc-cyan/10') 
                : (isFlow ? 'text-gray-400 hover:text-gray-200' : 'text-arc-cyan/50 hover:text-arc-cyan')
            }`}
          >
            ACTIVE DEVICES ({linkedDevices.length})
          </button>
          <button
            type="button"
            onClick={() => { setTab('scan'); }}
            className={`flex-1 py-3 text-center transition-all ${
              tab === 'scan' 
                ? (isFlow ? 'text-[#00a884] border-b-2 border-[#00a884]' : 'text-arc-cyan border-b-2 border-arc-cyan bg-arc-cyan/10') 
                : (isFlow ? 'text-gray-400 hover:text-gray-200' : 'text-arc-cyan/50 hover:text-arc-cyan')
            }`}
          >
            LINK A DEVICE (SCAN)
          </button>
          <button
            type="button"
            onClick={() => { stopCamera(); setTab('show_qr'); }}
            className={`flex-1 py-3 text-center transition-all ${
              tab === 'show_qr' 
                ? (isFlow ? 'text-[#00a884] border-b-2 border-[#00a884]' : 'text-arc-cyan border-b-2 border-arc-cyan bg-arc-cyan/10') 
                : (isFlow ? 'text-gray-400 hover:text-gray-200' : 'text-arc-cyan/50 hover:text-arc-cyan')
            }`}
          >
            PAIR AS SECONDARY
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex-1 overflow-y-auto">
          {tab === 'list' && (
            <div className="space-y-4">
              <div className="text-xs text-gray-400 leading-relaxed">
                Project Veil uses ephemeral zero-knowledge key encapsulation to link secondary terminals without sending unencrypted master keys through the relay server.
              </div>

              <div className="space-y-2.5">
                {linkedDevices.map((dev) => (
                  <div 
                    key={dev.id} 
                    className={`p-3.5 rounded-xl border flex items-center justify-between ${
                      isFlow ? 'bg-[#202c33]/70 border-[#222e35]' : 'bg-stark-bg border-arc-cyan/30'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${isFlow ? 'bg-white/5 text-gray-300' : 'bg-arc-cyan/10 text-arc-cyan'}`}>
                        {dev.isCurrent ? <Smartphone size={20} /> : <Monitor size={20} />}
                      </div>
                      <div>
                        <div className="font-semibold text-sm flex items-center gap-2">
                          <span>{dev.name}</span>
                          {dev.isCurrent && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono">
                              THIS DEVICE
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                          Linked {new Date(dev.linkedAt).toLocaleDateString()} • {dev.platform}
                        </div>
                      </div>
                    </div>

                    {!dev.isCurrent && (
                      <button
                        type="button"
                        onClick={() => handleRevokeDevice(dev.id)}
                        className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                        title="Revoke device access"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setTab('scan')}
                  className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                    isFlow 
                      ? 'bg-[#00a884] hover:bg-[#02906f] text-white shadow-lg' 
                      : 'bg-arc-cyan/20 border border-arc-cyan hover:bg-arc-cyan/30 text-arc-cyan shadow-glow-cyan font-hud tracking-widest'
                  }`}
                >
                  <Camera size={18} />
                  LINK A NEW DEVICE
                </button>
              </div>
            </div>
          )}

          {tab === 'scan' && (
            <div className="flex flex-col items-center text-center space-y-4">
              <p className="text-xs text-gray-400 max-w-sm">
                Point this camera at the QR code displayed on the new secondary device (laptop, tablet, or browser) to authorize secure synchronization.
              </p>

              <div 
                id="linked-device-reader" 
                className={`w-64 h-64 rounded-2xl overflow-hidden border relative flex items-center justify-center ${
                  isFlow ? 'bg-black border-[#222e35]' : 'bg-black border-arc-cyan shadow-glow-cyan'
                }`}
              >
                {!isCameraActive && (
                  <div className="flex flex-col items-center gap-2 text-gray-500 p-4">
                    <Camera size={36} className={isFlow ? 'text-gray-400' : 'text-arc-cyan'} />
                    <span className="text-xs">Camera viewfinder offline</span>
                  </div>
                )}
              </div>

              {scannerError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2 max-w-sm">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{scannerError}</span>
                </div>
              )}

              {pairingStatus === 'pairing' && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Encapsulating keys & transmitting encrypted vault to secondary device...</span>
                </div>
              )}

              {pairingStatus === 'success' && (
                <div className="p-3 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 size={16} />
                  <span>Device successfully authorized and linked!</span>
                </div>
              )}

              <div className="flex gap-2 w-full max-w-xs">
                {!isCameraActive ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    className={`flex-1 py-2.5 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 ${
                      isFlow ? 'bg-[#00a884] text-white hover:bg-[#02906f]' : 'bg-arc-cyan/20 border border-arc-cyan text-arc-cyan font-hud'
                    }`}
                  >
                    <Camera size={16} />
                    START CAMERA SCANNER
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="flex-1 py-2.5 rounded-xl font-semibold text-xs bg-gray-700 hover:bg-gray-600 text-white"
                  >
                    STOP CAMERA
                  </button>
                )}
              </div>
            </div>
          )}

          {tab === 'show_qr' && (
            <div className="flex flex-col items-center text-center space-y-4">
              {!pendingBundle ? (
                <>
                  <p className="text-xs text-gray-400 max-w-sm">
                    Open Project Veil on your primary mobile device, tap <strong className="text-white">Linked Devices</strong>, and scan this QR code to transfer end-to-end encrypted identity credentials.
                  </p>

                  <div className="p-4 bg-white rounded-2xl shadow-xl border border-white/20">
                    {secondarySession ? (
                      <QRCodeSVG
                        value={secondarySession.qrPayload}
                        size={210}
                        level="M"
                        includeMargin={false}
                      />
                    ) : (
                      <div className="w-[210px] h-[210px] flex items-center justify-center">
                        <RefreshCw size={24} className="animate-spin text-gray-500" />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[11px] font-mono text-gray-400">
                    <ShieldCheck size={14} className="text-emerald-400" />
                    <span>Ephemeral X25519 Keypair • Auto-expires in 5 min</span>
                  </div>
                </>
              ) : (
                <form onSubmit={handleFinishSecondaryLink} className="w-full max-w-sm space-y-4">
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2">
                    <CheckCircle2 size={18} />
                    <div>
                      <div className="font-bold">Identity Credentials Received</div>
                      <div className="text-[10px] opacity-80">Node: {pendingBundle.cipherId}</div>
                    </div>
                  </div>

                  <div className="text-left space-y-1">
                    <label className="text-xs font-semibold text-gray-300">
                      Set Local Vault Passphrase for this Terminal:
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={secondaryPassphrase}
                      onChange={(e) => setSecondaryPassphrase(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full p-3 bg-black/40 border border-gray-700 rounded-xl text-white text-sm focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={secondaryPassphrase.length < 8}
                    className={`w-full py-3 rounded-xl font-bold transition-all ${
                      isFlow ? 'bg-[#00a884] hover:bg-[#02906f] text-white disabled:opacity-50' : 'bg-arc-cyan/20 border border-arc-cyan text-arc-cyan font-hud'
                    }`}
                  >
                    COMPLETE PAIRING & UNLOCK
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
