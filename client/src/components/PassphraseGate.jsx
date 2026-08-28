import { useState } from 'react';
import { unwrapKeys } from '../crypto/keyStorage';
import { Lock } from 'lucide-react';

export default function PassphraseGate({ onUnlock, onReset }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const keys = await unwrapKeys(passphrase);
      onUnlock(keys);
    } catch (err) {
      setError('Invalid passphrase.');
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4">
      
      {/* Arc Reactor Core */}
      <div className="relative w-32 h-32 mb-8 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border-4 border-arc-cyan/20 border-t-arc-cyan animate-[spin_4s_linear_infinite] shadow-glow-cyan"></div>
        <div className="absolute inset-2 rounded-full border-2 border-arc-cyan/10 border-b-arc-cyan animate-[spin_3s_linear_infinite_reverse]"></div>
        <div className="absolute inset-4 rounded-full bg-arc-cyan/5 backdrop-blur-sm shadow-[inset_0_0_20px_rgba(0,240,255,0.2)]"></div>
        <Lock className="w-8 h-8 text-arc-cyan relative z-10" />
      </div>

      <h1 className="text-3xl font-hud font-bold tracking-[0.2em] text-white mb-8">SECURE SYSTEM ACCESS</h1>
      
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4">
        <input 
          type="password"
          value={passphrase}
          onChange={e => setPassphrase(e.target.value)}
          placeholder="ENTER DECRYPTION PASSPHRASE"
          className="w-full p-4 bg-stark-surface border border-arc-cyan/30 text-arc-cyan font-mono text-center placeholder:text-arc-cyan/30 focus:outline-none focus:border-arc-cyan focus:ring-1 focus:ring-arc-cyan/50 shadow-[inset_0_0_10px_rgba(0,240,255,0.05)] transition-all duration-200 ease-out"
          autoFocus
        />
        {error && <p className="text-stark-crimson font-mono text-sm text-center tracking-widest">{error}</p>}
        
        <button type="submit" className="relative group w-full bg-arc-cyan/10 hover:bg-arc-cyan/20 border border-arc-cyan p-4 font-hud font-bold tracking-[0.2em] text-arc-cyan transition-all duration-200 hover:shadow-glow-cyan overflow-hidden" style={{clipPath: "polygon(5% 0, 100% 0, 95% 100%, 0% 100%)"}}>
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-arc-cyan/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out"></div>
          INITIALIZE
        </button>
      </form>

      <button onClick={onReset} className="mt-12 font-hud tracking-[0.1em] text-sm text-gray-500 hover:text-stark-crimson hover:shadow-glow-crimson transition-all duration-200">
        PURGE KEYSTORE (FACTORY RESET)
      </button>
    </div>
  );
}
