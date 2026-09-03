import { useState, useEffect } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { QRCodeSVG } from 'qrcode.react';
import { X } from 'lucide-react';
import { Clipboard } from '@capacitor/clipboard';

export default function AddContactModal({ myId, keys, onClose, onAdd }) {
  const [tab, setTab] = useState('scan');
  const [scannedData, setScannedData] = useState('');
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let scanner = null;
    if (tab === 'scan') {
      scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
      scanner.render((text) => {
        setScannedData(text);
        try {
          const d = JSON.parse(text);
          if (d.nickname) setName(d.nickname);
        } catch(e) {}
        try { scanner.clear(); } catch(e) {}
      }, (err) => {});
    }
    return () => {
      if (scanner) {
        try { scanner.clear().catch(() => {}); } catch (e) {}
      }
    };
  }, [tab]);

  // Also auto-parse if user pastes it
  useEffect(() => {
    try {
      const d = JSON.parse(scannedData);
      if (d.nickname && !name) setName(d.nickname);
    } catch(e) {}
  }, [scannedData]);

  const handleAdd = (e) => {
    e.preventDefault();
    try {
      const data = JSON.parse(scannedData);
      if (data.id && data.mlkemPub && data.x25519Pub && data.ed25519Pub && name) {
        onAdd({
          id: data.id,
          name,
          mlkemPub: data.mlkemPub,
          x25519Pub: data.x25519Pub,
          ed25519Pub: data.ed25519Pub,
          verified: false
        });
      }
    } catch (e) {
      alert("Invalid contact data format");
    }
  };

  const handleCopy = async () => {
    try {
      await Clipboard.write({ string: myData });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Clipboard write failed", e);
      try {
        navigator.clipboard.writeText(myData);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {}
    }
  };

  const myData = JSON.stringify({
    id: myId,
    nickname: keys.nickname,
    mlkemPub: keys.mlkem.publicKeyB64,
    x25519Pub: keys.x25519.publicKeyB64,
    ed25519Pub: keys.ed25519.publicKeyB64
  });

  return (
    <div className="fixed inset-0 bg-stark-bg/90 backdrop-blur-md flex items-center justify-center p-4 z-50">
      <div className="bg-stark-surface border border-arc-cyan/30 w-full max-w-md flex flex-col shadow-glow-cyan" style={{clipPath: "polygon(0 0, 100% 0, 100% 95%, 95% 100%, 0 100%)"}}>
        <div className="flex justify-between items-center p-4 border-b border-arc-cyan/20 bg-arc-cyan/5">
          <h2 className="font-hud font-bold tracking-[0.2em] text-arc-cyan text-sm">ADD TARGET NODE</h2>
          <button onClick={onClose} className="text-arc-cyan/50 hover:text-arc-cyan transition-colors"><X size={20} /></button>
        </div>
        
        <div className="flex border-b border-arc-cyan/20">
          <button onClick={() => setTab('scan')} className={`flex-1 py-3 text-xs font-hud tracking-[0.1em] ${tab === 'scan' ? 'bg-arc-cyan/10 text-arc-cyan border-b-2 border-arc-cyan' : 'text-gray-500 hover:text-gray-400'} transition-all`}>SCAN / IMPORT</button>
          <button onClick={() => setTab('myid')} className={`flex-1 py-3 text-xs font-hud tracking-[0.1em] ${tab === 'myid' ? 'bg-arc-cyan/10 text-arc-cyan border-b-2 border-arc-cyan' : 'text-gray-500 hover:text-gray-400'} transition-all`}>MY TELEMETRY</button>
        </div>

        <div className="p-6">
          {tab === 'myid' ? (
            <div className="flex flex-col items-center text-center">
              <div className="bg-white p-4 mb-6 relative group border border-arc-cyan" style={{clipPath: "polygon(5% 0, 100% 0, 100% 95%, 95% 100%, 0 100%, 0 5%)"}}>
                {/* 4 Corner Brackets */}
                <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-arc-cyan"></div>
                <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-arc-cyan"></div>
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-arc-cyan"></div>
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-arc-cyan"></div>
                <QRCodeSVG value={myData} size={200} />
              </div>
              <p className="text-xs font-mono text-arc-cyan/50 mb-2 uppercase">Scan to acquire public keys</p>
              <div className="w-full relative group">
                <textarea readOnly value={myData} className="w-full h-20 bg-stark-bg border border-arc-cyan/30 p-2 text-[8px] font-mono text-arc-cyan/50 custom-scrollbar resize-none focus:outline-none" />
                <button 
                  onClick={handleCopy} 
                  className={`absolute bottom-2 right-2 px-3 py-1 text-xs font-hud tracking-widest transition-all shadow-glow-cyan ${copied ? 'bg-arc-cyan text-stark-bg' : 'bg-arc-cyan/20 hover:bg-arc-cyan border border-arc-cyan text-arc-cyan hover:text-stark-bg'}`}
                >
                  {copied ? 'COPIED!' : 'COPY JSON'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="relative">
                <div id="reader" className="w-full bg-stark-bg border border-arc-cyan/30 overflow-hidden relative min-h-[250px] flex items-center justify-center shadow-[inset_0_0_20px_rgba(0,240,255,0.05)]"></div>
                {/* HUD Overlay for Scanner */}
                <div className="absolute inset-0 pointer-events-none border-2 border-arc-cyan/10">
                  <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-arc-cyan"></div>
                  <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-arc-cyan"></div>
                  <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-arc-cyan"></div>
                  <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-arc-cyan"></div>
                  <div className="absolute top-1/2 left-0 w-full h-[1px] bg-arc-cyan/30 shadow-glow-cyan animate-[scan_2s_ease-in-out_infinite]"></div>
                </div>
              </div>
              
              <div className="flex items-center gap-2 my-2">
                <div className="h-[1px] flex-1 bg-arc-cyan/20"></div>
                <span className="text-[10px] font-mono text-arc-cyan/50 tracking-widest">OR MANUAL IMPORT</span>
                <div className="h-[1px] flex-1 bg-arc-cyan/20"></div>
              </div>

              <form onSubmit={handleAdd} className="flex flex-col gap-4">
                <textarea 
                  value={scannedData}
                  onChange={e => setScannedData(e.target.value)}
                  placeholder="Paste the FULL identity package here (the JSON text starting with '{').&#10;&#10;Note: Just entering a Cipher ID is not enough, as we need their public cryptographic keys to establish a secure link."
                  className="w-full bg-stark-bg border border-arc-cyan/30 p-3 text-xs font-mono text-arc-cyan h-28 placeholder:text-arc-cyan/40 focus:outline-none focus:border-arc-cyan focus:ring-1 focus:ring-arc-cyan/50 custom-scrollbar"
                />
                <input 
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="ENTER TARGET'S NICKNAME (e.g. 'Alice')"
                  required
                  className="w-full bg-stark-bg border border-arc-cyan/30 p-3 text-white font-hud tracking-[0.1em] placeholder:text-arc-cyan/30 focus:outline-none focus:border-arc-cyan focus:ring-1 focus:ring-arc-cyan/50"
                />
                <button type="submit" disabled={!name || !scannedData} className="relative group w-full bg-arc-cyan/10 hover:bg-arc-cyan/20 disabled:opacity-50 border border-arc-cyan p-4 font-hud font-bold tracking-[0.2em] text-arc-cyan transition-all duration-200 hover:shadow-glow-cyan overflow-hidden" style={{clipPath: "polygon(5% 0, 100% 0, 95% 100%, 0% 100%)"}}>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-arc-cyan/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out"></div>
                  REGISTER TARGET
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
