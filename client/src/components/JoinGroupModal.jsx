import { Users, ShieldCheck, X } from 'lucide-react';

export default function JoinGroupModal({ inviteData, onConfirmJoin, onDecline }) {
  if (!inviteData) return null;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div 
        className="bg-stark-surface border border-arc-cyan/60 p-6 w-full max-w-md shadow-glow-cyan relative flex flex-col"
        style={{ clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%)" }}
      >
        <button 
          onClick={onDecline} 
          className="absolute top-4 right-4 text-arc-cyan/60 hover:text-arc-cyan p-1 hover:bg-arc-cyan/10 transition-colors"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-4 border-b border-arc-cyan/30 pb-3">
          <div className="p-3 bg-arc-cyan/15 border border-arc-cyan/40 text-arc-cyan">
            <Users size={26} />
          </div>
          <div>
            <div className="text-[10px] font-mono text-arc-cyan/70 tracking-widest uppercase">ENCRYPTED INVITATION</div>
            <h2 className="font-hud font-bold tracking-[0.15em] text-xl text-white">GROUP CHANNEL DETECTED</h2>
          </div>
        </div>

        <div className="space-y-4 my-2">
          <div className="bg-stark-bg border border-arc-cyan/30 p-4">
            <div className="text-[10px] font-hud tracking-widest text-arc-cyan/60 uppercase mb-1">Group Designation</div>
            <div className="font-hud font-bold text-lg text-white mb-3 text-glow-cyan">{inviteData.name}</div>

            <div className="text-[10px] font-hud tracking-widest text-arc-cyan/60 uppercase mb-1">Invited By</div>
            <div className="font-mono text-xs text-arc-cyan/90 truncate">
              {inviteData.inviterName || inviteData.createdBy ? `Agent (${(inviteData.createdBy || inviteData.inviterId || '').slice(0, 10)}...)` : 'Group Member'}
            </div>
          </div>

          <div className="flex items-start gap-2.5 text-[11px] font-mono text-gray-300 bg-arc-cyan/5 border border-arc-cyan/20 p-3">
            <ShieldCheck size={18} className="text-arc-cyan flex-shrink-0 mt-0.5" />
            <div>
              <span className="text-arc-cyan font-bold">ZERO-KNOWLEDGE PRIVACY:</span> You can join and participate immediately. You can also add other group members as friends with 1 click directly inside the chat!
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-4 pt-3 border-t border-arc-cyan/20">
          <button
            onClick={onDecline}
            className="flex-1 py-2.5 border border-arc-cyan/30 text-arc-cyan/70 font-mono text-xs hover:border-arc-cyan hover:text-white transition-colors uppercase tracking-wider"
          >
            Decline
          </button>
          <button
            onClick={onConfirmJoin}
            className="flex-1 py-2.5 bg-arc-cyan text-black font-hud font-bold text-xs hover:bg-arc-cyan/80 transition-all uppercase tracking-widest shadow-glow-cyan"
          >
            Join Group
          </button>
        </div>
      </div>
    </div>
  );
}
