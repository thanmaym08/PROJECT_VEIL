import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, Sparkles, Image, Smile, Clock } from 'lucide-react';
import { EMOJI_CATEGORIES, EMOJI_DATABASE, CYBER_STICKERS, GIF_PRESETS } from './emojiData';

const RECENT_KEY = 'veil_recent_emojis';

export default function EmojiGifPicker({ 
  onSelectEmoji, 
  onSelectGif, 
  onSelectSticker, 
  onClose,
  mode = 'all' // 'all' | 'emoji-only'
}) {
  const [activeTab, setActiveTab] = useState('emoji'); // 'emoji' | 'gifs' | 'stickers'
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('smileys');
  const [recentEmojis, setRecentEmojis] = useState([]);
  const [gifCategory, setGifCategory] = useState('Trending');
  const [searchResultsGifs, setSearchResultsGifs] = useState(null);
  const [isSearchingGifs, setIsSearchingGifs] = useState(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_KEY);
      if (saved) setRecentEmojis(JSON.parse(saved));
    } catch {}
  }, []);

  const handleEmojiClick = (emoji) => {
    // Update recents
    const updated = [emoji, ...recentEmojis.filter(e => e !== emoji)].slice(0, 32);
    setRecentEmojis(updated);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    } catch {}

    if (onSelectEmoji) onSelectEmoji(emoji);
  };

  // Filter emojis based on search or category
  const displayedEmojis = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const results = [];
      const seen = new Set();
      for (const cat of Object.keys(EMOJI_DATABASE)) {
        for (const item of EMOJI_DATABASE[cat]) {
          if (!seen.has(item.emoji)) {
            if (item.tags.some(t => t.includes(q)) || item.emoji.includes(q)) {
              seen.add(item.emoji);
              results.push(item.emoji);
            }
          }
        }
      }
      return results;
    }

    if (activeCategory === 'recent') {
      return recentEmojis;
    }

    return (EMOJI_DATABASE[activeCategory] || []).map(i => i.emoji);
  }, [searchQuery, activeCategory, recentEmojis]);

  // Handle GIF Search
  useEffect(() => {
    const q = searchQuery.trim();
    if (activeTab !== 'gifs' || !q) {
      setSearchResultsGifs(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingGifs(true);
      try {
        // Use free public Giphy API endpoint with safe limit
        const res = await fetch(
          `https://api.giphy.com/v1/gifs/search?api_key=dc6zaTOxFJmzC&q=${encodeURIComponent(q)}&limit=12&rating=g`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.data && data.data.length > 0) {
            const mapped = data.data.map(g => ({
              id: g.id,
              title: g.title || q,
              url: g.images?.original?.url || g.images?.downsized?.url,
              preview: g.images?.fixed_width?.url || g.images?.preview_gif?.url
            }));
            setSearchResultsGifs(mapped);
          } else {
            setSearchResultsGifs([]);
          }
        } else {
          // Fallback to local filter
          fallbackFilterGifs(q);
        }
      } catch (err) {
        fallbackFilterGifs(q);
      } finally {
        setIsSearchingGifs(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, activeTab]);

  const fallbackFilterGifs = (q) => {
    const lq = q.toLowerCase();
    const all = GIF_PRESETS.flatMap(p => p.gifs);
    const matched = all.filter(g => g.title.toLowerCase().includes(lq));
    setSearchResultsGifs(matched);
  };

  const displayedGifs = useMemo(() => {
    if (searchResultsGifs !== null) return searchResultsGifs;
    const preset = GIF_PRESETS.find(p => p.category === gifCategory) || GIF_PRESETS[0];
    return preset.gifs;
  }, [searchResultsGifs, gifCategory]);

  return (
    <div 
      className="bg-stark-surface border border-arc-cyan/50 shadow-glow-cyan flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 rounded-none w-full max-w-sm sm:max-w-md h-80 z-40"
      style={{ clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Header & Tab Navigation */}
      <div className="flex items-center justify-between border-b border-arc-cyan/20 bg-black/60 px-3 py-2">
        {mode !== 'emoji-only' ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setActiveTab('emoji'); setSearchQuery(''); }}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-hud tracking-wider transition-all ${
                activeTab === 'emoji'
                  ? 'bg-arc-cyan/20 text-arc-cyan border border-arc-cyan/60 shadow-[0_0_8px_rgba(0,240,255,0.3)]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Smile size={13} /> EMOJI
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('gifs'); setSearchQuery(''); }}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-hud tracking-wider transition-all ${
                activeTab === 'gifs'
                  ? 'bg-arc-cyan/20 text-arc-cyan border border-arc-cyan/60 shadow-[0_0_8px_rgba(0,240,255,0.3)]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Image size={13} /> GIFS
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('stickers'); setSearchQuery(''); }}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-hud tracking-wider transition-all ${
                activeTab === 'stickers'
                  ? 'bg-arc-cyan/20 text-arc-cyan border border-arc-cyan/60 shadow-[0_0_8px_rgba(0,240,255,0.3)]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Sparkles size={13} /> STICKERS
            </button>
          </div>
        ) : (
          <div className="font-hud text-xs tracking-widest text-arc-cyan font-bold flex items-center gap-1.5">
            <Smile size={14} /> SELECT REACTION
          </div>
        )}

        <button 
          type="button"
          onClick={onClose}
          className="text-arc-cyan/60 hover:text-stark-crimson p-1 transition-colors"
          title="Close Picker"
        >
          <X size={16} />
        </button>
      </div>

      {/* Search Bar (for Emoji & GIFs) */}
      {activeTab !== 'stickers' && (
        <div className="p-2 border-b border-arc-cyan/20 bg-stark-bg/80">
          <div className="relative flex items-center">
            <Search size={14} className="absolute left-2.5 text-arc-cyan/50" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={activeTab === 'emoji' ? "Search all emojis (e.g. fire, skull, love)..." : "Search animated GIFs (e.g. cyber, matrix)..."}
              className="w-full bg-stark-surface border border-arc-cyan/30 pl-8 pr-7 py-1.5 text-xs font-mono text-arc-cyan placeholder:text-arc-cyan/30 focus:outline-none focus:border-arc-cyan"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-arc-cyan/50 hover:text-arc-cyan p-0.5"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: EMOJIS */}
      {activeTab === 'emoji' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Categories bar if not searching */}
          {!searchQuery && (
            <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto custom-scrollbar border-b border-arc-cyan/10 bg-black/40">
              {recentEmojis.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveCategory('recent')}
                  className={`p-1 rounded text-sm transition-all ${
                    activeCategory === 'recent' ? 'bg-arc-cyan/30 scale-110 shadow-glow-cyan' : 'opacity-60 hover:opacity-100'
                  }`}
                  title="Recently Used"
                >
                  🕒
                </button>
              )}
              {EMOJI_CATEGORIES.filter(c => c.id !== 'recent').map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`p-1 rounded text-sm transition-all ${
                    activeCategory === cat.id ? 'bg-arc-cyan/30 scale-110 shadow-glow-cyan' : 'opacity-60 hover:opacity-100'
                  }`}
                  title={cat.name}
                >
                  {cat.icon}
                </button>
              ))}
            </div>
          )}

          {/* Emoji Grid */}
          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar grid grid-cols-7 sm:grid-cols-8 gap-1 auto-rows-max">
            {displayedEmojis.length === 0 ? (
              <div className="col-span-full py-8 text-center text-xs font-mono text-arc-cyan/50">
                NO EMOJIS MATCHING "{searchQuery}"
              </div>
            ) : (
              displayedEmojis.map((emoji, idx) => (
                <button
                  key={`${emoji}-${idx}`}
                  type="button"
                  onClick={() => handleEmojiClick(emoji)}
                  className="w-9 h-9 flex items-center justify-center text-xl hover:bg-arc-cyan/20 hover:scale-125 transform transition-all rounded"
                >
                  {emoji}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: GIFS */}
      {activeTab === 'gifs' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Preset Category Chips (when not searching) */}
          {!searchQuery && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto custom-scrollbar border-b border-arc-cyan/10 bg-black/40">
              {GIF_PRESETS.map(p => (
                <button
                  key={p.category}
                  type="button"
                  onClick={() => setGifCategory(p.category)}
                  className={`px-2 py-0.5 text-[10px] font-mono whitespace-nowrap border transition-all ${
                    gifCategory === p.category
                      ? 'bg-arc-cyan/20 border-arc-cyan text-arc-cyan font-bold'
                      : 'border-arc-cyan/20 text-gray-400 hover:text-white'
                  }`}
                >
                  {p.category}
                </button>
              ))}
            </div>
          )}

          {/* GIF Grid */}
          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar grid grid-cols-2 gap-2 auto-rows-max">
            {isSearchingGifs ? (
              <div className="col-span-full py-8 text-center text-xs font-mono text-arc-cyan animate-pulse">
                [SEARCHING QUANTUM GIF ARCHIVE...]
              </div>
            ) : displayedGifs.length === 0 ? (
              <div className="col-span-full py-8 text-center text-xs font-mono text-arc-cyan/50">
                NO ANIMATED GIFS FOUND
              </div>
            ) : (
              displayedGifs.map(gif => (
                <button
                  key={gif.id}
                  type="button"
                  onClick={() => onSelectGif && onSelectGif(gif)}
                  className="group relative h-28 overflow-hidden border border-arc-cyan/30 hover:border-arc-cyan bg-black/50 transition-all"
                >
                  <img 
                    src={gif.preview || gif.url} 
                    alt={gif.title} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" 
                    loading="lazy" 
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1">
                    <span className="text-[9px] font-mono text-arc-cyan truncate block">{gif.title}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: CYBER-STICKERS */}
      {activeTab === 'stickers' && (
        <div className="flex-1 overflow-y-auto p-2.5 custom-scrollbar grid grid-cols-2 gap-2">
          {CYBER_STICKERS.map(st => (
            <button
              key={st.id}
              type="button"
              onClick={() => onSelectSticker && onSelectSticker(st)}
              className="p-3 text-left bg-black/60 hover:bg-arc-cyan/10 border border-arc-cyan/40 hover:border-arc-cyan transition-all flex flex-col justify-between group"
            >
              <div className="text-xl mb-1">{st.icon}</div>
              <div className="font-hud font-bold text-xs tracking-wider text-white group-hover:text-arc-cyan transition-colors truncate">
                {st.title}
              </div>
              <div className="text-[9px] font-mono text-arc-cyan/70 mt-1 truncate">
                {st.sub}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
