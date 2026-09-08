import React, { useState } from 'react';
import { Play, Pause, Repeat, Repeat1, Volume2, VolumeX, X, Music, User as UserIcon, SkipBack, SkipForward, Scissors, ChevronDown, ListMusic, Trash2 } from 'lucide-react';
import { MusicItem, AudioSegment } from '../types';
import { formatAudioDuration } from '../lib/audioDb';

interface AudioPlayerBarProps {
  item: MusicItem | null;
  activeSegmentId?: string | null;
  isPlaying: boolean;
  isLooping: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  onPlayPause: () => void;
  onToggleLoop: () => void;
  onSeek: (time: number) => void;
  onChangeVolume: (vol: number) => void;
  onClose: () => void;
  onSelectExcerpt?: (item: MusicItem) => void;
  onSelectSegment?: (segment: AudioSegment) => void;
  onPrevSegment?: () => void;
  onNextSegment?: () => void;
  onNavigateToArtist?: (artistName: string) => void;
  onNavigateToTrack?: (trackName: string) => void;
  // Multi-excerpt continuous loop sequence props
  loopPlaylist?: MusicItem[];
  loopPlaylistIndex?: number;
  isLoopPlaylistActive?: boolean;
  loopMode?: 'sequence' | 'single' | 'off';
  onSelectLoopPlaylistItem?: (index: number) => void;
  onRemoveFromLoopPlaylist?: (index: number) => void;
  onToggleLoopMode?: () => void;
  onPrevLoopItem?: () => void;
  onNextLoopItem?: () => void;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  item,
  activeSegmentId,
  isPlaying,
  isLooping,
  currentTime,
  duration,
  volume,
  onPlayPause,
  onToggleLoop,
  onSeek,
  onChangeVolume,
  onClose,
  onSelectExcerpt,
  onSelectSegment,
  onPrevSegment,
  onNextSegment,
  onNavigateToArtist,
  onNavigateToTrack,
  loopPlaylist = [],
  loopPlaylistIndex = 0,
  isLoopPlaylistActive = false,
  loopMode = 'sequence',
  onSelectLoopPlaylistItem,
  onRemoveFromLoopPlaylist,
  onToggleLoopMode,
  onPrevLoopItem,
  onNextLoopItem,
}) => {
  const [isMuted, setIsMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(volume);
  const [showSegmentMenu, setShowSegmentMenu] = useState(false);
  const [showLoopQueueMenu, setShowLoopQueueMenu] = useState(false);

  if (!item) return null;

  const hasMultiLoop = Boolean(isLoopPlaylistActive && loopPlaylist && loopPlaylist.length > 1);

  const segments = item.segments || [];
  const activeSegment = segments.find(s => s.id === activeSegmentId) || (segments.length > 0 ? segments[0] : null);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleMuteToggle = () => {
    if (isMuted) {
      setIsMuted(false);
      onChangeVolume(prevVolume || 0.8);
    } else {
      setPrevVolume(volume);
      setIsMuted(true);
      onChangeVolume(0);
    }
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(ratio * duration);
  };

  return (
    <div
      id="floating-audio-player-bar"
      className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-md border-t border-emerald-500/30 shadow-2xl px-4 py-2.5 sm:px-6 transition-all duration-300"
    >
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Left: Excerpt & Active Segment Info */}
        <div className="flex items-center gap-3 w-full md:w-1/3 min-w-0">
          <div
            onClick={() => onSelectExcerpt && onSelectExcerpt(item)}
            className="w-11 h-11 rounded-lg bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center shrink-0 cursor-pointer overflow-hidden group hover:border-emerald-400 transition"
          >
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
              />
            ) : (
              <Volume2 className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                onClick={() => onSelectExcerpt && onSelectExcerpt(item)}
                className="font-medium text-zinc-100 text-sm truncate hover:text-emerald-400 cursor-pointer transition"
                title={item.name}
              >
                {item.name}
              </span>
              {/* Multi-Excerpt Loop Sequence Badge & Queue Dropdown */}
              {hasMultiLoop && (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowLoopQueueMenu(!showLoopQueueMenu)}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500/40 transition cursor-pointer shadow-xs"
                    title="View & manage continuous multi-excerpt loop queue"
                  >
                    <Repeat className="w-3 h-3 text-emerald-400 animate-spin-slow" />
                    <span>Looping {loopPlaylistIndex + 1}/{loopPlaylist.length} Excerpts</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>

                  {showLoopQueueMenu && (
                    <div className="absolute bottom-full left-0 mb-2 w-72 sm:w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-2 z-50 max-h-72 overflow-y-auto">
                      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-zinc-800 px-1">
                        <div className="flex items-center gap-1.5">
                          <Repeat className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wider">Continuous Loop Queue</span>
                        </div>
                        <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                          {loopPlaylist.length} Excerpts
                        </span>
                      </div>
                      <div className="space-y-1">
                        {loopPlaylist.map((loopItem, idx) => {
                          const isCurrent = idx === loopPlaylistIndex;
                          return (
                            <div
                              key={`${loopItem.id}-${idx}`}
                              onClick={() => {
                                if (onSelectLoopPlaylistItem) onSelectLoopPlaylistItem(idx);
                                setShowLoopQueueMenu(false);
                              }}
                              className={`px-2.5 py-1.5 rounded-lg text-xs cursor-pointer flex items-center justify-between gap-2 transition group ${
                                isCurrent
                                  ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                                  : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className={`font-mono text-[10.5px] shrink-0 ${isCurrent ? 'text-emerald-400 font-extrabold' : 'text-zinc-500'}`}>
                                  #{idx + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs">{loopItem.name}</div>
                                  {(loopItem.parentName || loopItem.linkedArtistName) && (
                                    <div className="text-[10px] text-zinc-500 truncate">
                                      {loopItem.parentName || loopItem.linkedArtistName}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[10px] font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">
                                  {formatAudioDuration(loopItem.startTime || 0)} - {formatAudioDuration(loopItem.endTime || loopItem.durationSeconds || loopItem.audioDuration || 0)}
                                </span>
                                {onRemoveFromLoopPlaylist && loopPlaylist.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRemoveFromLoopPlaylist(idx);
                                    }}
                                    className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400 opacity-60 hover:opacity-100 transition"
                                    title="Remove excerpt from continuous loop"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {segments.length > 1 && (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowSegmentMenu(!showSegmentMenu)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition cursor-pointer"
                    title="Switch Excerpt Segment"
                  >
                    <Scissors className="w-3 h-3 text-emerald-400" />
                    <span>{segments.length} Excerpts</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>

                  {showSegmentMenu && (
                    <div className="absolute bottom-full left-0 mb-2 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-1.5 z-50 max-h-56 overflow-y-auto">
                      <div className="text-[10px] uppercase font-bold text-zinc-400 px-2 py-1 border-b border-zinc-800">
                        Demarcated Excerpts in File
                      </div>
                      {segments.map((seg, idx) => {
                        const isCurrent = (activeSegment?.id === seg.id);
                        return (
                          <div
                            key={seg.id}
                            onClick={() => {
                              if (onSelectSegment) onSelectSegment(seg);
                              setShowSegmentMenu(false);
                            }}
                            className={`px-2.5 py-1.5 rounded-lg text-xs cursor-pointer flex items-center justify-between transition ${
                              isCurrent
                                ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                                : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span className="font-mono text-[11px] text-zinc-500">#{idx + 1}</span>
                              <span className="truncate">{seg.name}</span>
                              {seg.tags && seg.tags.length > 0 && (
                                <div className="hidden sm:flex items-center gap-1 shrink-0">
                                  {seg.tags.slice(0, 2).map(t => (
                                    <span key={t} className="text-[9px] font-mono px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                                      #{t}
                                    </span>
                                  ))}
                                  {seg.tags.length > 2 && (
                                    <span className="text-[8.5px] text-zinc-400">+{seg.tags.length - 2}</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <span className="text-[10px] font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400 shrink-0">
                              {formatAudioDuration(seg.startTime)} - {formatAudioDuration(seg.endTime)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Subtitle / Active Excerpt Segment Indicator */}
            <div className="flex items-center gap-2 text-xs text-zinc-400 truncate mt-0.5">
              {activeSegment && segments.length > 0 ? (
                <span className="text-emerald-400 font-medium truncate flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span className="truncate">{activeSegment.name} ({formatAudioDuration(activeSegment.startTime)} - {formatAudioDuration(activeSegment.endTime)})</span>
                  {activeSegment.tags && activeSegment.tags.length > 0 && (
                    <span className="hidden sm:inline-flex items-center gap-1 ml-1 truncate">
                      {activeSegment.tags.slice(0, 3).map(t => (
                        <span key={t} className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300">
                          #{t}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              ) : item.linkedArtistName ? (
                <button
                  type="button"
                  onClick={() => onNavigateToArtist && onNavigateToArtist(item.linkedArtistName!)}
                  className="inline-flex items-center gap-1 hover:text-emerald-300 transition truncate underline-offset-2 hover:underline"
                >
                  <UserIcon className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="truncate">{item.linkedArtistName}</span>
                </button>
              ) : (
                <span className="text-zinc-500">{item.audioFileName || 'Audio excerpt'}</span>
              )}

              {item.linkedTrackName && (
                <>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => onNavigateToTrack && onNavigateToTrack(item.linkedTrackName!)}
                    className="inline-flex items-center gap-1 hover:text-emerald-300 transition truncate underline-offset-2 hover:underline"
                  >
                    <Music className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="truncate">{item.linkedTrackName}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Center: Controls & Segment Scrubber */}
        <div className="flex flex-col items-center gap-1.5 w-full md:w-2/5">
          <div className="flex items-center gap-3">
            {/* Previous Excerpt Segment or Previous in Multi-Loop */}
            {(hasMultiLoop || segments.length > 1) && (
              <button
                type="button"
                onClick={hasMultiLoop ? onPrevLoopItem : onPrevSegment}
                title={hasMultiLoop ? "Previous Excerpt in Loop" : "Previous Demarcated Excerpt"}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition cursor-pointer"
              >
                <SkipBack className="w-4 h-4" />
              </button>
            )}

            {/* Loop Toggle */}
            <button
              id="audio-player-repeat-btn"
              type="button"
              onClick={hasMultiLoop ? onToggleLoopMode : onToggleLoop}
              title={
                hasMultiLoop
                  ? loopMode === 'sequence'
                    ? `Continually looping all ${loopPlaylist.length} excerpts (Click for single excerpt loop)`
                    : loopMode === 'single'
                    ? 'Looping current excerpt only (Click to disable loop)'
                    : `Loop disabled (Click to loop all ${loopPlaylist.length} excerpts)`
                  : isLooping
                  ? 'Repeat: ON (Click to disable)'
                  : 'Repeat: OFF (Click to loop infinitely)'
              }
              className={`p-2 rounded-full transition-all relative cursor-pointer ${
                (hasMultiLoop ? loopMode !== 'off' : isLooping)
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-500/20'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              {hasMultiLoop && loopMode === 'single' ? (
                <Repeat1 className="w-4 h-4 text-emerald-400" />
              ) : (
                <Repeat className="w-4 h-4" />
              )}
              {hasMultiLoop && loopMode === 'sequence' && (
                <span className="absolute -top-1.5 -right-1.5 text-[8.5px] font-extrabold font-mono px-1 rounded-full bg-emerald-500 text-zinc-950 shadow-xs">
                  {loopPlaylist.length}
                </span>
              )}
              {(!hasMultiLoop && isLooping) && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>

            {/* Play/Pause */}
            <button
              id="audio-player-play-btn"
              type="button"
              onClick={onPlayPause}
              className="p-2.5 sm:p-3 rounded-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400 hover:scale-105 active:scale-95 shadow-lg shadow-emerald-500/30 transition duration-150 cursor-pointer"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            {/* Next Excerpt Segment or Next in Multi-Loop */}
            {(hasMultiLoop || segments.length > 1) && (
              <button
                type="button"
                onClick={hasMultiLoop ? onNextLoopItem : onNextSegment}
                title={hasMultiLoop ? "Next Excerpt in Loop" : "Next Demarcated Excerpt"}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition cursor-pointer"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            )}

            <div className="text-[11px] font-mono text-zinc-400 flex items-center gap-1 tabular-nums ml-1">
              <span className="text-zinc-200">{formatAudioDuration(currentTime)}</span>
              <span>/</span>
              <span>{formatAudioDuration(duration)}</span>
            </div>
          </div>

          {/* Timeline Scrubber with Highlighted Segment Ranges */}
          <div
            id="audio-player-timeline"
            onClick={handleProgressBarClick}
            className="w-full h-2.5 bg-zinc-800/90 rounded-full cursor-pointer relative overflow-hidden group hover:h-3 transition-all border border-zinc-700/50 shadow-inner"
          >
            {/* Render all segment marker ranges */}
            {duration > 0 && segments.map((seg, idx) => {
              const left = Math.max(0, Math.min(100, (seg.startTime / duration) * 100));
              const width = Math.max(1, Math.min(100 - left, ((seg.endTime - seg.startTime) / duration) * 100));
              const isActive = (activeSegment?.id === seg.id);

              return (
                <div
                  key={seg.id}
                  className={`absolute top-0 bottom-0 pointer-events-none transition-all ${
                    isActive
                      ? 'bg-emerald-400/40 border-x border-emerald-300 z-10'
                      : idx % 2 === 0
                      ? 'bg-emerald-600/20 border-x border-emerald-500/30'
                      : 'bg-teal-600/20 border-x border-teal-500/30'
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              );
            })}

            {/* Current Playhead Fill */}
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full relative z-20"
              style={{ width: `${progressPercent}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full opacity-0 group-hover:opacity-100 transition shadow-sm" />
            </div>
          </div>
        </div>

        {/* Right: Volume & Close */}
        <div className="flex items-center justify-end gap-3 w-full md:w-1/4">
          <div className="hidden sm:flex items-center gap-2">
            <button
              type="button"
              onClick={handleMuteToggle}
              className="text-zinc-400 hover:text-zinc-200 transition p-1 cursor-pointer"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-zinc-500" />
              ) : (
                <Volume2 className="w-4 h-4 text-zinc-400" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                if (isMuted) setIsMuted(false);
                onChangeVolume(parseFloat(e.target.value));
              }}
              className="w-20 accent-emerald-500 h-1 bg-zinc-700 rounded-lg cursor-pointer"
            />
          </div>

          <button
            id="audio-player-close-btn"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
            title="Stop & Close Player"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
