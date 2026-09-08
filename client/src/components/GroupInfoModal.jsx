import { useState } from 'react';
import { X, Users, Copy, Check, UserPlus, MessageSquare, LogOut, ShieldCheck, Share2 } from 'lucide-react';

export default function GroupInfoModal({ 
  group, 
  contacts, 
  myId, 
  onClose, 
  onAddMembers, 
  onAddFriendFromGroup, 
  onDirectMessage, 
  onLeaveGroup 
}) {
  const [copied, setCopied] = useState(false);
  const [showAddMore, setShowAddMore] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState([]);
  const [addedFriends, setAddedFriends] = useState({});

  // Generate invite URL
  const invitePayload = btoa(unescape(encodeURIComponent(JSON.stringify({
    id: group.id,
    name: group.name,
    createdBy: group.createdBy
  }))));

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://veil-relay.onrender.com';
  const inviteUrl = `${origin}/?joinGroup=${invitePayload}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {
      prompt("Group Invite Link:", inviteUrl);
    });
  };

  // Friends not yet in group
  const existingMemberIds = (group.members || []).map(m => m.id);
  const eligibleFriends = contacts.filter(c => !existingMemberIds.includes(c.id));

  const handleToggleAdd = (id) => {
    setSelectedToAdd(prev => 
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]
    );
  };

  const handleConfirmAdd = () => {
    const newMembers = contacts
      .filter(c => selectedToAdd.includes(c.id))
      .map(c => ({ id: c.id, name: c.name, role: 'member' }));
    
    onAddMembers(group.id, newMembers);
    setShowAddMore(false);
    setSelectedToAdd([]);
  };

  const handleAddFriendClick = async (member) => {
    await onAddFriendFromGroup(member);
    setAddedFriends(prev => ({ ...prev, [member.id]: true }));
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

        {/* Header */}
        <div className="flex items-center gap-3 mb-4 border-b border-arc-cyan/20 pb-3">
          <div className="p-2 bg-arc-cyan/10 border border-arc-cyan/30 text-arc-cyan">
            <Users size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-hud font-bold tracking-[0.2em] text-lg text-white truncate">{group.name}</h2>
            <div className="text-[10px] font-mono text-arc-cyan/70 tracking-wider">
              {group.members?.length || 1} PARTICIPANTS // E2EE DOUBLE RATCHET
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
          {/* Shareable Invite Link Box */}
          <div className="bg-stark-bg/70 border border-arc-cyan/30 p-3.5 rounded-none">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-hud tracking-widest text-arc-cyan uppercase flex items-center gap-1.5">
                <Share2 size={12} /> Shareable Group Invite Link
              </span>
              <span className="text-[9px] font-mono text-arc-cyan/50">OPEN ACCESS</span>
            </div>
            <p className="text-[10px] text-gray-300 font-mono mb-2.5 leading-relaxed">
              Anyone with this link can join this encrypted group with 1 click. No prior contact verification required!
            </p>
            <div className="flex gap-2">
              <input 
                type="text" 
                readOnly 
                value={inviteUrl} 
                className="flex-1 bg-black/60 border border-arc-cyan/20 px-2.5 py-1.5 text-[11px] font-mono text-arc-cyan/80 truncate focus:outline-none select-all"
              />
              <button
                onClick={handleCopyLink}
                className={`px-3 py-1.5 text-xs font-hud font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all ${
                  copied 
                    ? 'bg-stark-emerald text-black shadow-glow-emerald' 
                    : 'bg-arc-cyan text-black hover:bg-arc-cyan/80 shadow-glow-cyan'
                }`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'COPIED!' : 'COPY'}
              </button>
            </div>
          </div>

          {/* Add Friends from Contacts Section */}
          {eligibleFriends.length > 0 && (
            <div className="border border-arc-cyan/20 bg-stark-bg/40 p-3">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-[10px] font-hud tracking-widest text-arc-cyan uppercase">Add Friends to Group</div>
                  <div className="text-[9px] font-mono text-arc-cyan/50">{eligibleFriends.length} contacts not yet in group</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddMore(!showAddMore)}
                  className="px-2.5 py-1 border border-arc-cyan/40 text-arc-cyan text-[10px] font-mono hover:bg-arc-cyan/10 transition-colors uppercase"
                >
                  {showAddMore ? 'HIDE' : '+ SELECT FRIENDS'}
                </button>
              </div>

              {showAddMore && (
                <div className="mt-3 pt-3 border-t border-arc-cyan/10 space-y-2">
                  <div className="max-h-40 overflow-y-auto divide-y divide-arc-cyan/10 bg-stark-bg border border-arc-cyan/20 custom-scrollbar">
                    {eligibleFriends.map(c => {
                      const isSel = selectedToAdd.includes(c.id);
                      return (
                        <div
                          key={c.id}
                          onClick={() => handleToggleAdd(c.id)}
                          className={`p-2 flex items-center justify-between cursor-pointer text-xs ${
                            isSel ? 'bg-arc-cyan/15 text-white' : 'hover:bg-arc-cyan/5 text-gray-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-3.5 h-3.5 border flex items-center justify-center ${
                              isSel ? 'bg-arc-cyan border-arc-cyan text-black' : 'border-arc-cyan/40'
                            }`}>
                              {isSel && <Check size={10} strokeWidth={3} />}
                            </div>
                            <span className="font-hud font-bold">{c.name}</span>
                          </div>
                          <span className="text-[9px] font-mono text-arc-cyan/50">{c.id.slice(0, 8)}...</span>
                        </div>
                      );
                    })}
                  </div>
                  {selectedToAdd.length > 0 && (
                    <button
                      onClick={handleConfirmAdd}
                      className="w-full py-1.5 bg-arc-cyan text-black font-hud font-bold text-xs uppercase tracking-wider hover:bg-arc-cyan/80 shadow-glow-cyan"
                    >
                      Add {selectedToAdd.length} Selected Friend{selectedToAdd.length > 1 ? 's' : ''}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Group Roster / Members List */}
          <div>
            <div className="text-[10px] font-hud tracking-widest text-arc-cyan uppercase mb-2">
              Group Members ({group.members?.length || 0})
            </div>
            <div className="border border-arc-cyan/20 bg-stark-bg/60 divide-y divide-arc-cyan/10 custom-scrollbar max-h-60 overflow-y-auto">
              {(group.members || []).map((m) => {
                const isMe = m.id === myId;
                const isFriend = contacts.some(c => c.id === m.id) || addedFriends[m.id];
                const isAdmin = group.createdBy === m.id || m.role === 'admin';

                return (
                  <div key={m.id} className="p-3 flex items-center justify-between hover:bg-arc-cyan/5 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-none border border-arc-cyan/40 bg-arc-cyan/10 flex items-center justify-center font-hud font-bold text-xs text-arc-cyan">
                        {(m.name || 'M')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-hud font-bold text-xs text-white truncate">{m.name}</span>
                          {isMe && (
                            <span className="text-[8px] font-mono px-1 border border-arc-cyan/40 text-arc-cyan bg-arc-cyan/10">YOU</span>
                          )}
                          {isAdmin && (
                            <span className="text-[8px] font-mono px-1 border border-stark-gold/40 text-stark-gold bg-stark-gold/10">ADMIN</span>
                          )}
                        </div>
                        <div className="text-[9px] text-arc-cyan/50 font-mono truncate">{m.id.slice(0, 14)}...</div>
                      </div>
                    </div>

                    {/* Action buttons for this member */}
                    {!isMe && (
                      <div className="flex items-center gap-1.5">
                        {isFriend ? (
                          <button
                            title="Start Direct Chat"
                            onClick={() => {
                              const existingFriend = contacts.find(c => c.id === m.id) || { id: m.id, name: m.name };
                              onDirectMessage(existingFriend);
                              onClose();
                            }}
                            className="px-2 py-1 border border-arc-cyan/30 text-arc-cyan hover:bg-arc-cyan hover:text-black transition-all text-[10px] font-mono flex items-center gap-1"
                          >
                            <MessageSquare size={11} />
                            <span>CHAT</span>
                          </button>
                        ) : (
                          <button
                            title="Add to your Friends List"
                            onClick={() => handleAddFriendClick(m)}
                            className="px-2 py-1 bg-arc-cyan/10 border border-arc-cyan text-arc-cyan hover:bg-arc-cyan hover:text-black transition-all text-[10px] font-mono flex items-center gap-1 shadow-glow-cyan"
                          >
                            <UserPlus size={11} />
                            <span>+ ADD FRIEND</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Leave / Delete Group Button */}
          <div className="pt-2">
            <button
              onClick={() => {
                if (window.confirm(`Are you sure you want to leave and delete "${group.name}" from your device?`)) {
                  onLeaveGroup(group.id);
                  onClose();
                }
              }}
              className="w-full py-2 border border-stark-crimson/40 text-stark-crimson hover:bg-stark-crimson/10 font-mono text-xs flex items-center justify-center gap-2 transition-colors uppercase tracking-wider"
            >
              <LogOut size={14} />
              <span>Leave & Remove Group</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
