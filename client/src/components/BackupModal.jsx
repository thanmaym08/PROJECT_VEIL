import { useState } from 'react';
import { X, Shield, Download, Upload, Lock, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { exportEncryptedBackup, importEncryptedBackup } from '../storage/db';

export default function BackupModal({ isOpen, onClose, onRestoreComplete }) {
  const [activeTab, setActiveTab] = useState('export'); // 'export' | 'restore'
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [restoreFile, setRestoreFile] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [processing, setProcessing] = useState(false);

  if (!isOpen) return null;

  const handleExport = async (e) => {
    e.preventDefault();
    if (!passphrase) {
      setErrorMessage("Please enter an encryption passphrase for this backup.");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setErrorMessage("Passphrases do not match.");
      return;
    }

    setProcessing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const backupJson = await exportEncryptedBackup(passphrase);
      const blob = new Blob([backupJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `veil_encrypted_backup_${new Date().toISOString().slice(0, 10)}.veilbackup`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatusMessage("Encrypted backup generated and downloaded successfully!");
      setPassphrase('');
      setConfirmPassphrase('');
    } catch (err) {
      console.error("Backup export error:", err);
      setErrorMessage("Failed to export backup: " + (err.message || 'Unknown error'));
    } finally {
      setProcessing(false);
    }
  };

  const handleRestore = async (e) => {
    e.preventDefault();
    if (!restoreFile) {
      setErrorMessage("Please select a .veilbackup file to restore.");
      return;
    }
    if (!passphrase) {
      setErrorMessage("Please enter the decryption passphrase for this backup.");
      return;
    }

    setProcessing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const text = await restoreFile.text();
      const stats = await importEncryptedBackup(text, passphrase);
      setStatusMessage(`Restored successfully! (${stats.contactsCount} contacts, ${stats.groupsCount} groups, ${stats.messagesCount} messages).`);
      setPassphrase('');
      setRestoreFile(null);
      if (onRestoreComplete) onRestoreComplete();
    } catch (err) {
      console.error("Backup restore error:", err);
      setErrorMessage("Decryption failed. Please check your passphrase and file integrity.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#111b21] border border-[#222d34] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#202c33] px-5 py-4 border-b border-[#222d34]">
          <div className="flex items-center gap-2.5 text-[#00a884]">
            <Shield size={20} />
            <h3 className="font-hud tracking-wider text-white text-sm font-bold">ENCRYPTED BACKUP & RESTORE</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Tab Toggle */}
        <div className="flex border-b border-white/5 bg-[#182229]">
          <button
            type="button"
            onClick={() => { setActiveTab('export'); setErrorMessage(null); setStatusMessage(null); }}
            className={`flex-1 py-3 text-xs font-hud font-bold tracking-wider flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'export' ? 'text-[#00a884] border-b-2 border-[#00a884] bg-white/5' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Download size={14} />
            <span>EXPORT ARCHIVE</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('restore'); setErrorMessage(null); setStatusMessage(null); }}
            className={`flex-1 py-3 text-xs font-hud font-bold tracking-wider flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'restore' ? 'text-[#00a884] border-b-2 border-[#00a884] bg-white/5' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Upload size={14} />
            <span>RESTORE VAULT</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {errorMessage && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400 flex items-start gap-2">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {statusMessage && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-xl text-xs text-[#00a884] flex items-start gap-2">
              <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
              <span>{statusMessage}</span>
            </div>
          )}

          {activeTab === 'export' ? (
            <form onSubmit={handleExport} className="space-y-4">
              <p className="text-xs text-gray-400 leading-relaxed">
                Export an encrypted <code className="text-arc-cyan">.veilbackup</code> file containing all your contacts, groups, and message history. Protected by military-grade AES-256-GCM.
              </p>

              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Backup Passphrase</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="password"
                    required
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter strong encryption passphrase"
                    className="w-full bg-[#202c33] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00a884] transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Confirm Passphrase</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="password"
                    required
                    value={confirmPassphrase}
                    onChange={(e) => setConfirmPassphrase(e.target.value)}
                    placeholder="Re-enter passphrase"
                    className="w-full bg-[#202c33] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00a884] transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={processing}
                className="w-full py-3 bg-[#00a884] hover:bg-[#00c69d] disabled:opacity-50 text-white font-hud tracking-wider text-xs font-bold uppercase rounded-xl transition-all shadow-md flex items-center justify-center gap-2 mt-2"
              >
                {processing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                <span>{processing ? 'ENCRYPTING ARCHIVE...' : 'EXPORT ENCRYPTED BACKUP'}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleRestore} className="space-y-4">
              <p className="text-xs text-gray-400 leading-relaxed">
                Restore your chat history and cryptographic contacts from a previously exported <code className="text-arc-cyan">.veilbackup</code> file.
              </p>

              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Select Backup File</label>
                <input
                  type="file"
                  accept=".veilbackup,.json"
                  onChange={(e) => setRestoreFile(e.target.files[0] || null)}
                  className="w-full bg-[#202c33] border border-white/10 rounded-xl p-2 text-xs text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#00a884] file:text-white hover:file:bg-[#00c69d] cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">Backup Passphrase</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="password"
                    required
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter the passphrase used during export"
                    className="w-full bg-[#202c33] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00a884] transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={processing}
                className="w-full py-3 bg-[#00a884] hover:bg-[#00c69d] disabled:opacity-50 text-white font-hud tracking-wider text-xs font-bold uppercase rounded-xl transition-all shadow-md flex items-center justify-center gap-2 mt-2"
              >
                {processing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                <span>{processing ? 'DECRYPTING & RESTORING...' : 'RESTORE VAULT ARCHIVE'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
