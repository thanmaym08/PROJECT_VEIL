import { useState } from 'react';
import { X, Plus, Trash2, BarChart2 } from 'lucide-react';

export default function CreatePollModal({ isOpen, onClose, onCreatePoll }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);

  if (!isOpen) return null;

  const handleAddOption = () => {
    if (options.length < 6) {
      setOptions([...options, '']);
    }
  };

  const handleRemoveOption = (index) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index));
    }
  };

  const handleOptionChange = (index, value) => {
    const updated = [...options];
    updated[index] = value;
    setOptions(updated);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleanQuestion = question.trim();
    const cleanOptions = options.map(o => o.trim()).filter(o => o.length > 0);

    if (!cleanQuestion || cleanOptions.length < 2) return;

    const pollData = {
      id: `poll_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      question: cleanQuestion,
      options: cleanOptions.map((text, idx) => ({
        id: `opt_${idx}_${Date.now()}`,
        text: text,
        votes: [] // array of user IDs
      })),
      multiple: allowMultiple,
      createdAt: Date.now()
    };

    onCreatePoll(pollData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#111b21] border border-[#222d34] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#202c33] px-5 py-4 border-b border-[#222d34]">
          <div className="flex items-center gap-2.5 text-[#00a884]">
            <BarChart2 size={20} />
            <h3 className="font-hud tracking-wider text-white text-sm font-bold">CREATE IN-CHAT POLL</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1.5 uppercase tracking-wider">
              Question
            </label>
            <input
              type="text"
              required
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question..."
              className="w-full bg-[#2a3942] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-[#00a884] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-gray-400 mb-1.5 uppercase tracking-wider">
              Options
            </label>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    value={opt}
                    onChange={(e) => handleOptionChange(idx, e.target.value)}
                    placeholder={`Option ${idx + 1}`}
                    className="flex-1 bg-[#2a3942] border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00a884] transition-colors"
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveOption(idx)}
                      className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {options.length < 6 && (
              <button
                type="button"
                onClick={handleAddOption}
                className="mt-2.5 text-xs text-[#00a884] hover:underline flex items-center gap-1 font-semibold"
              >
                <Plus size={14} /> Add Option
              </button>
            )}
          </div>

          {/* Settings: Allow Multiple */}
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <span className="text-xs text-gray-300">Allow multiple answers</span>
            <input
              type="checkbox"
              checked={allowMultiple}
              onChange={(e) => setAllowMultiple(e.target.checked)}
              className="w-4 h-4 accent-[#00a884] cursor-pointer"
            />
          </div>

          {/* Submit */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-3 bg-[#00a884] hover:bg-[#00c69d] text-white font-hud tracking-wider text-xs font-bold uppercase rounded-xl transition-all shadow-md"
            >
              SEND POLL
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
