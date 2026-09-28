import { useState, useEffect, useRef } from 'react';
import { Camera, X, RotateCcw, Check, Sparkles } from 'lucide-react';

export default function CameraSnapModal({ isOpen, onClose, onCapture }) {
  const [facingMode, setFacingMode] = useState('environment');
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [hasCamera, setHasCamera] = useState(true);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      cleanupStream();
      return;
    }
    startStream();
    return () => {
      cleanupStream();
    };
  }, [isOpen, facingMode]);

  const cleanupStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setCapturedBlob(null);
  };

  const startStream = async () => {
    cleanupStream();
    try {
      const constraints = {
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setHasCamera(true);
    } catch (err) {
      console.warn("Direct ideal facingMode failed, falling back to basic video:", err);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setHasCamera(true);
      } catch (e) {
        console.error("No camera found or permission denied:", e);
        setHasCamera(false);
      }
    }
  };

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    
    // If using user front camera, mirror it horizontally
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedBlob(blob);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      }
    }, 'image/jpeg', 0.92);
  };

  const handleRetake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
  };

  const handleConfirm = () => {
    if (capturedBlob) {
      const file = new File([capturedBlob], `snap_${Date.now()}.jpg`, { type: 'image/jpeg' });
      onCapture(file);
      onClose();
    }
  };

  const toggleFlip = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-between p-4 sm:p-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="w-full max-w-lg flex items-center justify-between z-10">
        <div className="flex items-center gap-2 text-xs font-hud tracking-widest text-[#00a884]">
          <Camera size={18} />
          <span>VEIL CAMERA SNAP</span>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-white bg-white/10 rounded-full transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Viewfinder / Preview */}
      <div className="relative w-full max-w-lg aspect-[3/4] sm:aspect-square bg-black rounded-2xl overflow-hidden border border-white/10 shadow-2xl flex items-center justify-center my-auto">
        {!previewUrl ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
            />
            {!hasCamera && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-gray-400 bg-black/80">
                <p className="text-sm font-bold text-red-400">Camera Unavailable</p>
                <p className="text-xs mt-1">Please ensure camera permissions are granted in browser settings.</p>
              </div>
            )}
          </>
        ) : (
          <img src={previewUrl} alt="Snap preview" className="w-full h-full object-cover" />
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Bottom Controls */}
      <div className="w-full max-w-lg flex items-center justify-around py-4 z-10">
        {!previewUrl ? (
          <>
            <button
              onClick={toggleFlip}
              className="p-3.5 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
              title="Flip Camera"
            >
              <RotateCcw size={22} />
            </button>

            {/* Shutter Button */}
            <button
              onClick={handleCapture}
              disabled={!hasCamera}
              className="w-18 h-18 sm:w-20 sm:h-20 rounded-full border-4 border-white p-1 hover:scale-105 active:scale-95 transition-transform flex items-center justify-center bg-white/20 disabled:opacity-50"
            >
              <div className="w-full h-full rounded-full bg-white shadow-lg"></div>
            </button>

            <div className="w-12 h-12" /> {/* Spacer balance */}
          </>
        ) : (
          <div className="w-full flex items-center justify-between px-6">
            <button
              onClick={handleRetake}
              className="py-3 px-6 bg-white/10 hover:bg-white/20 text-gray-200 rounded-full text-xs font-hud tracking-wider flex items-center gap-2 transition-colors"
            >
              <RotateCcw size={16} />
              <span>RETAKE</span>
            </button>

            <button
              onClick={handleConfirm}
              className="py-3 px-8 bg-[#00a884] hover:bg-[#00c69d] text-white rounded-full text-xs font-hud tracking-wider font-bold flex items-center gap-2 shadow-[0_0_20px_rgba(0,168,132,0.4)] transition-all"
            >
              <Check size={18} />
              <span>SEND SNAP</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
