import { useState } from 'react';
import { X, Users, Check, ShieldCheck, Search } from 'lucide-react';

export default function CreateGroupModal({ contacts, myId, onClose, onCreateGroup }) {
  const [groupName, setGroupName] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  const toggleSelect = (id) => {
    setSelectedContactIds(prev => 
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]
    );
  };

  const filteredContacts = contacts.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreate = (e) => {
    e.preventDefault();
    if (!groupName.trim()) {
      alert("Please specify a Group Name");
      return;
    }

    const selectedMembers = contacts
      .filter(c => selectedContactIds.includes(c.id))
      .map(c => ({ id: c.id, name: c.name, role: 'member' }));

    onCreateGroup(groupName.trim(), selectedMembers);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div 
        className="bg-stark-surface border border-arc-cyan/40 p-6 w-full max-w-lg shadow-glow-cyan relative flex flex-col max-h-[90vh]"
        style={{ clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%)" }}
      >
        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 text-arc-cyan/60 hover:text-arc-cyan p-1 hover:bg-arc-cyan/10 transition-colors"
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-4 border-b border-arc-cyan/20 pb-3">
          <div className="p-2 bg-arc-cyan/10 border border-arc-cyan/30 text-arc-cyan">
            <Users size={22} />
          </div>
          <div>
            <h2 className="font-hud font-bold tracking-[0.2em] text-lg text-arc-cyan">NEW ENCRYPTED GROUP</h2>
            <p className="text-[10px] font-mono text-arc-cyan/60 tracking-wider">SECURE MULTI-PARTY TRANSMISSION CHANNEL</p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="flex-1 flex flex-col overflow-hidden">
          {/* Group Name Input */}
          <div className="mb-4">
            <label className="block text-[10px] font-hud tracking-widest text-arc-cyan uppercase mb-1">
              Group Name // Designation *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Cyber Squad, Team Alpha, Family..."
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full bg-stark-bg/90 border border-arc-cyan/30 p-2.5 text-white font-mono text-sm focus:border-arc-cyan focus:outline-none focus:ring-1 focus:ring-arc-cyan"
              autoFocus
            />
          </div>

          {/* Member Selection Section */}
          <div className="flex-1 flex flex-col min-h-0 mb-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-[10px] font-hud tracking-widest text-arc-cyan uppercase">
                Select Friends from Contacts ({selectedContactIds.length} Selected)
              </label>
              {contacts.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedContactIds.length === contacts.length) {
                      setSelectedContactIds([]);
                    } else {
                      setSelectedContactIds(contacts.map(c => c.id));
                    }
                  }}
                  className="text-[9px] font-mono text-arc-cyan/70 hover:text-arc-cyan hover:underline"
                >
                  {selectedContactIds.length === contacts.length ? 'DESELECT ALL' : 'SELECT ALL'}
                </button>
              )}
            </div>

            {/* Search Filter if > 4 contacts */}
            {contacts.length > 4 && (
              <div className="relative mb-2">
                <Search size={14} className="absolute left-2.5 top-2.5 text-arc-cyan/40" />
                <input
                  type="text"
                  placeholder="Filter friends..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-stark-bg/60 border border-arc-cyan/20 pl-8 pr-3 py-1.5 text-xs text-white font-mono focus:border-arc-cyan/60 focus:outline-none"
                />
              </div>
            )}

            {/* Contacts Checkbox List */}
            <div className="flex-1 overflow-y-auto border border-arc-cyan/20 bg-stark-bg/50 divide-y divide-arc-cyan/10 custom-scrollbar max-h-56">
              {contacts.length === 0 ? (
                <div className="p-6 text-center text-xs font-mono text-arc-cyan/50">
                  No friends in contacts yet.<br />
                  You can create the group now and invite friends using a shareable link!
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="p-4 text-center text-xs font-mono text-arc-cyan/50">
                  No matching friends found.
                </div>
              ) : (
                filteredContacts.map(c => {
                  const isSelected = selectedContactIds.includes(c.id);
                  return (
                    <div
                      key={c.id}
                      onClick={() => toggleSelect(c.id)}
                      className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${
                        isSelected ? 'bg-arc-cyan/15 border-l-2 border-arc-cyan' : 'hover:bg-arc-cyan/5'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Checkbox box */}
                        <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-arc-cyan border-arc-cyan text-black' : 'border-arc-cyan/40 bg-stark-bg'
                        }`}>
                          {isSelected && <Check size={12} strokeWidth={3} />}
                        </div>
                        <div>
                          <div className="font-hud font-bold text-white text-xs">{c.name}</div>
                          <div className="text-[9px] text-arc-cyan/50 font-mono">{c.id.slice(0, 10)}...</div>
                        </div>
                      </div>
                      <ShieldCheck size={14} className="text-arc-cyan/60" />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-3 border-t border-arc-cyan/20">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-arc-cyan/30 text-arc-cyan/70 font-mono text-xs hover:border-arc-cyan hover:text-white transition-colors uppercase tracking-wider"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 bg-arc-cyan text-black font-hud font-bold text-xs hover:bg-arc-cyan/80 transition-all uppercase tracking-widest shadow-glow-cyan"
            >
              Create Group Channel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
