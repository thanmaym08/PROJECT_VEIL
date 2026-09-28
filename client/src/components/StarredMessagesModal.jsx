import { useState, useEffect } from 'react';
import { Star, X, Search, Copy, Check, FileText, Image, Mic } from 'lucide-react';
import { getAllStarredMessages } from '../storage/db';

export default function StarredMessagesModal({ isOpen, onClose, onUnstar, onSelectMessage }) {
  const [starredMsgs, setStarredMsgs] = useState([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [copiedSeq, setCopiedSeq] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    getAllStarredMessages().then(msgs => {
      setStarredMsgs(msgs || []);
      setLoading(false);
    }).catch(err => {
      console.warn("Failed to load starred messages:", err);
      setLoading(false);
    });
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = starredMsgs.filter(m => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    const textMatch = (m.text || '').toLowerCase().includes(q);
    const senderMatch = (m.senderName || '').toLowerCase().includes(q);
    return textMatch || senderMatch;
  });

  const handleCopy = (text, seq) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedSeq(seq);
    setTimeout(() => setCopiedSeq(null), 2000);
  };

  const handleUnstarClick = (e, m) => {
    e.stopPropagation();
    if (onUnstar) onUnstar(m.contactId, m.seq);
    setStarredMsgs(prev => prev.filter(item => item.seq !== m.seq));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#111b21] border border-[#222d34] rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[80vh] max-h-[600px]">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#202c33] px-5 py-4 border-b border-[#222d34]">
          <div className="flex items-center gap-2.5 text-amber-400">
            <Star size={20} className="fill-amber-400" />
            <h3 className="font-hud tracking-wider text-white text-sm font-bold">STARRED MESSAGES</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3 bg-[#111b21] border-b border-white/5">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Search in starred messages..."
              className="w-full bg-[#202c33] text-sm text-white placeholder-gray-400 rounded-xl pl-10 pr-4 py-2 border border-white/5 focus:outline-none focus:border-[#00a884] transition-colors"
            />
          </div>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-xs font-mono text-gray-400">
              Loading starred archives...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-gray-400 p-4">
              <Star size={36} className="text-gray-600 mb-2" />
              <p className="text-sm font-medium text-gray-300">No Starred Messages</p>
              <p className="text-xs text-gray-500 mt-1">Tap the star icon on any message to save it here.</p>
            </div>
          ) : (
            filtered.map((msg) => (
              <div
                key={msg.seq}
                className="bg-[#202c33] hover:bg-[#2a3942] border border-white/5 rounded-xl p-3.5 transition-colors group relative"
              >
                <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
                  <span className="font-semibold text-white">
                    {msg.fromMe ? 'You' : msg.senderName || 'Peer'}
                  </span>
                  <span className="text-[10px] font-mono">
                    {new Date(msg.ts).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Message Body */}
                <div className="text-sm text-gray-200 break-words pr-12">
                  {msg.text && <p className="line-clamp-3">{msg.text}</p>}
                  {msg.attachment && (
                    <div className="flex items-center gap-1.5 text-xs text-[#00a884] mt-1">
                      {msg.attachment.isVoiceMemo ? <Mic size={14} /> : msg.attachment.isImage ? <Image size={14} /> : <FileText size={14} />}
                      <span>{msg.attachment.name || 'Encrypted Attachment'}</span>
                    </div>
                  )}
                  {msg.poll && (
                    <div className="text-xs text-arc-cyan mt-1 font-mono">
                      📊 Poll: {msg.poll.question}
                    </div>
                  )}
                </div>

                {/* Actions: Copy & Unstar */}
                <div className="absolute right-3 bottom-3 flex items-center gap-1.5">
                  {msg.text && (
                    <button
                      onClick={() => handleCopy(msg.text, msg.seq)}
                      className="p-1.5 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-md transition-colors"
                      title="Copy text"
                    >
                      {copiedSeq === msg.seq ? <Check size={14} className="text-[#00a884]" /> : <Copy size={14} />}
                    </button>
                  )}
                  <button
                    onClick={(e) => handleUnstarClick(e, msg)}
                    className="p-1.5 text-amber-400 hover:text-amber-300 bg-white/5 hover:bg-white/10 rounded-md transition-colors"
                    title="Unstar message"
                  >
                    <Star size={14} className="fill-amber-400" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
