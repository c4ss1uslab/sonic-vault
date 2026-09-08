import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Music, Search, Star, ExternalLink, Trash2, RefreshCw, 
  Volume2, Repeat, Play, Pause, Scissors, Plus, Link2, 
  MessageSquare, Sparkles, Download, FileText, Copy, Check, Radio, Palette, Upload, Tag
} from 'lucide-react';
import { MusicItem, TagCluster, AudioSegment, LastFmSettings } from '../types';
import { cn } from '../lib/utils';
import { getClusterColor } from '../lib/clusterColors';
import { fetchItemArtwork, getTimeframeShortLabel, getTimeframeFullLabel } from '../lib/lastfm';
import { formatAudioDuration, parseTimeToSeconds, saveAudioFile, getAudioDuration } from '../lib/audioDb';

const Button = ({ className, variant = 'primary', ...props }: any) => {
  const variants: any = {
    primary: 'bg-brand-accent text-white hover:opacity-90',
    secondary: 'bg-brand-card text-brand-text border border-brand-border hover:border-brand-accent',
    ghost: 'hover:bg-brand-card text-brand-muted hover:text-brand-text',
    danger: 'bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white',
  };
  return (
    <button 
      className={cn('px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer', variants[variant], className)}
      {...props}
    />
  );
};

export const getTagSource = (item: MusicItem | null | undefined, tag: string): 'llm' | 'manual' | 'lastfm' => {
  if (!item) return 'manual';
  const cleanTag = tag.toLowerCase().trim().replace(/^#/, '');
  if (item.tagSources && item.tagSources[cleanTag]) {
    return item.tagSources[cleanTag];
  }
  if (
    item.lastFmEnrichedAt || 
    item.lastFmPlaycount !== undefined || 
    item.lastFmUrl || 
    item.lastFmPeriod || 
    (item.id && (item.id.startsWith('lfm_') || item.id.startsWith('demo-lastfm-')))
  ) {
    return 'lastfm';
  }
  if (item.aiAnalyzed) {
    return 'llm';
  }
  return 'manual';
};

export const getItemClusters = (item: MusicItem | null, activeClusters: TagCluster[]): TagCluster[] => {
  if (!item || !item.tags || item.tags.length === 0) return [];
  const itemTagSet = new Set(item.tags.map(t => t.toLowerCase().trim().replace(/^#/, '')));
  return activeClusters.filter(cluster => 
    (cluster.tags || []).some(ct => itemTagSet.has(ct.toLowerCase().trim().replace(/^#/, '')))
  );
};

// Export formatting helpers for single item
export const formatSingleItemJSON = (item: MusicItem, activeClusters: TagCluster[]): string => {
  const itemClusters = getItemClusters(item, activeClusters);
  const primaryCluster = item.primaryCluster || itemClusters[0]?.name || null;
  const payload = {
    id: item.id,
    type: item.type,
    name: item.name,
    parentName: item.parentName || null,
    creator: item.creator || null,
    url: item.url,
    imageUrl: item.imageUrl || null,
    relevance: item.relevance ?? null,
    favoriteLevel: item.favoriteLevel ?? null,
    familiarity: item.familiarity ?? null,
    rank: item.rank ?? null,
    songCount: item.songCount ?? null,
    durationSeconds: item.durationSeconds ?? null,
    tags: item.tags || [],
    tagSources: item.tagSources || {},
    primaryCluster: primaryCluster,
    matchedClusters: itemClusters.map(c => c.name),
    lastFm: {
      playcount: item.lastFmPlaycount ?? null,
      periodPlaycount: item.lastFmPeriodPlaycount ?? null,
      period: item.lastFmPeriod ?? null,
      url: item.lastFmUrl ?? null,
      listeners: item.lastFmListeners ?? null,
      enrichedAt: item.lastFmEnrichedAt ?? null,
    },
    curationMetadata: {
      relatedToSource: item.relatedToSource || null,
      bpm: item.bpm ?? null,
      key: item.key || null,
      instrumentationDetails: item.instrumentationDetails || null,
      comments: item.comments || null,
      linkedTrackName: item.linkedTrackName || null,
      linkedArtistName: item.linkedArtistName || null,
    },
    curationNotes: item.notes || '',
    aiAnalyzed: Boolean(item.aiAnalyzed),
  };
  return JSON.stringify(payload, null, 2);
};

export const formatSingleItemMarkdown = (item: MusicItem, activeClusters: TagCluster[]): string => {
  const itemClusters = getItemClusters(item, activeClusters);
  const primaryCluster = item.primaryCluster || itemClusters[0]?.name || 'None';
  let md = `## ${item.name} (${item.type.toUpperCase()})\n`;
  if (item.parentName) md += `**Parent/Artist**: ${item.parentName}\n`;
  if (item.creator) md += `**Curator**: ${item.creator}\n`;
  md += `**Link**: ${item.url}\n`;
  if (item.relevance !== undefined) md += `**Relevance**: ${item.relevance}%\n`;
  if (item.familiarity !== undefined) md += `**Familiarity**: ${item.familiarity}%\n`;
  if (item.lastFmPlaycount !== undefined) md += `**Last.fm Scrobbles**: ${item.lastFmPlaycount}\n`;
  md += `**Primary Cluster**: ${primaryCluster}\n`;
  if (item.tags && item.tags.length > 0) {
    md += `**Tags**: ${item.tags.map(t => `#${t}`).join(', ')}\n`;
  }
  if (item.bpm) md += `**BPM**: ${item.bpm}\n`;
  if (item.key) md += `**Key**: ${item.key}\n`;
  if (item.instrumentationDetails) md += `**Instrumentation**: ${item.instrumentationDetails}\n`;
  if (item.relatedToSource) md += `**Lineage/Source**: ${item.relatedToSource}\n`;
  if (item.comments) md += `**Comments**: ${item.comments}\n`;
  if (item.notes) {
    md += `\n### Notes\n${item.notes}\n`;
  }
  return md;
};

// Modal Cluster Manager Component
const ModalClusterManager: React.FC<{
  item: MusicItem;
  activeClusters: TagCluster[];
  onUpdateItem: (id: string, updates: Partial<MusicItem>) => void;
  onOpenColorPicker?: (cluster: TagCluster) => void;
}> = ({ item, activeClusters, onUpdateItem, onOpenColorPicker }) => {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [clusterSearch, setClusterSearch] = useState('');
  const addDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (addDropdownRef.current && !addDropdownRef.current.contains(e.target as Node)) {
        setIsAddOpen(false);
      }
    };
    if (isAddOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isAddOpen]);

  const itemClusters = getItemClusters(item, activeClusters);
  const currentPrimaryName = item.primaryCluster || (itemClusters[0]?.name ?? '');

  const availableClusters = activeClusters.filter(
    c => !itemClusters.some(ic => ic.name === c.name)
  );

  const filteredAvailableClusters = availableClusters.filter(c =>
    c.name.toLowerCase().includes(clusterSearch.toLowerCase()) ||
    (c.description && c.description.toLowerCase().includes(clusterSearch.toLowerCase()))
  );

  const handleSetPrimary = (clusterName: string) => {
    onUpdateItem(item.id, { primaryCluster: clusterName });
  };

  const handleRemoveFromCluster = (clusterToRemove: TagCluster) => {
    const clusterTagSet = new Set((clusterToRemove.tags || []).map(t => t.toLowerCase().trim().replace(/^#/, '')));
    const updatedTags = (item.tags || []).filter(t => {
      const clean = t.toLowerCase().trim().replace(/^#/, '');
      return !clusterTagSet.has(clean);
    });

    let updatedPrimary = item.primaryCluster;
    if (item.primaryCluster === clusterToRemove.name) {
      const remainingClusters = itemClusters.filter(c => c.name !== clusterToRemove.name);
      updatedPrimary = remainingClusters[0]?.name || undefined;
    }

    onUpdateItem(item.id, {
      tags: updatedTags,
      primaryCluster: updatedPrimary,
    });
  };

  const handleAddToCluster = (targetCluster: TagCluster) => {
    const representativeTag = targetCluster.tags?.[0] || targetCluster.name.toLowerCase().replace(/\s+/g, '-');
    const cleanTag = representativeTag.toLowerCase().trim().replace(/^#/, '');
    const currentTags = item.tags || [];
    const alreadyHas = currentTags.some(t => t.toLowerCase().trim().replace(/^#/, '') === cleanTag);

    const updatedTags = alreadyHas ? currentTags : [...currentTags, cleanTag];
    const newPrimary = item.primaryCluster || targetCluster.name;

    const newTagSources = {
      ...(item.tagSources || {}),
      ...(alreadyHas ? {} : { [cleanTag]: 'manual' as const })
    };

    onUpdateItem(item.id, {
      tags: updatedTags,
      tagSources: newTagSources,
      primaryCluster: newPrimary,
    });
    setIsAddOpen(false);
    setClusterSearch('');
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm font-bold text-brand-muted uppercase tracking-widest block">
            Vibe & Genre Clusters
          </label>
          <span className="text-[10px] text-brand-muted font-mono">
            ({itemClusters.length} assigned)
          </span>
        </div>

        <div className="relative" ref={addDropdownRef}>
          <button
            type="button"
            onClick={() => setIsAddOpen(!isAddOpen)}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-brand-bg hover:bg-brand-border/60 border border-brand-border text-brand-text transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-brand-accent" />
            <span>Add to Cluster</span>
          </button>

          {isAddOpen && (
            <div className="absolute right-0 top-full mt-2 w-72 bg-brand-card border border-brand-border rounded-xl shadow-2xl z-50 p-2 space-y-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-muted" />
                <input
                  type="text"
                  value={clusterSearch}
                  onChange={(e) => setClusterSearch(e.target.value)}
                  placeholder="Search available clusters..."
                  className="w-full bg-brand-bg border border-brand-border rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none focus:border-brand-accent text-brand-text placeholder:text-brand-muted"
                  autoFocus
                />
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredAvailableClusters.length === 0 ? (
                  <p className="text-center text-xs text-brand-muted py-3">
                    {clusterSearch ? "No matching clusters found" : "Item belongs to all clusters"}
                  </p>
                ) : (
                  filteredAvailableClusters.map(cluster => {
                    const colorHex = getClusterColor(cluster);
                    return (
                      <button
                        key={cluster.name}
                        type="button"
                        onClick={() => handleAddToCluster(cluster)}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-brand-bg flex items-center justify-between gap-2 group transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: colorHex }}
                          />
                          <span className="text-xs font-medium text-brand-text truncate">
                            {cluster.name}
                          </span>
                        </div>
                        <span className="text-[10px] text-brand-muted shrink-0">
                          +{cluster.tags?.[0] || 'tag'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {itemClusters.length === 0 ? (
          <div className="p-3 bg-brand-bg/40 border border-dashed border-brand-border/60 rounded-xl text-center">
            <p className="text-xs text-brand-muted">
              No vibe clusters matched. Add tags or use "+ Add to Cluster" above.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {itemClusters.map(cluster => {
              const isPrimary = cluster.name === currentPrimaryName;
              const colorHex = getClusterColor(cluster);
              return (
                <div
                  key={cluster.name}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition-all",
                    isPrimary
                      ? "bg-brand-bg shadow-sm"
                      : "bg-brand-bg/50 hover:bg-brand-bg border-brand-border/60"
                  )}
                  style={{
                    borderColor: isPrimary ? colorHex : undefined,
                    boxShadow: isPrimary ? `0 0 0 1px ${colorHex}40` : undefined
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onOpenColorPicker?.(cluster)}
                    title={`Change color for "${cluster.name}"`}
                    className="w-3 h-3 rounded-full shrink-0 hover:scale-125 transition-transform cursor-pointer relative group/color"
                    style={{ backgroundColor: colorHex }}
                  >
                    <Palette className="h-2 w-2 text-white opacity-0 group-hover/color:opacity-100 absolute inset-0 m-auto" />
                  </button>

                  <span className="font-semibold text-brand-text">
                    {cluster.name}
                  </span>

                  {isPrimary ? (
                    <span
                      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded font-mono"
                      style={{
                        backgroundColor: `${colorHex}25`,
                        color: colorHex,
                      }}
                    >
                      Primary
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSetPrimary(cluster.name)}
                      className="text-[10px] text-brand-muted hover:text-brand-accent transition-colors cursor-pointer"
                      title="Set as primary cluster"
                    >
                      Set Primary
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleRemoveFromCluster(cluster)}
                    className="hover:text-red-400 text-brand-muted transition-colors ml-1 cursor-pointer"
                    title={`Remove ${cluster.name} tags from item`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

export interface DetailItemModalProps {
  item: MusicItem | null;
  items: MusicItem[];
  activeClusters: TagCluster[];
  scrobbleRankMap: Record<string, number>;
  existingArtistNames: string[];
  existingTrackNames: string[];
  lastFmSettings?: LastFmSettings;
  activeAudioItem: MusicItem | null;
  isPlayingAudio: boolean;
  activeSegmentId?: string;
  audioCurrentTime: number;
  audioDuration: number;
  isAnalyzing: boolean;
  analyzingId?: string | null;
  isEnrichingSingleItem: boolean;
  onClose: () => void;
  onUpdateItem: (id: string, updates: Partial<MusicItem>) => Promise<void> | void;
  onDeleteItem: (item: MusicItem) => void;
  onPlayAudio: (item: MusicItem, shouldLoop?: boolean, segmentId?: string) => void;
  onSeekAudio: (time: number) => void;
  onAnalyze: (item: MusicItem) => void;
  onEnrichItem: (item: MusicItem) => void;
  onOpenExcerptUpload: (artistName?: string, trackName?: string, artistId?: string, trackId?: string) => void;
  onOpenColorPicker?: (cluster: TagCluster) => void;
  onSelectItem?: (item: MusicItem) => void;
  loopPlaylist?: MusicItem[];
  isLoopPlaylistActive?: boolean;
  onToggleItemInLoop?: (item: MusicItem) => void;
}

export const DetailItemModal: React.FC<DetailItemModalProps> = ({
  item,
  items,
  activeClusters,
  scrobbleRankMap,
  existingArtistNames,
  existingTrackNames,
  lastFmSettings,
  activeAudioItem,
  isPlayingAudio,
  activeSegmentId,
  audioCurrentTime,
  audioDuration,
  isAnalyzing,
  analyzingId,
  isEnrichingSingleItem,
  onClose,
  onUpdateItem,
  onDeleteItem,
  onPlayAudio,
  onSeekAudio,
  onAnalyze,
  onEnrichItem,
  onOpenExcerptUpload,
  onOpenColorPicker,
  onSelectItem,
  loopPlaylist,
  isLoopPlaylistActive,
  onToggleItemInLoop
}) => {
  // Local form buffer state for 0ms typing responsiveness and no desyncs
  const [formData, setFormData] = useState<Partial<MusicItem>>({});
  const [tagInputValue, setTagInputValue] = useState('');
  const [isFetchingCover, setIsFetchingCover] = useState(false);
  const [singleItemCopied, setSingleItemCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');

  const pendingUpdatesRef = useRef<Partial<MusicItem>>({});
  const debounceTimerRef = useRef<any>(null);
  const currentItemIdRef = useRef<string | null>(null);

  // Initialize or reset form buffer when selected item changes
  useEffect(() => {
    if (item) {
      currentItemIdRef.current = item.id;
      setFormData({
        name: item.name,
        notes: item.notes || '',
        comments: item.comments || '',
        relatedToSource: item.relatedToSource || '',
        bpm: item.bpm !== undefined && item.bpm !== null ? item.bpm : '',
        key: item.key || '',
        instrumentationDetails: item.instrumentationDetails || '',
        imageUrl: item.imageUrl || '',
        familiarity: item.familiarity || 0,
        relevance: item.relevance || 0,
        favoriteLevel: item.favoriteLevel || 0,
        segments: item.segments || [],
        tags: item.tags || [],
        tagSources: item.tagSources || {},
        primaryCluster: item.primaryCluster,
        linkedTrackName: item.linkedTrackName || '',
        linkedTrackId: item.linkedTrackId || '',
        linkedArtistName: item.linkedArtistName || '',
        linkedArtistId: item.linkedArtistId || '',
        isLooping: item.isLooping || false,
      });
      pendingUpdatesRef.current = {};
      setSaveStatus('saved');
    }
  }, [item?.id]);

  // Sync external non-dirty updates (e.g. AI analysis finished, Last.fm enrichment)
  useEffect(() => {
    if (item && item.id === currentItemIdRef.current) {
      setFormData(prev => ({
        ...prev,
        // Sync fields that might update externally if not dirty
        tags: pendingUpdatesRef.current.tags !== undefined ? prev.tags : item.tags,
        tagSources: pendingUpdatesRef.current.tagSources !== undefined ? prev.tagSources : item.tagSources,
        imageUrl: pendingUpdatesRef.current.imageUrl !== undefined ? prev.imageUrl : item.imageUrl,
        segments: pendingUpdatesRef.current.segments !== undefined ? prev.segments : item.segments,
        relevance: pendingUpdatesRef.current.relevance !== undefined ? prev.relevance : item.relevance,
        familiarity: pendingUpdatesRef.current.familiarity !== undefined ? prev.familiarity : item.familiarity,
        favoriteLevel: pendingUpdatesRef.current.favoriteLevel !== undefined ? prev.favoriteLevel : item.favoriteLevel,
        primaryCluster: pendingUpdatesRef.current.primaryCluster !== undefined ? prev.primaryCluster : item.primaryCluster,
      }));
    }
  }, [item?.aiAnalyzed, item?.lastFmEnrichedAt, item?.lastFmPlaycount, item?.lastFmPeriodPlaycount]);

  // Debounced auto-save function
  const flushPendingUpdates = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const targetId = currentItemIdRef.current;
    const updates = pendingUpdatesRef.current;
    if (targetId && Object.keys(updates).length > 0) {
      setSaveStatus('saving');
      const updatesToSend = { ...updates };
      pendingUpdatesRef.current = {};
      Promise.resolve(onUpdateItem(targetId, updatesToSend)).then(() => {
        setSaveStatus('saved');
      }).catch(err => {
        console.error('Failed to auto-save:', err);
        setSaveStatus('unsaved');
      });
    }
  }, [onUpdateItem]);

  // Queue an update with debounce
  const queueUpdate = useCallback((updates: Partial<MusicItem>, immediate = false) => {
    if (!item) return;
    
    // Update local state immediately
    setFormData(prev => ({ ...prev, ...updates }));
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
    setSaveStatus('unsaved');

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (immediate) {
      flushPendingUpdates();
    } else {
      debounceTimerRef.current = setTimeout(() => {
        flushPendingUpdates();
      }, 400); // 400ms debounce
    }
  }, [item, flushPendingUpdates]);

  // Flush on unmount or before close
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      const targetId = currentItemIdRef.current;
      const updates = pendingUpdatesRef.current;
      if (targetId && Object.keys(updates).length > 0) {
        onUpdateItem(targetId, updates);
      }
    };
  }, [onUpdateItem]);

  const handleClose = () => {
    flushPendingUpdates();
    onClose();
  };

  if (!item) return null;

  // Star & Look helpers
  const getStarLevel = (): number => {
    if (formData.favoriteLevel !== undefined && formData.favoriteLevel !== null) {
      return formData.favoriteLevel;
    }
    if (formData.relevance === 95) return 4;
    if (formData.relevance === 90) return 3;
    if (formData.relevance === 80) return 2;
    if (formData.relevance === 70) return 1;
    return 0;
  };

  const isLookingInto = (): boolean => {
    const currentTags = formData.tags || [];
    return currentTags.some(t => {
      const clean = t.toLowerCase().trim().replace(/^#/, '');
      return clean === 'looking-into' || clean === 'lookinginto';
    });
  };

  const toggleLookingInto = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const currentlyTagged = isLookingInto();
    let newTags: string[];
    const newSources = { ...(formData.tagSources || {}) };
    if (currentlyTagged) {
      newTags = (formData.tags || []).filter(t => {
        const clean = t.toLowerCase().trim().replace(/^#/, '');
        return clean !== 'looking-into' && clean !== 'lookinginto';
      });
      delete newSources['looking-into'];
      delete newSources['lookinginto'];
    } else {
      newTags = [...(formData.tags || []), 'looking-into'];
      newSources['looking-into'] = 'manual';
    }
    queueUpdate({ tags: newTags, tagSources: newSources }, true);
  };

  const cycleFavoriteStar = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const currentLevel = getStarLevel();
    const nextLevel = (currentLevel + 1) % 5;
    let newRelevance = formData.relevance || 0;
    if (nextLevel === 1) newRelevance = 70;
    else if (nextLevel === 2) newRelevance = 80;
    else if (nextLevel === 3) newRelevance = 90;
    else if (nextLevel === 4) newRelevance = 95;
    else if (nextLevel === 0 && currentLevel > 0) newRelevance = 0;

    queueUpdate({ favoriteLevel: nextLevel, relevance: newRelevance }, true);
  };

  const renderStarIcon = (level: number) => {
    switch (level) {
      case 1:
        return <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.8)]" />;
      case 2:
        return <Star className="h-3.5 w-3.5 text-emerald-400 fill-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.8)]" />;
      case 3:
        return <Star className="h-3.5 w-3.5 text-red-500 fill-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.8)]" />;
      case 4:
        return <Star className="h-3.5 w-3.5 text-purple-400 fill-purple-500 drop-shadow-[0_0_6px_rgba(168,85,247,0.8)]" />;
      default:
        return <Star className="h-3.5 w-3.5 text-white/70 hover:text-white stroke-[2]" />;
    }
  };

  const getStarTitle = (level: number) => {
    switch (level) {
      case 1: return "★ Level 1 Favorite (Relevance 70% • Yellow Star)";
      case 2: return "★★ Level 2 Favorite (Relevance 80% • Green Star)";
      case 3: return "★★★ Level 3 Favorite (Relevance 90% • Red Star)";
      case 4: return "★★★★ Level 4 Top Favorite (Relevance 95% • Purple Star)";
      default: return "Click to cycle favorite star level (1-4)";
    }
  };

  // Linked excerpts for track or artist
  const linkedExcerpts = items.filter(i => {
    if (i.type !== 'excerpt') return false;
    if (item.type === 'artist') {
      return (
        i.linkedArtistId === item.id ||
        (i.linkedArtistName && i.linkedArtistName.toLowerCase() === item.name.toLowerCase()) ||
        (item.parentName && i.linkedArtistName && i.linkedArtistName.toLowerCase() === item.parentName.toLowerCase())
      );
    }
    if (item.type === 'track') {
      return (
        i.linkedTrackId === item.id ||
        (i.linkedTrackName && i.linkedTrackName.toLowerCase() === item.name.toLowerCase())
      );
    }
    return false;
  });

  const activeItemMerged: MusicItem = {
    ...item,
    ...formData,
    tags: formData.tags || item.tags || [],
    segments: formData.segments || item.segments || []
  };

  const isThisItemActive = Boolean(
    activeAudioItem && (
      activeAudioItem.id === item.id ||
      (activeAudioItem.parentItemId && activeAudioItem.parentItemId === item.id) ||
      (item.parentItemId && item.parentItemId === activeAudioItem.id) ||
      (item.parentItemId && activeAudioItem.parentItemId && item.parentItemId === activeAudioItem.parentItemId)
    )
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 15 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-5xl h-[92vh] bg-brand-card border border-brand-border rounded-3xl shadow-2xl flex flex-col md:flex-row overflow-hidden z-10"
      >
        {/* Header Action Bar */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          {/* Save indicator */}
          <div className="px-2.5 py-1 rounded-full text-[11px] font-mono glass flex items-center gap-1.5 text-brand-muted">
            <div className={cn(
              "w-2 h-2 rounded-full",
              saveStatus === 'saving' ? "bg-amber-400 animate-ping" :
              saveStatus === 'unsaved' ? "bg-amber-400" : "bg-emerald-400"
            )} />
            <span className="hidden sm:inline">
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved' : 'Saved'}
            </span>
          </div>

          <button 
            onClick={handleClose}
            className="p-2 glass rounded-full text-white hover:bg-white/20 transition-colors cursor-pointer"
            title="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Left Visual Hero */}
        <div className="w-full md:w-1/2 bg-brand-border relative h-64 md:h-auto shrink-0 overflow-hidden">
          {formData.imageUrl ? (
            <img src={formData.imageUrl} alt={item.name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-brand-muted bg-gradient-to-br from-zinc-900 to-black">
              <Music className="h-20 w-20" />
            </div>
          )}

          {/* Quick Badges in top-left */}
          <div className="absolute top-4 left-4 glass px-2.5 py-1 rounded-lg text-xs uppercase font-bold tracking-widest flex items-center gap-2 z-10">
            <button
              type="button"
              onClick={toggleLookingInto}
              className="p-0.5 hover:scale-125 transition-all cursor-pointer flex items-center justify-center focus:outline-none"
              title={isLookingInto() ? "Tagged as #looking-into (Click to remove tag)" : "Tag as #looking-into"}
            >
              {isLookingInto() ? (
                <Search className="h-3.5 w-3.5 text-sky-400 fill-sky-400 drop-shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
              ) : (
                <Search className="h-3.5 w-3.5 text-white/70 hover:text-sky-400 stroke-[2]" />
              )}
            </button>
            <button
              type="button"
              onClick={cycleFavoriteStar}
              className="p-0.5 hover:scale-125 transition-all cursor-pointer flex items-center justify-center focus:outline-none"
              title={getStarTitle(getStarLevel())}
            >
              {renderStarIcon(getStarLevel())}
            </button>
            <span>{item.type}</span>
          </div>

          <div className="absolute inset-x-0 bottom-0 p-6 md:p-8 bg-gradient-to-t from-brand-card via-brand-card/80 to-transparent">
            <span className="text-xs font-bold uppercase tracking-widest text-brand-accent mb-1.5 block">{item.type}</span>
            <h2 className="text-3xl md:text-4xl font-bold mb-1.5 leading-tight text-white">{item.name}</h2>
            {item.subtitle && <p className="text-sm font-medium text-brand-accent/80 tracking-wide mb-1 uppercase">{item.subtitle}</p>}
            {item.parentName && <p className="text-lg md:text-xl text-brand-muted">{item.parentName}</p>}
            {item.creator && (
              <div className="mt-3 flex items-center gap-2 text-sm text-brand-muted">
                <span>Curated by</span>
                {item.creatorUrl ? (
                  <a href={item.creatorUrl} target="_blank" rel="noreferrer" className="text-brand-text font-bold hover:text-brand-accent transition-colors flex items-center gap-1">
                    {item.creator}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-brand-text font-bold">{item.creator}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Metadata Editor */}
        <div className="flex-1 p-6 md:p-8 overflow-y-auto overflow-x-hidden space-y-6 md:space-y-8 min-w-0">
          {/* AI Analysis Status */}
          {item.type === 'playlist' && (
            <div className={cn(
              "p-4 rounded-2xl flex items-center justify-between gap-4",
              item.aiAnalyzed ? "bg-green-500/10 border border-green-500/20" : "bg-orange-500/10 border border-orange-500/20"
            )}>
              <div className="flex items-center gap-3">
                <div className={cn("h-2 w-2 rounded-full", item.aiAnalyzed ? "bg-green-500" : "bg-orange-500 animate-pulse")} />
                <div>
                  <p className={cn("text-xs font-bold uppercase tracking-widest", item.aiAnalyzed ? "text-green-500" : "text-orange-500")}>
                    {item.aiAnalyzed ? "AI Analyzed & Tagged" : "Pending AI Analysis"}
                  </p>
                  <p className="text-[10px] text-brand-muted mt-0.5">
                    {item.aiAnalyzed ? "Enhanced metadata has been extracted" : "Analyze this playlist to extract deeper metadata and tags"}
                  </p>
                </div>
              </div>
              {!item.aiAnalyzed && (
                <Button 
                  onClick={() => onAnalyze(item)} 
                  disabled={isAnalyzing}
                  className="py-1.5 px-3 text-xs flex items-center gap-2"
                >
                  {isAnalyzing && analyzingId === item.id && <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {isAnalyzing && analyzingId === item.id ? "Analyzing..." : "Analyze Now"}
                </Button>
              )}
            </div>
          )}

          {/* Common Stats Grid */}
          <div className={cn(
            "grid gap-2.5 sm:gap-3",
            (item.type === 'track' || item.type === 'excerpt') ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-5"
          )}>
            {/* Rank */}
            <div className="bg-brand-bg border border-brand-border rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center flex flex-col justify-between min-w-0 overflow-hidden">
              <span className="text-[10px] sm:text-[11px] font-bold text-amber-400 uppercase tracking-wider block mb-1 truncate px-0.5" title="Rank Position">Rank</span>
              <span className="text-xl sm:text-2xl font-mono text-amber-300 font-bold truncate">#{scrobbleRankMap[item.id] ?? item.rank ?? '-'}</span>
            </div>
            
            {/* Familiarity */}
            <div className="bg-brand-bg border border-brand-border rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center flex flex-col justify-between min-w-0 overflow-hidden">
              <span className="text-[10px] sm:text-[11px] font-bold text-brand-muted uppercase tracking-wider block mb-1 truncate px-0.5" title="Familiarity">Familiarity</span>
              <span className="text-xl sm:text-2xl font-mono text-brand-accent font-bold truncate">{formData.familiarity || 0}%</span>
            </div>

            {/* Relevance */}
            <div className="bg-brand-bg border border-brand-border rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center flex flex-col justify-between min-w-0 overflow-hidden">
              <span className="text-[10px] sm:text-[11px] font-bold text-brand-muted uppercase tracking-wider block mb-1 truncate px-0.5" title="Relevance">Relevance</span>
              <span className="text-xl sm:text-2xl font-mono text-brand-accent font-bold truncate">{formData.relevance || 0}%</span>
            </div>

            {item.type !== 'track' && item.type !== 'excerpt' && (
              <div className="bg-brand-bg border border-brand-border rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center flex flex-col justify-between min-w-0 overflow-hidden">
                <span className="text-[10px] sm:text-[11px] font-bold text-brand-muted uppercase tracking-wider block mb-1 truncate px-0.5" title="Songs">Songs</span>
                <span className="text-xl sm:text-2xl font-mono font-bold truncate">{item.songCount || 0}</span>
              </div>
            )}

            {/* Scrobbles */}
            <div className="bg-brand-bg border border-brand-border rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center flex flex-col justify-between min-w-0 overflow-hidden">
              <div className="flex items-center justify-center gap-1 text-[10px] sm:text-[11px] font-bold text-brand-muted uppercase tracking-wider mb-1 min-w-0 px-0.5" title="Total Scrobbles">
                <Radio className="h-3 w-3 text-red-500 shrink-0" />
                <span className="truncate">Scrobbles</span>
              </div>
              <span className="text-xl sm:text-2xl font-mono text-red-400 font-bold truncate" title="Absolute lifetime scrobbles on Last.fm">
                {item.lastFmPlaycount !== undefined ? Number(item.lastFmPlaycount).toLocaleString() : '0'}
              </span>
              {item.lastFmPeriodPlaycount !== undefined && item.lastFmPeriod && item.lastFmPeriod !== 'overall' ? (
                <div 
                  className="mt-1 py-0.5 px-1.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-300 text-[9px] sm:text-[10px] font-mono flex items-center justify-center gap-1 min-w-0" 
                  title={`${Number(item.lastFmPeriodPlaycount).toLocaleString()} scrobbles in ${getTimeframeFullLabel(item.lastFmPeriod)}`}
                >
                  <span className="font-semibold truncate">{Number(item.lastFmPeriodPlaycount).toLocaleString()}</span>
                  <span className="text-red-400/80 shrink-0">/{getTimeframeShortLabel(item.lastFmPeriod)}</span>
                </div>
              ) : (
                <div className="text-[9px] text-brand-muted font-mono mt-0.5 truncate px-0.5">
                  All-time Total
                </div>
              )}
              <div className="text-[9px] sm:text-[10px] text-brand-muted flex items-center justify-center gap-1 mt-1 font-mono min-w-0 px-0.5">
                {item.lastFmEnrichedAt ? (
                  <span className="truncate" title={`Synced with Last.fm on ${new Date(item.lastFmEnrichedAt).toLocaleString()}`}>
                    Synced {new Date(item.lastFmEnrichedAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })}
                  </span>
                ) : (
                  <span className="text-neutral-500 truncate">Not synced</span>
                )}
                {(item.type === 'artist' || item.type === 'track' || item.type === 'album') && (
                  <button
                    type="button"
                    onClick={() => onEnrichItem(item)}
                    disabled={isEnrichingSingleItem}
                    title="Sync with Last.fm"
                    className="hover:text-red-400 text-brand-muted transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center shrink-0 ml-1"
                  >
                    <RefreshCw className={cn("h-2.5 w-2.5", isEnrichingSingleItem && "animate-spin text-red-400")} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <a href={item.url} target="_blank" rel="noreferrer" className="flex-1">
              <Button className="w-full flex items-center justify-center gap-2">
                <ExternalLink className="h-5 w-5" />
                Open Link
              </Button>
            </a>
            <Button 
              variant="danger" 
              onClick={() => onDeleteItem(item)} 
              className="px-3"
              title="Delete item from library"
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          </div>

          {/* Rating & Sliders with zero-latency local buffer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
            <section className="bg-brand-bg/60 border border-brand-border/60 rounded-2xl p-4 space-y-2.5 min-w-0">
              <div className="flex items-center justify-between gap-2 text-xs font-bold text-brand-muted uppercase tracking-wider">
                <span className="truncate">Familiarity Level</span>
                <span className="text-xs font-mono text-brand-accent font-bold bg-brand-accent/15 border border-brand-accent/30 px-2 py-0.5 rounded-md shrink-0">
                  {formData.familiarity || 0}%
                </span>
              </div>
              <div className="flex items-center gap-3 min-w-0">
                <input 
                  type="range" 
                  min="0" max="100" 
                  value={formData.familiarity || 0} 
                  onChange={(e) => queueUpdate({ familiarity: parseInt(e.target.value) })}
                  onBlur={flushPendingUpdates}
                  className="w-full min-w-0 flex-1 accent-brand-accent cursor-pointer h-2 bg-brand-border rounded-lg"
                />
              </div>
            </section>

            <section className="bg-brand-bg/60 border border-brand-border/60 rounded-2xl p-4 space-y-2.5 min-w-0">
              <div className="flex items-center justify-between gap-2 text-xs font-bold text-brand-muted uppercase tracking-wider">
                <span className="truncate">Relevance Score</span>
                <span className="text-xs font-mono text-brand-accent font-bold bg-brand-accent/15 border border-brand-accent/30 px-2 py-0.5 rounded-md shrink-0">
                  {formData.relevance || 0}%
                </span>
              </div>
              <div className="flex items-center gap-3 min-w-0">
                <input 
                  type="range" 
                  min="0" max="100" 
                  value={formData.relevance || 0} 
                  onChange={(e) => queueUpdate({ relevance: parseInt(e.target.value) })}
                  onBlur={flushPendingUpdates}
                  className="w-full min-w-0 flex-1 accent-brand-accent cursor-pointer h-2 bg-brand-border rounded-lg"
                />
              </div>
            </section>
          </div>

          {/* Cover Image Source */}
          <section>
            <label className="text-sm font-bold text-brand-muted uppercase tracking-widest mb-4 block">Cover Image Source</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.imageUrl || ''}
                onChange={(e) => queueUpdate({ imageUrl: e.target.value })}
                onBlur={flushPendingUpdates}
                placeholder="https://..."
                className="flex-1 bg-brand-bg border border-brand-border rounded-xl px-4 py-2 outline-none focus:border-brand-accent text-sm text-brand-text placeholder:text-brand-muted/50"
              />
              <Button 
                onClick={async () => {
                  if (isFetchingCover) return;
                  setIsFetchingCover(true);
                  try {
                    const imgUrl = await fetchItemArtwork({
                      type: item.type,
                      name: item.name,
                      parentName: item.parentName,
                      url: item.url,
                      lastFmUrl: item.lastFmUrl
                    }, lastFmSettings?.apiKey);
                    if (imgUrl) {
                      queueUpdate({ imageUrl: imgUrl }, true);
                    } else {
                      alert('Could not find a cover image or artist photo automatically.');
                    }
                  } catch (e) {
                    console.error("Fetch cover error", e);
                    alert('Error fetching cover image automatically.');
                  } finally {
                    setIsFetchingCover(false);
                  }
                }}
                disabled={isFetchingCover}
                className="whitespace-nowrap px-4 py-2 flex items-center gap-2"
              >
                {isFetchingCover && <RefreshCw className="h-4 w-4 animate-spin" />}
                {isFetchingCover ? 'Fetching...' : 'Fetch Cover'}
              </Button>
            </div>
          </section>

          {/* Vibe & Genre Clusters */}
          <ModalClusterManager 
            item={activeItemMerged} 
            activeClusters={activeClusters} 
            onUpdateItem={(id, updates) => queueUpdate(updates, true)} 
            onOpenColorPicker={onOpenColorPicker}
          />

          {/* Tags */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <label className="text-sm font-bold text-brand-muted uppercase tracking-widest block">Tags & Genres</label>
              <div className="flex items-center gap-3 text-[10px] font-normal normal-case flex-wrap">
                <span className="flex items-center gap-1 text-brand-muted">
                  <span className="text-red-400 font-bold">#</span>
                  <span className="border-b border-red-400/40">Synced from Last.fm</span>
                </span>
                <span className="flex items-center gap-1 text-brand-muted">
                  <span className="text-orange-400 font-bold">#</span>
                  <span className="border-b border-orange-400/40">AI Auto-Tagged</span>
                </span>
                <span className="flex items-center gap-1 text-brand-muted">
                  <span className="text-emerald-400 font-bold">#</span>
                  <span className="border-b border-emerald-400/40">Manually Added</span>
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {(formData.tags || []).map(tag => {
                const src = getTagSource(activeItemMerged, tag);
                return (
                  <span 
                    key={tag} 
                    title={src === 'lastfm' ? "Synced from Last.fm tags" : src === 'llm' ? "Auto-added by AI" : "Manually added"}
                    className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 bg-brand-bg border border-brand-border/70 text-brand-text shadow-xs"
                  >
                    <span className={cn("font-bold", src === 'lastfm' ? "text-red-400" : src === 'llm' ? "text-orange-400" : "text-emerald-400")}>#</span>
                    <span className={cn("border-b pb-[1px]", src === 'lastfm' ? "border-red-400/50" : src === 'llm' ? "border-orange-400/50" : "border-emerald-400/50")}>{tag}</span>
                    <button 
                      type="button"
                      onClick={() => {
                        const updatedTags = (formData.tags || []).filter(t => t !== tag);
                        const updatedSources = { ...(formData.tagSources || {}) };
                        delete updatedSources[tag.toLowerCase().trim().replace(/^#/, '')];
                        queueUpdate({ tags: updatedTags, tagSources: updatedSources }, true);
                      }}
                      className="hover:text-red-400 text-brand-muted transition-colors cursor-pointer ml-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
            <input
              type="text"
              value={tagInputValue}
              onChange={(e) => setTagInputValue(e.target.value)}
              placeholder="Add tag and press Enter..."
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter' && tagInputValue.trim()) {
                  e.preventDefault();
                  const newTag = tagInputValue.trim().toLowerCase().replace(/^#/, '');
                  const currentTags = formData.tags || [];
                  if (!currentTags.includes(newTag)) {
                    const updatedTags = [...currentTags, newTag];
                    const updatedSources = {
                      ...(formData.tagSources || {}),
                      [newTag]: 'manual' as const
                    };
                    queueUpdate({ tags: updatedTags, tagSources: updatedSources }, true);
                  }
                  setTagInputValue('');
                }
              }}
              className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 outline-none focus:border-brand-accent text-sm text-brand-text placeholder:text-brand-muted/50"
            />
          </section>

          {/* Excerpt Audio Section (when viewing an Excerpt) */}
          {item.type === 'excerpt' && (
            <section className="space-y-4 bg-emerald-950/20 border border-emerald-500/40 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-5 w-5 text-emerald-400 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Audio Playback & Controls</h4>
                    <p className="text-[10px] text-brand-muted">Plays persistently in background & lockscreen</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {onToggleItemInLoop && (
                    <button
                      type="button"
                      onClick={() => onToggleItemInLoop(activeItemMerged)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold font-mono flex items-center gap-1.5 transition-all cursor-pointer border",
                        loopPlaylist?.some(p => p.id === activeItemMerged.id || ((activeItemMerged as any).originalSegmentId && (p as any).originalSegmentId === (activeItemMerged as any).originalSegmentId))
                          ? "bg-emerald-500 text-zinc-950 border-emerald-400 font-extrabold shadow-sm"
                          : "bg-brand-bg text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/30"
                      )}
                      title="Add or remove this excerpt from the multi-excerpt loop sequence"
                    >
                      <Repeat className="h-3.5 w-3.5" />
                      <span>
                        {loopPlaylist?.some(p => p.id === activeItemMerged.id || ((activeItemMerged as any).originalSegmentId && (p as any).originalSegmentId === (activeItemMerged as any).originalSegmentId))
                          ? "In Loop Queue"
                          : "+ Loop Queue"}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const newLoop = !formData.isLooping;
                      queueUpdate({ isLooping: newLoop }, true);
                    }}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-xs font-bold font-mono flex items-center gap-1.5 transition-all cursor-pointer",
                      formData.isLooping
                        ? "bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/30"
                        : "bg-brand-bg text-brand-muted hover:text-brand-text border border-brand-border"
                    )}
                    title={formData.isLooping ? "Loop is ON: Excerpt repeats seamlessly" : "Loop is OFF"}
                  >
                    <Repeat className="h-3.5 w-3.5" />
                    <span>{formData.isLooping ? "Looping ON" : "Loop OFF"}</span>
                  </button>
                </div>
              </div>

              {/* Quick Player Bar */}
              <div className="flex items-center gap-3 bg-brand-bg/80 border border-brand-border/80 p-3 rounded-xl">
                <button
                  type="button"
                  onClick={() => onPlayAudio(activeItemMerged, undefined, activeSegmentId || (item as any).originalSegmentId || activeItemMerged.activeSegmentId)}
                  className={cn(
                    "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer shadow-md",
                    isThisItemActive && isPlayingAudio
                      ? "bg-emerald-500 text-zinc-950 shadow-emerald-500/30"
                      : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                  )}
                >
                  {isThisItemActive && isPlayingAudio ? (
                    <Pause className="h-5 w-5 fill-current" />
                  ) : (
                    <Play className="h-5 w-5 fill-current ml-0.5" />
                  )}
                </button>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-brand-text font-semibold truncate">{item.audioFileName || item.name}</span>
                    <span className="text-brand-muted shrink-0">
                      {isThisItemActive
                        ? `${formatAudioDuration(audioCurrentTime)} / ${formatAudioDuration(audioDuration || item.durationSeconds || 0)}`
                        : formatAudioDuration(item.durationSeconds || 0)}
                    </span>
                  </div>
                  {isThisItemActive && (
                    <input
                      type="range"
                      min="0"
                      max={audioDuration || 1}
                      step="0.01"
                      value={audioCurrentTime}
                      onChange={(e) => onSeekAudio(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-brand-border rounded-lg appearance-none cursor-pointer accent-emerald-400"
                    />
                  )}
                </div>

                <label 
                  className="p-2 hover:bg-emerald-500/20 text-emerald-400 rounded-lg cursor-pointer transition-colors shrink-0" 
                  title="Attach or sync MP3 audio file to this excerpt on this device"
                >
                  <Upload className="h-4 w-4" />
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const dur = await getAudioDuration(file);
                      await saveAudioFile(item.id, file, file.name, file.type, dur);
                      queueUpdate({
                        audioFileName: file.name,
                        audioDuration: dur,
                        durationSeconds: dur,
                      }, true);
                    }}
                  />
                </label>
              </div>

              {/* Demarcated Excerpts & Timings Section */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-brand-text uppercase tracking-wider flex items-center gap-1.5">
                    <Scissors className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Demarcated Excerpts within this Audio ({(formData.segments || []).length})</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const segs = formData.segments || [];
                      const newId = `seg_${Date.now()}`;
                      const newSeg: AudioSegment = {
                        id: newId,
                        name: `Excerpt ${segs.length + 1}`,
                        startTime: 0,
                        endTime: item.audioDuration || item.durationSeconds || 30,
                        comments: ''
                      };
                      queueUpdate({ segments: [...segs, newSeg] }, true);
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Excerpt Timing</span>
                  </button>
                </div>

                {(!formData.segments || formData.segments.length === 0) ? (
                  <div className="p-3 bg-brand-bg/40 border border-dashed border-emerald-500/30 rounded-xl text-center">
                    <p className="text-xs text-brand-muted">No demarcated timing excerpts added yet. Full audio plays by default.</p>
                    <button
                      type="button"
                      onClick={() => {
                        const newSeg: AudioSegment = {
                          id: `seg_${Date.now()}`,
                          name: 'Main Excerpt',
                          startTime: 0,
                          endTime: item.audioDuration || item.durationSeconds || 30,
                          comments: ''
                        };
                        queueUpdate({ segments: [newSeg] }, true);
                      }}
                      className="mt-2 text-xs font-semibold text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Create first excerpt timing</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {formData.segments.map((seg, idx) => {
                      const isCurrentPlayingSeg = isThisItemActive && activeSegmentId === seg.id && isPlayingAudio;
                      const isSegSelectedOrActive = (activeSegmentId === seg.id || (!activeSegmentId && (item as any).originalSegmentId === seg.id)) && isThisItemActive;
                      return (
                        <div
                          key={seg.id}
                          className={cn(
                            "p-3 rounded-xl border transition-all space-y-2.5",
                            isSegSelectedOrActive
                              ? "bg-emerald-950/40 border-emerald-500/60 shadow-xs"
                              : "bg-brand-bg/60 border-brand-border/70 hover:border-emerald-500/40"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onPlayAudio(activeItemMerged, undefined, seg.id)}
                              className={cn(
                                "h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer",
                                isCurrentPlayingSeg
                                  ? "bg-emerald-500 text-zinc-950"
                                  : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                              )}
                              title={`Play ${seg.name}`}
                            >
                              {isCurrentPlayingSeg ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
                            </button>

                            <input
                              type="text"
                              value={seg.name}
                              onChange={(e) => {
                                const val = e.target.value;
                                const updated = (formData.segments || []).map(s => s.id === seg.id ? { ...s, name: val } : s);
                                queueUpdate({ segments: updated });
                              }}
                              onBlur={flushPendingUpdates}
                              placeholder={`Excerpt ${idx + 1}`}
                              className="flex-1 min-w-0 bg-brand-bg border border-brand-border/80 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-text focus:border-emerald-400 outline-none"
                            />

                            {/* Start Time */}
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] text-brand-muted font-mono">From:</span>
                              <input
                                type="text"
                                defaultValue={formatAudioDuration(seg.startTime)}
                                key={`start_${seg.id}_${seg.startTime}`}
                                onBlur={(e) => {
                                  const sec = parseTimeToSeconds(e.target.value, 0);
                                  const updated = (formData.segments || []).map(s => s.id === seg.id ? { ...s, startTime: sec } : s);
                                  queueUpdate({ segments: updated }, true);
                                }}
                                placeholder="0:00"
                                className="w-14 bg-brand-bg border border-brand-border/80 rounded-lg px-1.5 py-1.5 text-xs font-mono text-center text-brand-text focus:border-emerald-400 outline-none"
                                title="Start time (e.g. 0:14)"
                              />
                            </div>

                            {/* End Time */}
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] text-brand-muted font-mono">To:</span>
                              <input
                                type="text"
                                defaultValue={formatAudioDuration(seg.endTime)}
                                key={`end_${seg.id}_${seg.endTime}`}
                                onBlur={(e) => {
                                  const sec = parseTimeToSeconds(e.target.value, item.audioDuration || 30);
                                  const updated = (formData.segments || []).map(s => s.id === seg.id ? { ...s, endTime: sec } : s);
                                  queueUpdate({ segments: updated }, true);
                                }}
                                placeholder="0:38"
                                className="w-14 bg-brand-bg border border-brand-border/80 rounded-lg px-1.5 py-1.5 text-xs font-mono text-center text-brand-text focus:border-emerald-400 outline-none"
                                title="End time (e.g. 0:38)"
                              />
                            </div>

                            {(formData.segments || []).length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = (formData.segments || []).filter(s => s.id !== seg.id);
                                  queueUpdate({ segments: updated }, true);
                                }}
                                className="p-1.5 text-brand-muted hover:text-red-400 rounded-lg hover:bg-brand-bg transition-colors cursor-pointer"
                                title="Delete this excerpt timing"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>

                          <input
                            type="text"
                            value={seg.comments || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              const updated = (formData.segments || []).map(s => s.id === seg.id ? { ...s, comments: val } : s);
                              queueUpdate({ segments: updated });
                            }}
                            onBlur={flushPendingUpdates}
                            placeholder="Notes / feedback for this specific excerpt section..."
                            className="w-full bg-brand-bg/50 border border-brand-border/60 rounded-lg px-2.5 py-1 text-[11px] text-brand-text placeholder:text-brand-muted/50 focus:border-emerald-400 outline-none"
                          />

                          {/* Segment Individual Tags */}
                          <div className="pt-1.5 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-brand-muted flex items-center gap-1">
                                <Tag className="h-3 w-3 text-emerald-400" />
                                <span>Excerpt Tags</span>
                                <span className="text-[10px] text-brand-muted/70 font-normal">(individual)</span>
                              </span>
                              {(seg.tags || []).length > 0 && (
                                <span className="text-[10px] text-emerald-400 font-mono">
                                  {(seg.tags || []).length} {seg.tags!.length === 1 ? 'tag' : 'tags'}
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-1 min-h-[28px] p-1 bg-brand-bg/40 border border-brand-border/60 rounded-lg focus-within:border-emerald-400 transition-colors">
                              {(seg.tags || []).map(t => (
                                <span
                                  key={t}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10.5px] font-mono"
                                >
                                  <span>#{t}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newTags = (seg.tags || []).filter(existingTag => existingTag !== t);
                                      const updated = (formData.segments || []).map(s => s.id === seg.id ? { ...s, tags: newTags } : s);
                                      queueUpdate({ segments: updated }, true);
                                    }}
                                    className="hover:text-red-400 text-emerald-400/60 p-0.5 transition cursor-pointer"
                                    title={`Remove tag #${t}`}
                                  >
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                </span>
                              ))}

                              <input
                                type="text"
                                placeholder={(seg.tags || []).length === 0 ? "Add excerpt tags (comma or Enter)..." : "Add tag..."}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ',') {
                                    e.preventDefault();
                                    const input = e.currentTarget;
                                    const val = input.value.trim().toLowerCase().replace(/^#/, '');
                                    if (val) {
                                      const newTags = Array.from(new Set([...(seg.tags || []), val]));
                                      const updated = (formData.segments || []).map(s => s.id === seg.id ? { ...s, tags: newTags } : s);
                                      queueUpdate({ segments: updated }, true);
                                      input.value = '';
                                    }
                                  } else if (e.key === 'Backspace' && !e.currentTarget.value && (seg.tags || []).length > 0) {
                                    const newTags = seg.tags!.slice(0, -1);
                                    const updated = (formData.segments || []).map(s => s.id === seg.id ? { ...s, tags: newTags } : s);
                                    queueUpdate({ segments: updated }, true);
                                  }
                                }}
                                onBlur={(e) => {
                                  const val = e.currentTarget.value.trim().toLowerCase().replace(/^#/, '');
                                  if (val) {
                                    const newTags = Array.from(new Set([...(seg.tags || []), val]));
                                    const updated = (formData.segments || []).map(s => s.id === seg.id ? { ...s, tags: newTags } : s);
                                    queueUpdate({ segments: updated }, true);
                                    e.currentTarget.value = '';
                                  }
                                }}
                                className="flex-1 min-w-[110px] bg-transparent text-[11px] text-brand-text placeholder:text-brand-muted/50 focus:outline-none px-1"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Linking to Track / Artist */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-brand-text uppercase tracking-wider flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Link to Track & Artist</span>
                  </label>
                  <span className="text-[10px] text-brand-muted">Syncs excerpt with your library tabs</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-brand-muted flex items-center justify-between">
                      <span>Linked Track</span>
                      {formData.linkedTrackName && (
                        <button
                          type="button"
                          onClick={() => queueUpdate({ linkedTrackName: '', linkedTrackId: '' }, true)}
                          className="text-[10px] text-red-400 hover:underline cursor-pointer"
                        >
                          Unlink
                        </button>
                      )}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={formData.linkedTrackName || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const match = items.find(i => i.type === 'track' && i.name.toLowerCase() === val.toLowerCase());
                          queueUpdate({
                            linkedTrackName: val,
                            linkedTrackId: match ? match.id : formData.linkedTrackId,
                            linkedArtistName: match?.parentName || formData.linkedArtistName
                          });
                        }}
                        onBlur={flushPendingUpdates}
                        placeholder="Type or select a track name..."
                        list="modal-track-names-list"
                        className="w-full bg-brand-bg border border-brand-border rounded-xl px-3.5 py-2.5 outline-none focus:border-emerald-400 text-sm text-brand-text placeholder:text-brand-muted/50"
                      />
                      <datalist id="modal-track-names-list">
                        {existingTrackNames.map(name => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-brand-muted flex items-center justify-between">
                      <span>Linked Artist</span>
                      {formData.linkedArtistName && (
                        <button
                          type="button"
                          onClick={() => queueUpdate({ linkedArtistName: '', linkedArtistId: '' }, true)}
                          className="text-[10px] text-red-400 hover:underline cursor-pointer"
                        >
                          Unlink
                        </button>
                      )}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={formData.linkedArtistName || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const match = items.find(i => i.type === 'artist' && i.name.toLowerCase() === val.toLowerCase());
                          queueUpdate({
                            linkedArtistName: val,
                            linkedArtistId: match ? match.id : formData.linkedArtistId
                          });
                        }}
                        onBlur={flushPendingUpdates}
                        placeholder="Type or select an artist name..."
                        list="modal-artist-names-list"
                        className="w-full bg-brand-bg border border-brand-border rounded-xl px-3.5 py-2.5 outline-none focus:border-emerald-400 text-sm text-brand-text placeholder:text-brand-muted/50"
                      />
                      <datalist id="modal-artist-names-list">
                        {existingArtistNames.map(name => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                </div>
              </div>

              {/* Excerpt Comments & Notes */}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-semibold text-brand-text flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Excerpt Comments & Feedback</span>
                  </span>
                  <span className="text-[10px] text-brand-muted">Notes on this specific audio sample</span>
                </label>
                <textarea
                  value={formData.comments || ''}
                  onChange={(e) => queueUpdate({ comments: e.target.value })}
                  onBlur={flushPendingUpdates}
                  placeholder="Write your comments on this sample, feedback, mixing ideas, loop suggestions..."
                  className="w-full h-24 bg-brand-bg border border-brand-border rounded-xl p-3 outline-none focus:border-emerald-400 text-sm text-brand-text placeholder:text-brand-muted/50 resize-none transition-colors"
                />
              </div>
            </section>
          )}

          {/* Fillable Curation Metadata Fields (Track, Excerpt & Artist Details) */}
          {(item.type === 'artist' || item.type === 'track' || item.type === 'excerpt') && (
            <section className="space-y-4 bg-brand-bg/50 border border-brand-border/80 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between border-b border-brand-border/40 pb-2">
                <label className="text-xs font-bold text-brand-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-brand-accent" />
                  <span>Curation Metadata</span>
                </label>
                <span className="text-[10px] font-mono text-brand-accent uppercase tracking-widest bg-brand-accent/10 px-2 py-0.5 rounded border border-brand-accent/20">
                  {item.type} Details
                </span>
              </div>

              {/* Artist Metadata */}
              {item.type === 'artist' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-brand-text flex items-center justify-between">
                    <span>Artist Metadata: Related To / Source</span>
                    <span className="text-[10px] text-brand-muted font-normal">Lineage, labels, associations</span>
                  </label>
                  <input
                    type="text"
                    value={formData.relatedToSource || ''}
                    onChange={(e) => queueUpdate({ relatedToSource: e.target.value })}
                    onBlur={flushPendingUpdates}
                    placeholder="e.g. Associated with Blue Note, collaborated with Wayne Shorter, Miles Davis..."
                    className="w-full bg-brand-bg border border-brand-border rounded-xl px-3.5 py-2.5 outline-none focus:border-brand-accent text-sm text-brand-text placeholder:text-brand-muted/50 transition-colors"
                  />
                </div>
              )}

              {/* Track & Excerpt Metadata */}
              {(item.type === 'track' || item.type === 'excerpt') && (
                <div className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-brand-text flex items-center justify-between">
                        <span>BPM</span>
                        <span className="text-[10px] text-brand-muted font-normal">Tempo</span>
                      </label>
                      <input
                        type="text"
                        value={formData.bpm !== undefined && formData.bpm !== null ? String(formData.bpm) : ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          queueUpdate({ bpm: val ? (isNaN(Number(val)) ? val : Number(val)) : '' });
                        }}
                        onBlur={flushPendingUpdates}
                        placeholder="e.g. 124"
                        className="w-full bg-brand-bg border border-brand-border rounded-xl px-3.5 py-2.5 outline-none focus:border-brand-accent text-sm font-mono text-brand-text placeholder:text-brand-muted/50 transition-colors"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-brand-text flex items-center justify-between">
                        <span>Key / Mode</span>
                        <span className="text-[10px] text-brand-muted font-normal">Scale / Camelot</span>
                      </label>
                      <input
                        type="text"
                        value={formData.key || ''}
                        onChange={(e) => queueUpdate({ key: e.target.value })}
                        onBlur={flushPendingUpdates}
                        placeholder="e.g. F Major, 8A, A Minor"
                        className="w-full bg-brand-bg border border-brand-border rounded-xl px-3.5 py-2.5 outline-none focus:border-brand-accent text-sm text-brand-text placeholder:text-brand-muted/50 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-brand-text flex items-center justify-between">
                      <span>Instrumentation Details</span>
                      <span className="text-[10px] text-brand-muted font-normal">Key timbres & sonic elements</span>
                    </label>
                    <input
                      type="text"
                      value={formData.instrumentationDetails || ''}
                      onChange={(e) => queueUpdate({ instrumentationDetails: e.target.value })}
                      onBlur={flushPendingUpdates}
                      placeholder="e.g. Fender Rhodes, brushed snare, Moog sub-bass, tenor sax"
                      className="w-full bg-brand-bg border border-brand-border rounded-xl px-3.5 py-2.5 outline-none focus:border-brand-accent text-sm text-brand-text placeholder:text-brand-muted/50 transition-colors"
                    />
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Excerpts List for Tracks & Artists */}
          {(item.type === 'artist' || item.type === 'track') && (
            <section className="space-y-3 bg-brand-bg/50 border border-brand-border/80 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between border-b border-brand-border/40 pb-2">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-brand-muted shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-brand-text uppercase tracking-wider">
                      Excerpts ({linkedExcerpts.length})
                    </h4>
                    <p className="text-[10px] text-brand-muted">
                      Audio samples & clips synced with this {item.type}
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => onOpenExcerptUpload(
                    item.type === 'artist' ? item.name : (item.parentName || ''),
                    item.type === 'track' ? item.name : '',
                    item.type === 'artist' ? item.id : undefined,
                    item.type === 'track' ? item.id : undefined
                  )}
                  className="py-1 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Excerpt</span>
                </Button>
              </div>

              {linkedExcerpts.length > 0 ? (
                <div className="space-y-2">
                  {linkedExcerpts.map(excerpt => {
                    const isThisPlaying = activeAudioItem?.id === excerpt.id && isPlayingAudio;
                    return (
                      <div
                        key={excerpt.id}
                        className="p-3 bg-brand-card/90 border border-brand-border/80 hover:border-emerald-500/50 rounded-xl flex items-center justify-between gap-3 transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <button
                            type="button"
                            onClick={() => onPlayAudio(excerpt)}
                            className={cn(
                              "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer",
                              isThisPlaying ? "bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/30" : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                            )}
                            title={isThisPlaying ? "Pause" : "Play excerpt"}
                          >
                            {isThisPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-brand-text truncate">{excerpt.name}</span>
                              {excerpt.isLooping && (
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold shrink-0">
                                  🔁 Loop
                                </span>
                              )}
                              {excerpt.durationSeconds && (
                                <span className="text-[10px] font-mono text-brand-muted shrink-0">
                                  {formatAudioDuration(excerpt.durationSeconds)}
                                </span>
                              )}
                            </div>
                            {excerpt.comments ? (
                              <p className="text-xs text-brand-muted truncate mt-0.5 italic">"{excerpt.comments}"</p>
                            ) : excerpt.audioFileName ? (
                              <p className="text-[10px] text-brand-muted/70 font-mono truncate mt-0.5">{excerpt.audioFileName}</p>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onSelectItem?.(excerpt)}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-brand-bg hover:bg-brand-border/60 text-brand-text transition cursor-pointer"
                          >
                            View
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4 text-xs text-brand-muted border border-dashed border-brand-border/60 rounded-xl">
                  No audio excerpts linked yet. Click <strong className="text-brand-text">"+ Add Excerpt"</strong> to attach a sample for this {item.type}.
                </div>
              )}
            </section>
          )}

          {/* Notes textarea with instant local typing */}
          <section className="flex-1 flex flex-col">
            <label className="text-sm font-bold text-brand-muted uppercase tracking-widest mb-4 block">Curation Notes (Markdown)</label>
            <textarea
              value={formData.notes || ''}
              onChange={(e) => queueUpdate({ notes: e.target.value })}
              onBlur={flushPendingUpdates}
              placeholder="Write your analysis, mood details, or track lists here..."
              className="w-full h-48 bg-brand-bg border border-brand-border rounded-2xl p-4 outline-none focus:border-brand-accent mb-4 resize-none text-brand-text placeholder:text-brand-muted/50 leading-relaxed font-sans"
            />
          </section>

          {/* Single Item Quick Export Bar */}
          <div className="p-3.5 bg-brand-bg/40 border border-brand-border/60 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-brand-muted">
              <Download className="h-4 w-4 text-brand-accent" />
              <span>Export This Item</span>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => {
                  const jsonStr = formatSingleItemJSON(activeItemMerged, activeClusters);
                  const sanitizedName = (item.name || 'item').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 30);
                  const blob = new Blob([jsonStr], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${sanitizedName}_${item.type}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-3 py-1.5 text-xs font-bold bg-brand-card hover:bg-brand-bg border border-brand-border hover:border-brand-accent rounded-xl text-brand-text transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Download single item JSON"
              >
                <FileText className="h-3.5 w-3.5 text-brand-accent" />
                <span>JSON</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const mdStr = formatSingleItemMarkdown(activeItemMerged, activeClusters);
                  const sanitizedName = (item.name || 'item').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 30);
                  const blob = new Blob([mdStr], { type: 'text/markdown' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${sanitizedName}_${item.type}.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-3 py-1.5 text-xs font-bold bg-brand-card hover:bg-brand-bg border border-brand-border hover:border-brand-accent rounded-xl text-brand-text transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Download single item Markdown"
              >
                <FileText className="h-3.5 w-3.5 text-emerald-400" />
                <span>Markdown (.md)</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  const mdStr = formatSingleItemMarkdown(activeItemMerged, activeClusters);
                  try {
                    await navigator.clipboard.writeText(mdStr);
                    setSingleItemCopied(true);
                    setTimeout(() => setSingleItemCopied(false), 2500);
                  } catch (e) {
                    console.error('Copy failed', e);
                  }
                }}
                className="px-3 py-1.5 text-xs font-bold bg-brand-accent/15 hover:bg-brand-accent/25 border border-brand-accent/30 rounded-xl text-brand-accent transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Copy item Markdown to clipboard"
              >
                {singleItemCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{singleItemCopied ? 'Copied MD!' : 'Copy MD'}</span>
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
