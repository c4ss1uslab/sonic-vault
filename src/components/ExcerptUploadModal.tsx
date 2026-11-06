import React, { useState, useRef, useEffect } from 'react';
import { Upload, X, Music, User, Volume2, FileAudio, Tag, Sparkles, Star, Play, Pause, Repeat, Check, Loader2, Plus, Trash2, Clock, Scissors, CornerDownRight } from 'lucide-react';
import { MusicItem, TagCluster, AudioSegment } from '../types';
import { getAudioDuration, formatAudioDuration, formatPreciseTime, roundToMs } from '../lib/audioDb';
import { PreciseTimeInput } from './PreciseTimeInput';
import { ArtistPicker } from './ArtistPicker';

interface ExcerptUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (excerptData: Partial<MusicItem>, audioFile?: File) => Promise<void>;
  availableArtists: MusicItem[];
  availableTracks: MusicItem[];
  knownArtistNames?: string[];
  presetArtistName?: string;
  presetArtistId?: string;
  presetTrackName?: string;
  presetTrackId?: string;
  clusters?: TagCluster[];
}

export const ExcerptUploadModal: React.FC<ExcerptUploadModalProps> = ({
  isOpen,
  onClose,
  onSave,
  availableArtists,
  availableTracks,
  knownArtistNames = [],
  presetArtistName,
  presetArtistId,
  presetTrackName,
  presetTrackId,
  clusters = [],
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isLoopingPreview, setIsLoopingPreview] = useState(true);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [activeAuditionSegmentId, setActiveAuditionSegmentId] = useState<string | null>(null);
  
  // Demarcated Excerpts / Segments within this single audio file
  const [segments, setSegments] = useState<Array<{
    id: string;
    name: string;
    startTime: number; // seconds, ms precision
    endTime: number; // seconds, ms precision (0 = not set yet)
    artistId?: string;
    artistName?: string;
    comments: string;
    tags: string[];
    tagInputDraft?: string;
  }>>([
    {
      id: 'seg_1',
      name: 'Main Excerpt',
      startTime: 0,
      endTime: 0,
      comments: '',
      tags: [],
      tagInputDraft: '',
    },
  ]);

  const [notes, setNotes] = useState('');
  const [selectedArtistId, setSelectedArtistId] = useState(presetArtistId || '');
  const [selectedArtistName, setSelectedArtistName] = useState(presetArtistName || '');
  const [selectedTrackId, setSelectedTrackId] = useState(presetTrackId || '');
  const [selectedTrackName, setSelectedTrackName] = useState(presetTrackName || '');
  const [tagsInput, setTagsInput] = useState('sample, excerpt');
  const [primaryCluster, setPrimaryCluster] = useState('');
  const [genres, setGenres] = useState('');
  const [bpm, setBpm] = useState<string>('');
  const [key, setKey] = useState('');
  const [instrumentationDetails, setInstrumentationDetails] = useState('');
  const [favoriteLevel, setFavoriteLevel] = useState<number>(0);
  const [relevance, setRelevance] = useState<number>(90);
  const [rating, setRating] = useState<number>(85);
  const [imageUrl, setImageUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [artistSearch, setArtistSearch] = useState('');
  const [trackSearch, setTrackSearch] = useState('');
  const [showArtistDropdown, setShowArtistDropdown] = useState(false);
  const [showTrackDropdown, setShowTrackDropdown] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  // Sync presets if changed
  useEffect(() => {
    if (presetArtistId || presetArtistName) {
      setSelectedArtistId(presetArtistId || '');
      setSelectedArtistName(presetArtistName || '');
    }
    if (presetTrackId || presetTrackName) {
      setSelectedTrackId(presetTrackId || '');
      setSelectedTrackName(presetTrackName || '');
    }
  }, [presetArtistId, presetArtistName, presetTrackId, presetTrackName]);

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // While auditioning, watch the excerpt's end boundary every animation frame so
  // millisecond timings are honoured (timeupdate only fires ~4x per second).
  useEffect(() => {
    if (!isPlayingPreview || !activeAuditionSegmentId) return;
    let rafId = 0;
    const tick = () => {
      const audio = audioPreviewRef.current;
      const seg = segments.find(s => s.id === activeAuditionSegmentId);
      if (audio && seg) {
        const end = seg.endTime > seg.startTime ? seg.endTime : (duration || Infinity);
        if (audio.currentTime >= end) {
          if (isLoopingPreview) {
            audio.currentTime = seg.startTime;
          } else {
            audio.pause();
            audio.currentTime = end;
            setPreviewCurrentTime(end);
            setIsPlayingPreview(false);
            setActiveAuditionSegmentId(null);
            return;
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlayingPreview, activeAuditionSegmentId, segments, duration, isLoopingPreview]);

  if (!isOpen) return null;

  const handleFileProcess = async (selectedFile: File) => {
    if (!selectedFile.type.startsWith('audio/') && !selectedFile.name.match(/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i)) {
      alert('Please select a valid audio file (MP3, WAV, OGG, M4A, FLAC, AAC, WebM).');
      return;
    }

    setFile(selectedFile);
    setFileName(selectedFile.name);
    const rawName = selectedFile.name.replace(/\.[^/.]+$/, '');
    if (!title) {
      setTitle(rawName.replace(/[_-]/g, ' '));
    }

    try {
      const dur = await getAudioDuration(selectedFile);
      setDuration(dur);
      const objUrl = URL.createObjectURL(selectedFile);
      setPreviewUrl(objUrl);
      
      // Update first segment end time if it was 0:00
      setSegments(prev => {
        if (prev.length === 1 && prev[0].endTime <= 0) {
          return [{
            ...prev[0],
            endTime: roundToMs(dur),
          }];
        }
        return prev;
      });
    } catch (err) {
      console.error('Error reading audio duration:', err);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const togglePreviewPlay = () => {
    if (!audioPreviewRef.current) return;
    if (isPlayingPreview) {
      audioPreviewRef.current.pause();
      setIsPlayingPreview(false);
      setActiveAuditionSegmentId(null);
    } else {
      audioPreviewRef.current.play().then(() => setIsPlayingPreview(true)).catch(() => {});
    }
  };

  const seekPreview = (time: number) => {
    if (audioPreviewRef.current) {
      audioPreviewRef.current.currentTime = time;
      setPreviewCurrentTime(time);
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    seekPreview(ratio * duration);
  };

  const auditionSegment = (segmentId: string) => {
    if (!audioPreviewRef.current) return;
    const seg = segments.find(s => s.id === segmentId);
    if (!seg) return;

    const start = seg.startTime;
    
    if (activeAuditionSegmentId === segmentId && isPlayingPreview) {
      audioPreviewRef.current.pause();
      setIsPlayingPreview(false);
      setActiveAuditionSegmentId(null);
    } else {
      setActiveAuditionSegmentId(segmentId);
      audioPreviewRef.current.currentTime = start;
      setPreviewCurrentTime(start);
      audioPreviewRef.current.play().then(() => {
        setIsPlayingPreview(true);
      }).catch(console.error);
    }
  };

  const handleAddSegment = () => {
    const nextIdx = segments.length + 1;
    // Suggest next segment starting at current preview time or last segment's end time
    const lastSeg = segments[segments.length - 1];
    const suggestedStart = roundToMs(lastSeg ? lastSeg.endTime : previewCurrentTime);
    const suggestedEnd = roundToMs(duration > suggestedStart ? Math.min(duration, suggestedStart + 15) : (suggestedStart + 10));

    setSegments(prev => [
      ...prev,
      {
        id: `seg_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        name: `Excerpt ${nextIdx}`,
        startTime: suggestedStart,
        endTime: suggestedEnd,
        comments: '',
        tags: [],
        tagInputDraft: '',
      }
    ]);
  };

  const handleRemoveSegment = (id: string) => {
    if (segments.length <= 1) return;
    setSegments(prev => prev.filter(s => s.id !== id));
  };

  const handleUpdateSegment = (id: string, updates: Partial<typeof segments[0]>) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  // Read the playhead straight from the element: state only refreshes on timeupdate (~4x/sec)
  const getExactPlayhead = () => roundToMs(audioPreviewRef.current?.currentTime ?? previewCurrentTime);

  const handleSetSegmentStartFromPlayhead = (id: string) => {
    handleUpdateSegment(id, { startTime: getExactPlayhead() });
  };

  const handleSetSegmentEndFromPlayhead = (id: string) => {
    handleUpdateSegment(id, { endTime: getExactPlayhead() });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('Please enter an excerpt / song title.');
      return;
    }

    setIsSubmitting(true);
    try {
      const parsedTags = tagsInput
        .split(',')
        .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
        .filter(Boolean);

      if (!parsedTags.includes('sample') && !parsedTags.includes('excerpt')) {
        parsedTags.unshift('excerpt');
      }

      // Convert UI segments to standard AudioSegment[] without undefined fields
      const cleanSegments: AudioSegment[] = segments.map((s, idx) => {
        const startSec = roundToMs(s.startTime);
        let endSec = roundToMs(s.endTime > 0 ? s.endTime : (duration || 30));
        if (endSec <= startSec) {
          endSec = roundToMs(duration > startSec ? duration : startSec + 10);
        }

        // Collect all individual tags for this segment (including any pending text in draft input)
        let segTags = [...(s.tags || [])];
        if (s.tagInputDraft && s.tagInputDraft.trim()) {
          const draftTags = s.tagInputDraft
            .split(',')
            .map(t => t.trim().toLowerCase().replace(/^#/, ''))
            .filter(Boolean);
          segTags = Array.from(new Set([...segTags, ...draftTags]));
        }

        const segObj: AudioSegment = {
          id: s.id || `seg_${idx + 1}`,
          name: s.name.trim() || `Excerpt ${idx + 1}`,
          startTime: startSec,
          endTime: endSec,
        };
        const segArtistName = (s.artistName || '').trim();
        if (segArtistName) {
          segObj.artistName = segArtistName;
          if (s.artistId) segObj.artistId = s.artistId;
        }
        const trimmedComment = s.comments.trim();
        if (trimmedComment) {
          segObj.comments = trimmedComment;
        }
        if (segTags.length > 0) {
          segObj.tags = segTags;
        }
        return segObj;
      });

      const primarySegment = cleanSegments[0];
      const segmentCountText = cleanSegments.length > 1 ? ` • ${cleanSegments.length} excerpts` : '';

      const excerptData: Partial<MusicItem> = {
        type: 'excerpt',
        name: title.trim(),
        subtitle: `${selectedArtistName ? selectedArtistName + ' • ' : ''}${duration ? formatAudioDuration(duration) + ' audio' : 'Audio file'}${segmentCountText}`,
        url: '',
        audioFileName: fileName || 'sample.mp3',
        audioMimeType: file?.type || 'audio/mpeg',
        audioDuration: duration,
        durationSeconds: duration,
        segments: cleanSegments,
        startTime: primarySegment ? primarySegment.startTime : 0,
        endTime: primarySegment ? primarySegment.endTime : duration,
        isLooping: isLoopingPreview,
        notes: notes.trim(),
        tags: parsedTags,
        favoriteLevel,
        relevance,
        rating,
      };

      if (imageUrl.trim()) excerptData.imageUrl = imageUrl.trim();
      if (primarySegment?.id) excerptData.activeSegmentId = primarySegment.id;
      if (selectedArtistId) excerptData.linkedArtistId = selectedArtistId;
      if (selectedArtistName.trim()) excerptData.linkedArtistName = selectedArtistName.trim();
      if (selectedTrackId) excerptData.linkedTrackId = selectedTrackId;
      if (selectedTrackName.trim()) excerptData.linkedTrackName = selectedTrackName.trim();
      if (primaryCluster) excerptData.primaryCluster = primaryCluster;
      if (genres.trim()) excerptData.genres = genres.trim();
      if (bpm) excerptData.bpm = bpm;
      if (key.trim()) excerptData.key = key.trim();
      if (instrumentationDetails.trim()) excerptData.instrumentationDetails = instrumentationDetails.trim();

      await onSave(excerptData, file || undefined);
      onClose();
    } catch (error) {
      console.error('Error saving excerpt:', error);
      alert('Failed to save excerpt: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered artists and tracks
  const filteredArtists = availableArtists.filter((a) =>
    a.name.toLowerCase().includes(artistSearch.toLowerCase())
  );
  const filteredTracks = availableTracks.filter((t) =>
    t.name.toLowerCase().includes(trackSearch.toLowerCase())
  );

  return (
    <div
      id="excerpt-upload-modal-overlay"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        id="excerpt-upload-modal-content"
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl my-8 transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Volume2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">Upload & Demarcate Audio Excerpts</h2>
              <p className="text-xs text-zinc-400">Concentrate multiple excerpts within a single MP3 file with precise time markers</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
          {/* File Dropzone */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Audio File (MP3, WAV, OGG, M4A, FLAC, AAC)
            </label>
            <div
              id="audio-file-dropzone"
              onDrop={handleFileDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all duration-200 ${
                isDragging
                  ? 'border-emerald-400 bg-emerald-950/30 scale-[1.01]'
                  : file
                  ? 'border-emerald-500/50 bg-emerald-950/20'
                  : 'border-zinc-700 hover:border-zinc-500 bg-zinc-800/40 hover:bg-zinc-800/70'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac,.webm"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileProcess(e.target.files[0]);
                  }
                }}
              />
              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                    <FileAudio className="w-5 h-5" />
                    <span className="truncate max-w-md">{fileName}</span>
                  </div>
                  <div className="text-xs text-zinc-400 flex items-center gap-3">
                    <span>Total Track Duration: <strong className="text-zinc-200">{formatAudioDuration(duration)}</strong></span>
                    <span>•</span>
                    <span>Size: <strong className="text-zinc-200">{(file.size / (1024 * 1024)).toFixed(2)} MB</strong></span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1">Click or drop another file to replace</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-2">
                  <div className="p-3 rounded-full bg-zinc-800 text-zinc-300">
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-medium text-zinc-200">
                    Click to browse or drag & drop audio file here
                  </p>
                  <p className="text-xs text-zinc-400">
                    MP3, WAV, OGG, M4A, FLAC up to 50MB (Stored securely in local browser vault)
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Audio Preview & Demarcation Scrubber Bar */}
          {previewUrl && (
            <div className="bg-zinc-950/80 border border-emerald-500/30 rounded-xl p-4 space-y-3">
              <audio
                ref={audioPreviewRef}
                src={previewUrl}
                loop={isLoopingPreview}
                onTimeUpdate={() => {
                  if (audioPreviewRef.current) {
                    // Segment end/loop bounds are enforced by the requestAnimationFrame watcher above
                    setPreviewCurrentTime(audioPreviewRef.current.currentTime);
                  }
                }}
                onEnded={() => {
                  if (!isLoopingPreview) {
                    setIsPlayingPreview(false);
                    setActiveAuditionSegmentId(null);
                  }
                }}
              />

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={togglePreviewPlay}
                    className="p-2.5 rounded-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400 transition cursor-pointer shadow-md"
                    title={isPlayingPreview ? 'Pause' : 'Play Full Track'}
                  >
                    {isPlayingPreview ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                  </button>
                  <div>
                    <div className="text-xs font-semibold text-zinc-100 flex items-center gap-2">
                      <span>Audio Playhead</span>
                      <span className="font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30 text-[11px]">
                        {formatPreciseTime(previewCurrentTime)} / {formatPreciseTime(duration)}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400">Click anywhere on the timeline to scrub and sample timestamps</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsLoopingPreview(!isLoopingPreview)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                      isLoopingPreview
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                    title="Toggle Repeat / Loop for excerpts"
                  >
                    <Repeat className="w-3.5 h-3.5" />
                    <span>{isLoopingPreview ? 'Loop: ON' : 'Loop: OFF'}</span>
                  </button>
                </div>
              </div>

              {/* Interactive Visual Timeline with Segments Highlighting */}
              <div
                onClick={handleTimelineClick}
                className="w-full h-4 bg-zinc-800 rounded-full cursor-pointer relative overflow-hidden group shadow-inner border border-zinc-700/60"
                title="Click timeline to jump playhead"
              >
                {/* Segment Overlays on timeline */}
                {duration > 0 && segments.map((seg, idx) => {
                  const startSec = seg.startTime;
                  const endSec = seg.endTime > 0 ? seg.endTime : duration;
                  const left = Math.max(0, Math.min(100, (startSec / duration) * 100));
                  const width = Math.max(1, Math.min(100 - left, ((endSec - startSec) / duration) * 100));
                  const isAuditioning = activeAuditionSegmentId === seg.id;
                  
                  return (
                    <div
                      key={seg.id}
                      className={`absolute top-0 bottom-0 transition-opacity ${
                        isAuditioning
                          ? 'bg-emerald-400/80 ring-2 ring-white z-10'
                          : idx % 2 === 0
                          ? 'bg-emerald-500/40 border-x border-emerald-400/60'
                          : 'bg-teal-500/40 border-x border-teal-400/60'
                      }`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${seg.name}${seg.artistName ? ` (${seg.artistName})` : ''}: ${formatPreciseTime(startSec)} - ${formatPreciseTime(endSec)}`}
                    />
                  );
                })}

                {/* Current Playhead indicator */}
                {duration > 0 && (
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-white shadow-md z-20 pointer-events-none"
                    style={{ left: `${Math.max(0, Math.min(100, (previewCurrentTime / duration) * 100))}%` }}
                  >
                    <div className="w-2.5 h-2.5 bg-white rounded-full -translate-x-[3px] -translate-y-0.5 shadow-sm" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Demarcate Excerpts Manager (Concentrate multiple excerpts within one card) */}
          <div className="bg-zinc-950/60 border border-emerald-500/40 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
              <div className="flex items-center gap-2">
                <Scissors className="w-4 h-4 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
                    Demarcated Excerpts ({segments.length})
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Define multiple excerpts (e.g. 0:14 to 0:38) within this single audio file
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleAddSegment}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-sm cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Excerpt</span>
              </button>
            </div>

            <div className="space-y-3">
              {segments.map((seg, idx) => {
                const startSec = seg.startTime;
                const endSec = seg.endTime > 0 ? seg.endTime : (duration || 30);
                const segDuration = Math.max(0, endSec - startSec);
                const isAuditioning = activeAuditionSegmentId === seg.id && isPlayingPreview;

                return (
                  <div
                    key={seg.id}
                    className={`p-4 rounded-xl border transition-all ${
                      isAuditioning
                        ? 'bg-emerald-950/40 border-emerald-400/80 shadow-md ring-1 ring-emerald-400/40'
                        : 'bg-zinc-900/90 border-zinc-700/80 hover:border-zinc-600'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-zinc-800 text-emerald-400 border border-zinc-700 shrink-0">
                          #{idx + 1}
                        </span>
                        <input
                          type="text"
                          value={seg.name}
                          onChange={(e) => handleUpdateSegment(seg.id, { name: e.target.value })}
                          placeholder={`e.g. Guitar Solo, Chorus Hook, Riff...`}
                          className="font-bold text-sm text-zinc-100 bg-transparent border-b border-zinc-700 hover:border-zinc-500 focus:border-emerald-400 focus:outline-none px-1 py-0.5 flex-1"
                        />
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => auditionSegment(seg.id)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                            isAuditioning
                              ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/40'
                              : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30'
                          }`}
                          title={isAuditioning ? "Pause audition" : `Play excerpt from ${formatPreciseTime(startSec)} to ${formatPreciseTime(endSec)}`}
                        >
                          {isAuditioning ? (
                            <>
                              <Pause className="w-3.5 h-3.5 fill-current" />
                              <span>Auditioning...</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Audition Excerpt</span>
                            </>
                          )}
                        </button>

                        {segments.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSegment(seg.id)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition cursor-pointer"
                            title="Remove this excerpt segment"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Timing demarcation inputs (millisecond precision) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      {/* Start Time Demarcation */}
                      <div className="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800 space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-zinc-300">
                          <label className="font-semibold flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Start Timing</span>
                          </label>
                          {previewUrl && (
                            <button
                              type="button"
                              onClick={() => handleSetSegmentStartFromPlayhead(seg.id)}
                              className="text-[10.5px] text-emerald-400 hover:text-emerald-300 underline font-mono cursor-pointer"
                              title="Set start time to the exact current playhead position"
                            >
                              ⏱ Use Playhead ({formatPreciseTime(previewCurrentTime)})
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <PreciseTimeInput
                            value={seg.startTime}
                            onChange={(sec) => handleUpdateSegment(seg.id, { startTime: sec })}
                            max={duration || undefined}
                            title="Start time (m:ss.mmm)"
                            className="flex-1"
                            inputClassName="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-emerald-400"
                          />
                          <span className="text-[10px] text-zinc-500 font-mono shrink-0">m:ss.ms</span>
                        </div>
                      </div>

                      {/* End Time Demarcation */}
                      <div className="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800 space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-zinc-300">
                          <label className="font-semibold flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-teal-400" />
                            <span>End Timing</span>
                          </label>
                          {previewUrl && (
                            <button
                              type="button"
                              onClick={() => handleSetSegmentEndFromPlayhead(seg.id)}
                              className="text-[10.5px] text-teal-400 hover:text-teal-300 underline font-mono cursor-pointer"
                              title="Set end time to the exact current playhead position"
                            >
                              ⏱ Use Playhead ({formatPreciseTime(previewCurrentTime)})
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <PreciseTimeInput
                            value={endSec}
                            onChange={(sec) => handleUpdateSegment(seg.id, { endTime: sec })}
                            max={duration || undefined}
                            title="End time (m:ss.mmm)"
                            className="flex-1"
                            inputClassName="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-teal-400"
                          />
                          <span className="text-[10px] text-zinc-400 font-mono font-bold shrink-0 bg-zinc-800 px-1.5 py-0.5 rounded">
                            {formatPreciseTime(segDuration)} loop
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Excerpt-specific artist (can differ from the card's linked artist) */}
                    <div className="mt-2.5 space-y-1">
                      <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Excerpt Artist</span>
                        <span className="text-[10.5px] text-zinc-400 font-normal">
                          {selectedArtistName.trim()
                            ? `(leave empty to use card artist: ${selectedArtistName.trim()})`
                            : '(optional — who plays on this excerpt)'}
                        </span>
                      </label>
                      <ArtistPicker
                        artists={availableArtists}
                        knownNames={knownArtistNames}
                        valueId={seg.artistId}
                        valueName={seg.artistName || ''}
                        onChange={({ id, name }) => handleUpdateSegment(seg.id, { artistId: id, artistName: name })}
                        placeholder={selectedArtistName.trim() ? `${selectedArtistName.trim()} (card artist)` : 'Search library or type a new artist...'}
                      />
                    </div>

                    {/* Excerpt specific comments */}
                    <div className="mt-2">
                      <input
                        type="text"
                        value={seg.comments}
                        onChange={(e) => handleUpdateSegment(seg.id, { comments: e.target.value })}
                        placeholder="Optional comment/feedback for this specific excerpt (e.g. 'Tight syncopation, check bassline')"
                        className="w-full bg-zinc-950/40 border border-zinc-800/80 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                      />
                    </div>

                    {/* Individual Excerpt Tags */}
                    <div className="mt-2.5 bg-zinc-950/70 border border-emerald-500/20 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                          <Tag className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Excerpt Tags</span>
                          <span className="text-[10.5px] text-zinc-400 font-normal">
                            (individual tags for this excerpt)
                          </span>
                        </label>
                        {seg.tags.length > 0 && (
                          <span className="text-[10.5px] text-emerald-400 font-mono font-medium">
                            {seg.tags.length} {seg.tags.length === 1 ? 'tag' : 'tags'}
                          </span>
                        )}
                      </div>

                      {/* Tag Chips & Input */}
                      <div className="flex flex-wrap items-center gap-1.5 min-h-[34px] p-1.5 bg-zinc-900/90 border border-zinc-700/80 rounded-lg focus-within:border-emerald-400 transition-colors">
                        {seg.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono group"
                          >
                            <span>#{tag}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const newTags = seg.tags.filter(t => t !== tag);
                                handleUpdateSegment(seg.id, { tags: newTags });
                              }}
                              className="text-emerald-400/60 hover:text-red-400 p-0.5 rounded transition cursor-pointer"
                              title={`Remove tag #${tag}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}

                        <input
                          type="text"
                          value={seg.tagInputDraft || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val.includes(',')) {
                              const parts = val.split(',');
                              const newTokens = parts
                                .slice(0, -1)
                                .map(p => p.trim().toLowerCase().replace(/^#/, ''))
                                .filter(Boolean);
                              const remainder = parts[parts.length - 1];
                              const merged = Array.from(new Set([...seg.tags, ...newTokens]));
                              handleUpdateSegment(seg.id, { tags: merged, tagInputDraft: remainder });
                            } else {
                              handleUpdateSegment(seg.id, { tagInputDraft: val });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              const val = (seg.tagInputDraft || '').trim().toLowerCase().replace(/^#/, '');
                              if (val) {
                                const merged = Array.from(new Set([...seg.tags, val]));
                                handleUpdateSegment(seg.id, { tags: merged, tagInputDraft: '' });
                              }
                            } else if (e.key === 'Backspace' && !seg.tagInputDraft && seg.tags.length > 0) {
                              handleUpdateSegment(seg.id, { tags: seg.tags.slice(0, -1) });
                            }
                          }}
                          onBlur={() => {
                            const val = (seg.tagInputDraft || '').trim().toLowerCase().replace(/^#/, '');
                            if (val) {
                              const merged = Array.from(new Set([...seg.tags, val]));
                              handleUpdateSegment(seg.id, { tags: merged, tagInputDraft: '' });
                            }
                          }}
                          placeholder={seg.tags.length === 0 ? "Type tag & press Enter or comma (e.g. guitar solo, hook)..." : "Add tag..."}
                          className="flex-1 min-w-[150px] bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none px-1"
                        />
                      </div>

                      {/* Quick suggestions */}
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5 text-[10.5px]">
                        <span className="text-[10px] uppercase font-bold text-zinc-500 mr-0.5">Quick tags:</span>
                        {['solo', 'hook', 'riff', 'intro', 'bassline', 'groove', 'vocal', 'break'].map((suggestion) => {
                          const isAdded = seg.tags.includes(suggestion);
                          return (
                            <button
                              key={suggestion}
                              type="button"
                              disabled={isAdded}
                              onClick={() => {
                                if (!isAdded) {
                                  handleUpdateSegment(seg.id, { tags: [...seg.tags, suggestion] });
                                }
                              }}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
                                isAdded
                                  ? 'bg-zinc-800/30 text-zinc-600 cursor-not-allowed'
                                  : 'bg-zinc-800/80 hover:bg-emerald-950/60 hover:text-emerald-300 text-zinc-400 border border-zinc-700/60'
                              }`}
                            >
                              +{suggestion}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Title & Artwork URL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                Card / Song Title <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Kind of Blue - Modal Sessions"
                className="w-full px-3.5 py-2 bg-zinc-800/80 border border-zinc-700 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                Cover Artwork URL (Optional)
              </label>
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://images.unsplash.com/..."
                className="w-full px-3.5 py-2 bg-zinc-800/80 border border-zinc-700 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 text-sm"
              />
            </div>
          </div>

          {/* Sync & Link to Track / Artist */}
          <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              <Sparkles className="w-4 h-4" />
              <span>Link & Sync with Artist / Track</span>
            </div>
            <p className="text-xs text-zinc-400">
              Linked excerpts will automatically appear in the Excerpts section at the bottom of the artist and track cards.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Artist Link Selector */}
              <div className="relative">
                <label className="block text-[11px] font-semibold text-zinc-300 mb-1 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Linked Artist</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={selectedArtistName}
                    onFocus={() => setShowArtistDropdown(true)}
                    onBlur={() => setShowArtistDropdown(false)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setShowArtistDropdown(false); }}
                    onChange={(e) => {
                      setSelectedArtistName(e.target.value);
                      setArtistSearch(e.target.value);
                      setShowArtistDropdown(true);
                      const match = availableArtists.find(
                        (a) => a.name.toLowerCase() === e.target.value.toLowerCase()
                      );
                      setSelectedArtistId(match ? match.id : '');
                    }}
                    placeholder="Search or type artist name..."
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                  {selectedArtistName && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedArtistName('');
                        setSelectedArtistId('');
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {showArtistDropdown && filteredArtists.length > 0 && (
                  <div onMouseDown={(e) => e.preventDefault()} className="absolute z-20 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                    {filteredArtists.slice(0, 8).map((artist) => (
                      <div
                        key={artist.id}
                        onClick={() => {
                          setSelectedArtistId(artist.id);
                          setSelectedArtistName(artist.name);
                          setShowArtistDropdown(false);
                        }}
                        className="px-3 py-2 text-xs text-zinc-200 hover:bg-emerald-500/20 hover:text-emerald-300 cursor-pointer flex items-center justify-between"
                      >
                        <span>{artist.name}</span>
                        {selectedArtistId === artist.id && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Track Link Selector */}
              <div className="relative">
                <label className="block text-[11px] font-semibold text-zinc-300 mb-1 flex items-center gap-1">
                  <Music className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Linked Track</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={selectedTrackName}
                    onFocus={() => setShowTrackDropdown(true)}
                    onBlur={() => setShowTrackDropdown(false)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setShowTrackDropdown(false); }}
                    onChange={(e) => {
                      setSelectedTrackName(e.target.value);
                      setTrackSearch(e.target.value);
                      setShowTrackDropdown(true);
                      const match = availableTracks.find(
                        (t) => t.name.toLowerCase() === e.target.value.toLowerCase()
                      );
                      setSelectedTrackId(match ? match.id : '');
                      if (match && match.parentName && !selectedArtistName) {
                        setSelectedArtistName(match.parentName);
                        setSelectedArtistId(match.parentId || '');
                      }
                    }}
                    placeholder="Search or type track name..."
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                  {selectedTrackName && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTrackName('');
                        setSelectedTrackId('');
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {showTrackDropdown && filteredTracks.length > 0 && (
                  <div onMouseDown={(e) => e.preventDefault()} className="absolute z-20 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                    {filteredTracks.slice(0, 8).map((track) => (
                      <div
                        key={track.id}
                        onClick={() => {
                          setSelectedTrackId(track.id);
                          setSelectedTrackName(track.name);
                          if (track.parentName) {
                            setSelectedArtistName(track.parentName);
                            setSelectedArtistId(track.parentId || '');
                          }
                          setShowTrackDropdown(false);
                        }}
                        className="px-3 py-2 text-xs text-zinc-200 hover:bg-emerald-500/20 hover:text-emerald-300 cursor-pointer flex items-center justify-between"
                      >
                        <div>
                          <div>{track.name}</div>
                          {track.parentName && <div className="text-[10px] text-zinc-400">{track.parentName}</div>}
                        </div>
                        {selectedTrackId === track.id && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Curation Notes / Comment */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1">
              General Notes & Feedback
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add general arrangement ideas, recording notes, loop characteristics..."
              className="w-full px-3.5 py-2 bg-zinc-800/80 border border-zinc-700 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 text-sm"
            />
          </div>

          {/* Tags & Tag Cluster */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                Full Card Tags (comma separated)
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="sample, excerpt, trumpet, brass, hook"
                className="w-full px-3.5 py-2 bg-zinc-800/80 border border-zinc-700 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 text-sm"
              />
              <p className="text-[10.5px] text-zinc-500 mt-1">
                Card-level tags apply to the entire item. Individual excerpts above also have their own dedicated tags.
              </p>
            </div>
            {clusters.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Vibe / Genre Cluster
                </label>
                <select
                  value={primaryCluster}
                  onChange={(e) => setPrimaryCluster(e.target.value)}
                  className="w-full px-3.5 py-2 bg-zinc-800/80 border border-zinc-700 rounded-xl text-zinc-100 focus:outline-none focus:border-emerald-500 text-sm"
                >
                  <option value="">-- No specific cluster --</option>
                  {clusters.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Musical Details (BPM, Key, Genres, Instrumentation) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">BPM</label>
              <input
                type="text"
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                placeholder="e.g. 128"
                className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Key / Mode</label>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g. D Dorian"
                className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Relevance (0-100)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={relevance}
                onChange={(e) => setRelevance(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">Star Tier (0-4)</label>
              <select
                value={favoriteLevel}
                onChange={(e) => setFavoriteLevel(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="0">Unstarred</option>
                <option value="1">★ 70 Tier (Yellow)</option>
                <option value="2">★★ 80 Tier (Green)</option>
                <option value="3">★★★ 90 Tier (Red)</option>
                <option value="4">★★★★ 95 Tier (Purple)</option>
              </select>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-zinc-300 hover:bg-zinc-800 text-sm font-medium transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm transition shadow-lg shadow-emerald-500/20 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving Excerpts...</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4" />
                  <span>Save Concentrated Card ({segments.length} {segments.length === 1 ? 'Excerpt' : 'Excerpts'})</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
