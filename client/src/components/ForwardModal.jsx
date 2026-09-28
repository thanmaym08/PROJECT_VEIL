import { useState } from 'react';
import { X, Search, Share2, Check, User, Users } from 'lucide-react';

export default function ForwardModal({
  isOpen,
  onClose,
  messageToForward,
  contacts = [],
  groups = [],
  onConfirmForward
}) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen || !messageToForward) return null;

  const toggleSelect = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const cleanQuery = searchQuery.toLowerCase().trim();
  const filteredContacts = contacts.filter(c => (c.name || '').toLowerCase().includes(cleanQuery));
  const filteredGroups = groups.filter(g => (g.name || '').toLowerCase().includes(cleanQuery));

  const handleForward = () => {
    if (selectedIds.length === 0) return;
    onConfirmForward(selectedIds, messageToForward);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#111b21] border border-[#222d34] rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[75vh] max-h-[550px]">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#202c33] px-5 py-4 border-b border-[#222d34]">
          <div className="flex items-center gap-2.5 text-[#00a884]">
            <Share2 size={20} />
            <h3 className="font-hud tracking-wider text-white text-sm font-bold">FORWARD MESSAGE</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Message Preview Snippet */}
        <div className="px-5 py-2.5 bg-[#182229] border-b border-white/5 text-xs text-gray-300 flex items-center gap-2">
          <span className="font-bold text-[#00a884] uppercase tracking-wider text-[10px]">Forwarding:</span>
          <span className="truncate italic">
            {messageToForward.text || messageToForward.attachment?.name || 'Encrypted Media'}
          </span>
        </div>

        {/* Search Bar */}
        <div className="p-3 bg-[#111b21] border-b border-white/5">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search contacts or groups..."
              className="w-full bg-[#202c33] text-sm text-white placeholder-gray-400 rounded-xl pl-10 pr-4 py-2 border border-white/5 focus:outline-none focus:border-[#00a884] transition-colors"
            />
          </div>
        </div>

        {/* Contact & Group Selector List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {filteredGroups.length > 0 && (
            <div className="mb-2">
              <span className="text-[10px] font-mono text-gray-400 uppercase tracking-widest px-2">GROUPS</span>
              {filteredGroups.map(g => {
                const isSelected = selectedIds.includes(g.id);
                return (
                  <div
                    key={g.id}
                    onClick={() => toggleSelect(g.id)}
                    className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#00a884]/20 border border-[#00a884]/40' : 'hover:bg-[#202c33]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-arc-cyan/20 border border-arc-cyan/40 flex items-center justify-center text-arc-cyan">
                        <Users size={16} />
                      </div>
                      <span className="text-sm font-semibold text-white">{g.name}</span>
                    </div>
                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                      isSelected ? 'bg-[#00a884] border-[#00a884] text-white' : 'border-gray-500'
                    }`}>
                      {isSelected && <Check size={13} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div>
            <span className="text-[10px] font-mono text-gray-400 uppercase tracking-widest px-2">CONTACTS</span>
            {filteredContacts.length === 0 && filteredGroups.length === 0 ? (
              <p className="text-center text-xs text-gray-500 py-6">No recipients found</p>
            ) : (
              filteredContacts.map(c => {
                const isSelected = selectedIds.includes(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => toggleSelect(c.id)}
                    className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#00a884]/20 border border-[#00a884]/40' : 'hover:bg-[#202c33]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#202c33] border border-white/10 flex items-center justify-center text-gray-300">
                        <User size={16} />
                      </div>
                      <span className="text-sm font-semibold text-white">{c.name || `Agent-${c.id.slice(0, 4)}`}</span>
                    </div>
                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                      isSelected ? 'bg-[#00a884] border-[#00a884] text-white' : 'border-gray-500'
                    }`}>
                      {isSelected && <Check size={13} />}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer Confirm */}
        <div className="p-4 bg-[#202c33] border-t border-[#222d34]">
          <button
            onClick={handleForward}
            disabled={selectedIds.length === 0}
            className="w-full py-3 bg-[#00a884] hover:bg-[#00c69d] disabled:opacity-40 disabled:cursor-not-allowed text-white font-hud tracking-wider text-xs font-bold uppercase rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
          >
            <Share2 size={15} />
            <span>FORWARD {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
