import { useState, useEffect } from 'react';
import { generateCipherId, generateLongTermKeys } from '../crypto/identity';
import { wrapAndStoreKeys } from '../crypto/keyStorage';
import { ShieldCheck, Copy } from 'lucide-react';

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(1);
  const [cipherId, setCipherId] = useState('');
  const [keys, setKeys] = useState(null);
  const [passphrase, setPassphrase] = useState('');
  const [nickname, setNickname] = useState('');

  useEffect(() => {
    setCipherId(generateCipherId());
    setKeys(generateLongTermKeys());
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(cipherId);
  };

  const handleFinish = async (e) => {
    e.preventDefault();
    if (passphrase.length < 8) return;
    
    const bundle = { cipherId, nickname, ...keys };
    await wrapAndStoreKeys(passphrase, bundle);
    onComplete(bundle);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4">
      {/* Arc Reactor Core */}
      <div className="relative w-24 h-24 mb-6 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border-4 border-arc-cyan/20 border-t-arc-cyan animate-[spin_4s_linear_infinite] shadow-glow-cyan"></div>
        <div className="absolute inset-2 rounded-full border-2 border-arc-cyan/10 border-b-arc-cyan animate-[spin_3s_linear_infinite_reverse]"></div>
        <div className="absolute inset-4 rounded-full bg-arc-cyan/5 backdrop-blur-sm"></div>
        <ShieldCheck className="w-8 h-8 text-arc-cyan relative z-10" />
      </div>

      <h1 className="text-4xl font-hud font-bold tracking-[0.2em] text-white mb-2">PROJECT VEIL</h1>
      <p className="text-arc-cyan/70 font-mono text-xs tracking-widest mb-10 text-center max-w-md uppercase">
        Sovereign Quantum-Resistant Terminal // No Metadata // Local Node Only
      </p>

      {step === 1 && (
        <div className="w-full max-w-sm bg-stark-surface p-8 border border-arc-cyan/30 text-center flex flex-col gap-6 shadow-[inset_0_0_20px_rgba(0,240,255,0.05)]" style={{clipPath: "polygon(0 0, 100% 0, 100% 95%, 95% 100%, 0 100%)"}}>
          <h2 className="text-xs font-hud text-arc-cyan/70 uppercase tracking-[0.2em]">Generated Cipher ID</h2>
          
          <div className="relative p-4 border border-arc-cyan/20 bg-stark-bg group cursor-pointer overflow-hidden" onClick={handleCopy}>
            <div className="absolute inset-0 bg-gradient-to-b from-arc-cyan/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="absolute top-0 left-0 w-full h-[1px] bg-arc-cyan opacity-0 group-hover:opacity-100 group-hover:animate-[scan_2s_linear_infinite]"></div>
            <div className="text-xl font-mono tracking-widest text-arc-cyan select-all break-all leading-relaxed">
              {cipherId || 'GENERATING...'}
            </div>
            <div className="absolute bottom-1 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Copy className="w-4 h-4 text-arc-cyan" />
            </div>
          </div>
          
          <input 
            type="text"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            placeholder="REGISTER PUBLIC NICKNAME"
            required
            className="w-full bg-stark-bg border border-arc-cyan/30 p-3 text-center text-white font-hud tracking-widest placeholder:text-arc-cyan/30 focus:outline-none focus:border-arc-cyan focus:ring-1 focus:ring-arc-cyan/50 transition-all duration-200"
          />

          <button onClick={() => setStep(2)} disabled={!nickname} className="relative group w-full bg-arc-cyan/10 hover:bg-arc-cyan/20 disabled:opacity-50 border border-arc-cyan p-4 font-hud font-bold tracking-[0.2em] text-arc-cyan transition-all duration-200 hover:shadow-glow-cyan overflow-hidden" style={{clipPath: "polygon(5% 0, 100% 0, 95% 100%, 0% 100%)"}}>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-arc-cyan/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out"></div>
            ENGAGE PROTOCOL
          </button>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={handleFinish} className="w-full max-w-sm bg-stark-surface p-8 border border-stark-gold/30 text-center flex flex-col gap-6 shadow-glow-gold" style={{clipPath: "polygon(0 5%, 5% 0, 100% 0, 100% 95%, 95% 100%, 0 100%)"}}>
          <h2 className="text-xs font-hud text-stark-gold uppercase tracking-[0.2em]">ENCRYPT LOCAL KEYSTORE</h2>
          <p className="text-stark-gold/70 text-xs font-mono">WARNING: Lost passphrases cannot be recovered.</p>
          
          <input 
            type="password"
            value={passphrase}
            onChange={e => setPassphrase(e.target.value)}
            placeholder="ENTER MASTER PASSPHRASE"
            className="w-full bg-stark-bg border border-stark-gold/30 p-4 text-center text-stark-gold font-mono placeholder:text-stark-gold/30 focus:outline-none focus:border-stark-gold focus:ring-1 focus:ring-stark-gold/50 transition-all duration-200"
            autoFocus
          />
          <button type="submit" disabled={passphrase.length < 8} className="relative group w-full bg-stark-gold/10 hover:bg-stark-gold/20 disabled:opacity-50 border border-stark-gold p-4 font-hud font-bold tracking-[0.2em] text-stark-gold transition-all duration-200 hover:shadow-glow-gold overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-stark-gold/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out"></div>
            FINALIZE ENCRYPTION
          </button>
        </form>
      )}
    </div>
  );
}
