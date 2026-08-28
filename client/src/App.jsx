import { useState, useEffect } from 'react';
import PassphraseGate from './components/PassphraseGate';
import Onboarding from './components/Onboarding';
import ChatLayout from './components/ChatLayout';
import { hasVault } from './crypto/keyStorage';

export default function App() {
  const [view, setView] = useState('loading');
  const [keys, setKeys] = useState(null);
  const [myId, setMyId] = useState(null);

  useEffect(() => {
    hasVault().then(exists => {
      if (exists) setView('gate');
      else setView('onboarding');
    });
  }, []);

  const handleKeysUnlocked = (unlockedKeys) => {
    setKeys(unlockedKeys);
    setMyId(unlockedKeys.cipherId);
    setView('chat');
  };

  if (view === 'loading') return <div className="min-h-screen bg-stark-bg text-white flex items-center justify-center font-hud text-2xl tracking-widest text-arc-cyan">INITIALIZING...</div>;

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#050811] via-[#080E1C] to-[#04060C] text-gray-100 flex flex-col font-sans overflow-hidden">
      {/* Ambient Radial Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-arc-cyan/10 via-transparent to-transparent pointer-events-none"></div>
      
      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,240,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,240,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"></div>

      <div className="relative z-10 flex flex-col flex-1 h-full">
        {view === 'gate' && <PassphraseGate onUnlock={handleKeysUnlocked} onReset={() => setView('onboarding')} />}
        {view === 'onboarding' && <Onboarding onComplete={handleKeysUnlocked} />}
        {view === 'chat' && <ChatLayout keys={keys} myId={myId} />}
      </div>
    </div>
  );
}
