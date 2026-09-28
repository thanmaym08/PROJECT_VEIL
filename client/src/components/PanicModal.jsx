import { ShieldAlert, AlertTriangle, Flame } from 'lucide-react';

export default function PanicModal({ isOpen, onClose, onConfirm }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md bg-[#0a0810] border-2 border-stark-crimson shadow-[0_0_30px_rgba(255,42,95,0.4)] p-6 relative overflow-hidden"
        style={{ clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%)" }}
      >
        {/* Top Warning Strip */}
        <div className="flex items-center gap-2 text-stark-crimson mb-4 font-hud tracking-[0.25em] text-sm uppercase font-bold border-b border-stark-crimson/30 pb-3">
          <Flame size={20} className="animate-bounce" />
          <span>ZERO-FORENSIC PANIC WIPE</span>
        </div>

        <div className="space-y-3 font-mono text-xs text-gray-300">
          <p className="text-stark-crimson font-bold text-sm">
            CRITICAL WARNING: PROTOCOL DESTRUCTION INITIATED
          </p>
          <p className="text-gray-400 leading-relaxed text-[11px]">
            Executing this emergency wipe will immediately:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-[11px] text-gray-300 pl-1">
            <li>Zeroize all active ML-KEM and X25519 ratchet keys in RAM</li>
            <li>Purge persistent vaults and local IndexedDB message archives</li>
            <li>Destroy all peer session states and reset relay uplinks</li>
            <li>Revert client state to zero-knowledge pre-initialization</li>
          </ul>
          <p className="text-stark-gold text-[10px] uppercase tracking-wider font-bold pt-1">
            ⚠️ This action cannot be reversed. No recovery keys exist.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 bg-transparent border border-gray-600 hover:border-gray-400 text-gray-300 font-hud tracking-wider text-xs uppercase transition-colors"
          >
            Abort // Stand Down
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 py-2.5 px-4 bg-stark-crimson hover:bg-red-600 text-white font-hud tracking-widest text-xs uppercase font-bold transition-all shadow-[0_0_15px_rgba(255,42,95,0.5)] flex items-center justify-center gap-1.5"
          >
            <ShieldAlert size={15} />
            <span>Purge & Wipe</span>
          </button>
        </div>
      </div>
    </div>
  );
}
