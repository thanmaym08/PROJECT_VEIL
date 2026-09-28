import { useState } from 'react';
import { X, Check, Image as ImageIcon, Sparkles } from 'lucide-react';

export const WALLPAPERS = [
  {
    id: 'doodle',
    name: 'WhatsApp Classic Doodle',
    bgClass: "bg-[#0b141a] bg-[radial-gradient(#202c33_1px,transparent_1px)] [background-size:16px_16px]"
  },
  {
    id: 'emerald',
    name: 'Deep Emerald',
    bgClass: "bg-gradient-to-b from-[#061e19] via-[#092922] to-[#041410]"
  },
  {
    id: 'slate',
    name: 'Slate Minimal',
    bgClass: "bg-[#111b21]"
  },
  {
    id: 'cyber',
    name: 'Cyberpunk HUD',
    bgClass: "bg-[#050811] bg-[linear-gradient(rgba(0,240,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(0,240,255,0.05)_1px,transparent_1px)] bg-[size:24px_24px]"
  },
  {
    id: 'midnight',
    name: 'Pitch Obsidian',
    bgClass: "bg-[#000000]"
  },
  {
    id: 'indigo',
    name: 'Cosmic Indigo',
    bgClass: "bg-gradient-to-br from-[#0c1021] via-[#14122c] to-[#080718]"
  }
];

export default function WallpaperModal({ isOpen, onClose, currentWallpaper, onSelectWallpaper }) {
  const [selectedId, setSelectedId] = useState(currentWallpaper || 'doodle');

  if (!isOpen) return null;

  const handleApply = () => {
    onSelectWallpaper(selectedId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#111b21] border border-[#222d34] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#202c33] px-5 py-4 border-b border-[#222d34]">
          <div className="flex items-center gap-2.5 text-[#00a884]">
            <ImageIcon size={20} />
            <h3 className="font-hud tracking-wider text-white text-sm font-bold">CHAT WALLPAPER</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Wallpaper Grid */}
        <div className="p-5 grid grid-cols-2 gap-3.5 max-h-[60vh] overflow-y-auto">
          {WALLPAPERS.map((wp) => {
            const isSelected = selectedId === wp.id;
            return (
              <div
                key={wp.id}
                onClick={() => setSelectedId(wp.id)}
                className={`relative h-28 rounded-xl cursor-pointer overflow-hidden border-2 transition-all p-2 flex flex-col justify-end ${wp.bgClass} ${
                  isSelected ? 'border-[#00a884] shadow-[0_0_15px_rgba(0,168,132,0.4)] scale-102' : 'border-white/10 hover:border-white/30'
                }`}
              >
                {/* Simulated Chat Bubble Preview */}
                <div className="w-3/4 bg-[#005c4b] text-[8px] text-white p-1 rounded-md ml-auto mb-1 opacity-80 shadow">
                  Hey there!
                </div>
                <div className="w-3/4 bg-[#202c33] text-[8px] text-gray-200 p-1 rounded-md mr-auto mb-2 opacity-80 shadow">
                  Encrypted hello 👋
                </div>

                <div className="bg-black/60 backdrop-blur-xs px-2 py-0.5 rounded text-[10px] text-white font-medium flex items-center justify-between">
                  <span className="truncate">{wp.name}</span>
                  {isSelected && <Check size={12} className="text-[#00a884]" />}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#202c33] border-t border-[#222d34]">
          <button
            onClick={handleApply}
            className="w-full py-3 bg-[#00a884] hover:bg-[#00c69d] text-white font-hud tracking-wider text-xs font-bold uppercase rounded-xl transition-all shadow-md"
          >
            SET WALLPAPER
          </button>
        </div>
      </div>
    </div>
  );
}
