import { useState } from 'react';
import { X, Radio, Search, Check, User, Users } from 'lucide-react';

export default function CreateBroadcastModal({ isOpen, onClose, contacts = [], onCreateBroadcast }) {
  const [listName, setListName] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) return null;

  const toggleSelect = (id) => {
    setSelectedContactIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const filtered = contacts.filter(c => (c.name || '').toLowerCase().includes(searchQuery.toLowerCase().trim()));

  const handleCreate = (e) => {
    e.preventDefault();
    if (!listName.trim() || selectedContactIds.length < 2) return;

    const broadcast = {
      id: `broadcast_${Date.now()}`,
      name: listName.trim(),
      isBroadcast: true,
      recipients: selectedContactIds,
      createdAt: Date.now()
    };

    onCreateBroadcast(broadcast);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#111b21] border border-[#222d34] rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[75vh] max-h-[550px]">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#202c33] px-5 py-4 border-b border-[#222d34]">
          <div className="flex items-center gap-2.5 text-[#00a884]">
            <Radio size={20} />
            <h3 className="font-hud tracking-wider text-white text-sm font-bold">NEW BROADCAST LIST</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleCreate} className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 bg-[#182229] border-b border-white/5 space-y-3">
            <p className="text-[11px] text-gray-400">
              Only contacts who have you in their contact list will receive your broadcast messages as direct 1-on-1 private messages.
            </p>
            <input
              type="text"
              required
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="Broadcast list name (e.g. Project Team)"
              className="w-full bg-[#202c33] border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00a884] transition-colors"
            />
          </div>

          {/* Search Contacts */}
          <div className="p-3 bg-[#111b21] border-b border-white/5">
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search contacts..."
                className="w-full bg-[#202c33] text-sm text-white placeholder-gray-400 rounded-xl pl-10 pr-4 py-2 border border-white/5 focus:outline-none focus:border-[#00a884] transition-colors"
              />
            </div>
          </div>

          {/* Contact List with Checkboxes */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {filtered.length === 0 ? (
              <p className="text-center text-xs text-gray-500 py-8">No contacts found</p>
            ) : (
              filtered.map(c => {
                const isSelected = selectedContactIds.includes(c.id);
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

          {/* Footer Submit */}
          <div className="p-4 bg-[#202c33] border-t border-[#222d34]">
            <button
              type="submit"
              disabled={!listName.trim() || selectedContactIds.length < 2}
              className="w-full py-3 bg-[#00a884] hover:bg-[#00c69d] disabled:opacity-40 disabled:cursor-not-allowed text-white font-hud tracking-wider text-xs font-bold uppercase rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
            >
              <Radio size={15} />
              <span>CREATE BROADCAST ({selectedContactIds.length} RECIPIENTS)</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
