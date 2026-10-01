import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2 } from 'lucide-react';

export default function VoiceMemoPlayer({ audioUrl, appMode = 'flow', fileName = 'Voice Memo' }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
        setDuration(audio.duration);
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [audioUrl]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.warn("[AUDIO] Playback error:", err);
      });
    }
  };

  const handleSeek = (e) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    audioRef.current.currentTime = pct * duration;
    setCurrentTime(pct * duration);
  };

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Fixed simulated waveform heights (28 bars)
  const barHeights = [
    30, 60, 45, 80, 50, 95, 70, 40, 85, 100, 65, 45, 90, 75,
    55, 80, 40, 65, 90, 100, 70, 50, 85, 60, 40, 75, 55, 35
  ];

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const togglePlaybackSpeed = () => {
    const nextSpeed = playbackSpeed === 1 ? 1.5 : (playbackSpeed === 1.5 ? 2 : 1);
    setPlaybackSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const isFlow = appMode === 'flow';

  return (
    <div className={`flex items-center gap-2.5 p-2.5 rounded-xl max-w-xs transition-all ${
      isFlow 
        ? 'bg-[#182229]/90 border border-emerald-500/20 text-white' 
        : 'bg-stark-surface/90 border border-arc-cyan/40 text-arc-cyan shadow-glow-cyan'
    }`}>
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Play / Pause button */}
      <button
        type="button"
        onClick={togglePlay}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 ${
          isFlow 
            ? 'bg-[#00a884] hover:bg-[#02906f] text-white shadow-md' 
            : 'bg-arc-cyan/20 hover:bg-arc-cyan/30 text-arc-cyan border border-arc-cyan'
        }`}
        title={isPlaying ? "Pause voice memo" : "Play voice memo"}
      >
        {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} className="ml-0.5" fill="currentColor" />}
      </button>

      {/* Waveform and Progress Bar */}
      <div className="flex-1 flex flex-col justify-center gap-1 min-w-[120px]">
        <div 
          onClick={handleSeek} 
          className="flex items-center gap-[2px] h-6 cursor-pointer py-1 group"
          title="Click to seek"
        >
          {barHeights.map((h, i) => {
            const barPct = (i / barHeights.length) * 100;
            const isPlayed = barPct <= progressPct;
            return (
              <span
                key={i}
                style={{ height: `${h}%` }}
                className={`w-[3px] rounded-full transition-colors ${
                  isFlow
                    ? (isPlayed ? 'bg-[#00a884]' : 'bg-gray-500/50 group-hover:bg-gray-400')
                    : (isPlayed ? 'bg-arc-cyan shadow-[0_0_6px_rgba(0,240,255,0.6)]' : 'bg-arc-cyan/20 group-hover:bg-arc-cyan/40')
                }`}
              />
            );
          })}
        </div>

        {/* Time Labels */}
        <div className={`flex justify-between text-[10px] font-mono leading-none ${
          isFlow ? 'text-gray-400' : 'text-arc-cyan/70'
        }`}>
          <span>{formatTime(currentTime)}</span>
          <span>{duration > 0 ? formatTime(duration) : '••:••'}</span>
        </div>
      </div>

      {/* Speed Multiplier Button (1x / 1.5x / 2x) */}
      <button
        type="button"
        onClick={togglePlaybackSpeed}
        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all shrink-0 ${
          playbackSpeed > 1
            ? (isFlow ? 'bg-[#00a884] text-white shadow-sm' : 'bg-arc-cyan text-black')
            : (isFlow ? 'bg-[#2a3942] text-gray-300 hover:text-white' : 'bg-arc-cyan/10 text-arc-cyan/70 hover:text-arc-cyan')
        }`}
        title="Cycle playback speed (1x -> 1.5x -> 2x)"
      >
        {playbackSpeed}x
      </button>

      <div className="shrink-0 opacity-40">
        <Volume2 size={13} className={isFlow ? 'text-gray-400' : 'text-arc-cyan'} />
      </div>
    </div>
  );
}
