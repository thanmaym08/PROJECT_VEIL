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
    hasVault().then(async exists => {
      if (exists) {
        if (window.Capacitor?.isNative) {
          try {
            const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
            const result = await NativeBiometric.isAvailable();
            if (result.isAvailable) {
              const creds = await NativeBiometric.getSecureCredentials({
                server: "veil.system",
                title: "VEIL AUTHENTICATION",
                subtitle: "Access encrypted vault",
                description: "Scan biometric to unlock keys"
              });
              
              if (creds && creds.password) {
                const { unwrapKeys } = await import('./crypto/keyStorage');
                const keys = await unwrapKeys(creds.password);
                handleKeysUnlocked(keys);
                return;
              }
            }
          } catch (e) {
            console.warn("Biometric auth failed or skipped:", e);
          }
        }
        setView('gate');
      } else {
        setView('onboarding');
      }
    });
  }, []);

  const handleKeysUnlocked = (unlockedKeys) => {
    setKeys(unlockedKeys);
    setMyId(unlockedKeys.cipherId);
    setView('chat');
  };

  if (view === 'loading') return <div className="min-h-screen bg-stark-bg text-white flex items-center justify-center font-hud text-2xl tracking-widest text-arc-cyan">INITIALIZING...</div>;

  const handleReset = async () => {
    if (window.Capacitor?.isNative) {
      try {
        const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
        await SecureStoragePlugin.remove({ key: 'vault' });
        
        const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
        await NativeBiometric.deleteCredentials({ server: 'veil.system' });
      } catch (e) {
        console.warn(e);
      }
    } else {
      localStorage.removeItem('veil_vault');
    }
    
    // Also clear IndexedDB
    try {
      indexedDB.deleteDatabase('veil_data');
      indexedDB.deleteDatabase('veil_vault');
    } catch (e) {}

    setView('onboarding');
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#050811] via-[#080E1C] to-[#04060C] text-gray-100 flex flex-col font-sans overflow-hidden">
      {/* Ambient Radial Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-arc-cyan/10 via-transparent to-transparent pointer-events-none"></div>
      
      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,240,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,240,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"></div>

      <div className="relative z-10 flex flex-col flex-1 h-full">
        {view === 'gate' && <PassphraseGate onUnlock={handleKeysUnlocked} onReset={handleReset} />}
        {view === 'onboarding' && <Onboarding onComplete={handleKeysUnlocked} />}
        {view === 'chat' && <ChatLayout keys={keys} myId={myId} />}
      </div>
    </div>
  );
}
