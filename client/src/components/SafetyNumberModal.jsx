import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, ShieldCheck, ShieldAlert } from 'lucide-react';
import { computeSafetyNumber } from '../crypto/safetyNumber';

export default function SafetyNumberModal({ myId, myKeys, contact, onClose, onVerify }) {
  const [safetyNumber, setSafetyNumber] = useState('');

  useEffect(() => {
    const sn = computeSafetyNumber(
      myId, contact.id,
      myKeys.mlkem.publicKeyB64, myKeys.x25519.publicKeyB64,
      contact.mlkemPub, contact.x25519Pub
    );
    setSafetyNumber(sn);
  }, [myId, myKeys, contact]);

  return (
    <div className="fixed inset-0 bg-stark-bg/90 backdrop-blur-md flex items-center justify-center p-4 z-50">
      <div className="bg-stark-surface border border-arc-cyan/30 w-full max-w-sm flex flex-col shadow-glow-cyan" style={{clipPath: "polygon(0 0, 100% 0, 100% 95%, 95% 100%, 0 100%)"}}>
        <div className="flex justify-between items-center p-4 border-b border-arc-cyan/20 bg-arc-cyan/5">
          <h2 className="font-hud font-bold tracking-[0.2em] text-arc-cyan text-sm flex items-center gap-2">
            {contact.verified ? <ShieldCheck className="text-arc-cyan" size={18} /> : <ShieldAlert className="text-stark-gold" size={18} />}
            AUTHENTICATION MATRIX
          </h2>
          <button onClick={onClose} className="text-arc-cyan/50 hover:text-arc-cyan transition-colors"><X size={20} /></button>
        </div>
        
        <div className="p-6 flex flex-col items-center">
          <p className="text-xs font-mono text-arc-cyan/70 text-center mb-6 uppercase">
            Visually confirm the following cryptographic fingerprint with <span className="text-white font-bold">{contact.name}</span> to ensure zero MITM interception.
          </p>

          <div className="bg-white p-4 mb-6 relative group border border-arc-cyan" style={{clipPath: "polygon(5% 0, 100% 0, 100% 95%, 95% 100%, 0 100%, 0 5%)"}}>
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-arc-cyan"></div>
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-arc-cyan"></div>
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-arc-cyan"></div>
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-arc-cyan"></div>
            <QRCodeSVG value={safetyNumber} size={180} />
          </div>

          <div className="grid grid-cols-2 gap-4 font-mono text-lg font-bold tracking-widest text-arc-cyan mb-8 text-center bg-stark-bg p-4 border border-arc-cyan/20">
            {safetyNumber.split(' ').map((chunk, i) => (
              <div key={i}>{chunk}</div>
            ))}
          </div>

          <label className={`flex items-center gap-3 w-full p-4 border cursor-pointer transition-all ${contact.verified ? 'bg-arc-cyan/10 border-arc-cyan shadow-glow-cyan' : 'bg-stark-bg border-arc-cyan/30 hover:border-arc-cyan/60'}`} style={{clipPath: "polygon(0 0, 100% 0, 100% 80%, 95% 100%, 0 100%)"}}>
            <input 
              type="checkbox" 
              checked={contact.verified}
              onChange={(e) => onVerify(e.target.checked)}
              className="w-5 h-5 accent-arc-cyan cursor-pointer"
            />
            <span className={`font-hud tracking-[0.2em] font-bold ${contact.verified ? 'text-arc-cyan' : 'text-arc-cyan/50'}`}>
              {contact.verified ? 'NODE AUTHENTICATED' : 'ACKNOWLEDGE MATCH'}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
