import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp, 
  setDoc,
  getDoc,
  getDocs,
  orderBy 
} from 'firebase/firestore';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { getDocFromServer, doc as firestoreDoc } from 'firebase/firestore';
import { MusicItem, ItemType, TagCluster, LastFmSettings } from './types';
import { AudioWaveform, Library, Plus, Search, Filter, LogOut, Music, User as UserIcon, Disc, ListMusic, Tag, Star, ChevronRight, ChevronLeft, ChevronDown, PanelLeftClose, PanelLeftOpen, Menu, Share2, Download, Trash2, X, ExternalLink, Upload, FileSpreadsheet, CheckSquare, Square, Edit3, Image as ImageIcon, RefreshCw, Sparkles, Layers, HelpCircle, Minus, GripVertical, ArrowUp, ArrowDown, Move, LayoutGrid, Grid3x3, LayoutList, Globe, RotateCcw, FileText, Copy, Check, Radio, Palette, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from './lib/utils';
import { parseMusicLinks, parsePlaylistSpreadsheet, parseAlbumSpreadsheet, analyzeItem, AVAILABLE_MODELS, clusterTagsWithAI } from './lib/gemini';
import { LastFmSyncModal } from './components/LastFmSyncModal';
import { ClusterColorModal, ClusterColorGrid } from './components/ClusterColorPicker';
import { getClusterColor, CLUSTER_COLOR_PALETTE } from './lib/clusterColors';
import { enrichArtistFromLastFm, enrichTrackFromLastFm, enrichAlbumFromLastFm, fetchItemArtwork, fetchArtistPicture, fetchAlbumCover, fetchTrackCover, getTimeframeShortLabel, getTimeframeFullLabel } from './lib/lastfm';
import * as XLSX from 'xlsx';
import ReactMarkdown from 'react-markdown';
import { INITIAL_DEMO_ITEMS, INITIAL_DEMO_CLUSTERS } from './data/demoDataset';

// --- Components ---

const Button = ({ className, variant = 'primary', ...props }: any) => {
  const variants: any = {
    primary: 'bg-brand-accent text-white hover:opacity-90',
    secondary: 'bg-brand-card text-brand-text border border-brand-border hover:border-brand-accent',
    ghost: 'hover:bg-brand-card text-brand-muted hover:text-brand-text',
    danger: 'bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white',
  };
  return (
    <button 
      className={cn('px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none', variants[variant], className)}
      {...props}
    />
  );
};

const Card = ({ children, className, ...props }: any) => (
  <div className={cn('glass rounded-xl p-4', className)} {...props}>
    {children}
  </div>
);

export const getTagSource = (item: MusicItem | null | undefined, tag: string): 'llm' | 'manual' | 'lastfm' => {
  if (!item) return 'manual';
  const cleanTag = tag.toLowerCase().trim().replace(/^#/, '');
  if (item.tagSources && item.tagSources[cleanTag]) {
    return item.tagSources[cleanTag];
  }
  // Check if item originated or was enriched from Last.fm
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

export const getGlobalTagSource = (items: MusicItem[], tag: string): 'llm' | 'manual' | 'lastfm' => {
  const cleanTag = tag.toLowerCase().trim().replace(/^#/, '');
  const matchingItems = items.filter(item => 
    item.tags && item.tags.some(t => t.toLowerCase().trim().replace(/^#/, '') === cleanTag)
  );
  if (matchingItems.length === 0) return 'manual';
  // Prioritize Last.fm if ANY matching item has this tag synced/imported from Last.fm
  const hasLastFm = matchingItems.some(item => getTagSource(item, cleanTag) === 'lastfm');
  if (hasLastFm) return 'lastfm';
  const hasManual = matchingItems.some(item => getTagSource(item, cleanTag) === 'manual');
  if (hasManual) return 'manual';
  return 'llm';
};

export const getItemClusters = (item: MusicItem | null, activeClusters: TagCluster[]): TagCluster[] => {
  if (!item || !item.tags || item.tags.length === 0) return [];
  const itemTagSet = new Set(item.tags.map(t => t.toLowerCase().trim().replace(/^#/, '')));
  const matched = activeClusters.filter(cluster => 
    (cluster.tags || []).some(ct => itemTagSet.has(ct.toLowerCase().trim().replace(/^#/, '')))
  );

  if (item.primaryCluster) {
    const primaryIndex = matched.findIndex(c => c.name === item.primaryCluster);
    if (primaryIndex > 0) {
      const [primaryObj] = matched.splice(primaryIndex, 1);
      matched.unshift(primaryObj);
    } else if (primaryIndex === -1) {
      const primaryObj = activeClusters.find(c => c.name === item.primaryCluster);
      if (primaryObj) {
        matched.unshift(primaryObj);
      }
    }
  }

  return matched;
};

export const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", url);
  downloadAnchorNode.setAttribute("download", filename);
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
  URL.revokeObjectURL(url);
};

export const formatExportJSON = (itemsToExport: MusicItem[], activeClusters: TagCluster[]): string => {
  const exportPayload = itemsToExport.map(item => {
    const itemClusters = getItemClusters(item, activeClusters);
    const clusterNames = itemClusters.map(c => c.name);
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      url: item.url,
      imageUrl: item.imageUrl || null,
      parentName: item.parentName || null,
      subtitle: item.subtitle || null,
      creator: item.creator || null,
      creatorUrl: item.creatorUrl || null,
      releaseDate: item.releaseDate || null,
      songCount: item.songCount !== undefined ? item.songCount : null,
      durationSeconds: item.durationSeconds !== undefined ? item.durationSeconds : null,
      // Familiarity & Relevance metrics
      familiarityLevel: item.familiarity !== undefined ? item.familiarity : 0,
      relevanceScore: item.relevance !== undefined ? item.relevance : 0,
      favoriteLevel: item.favoriteLevel || 0,
      rating: item.rating !== undefined ? item.rating : 50,
      // Last.fm Scrobbles & Timeframe metrics
      lastFmTotalScrobbles: item.lastFmPlaycount !== undefined ? item.lastFmPlaycount : null,
      lastFmTimeframeScrobbles: item.lastFmPeriodPlaycount !== undefined ? item.lastFmPeriodPlaycount : null,
      lastFmTimeframePeriod: item.lastFmPeriod || null,
      lastFmListeners: item.lastFmListeners !== undefined ? item.lastFmListeners : null,
      lastFmEnrichedAt: item.lastFmEnrichedAt || null,
      // Clusters & Tags
      primaryCluster: item.primaryCluster || (clusterNames[0] || null),
      vibeGenreClusters: clusterNames,
      tags: item.tags || [],
      tagSources: item.tagSources || {},
      // Fillable metadata fields
      relatedToSource: item.relatedToSource || null,
      genres: item.genres || null,
      rhythms: item.rhythms || null,
      bpm: item.bpm !== undefined && item.bpm !== null && item.bpm !== '' ? item.bpm : null,
      key: item.key || null,
      instrumentationDetails: item.instrumentationDetails || null,
      // Curation notes
      curationNotes: item.notes || '',
      aiAnalyzed: Boolean(item.aiAnalyzed),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
    };
  });
  return JSON.stringify(exportPayload, null, 2);
};

export const formatExportMarkdown = (itemsToExport: MusicItem[], activeClusters: TagCluster[], scopeTitle = "Full Library"): string => {
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  const artists = itemsToExport.filter(i => i.type === 'artist');
  const playlists = itemsToExport.filter(i => i.type === 'playlist');
  const albums = itemsToExport.filter(i => i.type === 'album');
  const tracks = itemsToExport.filter(i => i.type === 'track');

  let md = `# Sonic Vault — Music Curation & Metadata Library Export\n\n`;
  md += `> **Scope**: ${scopeTitle}  \n`;
  md += `> **Export Date**: ${nowStr}  \n`;
  md += `> **Total Items**: ${itemsToExport.length} (Artists: ${artists.length}, Playlists: ${playlists.length}, Albums: ${albums.length}, Tracks: ${tracks.length})\n\n`;
  md += `---\n\n`;

  md += `## Table of Contents\n`;
  if (artists.length > 0) md += `- [Artists (${artists.length})](#artists)\n`;
  if (playlists.length > 0) md += `- [Playlists (${playlists.length})](#playlists)\n`;
  if (albums.length > 0) md += `- [Albums (${albums.length})](#albums)\n`;
  if (tracks.length > 0) md += `- [Tracks (${tracks.length})](#tracks)\n`;
  md += `\n---\n\n`;

  const renderItemSection = (item: MusicItem, idx: number) => {
    const itemClusters = getItemClusters(item, activeClusters);
    const clusterNames = itemClusters.map(c => c.name);
    let sec = `### ${idx + 1}. ${item.name}\n\n`;
    sec += `- **Type**: \`${item.type}\`\n`;
    if (item.url) sec += `- **URL**: [Open Link](${item.url})\n`;
    if (item.subtitle) sec += `- **Subtitle**: ${item.subtitle}\n`;
    if (item.parentName) sec += `- **Parent / Artist**: ${item.parentName}\n`;
    if (item.creator) {
      sec += `- **Creator / Curator**: ${item.creatorUrl ? `[${item.creator}](${item.creatorUrl})` : item.creator}\n`;
    }
    if (item.releaseDate) sec += `- **Release Date**: ${item.releaseDate}\n`;
    if (item.songCount !== undefined && item.songCount > 0) sec += `- **Song Count**: ${item.songCount} songs\n`;
    if (item.durationSeconds !== undefined && item.durationSeconds > 0) {
      const mins = Math.floor(item.durationSeconds / 60);
      const secs = item.durationSeconds % 60;
      sec += `- **Duration**: ${mins}m ${secs.toString().padStart(2, '0')}s (${item.durationSeconds}s)\n`;
    }

    // Familiarity & Relevance
    const favTitle = item.favoriteLevel === 4 ? ' ★★★★ (95% Purple Tier)' : item.favoriteLevel === 3 ? ' ★★★ (90% Red Tier)' : item.favoriteLevel === 2 ? ' ★★ (80% Green Tier)' : item.favoriteLevel === 1 ? ' ★ (70% Starred)' : '';
    sec += `- **Familiarity Level**: ${item.familiarity !== undefined ? item.familiarity : 0}%\n`;
    sec += `- **Relevance Score**: ${item.relevance !== undefined ? item.relevance : 0}%${favTitle}\n`;
    if (item.lastFmPlaycount !== undefined) {
      sec += `- **Last.fm Total Lifetime Scrobbles**: ${item.lastFmPlaycount.toLocaleString()} plays\n`;
    }
    if (item.lastFmPeriodPlaycount !== undefined && item.lastFmPeriod && item.lastFmPeriod !== 'overall') {
      sec += `- **Last.fm Timeframe Scrobbles (${getTimeframeShortLabel(item.lastFmPeriod)})**: ${item.lastFmPeriodPlaycount.toLocaleString()} plays (${getTimeframeFullLabel(item.lastFmPeriod)})\n`;
    }

    // Vibe / Genre Clusters
    if (clusterNames.length > 0) {
      const clusterFormatted = clusterNames.map((c, i) => i === 0 && (item.primaryCluster === c || !item.primaryCluster) ? `**${c}** *(Primary)*` : `\`${c}\``).join(', ');
      sec += `- **Vibe / Genre Clusters**: ${clusterFormatted}\n`;
    }

    // Fillable metadata fields
    if (item.type === 'artist' && item.relatedToSource) {
      sec += `- **Artist Metadata (Related to / Source)**: ${item.relatedToSource}\n`;
    }
    if (item.genres) {
      sec += `- **Genre(s)**: ${item.genres}\n`;
    }
    if (item.rhythms) {
      sec += `- **Rhythm(s)**: ${item.rhythms}\n`;
    }
    if (item.type === 'track') {
      if (item.bpm !== undefined && item.bpm !== null && item.bpm !== '') sec += `- **BPM**: ${item.bpm}\n`;
      if (item.key) sec += `- **Key**: ${item.key}\n`;
      if (item.instrumentationDetails) sec += `- **Instrumentation Details**: ${item.instrumentationDetails}\n`;
    }

    // Tags
    if (item.tags && item.tags.length > 0) {
      sec += `- **Tags**: ${item.tags.map(t => `\`#${t.replace(/^#/, '')}\``).join(', ')}\n`;
    }

    // Curation Notes
    if (item.notes && item.notes.trim()) {
      sec += `\n#### Curation Notes\n\n${item.notes.trim()}\n`;
    }

    sec += `\n---\n\n`;
    return sec;
  };

  if (artists.length > 0) {
    md += `## Artists\n\n`;
    artists.forEach((item, idx) => {
      md += renderItemSection(item, idx);
    });
  }

  if (playlists.length > 0) {
    md += `## Playlists\n\n`;
    playlists.forEach((item, idx) => {
      md += renderItemSection(item, idx);
    });
  }

  if (albums.length > 0) {
    md += `## Albums\n\n`;
    albums.forEach((item, idx) => {
      md += renderItemSection(item, idx);
    });
  }

  if (tracks.length > 0) {
    md += `## Tracks\n\n`;
    tracks.forEach((item, idx) => {
      md += renderItemSection(item, idx);
    });
  }

  return md;
};

const ItemClusterBadges = ({ 
  item, 
  activeClusters, 
  viewMode,
  onUpdateItem,
  onOpenColorPicker
}: { 
  item: MusicItem; 
  activeClusters: TagCluster[]; 
  viewMode: 'cards' | 'small-cards' | 'list';
  onUpdateItem?: (id: string, updates: Partial<MusicItem>) => void;
  onOpenColorPicker?: (cluster: TagCluster) => void;
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen]);

  const itemClusters = React.useMemo(() => {
    return getItemClusters(item, activeClusters);
  }, [item, activeClusters]);

  if (itemClusters.length === 0) return null;

  const primaryCluster = itemClusters[0];
  const primaryColor = getClusterColor(primaryCluster);
  const isPrimaryVibe = (primaryCluster.category || 'vibe') === 'vibe';
  
  const otherClusters = itemClusters.slice(1);
  const otherCount = otherClusters.length;
  const otherNamesText = otherClusters.map(c => c.name).join(', ');

  const handleSelectPrimary = (e: React.MouseEvent, clusterName: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (onUpdateItem) {
      const targetCluster = activeClusters.find(c => c.name === clusterName);
      let newTags = [...(item.tags || [])];
      if (targetCluster && targetCluster.tags && targetCluster.tags.length > 0) {
        const representativeTag = targetCluster.tags[0].toLowerCase().trim().replace(/^#/, '');
        if (!newTags.map(t => t.toLowerCase().trim().replace(/^#/, '')).includes(representativeTag)) {
          newTags.push(representativeTag);
        }
      }
      onUpdateItem(item.id, { primaryCluster: clusterName, tags: newTags });
    }
    setIsDropdownOpen(false);
  };

  const renderDropdown = () => {
    if (!isDropdownOpen) return null;

    return (
      <div 
        ref={dropdownRef}
        className="absolute top-full left-0 mt-1.5 w-64 bg-brand-card/95 backdrop-blur-md border border-brand-border/80 text-brand-text text-xs rounded-xl shadow-2xl z-50 p-2 cursor-default select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 border-b border-brand-border/40 mb-1 flex items-center justify-between text-brand-muted">
          <span>Set Main Vibe / Genre</span>
          <Sparkles className="h-2.5 w-2.5 text-brand-accent" />
        </div>

        {/* Assigned Clusters List */}
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {itemClusters.map((cluster) => {
            const isSelected = primaryCluster.name === cluster.name;
            const cColor = getClusterColor(cluster);
            return (
              <button
                key={cluster.name}
                type="button"
                onClick={(e) => handleSelectPrimary(e, cluster.name)}
                className={cn(
                  "w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors cursor-pointer text-xs",
                  isSelected
                    ? "font-bold shadow-sm"
                    : "hover:bg-brand-card/80 text-brand-text/90"
                )}
                style={isSelected ? {
                  backgroundColor: `${cColor}25`,
                  borderColor: `${cColor}60`,
                  color: cColor,
                  borderWidth: 1,
                  borderStyle: 'solid'
                } : {}}
              >
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: cColor }} />
                  <div className="min-w-0 truncate">
                    <div className="truncate font-semibold">{cluster.name}</div>
                    {cluster.description && (
                      <div className="text-[9px] text-brand-muted truncate leading-tight">{cluster.description}</div>
                    )}
                  </div>
                </div>
                {isSelected && <Star className="h-3 w-3 shrink-0" style={{ color: cColor, fill: cColor }} />}
              </button>
            );
          })}
        </div>

        {/* Other Active Clusters */}
        {activeClusters.length > itemClusters.length && (
          <>
            <div className="text-[9px] font-bold uppercase text-brand-muted tracking-wider px-2 pt-2 pb-1 border-t border-brand-border/40 mt-1">
              Add & Set as Main
            </div>
            <div className="space-y-0.5 max-h-36 overflow-y-auto">
              {activeClusters
                .filter(c => !itemClusters.some(ic => ic.name === c.name))
                .map((cluster) => {
                  const cColor = getClusterColor(cluster);
                  return (
                    <button
                      key={cluster.name}
                      type="button"
                      onClick={(e) => handleSelectPrimary(e, cluster.name)}
                      className="w-full text-left px-2.5 py-1 hover:bg-brand-card/80 rounded-lg text-brand-muted hover:text-brand-text truncate text-[11px] transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: cColor }} />
                      <span className="truncate">+ {cluster.name}</span>
                    </button>
                  );
                })
              }
            </div>
          </>
        )}
      </div>
    );
  };

  if (viewMode === 'list') {
    return (
      <div 
        className="flex items-center gap-1.5 shrink-0 max-w-[125px] sm:max-w-[160px] relative z-20 flex-nowrap min-w-0" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Primary Cluster Badge with distinct color */}
        <div className={cn("relative min-w-0 flex-1 shrink max-w-full group/primary", isDropdownOpen ? "z-50" : "")}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setIsDropdownOpen(!isDropdownOpen);
            }}
            style={{
              backgroundColor: `${primaryColor}18`,
              borderColor: `${primaryColor}45`,
              color: primaryColor,
            }}
            className="w-full max-w-full min-w-0 text-[10px] font-bold border px-2 py-0.5 rounded-md flex items-center gap-1 cursor-pointer transition-all hover:brightness-110 focus:outline-none overflow-hidden"
            title="Click to select main vibe/genre cluster"
          >
            {isPrimaryVibe ? (
              <Sparkles className="h-2.5 w-2.5 shrink-0" style={{ color: primaryColor }} />
            ) : (
              <Disc className="h-2.5 w-2.5 shrink-0" style={{ color: primaryColor }} />
            )}
            <span className="truncate min-w-0 flex-1 text-left">{primaryCluster.name}</span>
            <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-70 group-hover/primary:opacity-100 transition-opacity" />
          </button>
          {!isDropdownOpen && (
            <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover/primary:block z-50 w-max max-w-xs bg-brand-card/95 backdrop-blur-md border border-brand-border/80 text-brand-text text-[11px] p-2 rounded-xl shadow-2xl pointer-events-none transition-all">
              <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: primaryColor }}>
                Main {isPrimaryVibe ? 'Vibe' : 'Genre'} Cluster (Click to change)
              </div>
              <div className="text-xs text-brand-text font-bold flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: primaryColor }} />
                {primaryCluster.name}
              </div>
              {primaryCluster.description && (
                <div className="text-[10px] text-brand-muted mt-0.5 leading-snug">{primaryCluster.description}</div>
              )}
            </div>
          )}
          {renderDropdown()}
        </div>

        {/* Other Clusters +X Badge */}
        {otherCount > 0 && (
          <div className="relative group/other shrink-0 flex items-center">
            <span 
              className="text-[9px] font-extrabold bg-brand-card border border-brand-border/80 text-brand-muted px-1.5 py-0.5 rounded-md cursor-help transition-colors hover:text-brand-text shrink-0 min-w-[20px] text-center inline-flex items-center justify-center leading-none"
            >
              +{otherCount}
            </span>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/other:block z-50 w-max max-w-xs bg-brand-card/95 backdrop-blur-md border border-brand-border/80 text-brand-text text-[11px] p-2 rounded-xl shadow-2xl pointer-events-none transition-all">
              <div className="text-[9px] font-bold uppercase text-brand-muted tracking-wider mb-1">Other Clusters ({otherCount}):</div>
              <div className="space-y-1">
                {otherClusters.map(c => {
                  const ocColor = getClusterColor(c);
                  return (
                    <div key={c.name} className="flex items-center gap-1.5 text-xs text-brand-text">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ocColor }} />
                      <span>{c.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (viewMode === 'small-cards') {
    return (
      <div className="flex items-center gap-1 mb-1 relative z-20 flex-nowrap max-w-full min-w-0" onClick={(e) => e.stopPropagation()}>
        {/* Primary Cluster Badge */}
        <div className={cn("relative min-w-0 flex-1 shrink max-w-full group/primary", isDropdownOpen ? "z-50" : "")}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setIsDropdownOpen(!isDropdownOpen);
            }}
            style={{
              backgroundColor: `${primaryColor}18`,
              borderColor: `${primaryColor}45`,
              color: primaryColor,
            }}
            className="w-full max-w-full min-w-0 text-[9px] font-bold border px-1.5 py-0.5 rounded-md flex items-center gap-1 cursor-pointer transition-all hover:brightness-110 focus:outline-none overflow-hidden"
            title="Click to select main vibe/genre cluster"
          >
            {isPrimaryVibe ? (
              <Sparkles className="h-2.5 w-2.5 shrink-0" style={{ color: primaryColor }} />
            ) : (
              <Disc className="h-2.5 w-2.5 shrink-0" style={{ color: primaryColor }} />
            )}
            <span className="truncate min-w-0 flex-1 text-left">{primaryCluster.name}</span>
            <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-70 group-hover/primary:opacity-100 transition-opacity" />
          </button>
          {!isDropdownOpen && (
            <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover/primary:block z-50 w-max max-w-xs bg-brand-card/95 backdrop-blur-md border border-brand-border/80 text-brand-text text-[11px] p-2 rounded-xl shadow-2xl pointer-events-none transition-all">
              <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: primaryColor }}>
                Main {isPrimaryVibe ? 'Vibe' : 'Genre'} Cluster (Click to change)
              </div>
              <div className="text-xs text-brand-text font-bold flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: primaryColor }} />
                {primaryCluster.name}
              </div>
              {primaryCluster.description && (
                <div className="text-[10px] text-brand-muted mt-0.5 leading-snug">{primaryCluster.description}</div>
              )}
            </div>
          )}
          {renderDropdown()}
        </div>

        {/* Other Clusters +X Badge */}
        {otherCount > 0 && (
          <div className="relative group/other shrink-0 flex items-center">
            <span 
              className="text-[9px] font-extrabold bg-brand-card border border-brand-border/80 text-brand-muted px-1.5 py-0.5 rounded-md cursor-help transition-colors hover:text-brand-text shrink-0"
            >
              +{otherCount}
            </span>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/other:block z-50 w-max max-w-xs bg-brand-card/95 backdrop-blur-md border border-brand-border/80 text-brand-text text-[11px] p-2 rounded-xl shadow-2xl pointer-events-none transition-all">
              <div className="text-[9px] font-bold uppercase text-brand-muted tracking-wider mb-1">Other Clusters ({otherCount}):</div>
              <div className="space-y-1">
                {otherClusters.map(c => {
                  const ocColor = getClusterColor(c);
                  return (
                    <div key={c.name} className="flex items-center gap-1.5 text-xs text-brand-text">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ocColor }} />
                      <span>{c.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // viewMode === 'cards'
  return (
    <div className="flex items-center gap-1.5 mb-1.5 relative z-20 flex-nowrap max-w-full min-w-0" onClick={(e) => e.stopPropagation()}>
      {/* Primary Cluster Badge */}
      <div className={cn("relative min-w-0 flex-1 shrink max-w-full group/primary", isDropdownOpen ? "z-50" : "")}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setIsDropdownOpen(!isDropdownOpen);
          }}
          style={{
            backgroundColor: `${primaryColor}18`,
            borderColor: `${primaryColor}45`,
            color: primaryColor,
          }}
          className="w-full max-w-full min-w-0 text-[10px] font-bold border px-2 py-0.5 rounded-md flex items-center gap-1 cursor-pointer transition-all hover:brightness-110 focus:outline-none overflow-hidden"
          title="Click to select main vibe/genre cluster"
        >
          {isPrimaryVibe ? (
            <Sparkles className="h-3 w-3 shrink-0" style={{ color: primaryColor }} />
          ) : (
            <Disc className="h-3 w-3 shrink-0" style={{ color: primaryColor }} />
          )}
          <span className="truncate min-w-0 flex-1 text-left">{primaryCluster.name}</span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-70 group-hover/primary:opacity-100 transition-opacity" />
        </button>
        {!isDropdownOpen && (
          <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover/primary:block z-50 w-max max-w-xs bg-brand-card/95 backdrop-blur-md border border-brand-border/80 text-brand-text text-[11px] p-2 rounded-xl shadow-2xl pointer-events-none transition-all">
            <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: primaryColor }}>
              Main {isPrimaryVibe ? 'Vibe' : 'Genre'} Cluster (Click to change)
            </div>
            <div className="text-xs text-brand-text font-bold flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: primaryColor }} />
              {primaryCluster.name}
            </div>
            {primaryCluster.description && (
              <div className="text-[10px] text-brand-muted mt-0.5 leading-snug">{primaryCluster.description}</div>
            )}
          </div>
        )}
        {renderDropdown()}
      </div>

      {/* Other Clusters +X Badge */}
      {otherCount > 0 && (
        <div className="relative group/other shrink-0 flex items-center">
          <span 
            className="text-[10px] font-extrabold bg-brand-card border border-brand-border/80 text-brand-muted px-1.5 py-0.5 rounded-md cursor-help transition-colors hover:text-brand-text shrink-0"
          >
            +{otherCount}
          </span>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/other:block z-50 w-max max-w-xs bg-brand-card/95 backdrop-blur-md border border-brand-border/80 text-brand-text text-[11px] p-2 rounded-xl shadow-2xl pointer-events-none transition-all">
            <div className="text-[9px] font-bold uppercase text-brand-muted tracking-wider mb-1">Other Clusters ({otherCount}):</div>
            <div className="space-y-1">
              {otherClusters.map(c => {
                const ocColor = getClusterColor(c);
                return (
                  <div key={c.name} className="flex items-center gap-1.5 text-xs text-brand-text">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ocColor }} />
                    <span>{c.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const DetailClusterManager = ({ 
  item, 
  activeClusters, 
  onUpdateItem,
  onOpenColorPicker
}: { 
  item: MusicItem; 
  activeClusters: TagCluster[]; 
  onUpdateItem: (id: string, updates: Partial<MusicItem>) => void;
  onOpenColorPicker?: (cluster: TagCluster) => void;
}) => {
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

  const handleAddToCluster = (clusterToAdd: TagCluster) => {
    const tagsToAdd = (clusterToAdd.tags && clusterToAdd.tags.length > 0)
      ? clusterToAdd.tags.map(t => t.toLowerCase().trim().replace(/^#/, ''))
      : [clusterToAdd.name.toLowerCase().replace(/[^a-z0-9]/g, '-')];

    const currentTagSet = new Set((item.tags || []).map(t => t.toLowerCase().trim().replace(/^#/, '')));
    const newTags = [...(item.tags || [])];
    const newSources = { ...(item.tagSources || {}) };

    tagsToAdd.forEach(t => {
      if (!currentTagSet.has(t)) {
        newTags.push(t);
        newSources[t] = 'manual';
      }
    });

    let newPrimary = item.primaryCluster;
    if (!newPrimary || itemClusters.length === 0) {
      newPrimary = clusterToAdd.name;
    }

    onUpdateItem(item.id, {
      tags: newTags,
      tagSources: newSources,
      primaryCluster: newPrimary,
    });

    setIsAddOpen(false);
    setClusterSearch('');
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-bold text-brand-muted uppercase tracking-widest block">
          Vibe & Genre Clusters
        </label>
        <span className="text-[10px] font-bold text-brand-muted uppercase bg-brand-bg px-2.5 py-1 rounded-md border border-brand-border">
          {itemClusters.length} {itemClusters.length === 1 ? 'cluster' : 'clusters'}
        </span>
      </div>

      {/* Assigned Clusters List */}
      <div className="flex flex-wrap gap-2.5">
        {itemClusters.map((cluster) => {
          const isPrimary = currentPrimaryName === cluster.name;
          const isVibe = (cluster.category || 'vibe') === 'vibe';
          const clusterColorHex = getClusterColor(cluster);

          return (
            <div
              key={cluster.name}
              className={cn(
                "group relative flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all shadow-sm",
                isPrimary
                  ? "ring-1"
                  : "bg-brand-bg hover:border-brand-muted"
              )}
              style={{
                backgroundColor: isPrimary ? `${clusterColorHex}20` : undefined,
                borderColor: isPrimary ? `${clusterColorHex}80` : undefined,
                color: isPrimary ? clusterColorHex : undefined,
              }}
            >
              {/* Category Icon / Color Trigger */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onOpenColorPicker) onOpenColorPicker(cluster);
                }}
                className="p-1 -ml-1 rounded-lg hover:scale-110 transition-transform cursor-pointer"
                title={`Change color for "${cluster.name}"`}
              >
                {isVibe ? (
                  <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: clusterColorHex }} />
                ) : (
                  <Disc className="h-3.5 w-3.5 shrink-0" style={{ color: clusterColorHex }} />
                )}
              </button>

              {/* Cluster Name */}
              <span className="font-bold">{cluster.name}</span>

              {/* Primary Selector or Badge */}
              {isPrimary ? (
                <span 
                  className="text-white text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md flex items-center gap-1 shadow-sm"
                  style={{ backgroundColor: clusterColorHex }}
                >
                  <Star className="h-2.5 w-2.5 fill-white" />
                  Main
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSetPrimary(cluster.name)}
                  className="text-[9.5px] font-bold uppercase tracking-wider text-brand-muted hover:text-brand-text bg-brand-card hover:bg-brand-border/40 px-2 py-0.5 rounded-md border border-brand-border/60 transition-colors cursor-pointer"
                  title="Set as main cluster displayed on card"
                >
                  Set as Main
                </button>
              )}

              {/* Quick color change button */}
              {onOpenColorPicker && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenColorPicker(cluster);
                  }}
                  className="p-1 text-brand-muted hover:text-brand-text hover:bg-brand-card/80 rounded-md transition-colors cursor-pointer opacity-70 group-hover:opacity-100"
                  title="Change cluster color"
                >
                  <Palette className="h-3 w-3" style={{ color: clusterColorHex }} />
                </button>
              )}

              {/* Remove Button */}
              <button
                type="button"
                onClick={() => handleRemoveFromCluster(cluster)}
                className="p-1 text-brand-muted hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors cursor-pointer ml-0.5"
                title={`Remove from ${cluster.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}

        {itemClusters.length === 0 && (
          <p className="text-xs text-brand-muted italic py-1">
            No vibe or genre clusters assigned yet. Add one below!
          </p>
        )}
      </div>

      {/* Add to Cluster Dropdown Button */}
      <div className="relative inline-block" ref={addDropdownRef}>
        <button
          type="button"
          onClick={() => setIsAddOpen(!isAddOpen)}
          className="px-3.5 py-2 rounded-xl text-xs font-bold border border-brand-border/80 bg-brand-bg text-brand-text hover:border-brand-accent/60 hover:text-brand-accent flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
        >
          <Plus className="h-3.5 w-3.5 text-brand-accent" />
          <span>Add to Vibe / Genre Cluster</span>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", isAddOpen ? "rotate-180" : "")} />
        </button>

        {isAddOpen && (
          <div className="absolute top-full left-0 mt-1.5 w-72 bg-brand-card border border-brand-border/80 rounded-2xl shadow-2xl z-50 p-3 space-y-2 max-h-64 overflow-y-auto">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-brand-muted" />
              <input
                type="text"
                value={clusterSearch}
                onChange={(e) => setClusterSearch(e.target.value)}
                placeholder="Search clusters..."
                className="w-full bg-brand-bg border border-brand-border rounded-lg pl-8 pr-2.5 py-1.5 text-xs outline-none focus:border-brand-accent"
                autoFocus
              />
            </div>

            <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
              {filteredAvailableClusters.map((cluster) => {
                const isVibe = (cluster.category || 'vibe') === 'vibe';
                const cColor = getClusterColor(cluster);
                return (
                  <button
                    key={cluster.name}
                    type="button"
                    onClick={() => handleAddToCluster(cluster)}
                    className="w-full text-left p-2 rounded-xl hover:bg-brand-card/80 border border-transparent hover:border-brand-border/60 flex items-center justify-between transition-colors text-xs cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: cColor }} />
                      <span className="font-semibold truncate text-brand-text group-hover:text-brand-accent">
                        {cluster.name}
                      </span>
                    </div>
                    <span className="text-[9px] uppercase font-bold text-brand-muted bg-brand-bg px-1.5 py-0.5 rounded border border-brand-border shrink-0">
                      {isVibe ? 'Vibe' : 'Genre'}
                    </span>
                  </button>
                );
              })}

              {filteredAvailableClusters.length === 0 && (
                <p className="text-xs text-brand-muted text-center py-3">
                  {availableClusters.length === 0
                    ? "Item belongs to all active clusters!"
                    : "No matching clusters found."}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

// --- App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [items, setItems] = useState<MusicItem[]>([]);

  // Interactive Demo Mode States
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sonic_vault_is_demo_mode') === 'true';
    } catch (e) {
      return false;
    }
  });
  const [isPublishingDemo, setIsPublishingDemo] = useState(false);
  const [showPublishDemoModal, setShowPublishDemoModal] = useState(false);

  const [activeTab, setActiveTab] = useState<ItemType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<MusicItem | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importLinks, setImportLinks] = useState('');
  const [importType, setImportType] = useState<'links' | 'playlists_sheet' | 'albums_sheet'>('links');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [connectionError, setConnectionError] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [preferredAIModel, setPreferredAIModel] = useState<string>('gemini-2.0-flash');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkEditModalOpen, setBulkEditModalOpen] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkRelevanceInput, setBulkRelevanceInput] = useState<number | ''>('');
  const [bulkFamiliarityInput, setBulkFamiliarityInput] = useState<number | ''>('');
  const [bulkActionType, setBulkActionType] = useState<'addTags' | 'setTags' | 'setRelevance' | 'combined'>('combined');
  const [isFetchingCovers, setIsFetchingCovers] = useState(false);
  const [isFetchingSingleCover, setIsFetchingSingleCover] = useState(false);
  
  const [sortConfigs, setSortConfigs] = useState<{ field: string; direction: 'asc' | 'desc' }[]>([
    { field: 'relevance', direction: 'desc' },
    { field: 'createdAt', direction: 'desc' }
  ]);

  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [tagToRename, setTagToRename] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [selectedClustersForTag, setSelectedClustersForTag] = useState<string[]>([]);
  const [isNormalizing, setIsNormalizing] = useState(false);
  const [tagSortField, setTagSortField] = useState<'alphabetical' | 'count'>('alphabetical');
  const [tagSortDirection, setTagSortDirection] = useState<'asc' | 'desc'>('asc');

  // Tag multi-selection for bulk edit/delete
  const [selectedTagsForMgmt, setSelectedTagsForMgmt] = useState<string[]>([]);
  const [lowPriorityTags, setLowPriorityTags] = useState<string[]>([]);
  const [bulkTagEditModalOpen, setBulkTagEditModalOpen] = useState(false);
  const [bulkTagNewName, setBulkTagNewName] = useState('');
  const [bulkTagClusters, setBulkTagClusters] = useState<string[]>([]);
  
  const [tagViewMode, setTagViewMode] = useState<'clusters' | 'list'>('clusters');
  
  // Custom Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    variant?: 'danger' | 'warning' | 'primary';
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const promptDeleteSingleItem = (item: MusicItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setConfirmModal({
      isOpen: true,
      title: "Delete Item",
      message: `Are you sure you want to delete "${item.name}" from your library?`,
      confirmText: "Delete Item",
      variant: "danger",
      onConfirm: async () => {
        await safeDeleteDoc(item.id);
        if (detailItem && detailItem.id === item.id) {
          setDetailItem(null);
        }
      }
    });
  };
  const [itemViewMode, setItemViewMode] = useState<'cards' | 'small-cards' | 'list'>(() => {
    try {
      const saved = localStorage.getItem('sonic_vault_item_view_mode');
      if (saved === 'cards' || saved === 'small-cards' || saved === 'list') return saved;
    } catch (e) {}
    return 'cards';
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sonic_vault_sidebar_collapsed') === 'true';
    } catch (e) {
      return false;
    }
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sonic_vault_sidebar_collapsed', String(next)); } catch (e) {}
      return next;
    });
  };

  const [aiClusters, setAiClusters] = useState<TagCluster[] | null>(null);
  const [draggedClusterName, setDraggedClusterName] = useState<string | null>(null);
  const [dragOverClusterName, setDragOverClusterName] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after'>('after');
  const [dragOverCategory, setDragOverCategory] = useState<'vibe' | 'genre' | null>(null);
  const [openClusterMenuName, setOpenClusterMenuName] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = () => {
      setOpenClusterMenuName(null);
    };
    if (openClusterMenuName) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [openClusterMenuName]);
  const [customClusters, setCustomClusters] = useState<TagCluster[]>([]);
  const [tagMatchStrategy, setTagMatchStrategy] = useState<'and' | 'or'>('or');
  const [prioritizeStarSearchFirst, setPrioritizeStarSearchFirst] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sonic_vault_star_search_first');
      return saved !== null ? saved === 'true' : true;
    } catch (e) {
      return true;
    }
  });

  const togglePrioritizeStarSearchFirst = () => {
    setPrioritizeStarSearchFirst(prev => {
      const next = !prev;
      try {
        localStorage.setItem('sonic_vault_star_search_first', String(next));
      } catch (e) {}
      if (user && !isDemoMode) {
        saveUserSettings({ prioritizeStarSearchFirst: next });
      }
      return next;
    });
  };
  const [isClustering, setIsClustering] = useState(false);

  // Custom cluster form states
  const [isCreatingCustomCluster, setIsCreatingCustomCluster] = useState(false);
  const [newClusterName, setNewClusterName] = useState('');
  const [newClusterDescription, setNewClusterDescription] = useState('');
  const [newClusterTags, setNewClusterTags] = useState<string[]>([]);
  const [editingCustomClusterName, setEditingCustomClusterName] = useState<string | null>(null);

  // Collapsible cluster tag lists state
  const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({});

  // Universal cluster editing states
  const [clusterEditTarget, setClusterEditTarget] = useState<{
    cluster: TagCluster;
    originalName: string;
    type: 'custom' | 'ai' | 'default';
    isEditingTagsOnly?: boolean;
  } | null>(null);
  const [editClusterName, setEditClusterName] = useState('');
  const [editClusterDescription, setEditClusterDescription] = useState('');
  const [editClusterCategory, setEditClusterCategory] = useState<'vibe' | 'genre'>('vibe');
  const [editClusterColor, setEditClusterColor] = useState<string>('#2563eb');
  const [editClusterTags, setEditClusterTags] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [colorPickerCluster, setColorPickerCluster] = useState<TagCluster | null>(null);

  // Export Modal state
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'markdown'>('json');
  const [exportScope, setExportScope] = useState<'all' | 'filtered'>('all');
  const [copiedExport, setCopiedExport] = useState(false);
  const [singleItemCopied, setSingleItemCopied] = useState(false);

  const [filters, setFilters] = useState({
    songRange: 'all',
    lengthRange: 'all',
    relevanceRange: 'all',
    creator: 'all',
    familiarityRange: 'all',
    timeframe: 'overall'
  });

  const [bulkStarLevel, setBulkStarLevel] = useState<number>(0);

  // Last.fm Integration States
  const [isLastFmModalOpen, setIsLastFmModalOpen] = useState(false);
  const [lastFmSettings, setLastFmSettings] = useState<LastFmSettings | undefined>(() => {
    try {
      const saved = localStorage.getItem('sonic_vault_lastfm_cached');
      return saved ? JSON.parse(saved) : undefined;
    } catch (e) {
      return undefined;
    }
  });
  const [isEnrichingSingleItem, setIsEnrichingSingleItem] = useState(false);

  // Delay re-sorting by 3 seconds after toggling favorite on an item
  const [sortOverrides, setSortOverrides] = useState<Record<string, { relevance: number; favoriteLevel: number }>>({});
  const starClickTimersRef = useRef<Record<string, NodeJS.Timeout>>({});

  useEffect(() => {
    return () => {
      Object.values(starClickTimersRef.current).forEach(timer => clearTimeout(timer));
    };
  }, []);

  // Safe mutations wrapper for Demo Mode vs Live Firestore
  const safeUpdateDoc = async (id: string, updates: any) => {
    const sanitizedUpdates: any = {};
    for (const key of Object.keys(updates)) {
      if (updates[key] !== undefined) {
        sanitizedUpdates[key] = updates[key];
      }
    }

    if (isDemoMode) {
      setItems(prev => {
        const next = prev.map(i => i.id === id ? { ...i, ...sanitizedUpdates, updatedAt: new Date().toISOString() } : i);
        try { localStorage.setItem('sonic_vault_demo_session_items', JSON.stringify(next)); } catch (e) {}
        return next;
      });
      if (detailItem && detailItem.id === id) {
        setDetailItem(prev => prev ? ({ ...prev, ...sanitizedUpdates } as MusicItem) : null);
      }
      return;
    }
    
    if (!sanitizedUpdates.updatedAt) {
      sanitizedUpdates.updatedAt = serverTimestamp();
    }

    const path = `musicItems/${id}`;
    try {
      await updateDoc(doc(db, 'musicItems', id), sanitizedUpdates);
      if (detailItem && detailItem.id === id) {
        setDetailItem(prev => prev ? ({ ...prev, ...sanitizedUpdates } as MusicItem) : null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const safeDeleteDoc = async (id: string) => {
    if (isDemoMode) {
      setItems(prev => {
        const next = prev.filter(i => i.id !== id);
        try { localStorage.setItem('sonic_vault_demo_session_items', JSON.stringify(next)); } catch (e) {}
        return next;
      });
      if (detailItem && detailItem.id === id) {
        setDetailItem(null);
      }
      return;
    }
    const path = `musicItems/${id}`;
    try {
      await deleteDoc(doc(db, 'musicItems', id));
      if (detailItem && detailItem.id === id) {
        setDetailItem(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const loadDemoSnapshotFromFirestore = async (): Promise<{ items: MusicItem[]; customClusters: TagCluster[]; aiClusters: TagCluster[] | null; lowPriorityTags: string[] } | null> => {
    try {
      const snap = await getDoc(doc(db, 'demoSnapshots', 'default'));
      if (snap.exists()) {
        const data = snap.data();
        let loadedItems: MusicItem[] = [];

        // Check if items were partitioned across subcollection chunks
        const chunkCount = typeof data.chunkCount === 'number' ? data.chunkCount : 0;
        if (chunkCount > 0) {
          try {
            const chunksSnap = await getDocs(collection(db, 'demoSnapshots', 'default', 'chunks'));
            if (!chunksSnap.empty) {
              const chunks = chunksSnap.docs.map(d => d.data());
              chunks.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
              for (const c of chunks) {
                if (Array.isArray(c.items)) {
                  loadedItems.push(...c.items);
                }
              }
            }
          } catch (chunkErr) {
            console.warn('Failed loading demo snapshot chunks:', chunkErr);
          }
        }

        // Fallback: If no chunk items were loaded but data.items exists directly on main doc
        if (loadedItems.length === 0 && Array.isArray(data.items) && data.items.length > 0) {
          loadedItems = data.items;
        }

        if (loadedItems.length > 0) {
          return {
            items: loadedItems,
            customClusters: data.customClusters || INITIAL_DEMO_CLUSTERS,
            aiClusters: data.aiClusters || null,
            lowPriorityTags: data.lowPriorityTags || [],
          };
        }
      }
    } catch (err) {
      console.warn('Could not fetch public demo snapshot from Firestore:', err);
    }
    return null;
  };

  const handleEnterDemoMode = async () => {
    setIsDemoMode(true);
    try { localStorage.setItem('sonic_vault_is_demo_mode', 'true'); } catch (e) {}
    const demoUserObj = { uid: 'demo-guest', displayName: 'Demo Visitor', email: 'guest@demo.vault', emailVerified: true } as any;
    setUser(demoUserObj);
    setLoading(true);

    const savedSessionItems = localStorage.getItem('sonic_vault_demo_session_items');
    const savedSessionSettings = localStorage.getItem('sonic_vault_demo_session_settings');

    if (savedSessionItems) {
      try {
        const parsedItems = JSON.parse(savedSessionItems);
        setItems(parsedItems);
        if (savedSessionSettings) {
          const parsedSettings = JSON.parse(savedSessionSettings);
          if (parsedSettings.customClusters) setCustomClusters(parsedSettings.customClusters);
          if (parsedSettings.aiClusters) setAiClusters(parsedSettings.aiClusters);
          if (parsedSettings.lowPriorityTags) setLowPriorityTags(parsedSettings.lowPriorityTags);
        }
        setLoading(false);
        return;
      } catch (e) {
        console.error('Failed parsing demo session items', e);
      }
    }

    const loadedSnapshot = await loadDemoSnapshotFromFirestore();
    if (loadedSnapshot) {
      setItems(loadedSnapshot.items);
      setCustomClusters(loadedSnapshot.customClusters);
      setAiClusters(loadedSnapshot.aiClusters);
      setLowPriorityTags(loadedSnapshot.lowPriorityTags);
      setLoading(false);
      return;
    }

    setItems(INITIAL_DEMO_ITEMS);
    setCustomClusters(INITIAL_DEMO_CLUSTERS);
    setAiClusters(null);
    setLowPriorityTags([]);
    setLoading(false);
  };

  const handleExitDemoMode = () => {
    setIsDemoMode(false);
    try { localStorage.removeItem('sonic_vault_is_demo_mode'); } catch (e) {}
    setUser(null);
    setItems([]);
    setAiClusters(null);
    setCustomClusters([]);
    setLowPriorityTags([]);
    signOut(auth).catch(() => {});
  };

  const handleResetDemoData = async () => {
    setConfirmModal({
      isOpen: true,
      title: "Reset Demo Sandbox",
      message: "Reset your demo sandbox to the published default snapshot? All local changes made in demo mode will be cleared.",
      confirmText: "Reset Sandbox",
      variant: "warning",
      onConfirm: async () => {
        try {
          localStorage.removeItem('sonic_vault_demo_session_items');
          localStorage.removeItem('sonic_vault_demo_session_settings');
        } catch (e) {}
        setLoading(true);

        const loadedSnapshot = await loadDemoSnapshotFromFirestore();
        if (loadedSnapshot) {
          setItems(loadedSnapshot.items);
          setCustomClusters(loadedSnapshot.customClusters);
          setAiClusters(loadedSnapshot.aiClusters);
          setLowPriorityTags(loadedSnapshot.lowPriorityTags);
          setLoading(false);
          return;
        }

        setItems(INITIAL_DEMO_ITEMS);
        setCustomClusters(INITIAL_DEMO_CLUSTERS);
        setAiClusters(null);
        setLowPriorityTags([]);
        setLoading(false);
      }
    });
  };

  const handlePublishDemoSnapshot = async () => {
    if (!user || isDemoMode) return;
    setIsPublishingDemo(true);
    try {
      // 1. Sanitize items
      const sanitizedItems = items.map(item => {
        const clean: any = {};
        for (const [k, v] of Object.entries(item)) {
          if (v !== undefined) {
            clean[k] = v;
          }
        }
        return clean;
      });

      // Split into chunks of 35 items (guarantees << 1MB limit per document)
      const CHUNK_SIZE = 35;
      const totalChunks = Math.max(1, Math.ceil(sanitizedItems.length / CHUNK_SIZE));

      // 2. Write partitioned chunk documents to subcollection /demoSnapshots/default/chunks/{chunkId}
      for (let c = 0; c < totalChunks; c++) {
        const chunkItems = sanitizedItems.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
        await setDoc(doc(db, 'demoSnapshots', 'default', 'chunks', String(c)), {
          index: c,
          items: chunkItems,
          updatedAt: serverTimestamp(),
        });
      }

      // 3. Clean up any surplus chunks if library shrank
      try {
        const existingChunksSnap = await getDocs(collection(db, 'demoSnapshots', 'default', 'chunks'));
        for (const chunkDoc of existingChunksSnap.docs) {
          const idx = parseInt(chunkDoc.id, 10);
          if (!isNaN(idx) && idx >= totalChunks) {
            await deleteDoc(chunkDoc.ref);
          }
        }
      } catch (cleanupErr) {
        console.warn('Chunk cleanup notice (non-fatal):', cleanupErr);
      }

      // 4. Write parent metadata snapshot document (excludes monolithic items array if large to guarantee <1MB)
      const mainPayload: any = {
        publishedBy: user.uid,
        publishedByEmail: user.email || 'authenticated-user',
        totalItems: items.length,
        chunkCount: totalChunks,
        customClusters: customClusters || [],
        aiClusters: aiClusters || null,
        lowPriorityTags: lowPriorityTags || [],
        updatedAt: serverTimestamp(),
      };

      // Only embed inline items array on root doc if library is very small (<= 20 items)
      if (sanitizedItems.length <= 20) {
        mainPayload.items = sanitizedItems;
      }

      await setDoc(doc(db, 'demoSnapshots', 'default'), mainPayload);
      setShowPublishDemoModal(false);
      alert(`✅ Success! Your library (${items.length} items across ${totalChunks} partition${totalChunks === 1 ? '' : 's'}) has been published to the interactive public demo snapshot.\n\nUnauthenticated visitors clicking "Explore Interactive Demo Sandbox" will now load your published library!`);
    } catch (err: any) {
      console.error('Failed to publish demo snapshot to Firestore', err);
      alert(`Failed to publish demo snapshot: ${err.message || 'Unknown error'}`);
    } finally {
      setIsPublishingDemo(false);
    }
  };

  useEffect(() => {
    if (isDemoMode) {
      handleEnterDemoMode();
    }
  }, []);

  useEffect(() => {
    async function testConnection() {
      try {
        // Test connection to Firestore
        await getDocFromServer(firestoreDoc(db, 'test', 'connection'));
      } catch (error: any) {
        if (error?.message?.includes('the client is offline') || error?.code === 'unavailable') {
          setConnectionError(true);
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (isDemoMode) {
        if (!user) {
          setUser({ uid: 'demo-guest', displayName: 'Demo Visitor', email: 'guest@demo.vault', emailVerified: true } as any);
        }
        setLoading(false);
        return;
      }
      setUser(u);
      setLoading(false);
    });
  }, [isDemoMode]);

  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          setUser(result.user);
        }
      })
      .catch((error: any) => {
        console.error("Redirect sign-in result error:", error);
        if (error?.code === 'auth/unauthorized-domain') {
          setAuthError(`Domain unauthorized: "${window.location.hostname}" is not authorized in Firebase Console -> Authentication -> Settings -> Authorized Domains.`);
        } else {
          setAuthError(`Redirect sign-in error (${error?.code || 'unknown'}): ${error?.message || String(error)}`);
        }
      });
  }, []);

  const saveUserSettings = async (updates: Partial<{
    aiClusters: TagCluster[] | null;
    customClusters: TagCluster[];
    lowPriorityTags: string[];
    preferredAIModel: string;
    tagMatchStrategy: 'and' | 'or';
    lastFmSettings: LastFmSettings;
    prioritizeStarSearchFirst: boolean;
  }>) => {
    if (isDemoMode) {
      try {
        const saved = localStorage.getItem('sonic_vault_demo_session_settings');
        const current = saved ? JSON.parse(saved) : {};
        const updated = { ...current, ...updates };
        localStorage.setItem('sonic_vault_demo_session_settings', JSON.stringify(updated));
      } catch (e) {}
      return;
    }
    if (!user) return;
    const path = `userSettings/${user.uid}`;
    try {
      const payload: any = {
        userId: user.uid,
        updatedAt: serverTimestamp(),
      };
      if (updates.aiClusters !== undefined) payload.aiClusters = updates.aiClusters;
      if (updates.customClusters !== undefined) payload.customClusters = updates.customClusters;
      if (updates.lowPriorityTags !== undefined) payload.lowPriorityTags = updates.lowPriorityTags;
      if (updates.preferredAIModel !== undefined) payload.preferredAIModel = updates.preferredAIModel;
      if (updates.tagMatchStrategy !== undefined) payload.tagMatchStrategy = updates.tagMatchStrategy;
      if (updates.prioritizeStarSearchFirst !== undefined) payload.prioritizeStarSearchFirst = updates.prioritizeStarSearchFirst;
      if (updates.lastFmSettings !== undefined) {
        // Sanitize lastFmSettings to avoid undefined values
        const lfm = updates.lastFmSettings;
        const cleanLfm: any = {};
        if (lfm.username !== undefined) cleanLfm.username = lfm.username;
        if (lfm.apiKey !== undefined) cleanLfm.apiKey = lfm.apiKey;
        if (lfm.autoEnrich !== undefined) cleanLfm.autoEnrich = lfm.autoEnrich;
        if (lfm.lastSync !== undefined) cleanLfm.lastSync = lfm.lastSync;
        if (lfm.defaultPeriod !== undefined) cleanLfm.defaultPeriod = lfm.defaultPeriod;
        payload.lastFmSettings = cleanLfm;
      }

      await setDoc(doc(db, 'userSettings', user.uid), payload, { merge: true });
    } catch (err) {
      console.error('Failed to sync user settings to Firestore', err);
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleSaveLastFmSettings = (newSettings: LastFmSettings) => {
    setLastFmSettings(newSettings);
    try {
      localStorage.setItem('sonic_vault_lastfm_cached', JSON.stringify(newSettings));
    } catch (e) {}
    if (user) {
      try { localStorage.setItem(`sonic_vault_lastfm_${user.uid}`, JSON.stringify(newSettings)); } catch (e) {}
      saveUserSettings({ lastFmSettings: newSettings });
    }
  };

  const handleImportLastFmItems = async (
    newItems: Partial<MusicItem>[],
    onProgress?: (current: number, total: number, currentItemName?: string, phase?: 'preparing' | 'writing') => void
  ) => {
    // Ensure artist items have their tags populated from Last.fm if missing
    for (let i = 0; i < newItems.length; i++) {
      const item = newItems[i];
      if (item.type === 'artist' && (!item.tags || item.tags.length === 0)) {
        if (onProgress) {
          onProgress(i + 1, newItems.length, item.name || 'Artist', 'preparing');
        }
        try {
          const enrich = await enrichArtistFromLastFm(item.name || '', lastFmSettings?.apiKey || '', lastFmSettings?.username);
          if (enrich) {
            if (enrich.tags && enrich.tags.length > 0) {
              item.tags = enrich.tags;
              if (!item.tagSources) item.tagSources = {};
              enrich.tags.forEach(t => {
                const clean = t.toLowerCase().trim().replace(/^#/, '');
                item.tagSources![clean] = 'lastfm';
              });
            }
            if (!item.genres && enrich.genres) item.genres = enrich.genres;
            if (!item.imageUrl && enrich.imageUrl) item.imageUrl = enrich.imageUrl;
            if (!item.notes && enrich.bioSummary) item.notes = `Last.fm Bio:\n${enrich.bioSummary}`;
            if (!item.lastFmListeners && enrich.listeners) item.lastFmListeners = enrich.listeners;
          }
        } catch (e) {}
      }
    }

    if (isDemoMode) {
      setItems(prev => {
        let updatedList = [...prev];
        for (let idx = 0; idx < newItems.length; idx++) {
          const item = newItems[idx];
          if (onProgress) {
            onProgress(idx + 1, newItems.length, item.name || 'Item', 'writing');
          }
          const cleanName = (item.name || '').toLowerCase().trim();
          
          let existingIndex = -1;
          if (item.type === 'artist') {
            existingIndex = updatedList.findIndex(i => i.type === 'artist' && i.name.toLowerCase().trim() === cleanName);
          } else if (item.type === 'track') {
            existingIndex = updatedList.findIndex(i => 
              i.type === 'track' && 
              i.name.toLowerCase().trim() === cleanName && 
              (!item.parentName || (i.parentName && i.parentName.toLowerCase().trim() === item.parentName.toLowerCase().trim()))
            );
          } else if (item.type === 'album') {
            existingIndex = updatedList.findIndex(i => 
              i.type === 'album' && 
              i.name.toLowerCase().trim() === cleanName && 
              (!item.parentName || (i.parentName && i.parentName.toLowerCase().trim() === item.parentName.toLowerCase().trim()))
            );
          }

          if (existingIndex !== -1) {
            // Update existing item in-place
            const existing = updatedList[existingIndex];
            const mergedTags = Array.from(new Set([...(existing.tags || []), ...(item.tags || [])]));
            const mergedTagSources = { ...(existing.tagSources || {}), ...(item.tagSources || {}) };
            (item.tags || []).forEach(t => {
              const clean = t.toLowerCase().trim().replace(/^#/, '');
              if (!mergedTagSources[clean]) mergedTagSources[clean] = 'lastfm';
            });
            
            updatedList[existingIndex] = {
              ...existing,
              lastFmPlaycount: item.lastFmPlaycount ?? existing.lastFmPlaycount,
              lastFmPeriodPlaycount: item.lastFmPeriodPlaycount !== undefined ? item.lastFmPeriodPlaycount : existing.lastFmPeriodPlaycount,
              lastFmPeriod: item.lastFmPeriod || existing.lastFmPeriod,
              familiarity: item.familiarity ?? existing.familiarity, // Recalculated from scrobbles
              lastFmEnrichedAt: item.lastFmEnrichedAt || new Date().toISOString(),
              imageUrl: item.imageUrl || existing.imageUrl,
              lastFmUrl: item.lastFmUrl || existing.lastFmUrl,
              lastFmListeners: item.lastFmListeners ?? existing.lastFmListeners,
              durationSeconds: item.durationSeconds || existing.durationSeconds,
              genres: item.genres || existing.genres,
              tags: mergedTags,
              tagSources: mergedTagSources,
              updatedAt: new Date().toISOString(),
            };
          } else {
            // Prepend new item
            const itemTags = item.tags || [];
            const tagSources: Record<string, 'lastfm' | 'manual' | 'llm'> = { ...(item.tagSources || {}) };
            itemTags.forEach(t => {
              const clean = t.toLowerCase().trim().replace(/^#/, '');
              if (!tagSources[clean]) tagSources[clean] = 'lastfm';
            });

            const newItem: MusicItem = {
              id: `demo-lastfm-${Date.now()}-${idx}`,
              userId: 'demo-guest',
              name: item.name || 'Untitled',
              type: item.type || 'artist',
              url: item.url || '',
              parentName: item.parentName,
              imageUrl: item.imageUrl,
              durationSeconds: item.durationSeconds,
              familiarity: item.familiarity ?? 0, // Inferred from playcount
              relevance: 0, // Strictly manual only: untouched by Last.fm
              rating: item.rating ?? 50,
              favoriteLevel: item.favoriteLevel ?? 0,
              tags: itemTags,
              tagSources,
              primaryCluster: item.primaryCluster,
              genres: item.genres,
              notes: item.notes || '',
              lastFmPlaycount: item.lastFmPlaycount,
              lastFmPeriodPlaycount: item.lastFmPeriodPlaycount,
              lastFmPeriod: item.lastFmPeriod,
              lastFmUrl: item.lastFmUrl,
              lastFmListeners: item.lastFmListeners,
              lastFmEnrichedAt: item.lastFmEnrichedAt || new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            updatedList = [newItem, ...updatedList];
          }
        }
        try { localStorage.setItem('sonic_vault_demo_session_items', JSON.stringify(updatedList)); } catch (e) {}
        return updatedList;
      });
      return;
    }
    if (!user) return;

    for (let idx = 0; idx < newItems.length; idx++) {
      const item = newItems[idx];
      if (onProgress) {
        onProgress(idx + 1, newItems.length, item.name || 'Item', 'writing');
      }
      const cleanName = (item.name || '').toLowerCase().trim();
      
      // Check if this item already exists in the user's vault
      let existing: MusicItem | undefined;
      if (item.type === 'artist') {
        existing = items.find(i => i.type === 'artist' && i.name.toLowerCase().trim() === cleanName);
      } else if (item.type === 'track') {
        existing = items.find(i => 
          i.type === 'track' && 
          i.name.toLowerCase().trim() === cleanName && 
          (!item.parentName || (i.parentName && i.parentName.toLowerCase().trim() === item.parentName.toLowerCase().trim()))
        );
      } else if (item.type === 'album') {
        existing = items.find(i => 
          i.type === 'album' && 
          i.name.toLowerCase().trim() === cleanName && 
          (!item.parentName || (i.parentName && i.parentName.toLowerCase().trim() === item.parentName.toLowerCase().trim()))
        );
      }

      if (existing) {
        // Re-sync and update existing item
        const mergedTags = Array.from(new Set([...(existing.tags || []), ...(item.tags || [])]));
        const mergedTagSources = { ...(existing.tagSources || {}), ...(item.tagSources || {}) };
        (item.tags || []).forEach(t => {
          const clean = t.toLowerCase().trim().replace(/^#/, '');
          if (!mergedTagSources[clean]) mergedTagSources[clean] = 'lastfm';
        });
        
        const updates: any = {
          lastFmPlaycount: item.lastFmPlaycount ?? existing.lastFmPlaycount,
          familiarity: item.familiarity ?? existing.familiarity, // Recalculated from scrobbles
          lastFmEnrichedAt: item.lastFmEnrichedAt || new Date().toISOString(),
          tags: mergedTags,
          tagSources: mergedTagSources,
          updatedAt: serverTimestamp(),
        };

        if (item.lastFmPeriodPlaycount !== undefined) {
          updates.lastFmPeriodPlaycount = item.lastFmPeriodPlaycount;
        }
        if (item.lastFmPeriod) {
          updates.lastFmPeriod = item.lastFmPeriod;
        }
        if (item.imageUrl && (!existing.imageUrl || existing.imageUrl.trim() === '')) {
          updates.imageUrl = item.imageUrl;
        }
        if (item.lastFmUrl && !existing.lastFmUrl) {
          updates.lastFmUrl = item.lastFmUrl;
        }
        if (item.lastFmListeners !== undefined) {
          updates.lastFmListeners = item.lastFmListeners;
        }
        if (item.durationSeconds && (!existing.durationSeconds || existing.durationSeconds === 0)) {
          updates.durationSeconds = item.durationSeconds;
        }
        if (item.genres && !existing.genres) {
          updates.genres = item.genres;
        }
        if (item.notes && (!existing.notes || existing.notes.trim() === '')) {
          updates.notes = item.notes;
        }

        await safeUpdateDoc(existing.id, updates);
      } else {
        // Add new item to vault
        const itemTags = item.tags || [];
        const tagSources: Record<string, 'lastfm' | 'manual' | 'llm'> = { ...(item.tagSources || {}) };
        itemTags.forEach(t => {
          const clean = t.toLowerCase().trim().replace(/^#/, '');
          if (!tagSources[clean]) tagSources[clean] = 'lastfm';
        });

        const payload: any = {
          userId: user.uid,
          name: item.name || 'Untitled',
          type: item.type || 'artist',
          url: item.url || '',
          familiarity: item.familiarity ?? 0, // Inferred from playcount
          relevance: 0, // Strictly manual only: untouched by Last.fm
          rating: item.rating ?? 50,
          favoriteLevel: item.favoriteLevel ?? 0,
          tags: itemTags,
          tagSources,
          notes: item.notes || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (item.parentName) payload.parentName = item.parentName;
        if (item.imageUrl) payload.imageUrl = item.imageUrl;
        if (item.durationSeconds) payload.durationSeconds = item.durationSeconds;
        if (item.primaryCluster) payload.primaryCluster = item.primaryCluster;
        if (item.genres) payload.genres = item.genres;
        if (item.lastFmPlaycount !== undefined) payload.lastFmPlaycount = item.lastFmPlaycount;
        if (item.lastFmPeriodPlaycount !== undefined) payload.lastFmPeriodPlaycount = item.lastFmPeriodPlaycount;
        if (item.lastFmPeriod) payload.lastFmPeriod = item.lastFmPeriod;
        if (item.lastFmUrl) payload.lastFmUrl = item.lastFmUrl;
        if (item.lastFmListeners !== undefined) payload.lastFmListeners = item.lastFmListeners;
        if (item.lastFmEnrichedAt) payload.lastFmEnrichedAt = item.lastFmEnrichedAt;

        await addDoc(collection(db, 'musicItems'), payload);
      }
    }
  };

  const handleBatchUpdateLastFmItems = async (updates: { id: string; changes: Partial<MusicItem> }[]) => {
    for (const update of updates) {
      await safeUpdateDoc(update.id, update.changes);
    }
  };

  const handleEnrichSingleItem = async (item: MusicItem) => {
    if (isEnrichingSingleItem) return;
    setIsEnrichingSingleItem(true);
    try {
      const userApiKey = lastFmSettings?.apiKey;
      const userLfmName = lastFmSettings?.username;

      if (item.type === 'artist') {
        const enrichData = await enrichArtistFromLastFm(item.name, userApiKey, userLfmName);
        if (enrichData) {
          const newTags = Array.from(new Set([...(item.tags || []), ...enrichData.tags]));
          const tagSources = { ...(item.tagSources || {}) };
          enrichData.tags.forEach(t => {
            const clean = t.toLowerCase().trim();
            if (!tagSources[clean]) tagSources[clean] = 'lastfm';
          });
          const changes: any = {
            lastFmEnrichedAt: new Date().toISOString(),
            tags: newTags,
            tagSources,
          };
          if (enrichData.imageUrl && !item.imageUrl) changes.imageUrl = enrichData.imageUrl;
          if (enrichData.bioSummary && (!item.notes || item.notes.trim() === '')) changes.notes = `Last.fm Summary:\n${enrichData.bioSummary}`;
          if (enrichData.genres && !item.genres) changes.genres = enrichData.genres;
          if (enrichData.listeners) changes.lastFmListeners = enrichData.listeners;
          if (enrichData.url && !item.url) changes.url = enrichData.url;
          if (enrichData.inferredFamiliarity !== undefined) {
            changes.familiarity = enrichData.inferredFamiliarity; // Inferred from playcount
            if (enrichData.userPlaycount !== undefined) changes.lastFmPlaycount = enrichData.userPlaycount;
          }
          // Note: Relevance is strictly manual only and never updated by Last.fm
          await safeUpdateDoc(item.id, changes);
        }
      } else if (item.type === 'track') {
        const artistName = item.parentName || item.creator || '';
        if (artistName) {
          const enrichData = await enrichTrackFromLastFm(item.name, artistName, userApiKey, userLfmName);
          if (enrichData) {
            const newTags = Array.from(new Set([...(item.tags || []), ...enrichData.tags]));
            const tagSources = { ...(item.tagSources || {}) };
            enrichData.tags.forEach(t => {
              const clean = t.toLowerCase().trim();
              if (!tagSources[clean]) tagSources[clean] = 'lastfm';
            });
            const changes: any = {
              lastFmEnrichedAt: new Date().toISOString(),
              tags: newTags,
              tagSources,
            };
            if (enrichData.durationSeconds && (!item.durationSeconds || item.durationSeconds === 0)) {
              changes.durationSeconds = enrichData.durationSeconds;
            }
            if (enrichData.imageUrl && !item.imageUrl) changes.imageUrl = enrichData.imageUrl;
            if (enrichData.listeners) changes.lastFmListeners = enrichData.listeners;
            if (enrichData.url && !item.url) changes.url = enrichData.url;
            if (enrichData.genres && !item.genres) changes.genres = enrichData.genres;
            if (enrichData.inferredFamiliarity !== undefined) {
              changes.familiarity = enrichData.inferredFamiliarity;
              if (enrichData.userPlaycount !== undefined) changes.lastFmPlaycount = enrichData.userPlaycount;
            }
            await safeUpdateDoc(item.id, changes);
          }
        }
      } else if (item.type === 'album') {
        const artistName = item.parentName || item.creator || '';
        if (artistName) {
          const enrichData = await enrichAlbumFromLastFm(item.name, artistName, userApiKey, userLfmName);
          if (enrichData) {
            const newTags = Array.from(new Set([...(item.tags || []), ...enrichData.tags]));
            const tagSources = { ...(item.tagSources || {}) };
            enrichData.tags.forEach(t => {
              const clean = t.toLowerCase().trim();
              if (!tagSources[clean]) tagSources[clean] = 'lastfm';
            });
            const changes: any = {
              lastFmEnrichedAt: new Date().toISOString(),
              tags: newTags,
              tagSources,
            };
            if (enrichData.songCount && !item.songCount) changes.songCount = enrichData.songCount;
            if (enrichData.releaseDate && !item.releaseDate) changes.releaseDate = enrichData.releaseDate;
            if (enrichData.imageUrl && !item.imageUrl) changes.imageUrl = enrichData.imageUrl;
            if (enrichData.genres && !item.genres) changes.genres = enrichData.genres;
            if (enrichData.inferredFamiliarity !== undefined) {
              changes.familiarity = enrichData.inferredFamiliarity;
              if (enrichData.userPlaycount !== undefined) changes.lastFmPlaycount = enrichData.userPlaycount;
            }
            await safeUpdateDoc(item.id, changes);
          }
        }
      }
    } catch (err) {
      console.error('Single item enrichment error:', err);
    } finally {
      setIsEnrichingSingleItem(false);
    }
  };

  useEffect(() => {
    if (!user || isDemoMode) {
      return;
    }

    const settingsRef = doc(db, 'userSettings', user.uid);
    const unsubscribe = onSnapshot(settingsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.aiClusters !== undefined) {
          setAiClusters(data.aiClusters);
          try {
            if (data.aiClusters) {
              localStorage.setItem(`sonic_vault_clusters_${user.uid}`, JSON.stringify(data.aiClusters));
            } else {
              localStorage.removeItem(`sonic_vault_clusters_${user.uid}`);
            }
          } catch (e) {}
        }
        if (data.customClusters !== undefined) {
          setCustomClusters(data.customClusters);
          try { localStorage.setItem(`sonic_vault_custom_clusters_${user.uid}`, JSON.stringify(data.customClusters)); } catch (e) {}
        }
        if (data.lowPriorityTags !== undefined) {
          setLowPriorityTags(data.lowPriorityTags);
          try { localStorage.setItem(`sonic_vault_low_priority_tags_${user.uid}`, JSON.stringify(data.lowPriorityTags)); } catch (e) {}
        }
        if (data.preferredAIModel) {
          setPreferredAIModel(data.preferredAIModel);
        }
        if (data.tagMatchStrategy) {
          setTagMatchStrategy(data.tagMatchStrategy);
        }
        if (data.prioritizeStarSearchFirst !== undefined) {
          setPrioritizeStarSearchFirst(data.prioritizeStarSearchFirst);
          try { localStorage.setItem('sonic_vault_star_search_first', String(data.prioritizeStarSearchFirst)); } catch (e) {}
        }
        if (data.lastFmSettings !== undefined) {
          setLastFmSettings(data.lastFmSettings);
          try {
            localStorage.setItem(`sonic_vault_lastfm_${user.uid}`, JSON.stringify(data.lastFmSettings));
            localStorage.setItem('sonic_vault_lastfm_cached', JSON.stringify(data.lastFmSettings));
          } catch (e) {}
        }
      } else {
        // Migration: If no Firestore settings exist yet, migrate local storage to Firestore
        const savedClusters = localStorage.getItem(`sonic_vault_clusters_${user.uid}`);
        const savedCustom = localStorage.getItem(`sonic_vault_custom_clusters_${user.uid}`);
        const savedLow = localStorage.getItem(`sonic_vault_low_priority_tags_${user.uid}`);
        const savedLastFm = localStorage.getItem(`sonic_vault_lastfm_${user.uid}`);

        let initAiClusters: TagCluster[] | null = null;
        let initCustomClusters: TagCluster[] = [];
        let initLowPriority: string[] = [];
        let initLastFm: LastFmSettings | undefined = undefined;

        if (savedClusters) {
          try { initAiClusters = JSON.parse(savedClusters); } catch (e) {}
        }
        if (savedCustom) {
          try { initCustomClusters = JSON.parse(savedCustom); } catch (e) {}
        }
        if (savedLow) {
          try { initLowPriority = JSON.parse(savedLow); } catch (e) {}
        }
        if (savedLastFm) {
          try { initLastFm = JSON.parse(savedLastFm); } catch (e) {}
        }

        if (savedClusters || savedCustom || savedLow || savedLastFm) {
          setAiClusters(initAiClusters);
          setCustomClusters(initCustomClusters);
          setLowPriorityTags(initLowPriority);
          if (initLastFm) setLastFmSettings(initLastFm);
        }

        saveUserSettings({
          aiClusters: initAiClusters,
          customClusters: initCustomClusters,
          lowPriorityTags: initLowPriority,
          preferredAIModel: 'gemini-2.0-flash',
          tagMatchStrategy: 'or',
          lastFmSettings: initLastFm,
        });
      }
    }, (error) => {
      console.error('UserSettings snapshot error:', error);
    });

    return () => unsubscribe();
  }, [user, isDemoMode]);

  const toggleLowPriorityTag = (tag: string) => {
    const clean = tag.toLowerCase().trim();
    setLowPriorityTags(prev => {
      const next = prev.includes(clean) ? prev.filter(t => t !== clean) : [...prev, clean];
      if (user) {
        try { localStorage.setItem(`sonic_vault_low_priority_tags_${user.uid}`, JSON.stringify(next)); } catch (e) {}
        saveUserSettings({ lowPriorityTags: next });
      }
      return next;
    });
  };

  useEffect(() => {
    if (!user || isDemoMode) return;
    const q = query(
      collection(db, 'musicItems'),
      where('userId', '==', user.uid)
    );
    const path = 'musicItems';
    return onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MusicItem));
      docs.sort((a, b) => {
        const timeA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return timeB - timeA;
      });
      setItems(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
  }, [user, isDemoMode]);

  const migratedItemsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || isDemoMode || items.length === 0) return;

    // Migrate old favorited items to new favorite classification:
    // Old Level 3 (Purple, rel 95) -> New Level 4 (Purple, rel 95)
    // Old Level 2 (Red, rel 90)    -> New Level 3 (Red, rel 90)
    // Old Level 1 (Yellow, rel 80) -> New Level 1 (Yellow, rel 70)
    const migrateOldFavorites = async () => {
      for (const item of items) {
        if (migratedItemsRef.current.has(item.id)) continue;

        if (item.favoriteLevel === 3 && (item.relevance === 95 || item.relevance === undefined)) {
          migratedItemsRef.current.add(item.id);
          try {
            await updateDoc(doc(db, 'musicItems', item.id), {
              favoriteLevel: 4,
              relevance: 95,
              updatedAt: serverTimestamp(),
            });
          } catch (e) {
            console.error("Migration failed for item", item.id, e);
          }
        } else if (item.favoriteLevel === 2 && (item.relevance === 90 || item.relevance === undefined)) {
          migratedItemsRef.current.add(item.id);
          try {
            await updateDoc(doc(db, 'musicItems', item.id), {
              favoriteLevel: 3,
              relevance: 90,
              updatedAt: serverTimestamp(),
            });
          } catch (e) {
            console.error("Migration failed for item", item.id, e);
          }
        } else if (item.favoriteLevel === 1 && item.relevance === 80) {
          migratedItemsRef.current.add(item.id);
          try {
            await updateDoc(doc(db, 'musicItems', item.id), {
              favoriteLevel: 1,
              relevance: 70,
              updatedAt: serverTimestamp(),
            });
          } catch (e) {
            console.error("Migration failed for item", item.id, e);
          }
        } else if (item.favoriteLevel === undefined && item.relevance === 80) {
          migratedItemsRef.current.add(item.id);
          try {
            await updateDoc(doc(db, 'musicItems', item.id), {
              favoriteLevel: 1,
              relevance: 70,
              updatedAt: serverTimestamp(),
            });
          } catch (e) {
            console.error("Migration failed for item", item.id, e);
          }
        }
      }
    };

    migrateOldFavorites();
  }, [user, items]);

  const handleLogin = async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Popup login failed:", error);
      if (error?.code === 'auth/unauthorized-domain') {
        setAuthError(`Domain unauthorized: "${window.location.hostname}" is not authorized in Firebase Console -> Authentication -> Settings -> Authorized Domains.`);
      } else if (error?.code === 'auth/popup-closed-by-user') {
        setAuthError('The sign-in popup was closed before completing authentication. If popups auto-close or fail in your browser, try "Sign In with Redirect" below or open the app in a new tab.');
      } else if (error?.code === 'auth/popup-blocked') {
        setAuthError('Sign-in popup was blocked by your browser settings. Please allow popups or try "Sign In with Redirect".');
      } else if (error?.code === 'auth/cancelled-popup-request') {
        // Request cancelled by user
      } else {
        setAuthError(`Sign-in error (${error?.code || 'unknown'}): ${error?.message || String(error)}`);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleRedirectLogin = async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithRedirect(auth, provider);
    } catch (error: any) {
      console.error("Redirect login failed:", error);
      setAuthError(`Redirect login error (${error?.code || 'unknown'}): ${error?.message || String(error)}`);
      setIsSigningIn(false);
    }
  };

  const handleLogout = () => {
    if (isDemoMode) {
      handleExitDemoMode();
    } else {
      signOut(auth);
    }
  };

  const handleImport = async () => {
    const hasInput = importType === 'links' ? importLinks.trim() : (importFile || importLinks.trim());
    if (!hasInput || !user) return;
    
    setIsImporting(true);
    setImportProgress({ current: 0, total: 0 });
    const path = 'musicItems';

    const parseDurationRaw = (str: any): number => {
      if (typeof str === 'number') return str;
      if (!str || typeof str !== 'string') return 0;
      const clean = str.toLowerCase().trim();
      if (clean.includes(':')) {
        const parts = clean.split(':').map(Number);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
      }
      const hMatch = clean.match(/(\d+)h/);
      const mMatch = clean.match(/(\d+)m/);
      const sMatch = clean.match(/(\d+)s/);
      let total = 0;
      if (hMatch) total += parseInt(hMatch[1]) * 3600;
      if (mMatch) total += parseInt(mMatch[1]) * 60;
      if (sMatch) total += parseInt(sMatch[1]);
      return total;
    };

    try {
      let finalParsed: any[] = [];

      if (importType !== 'links' && importFile) {
        const buffer = await importFile.arrayBuffer();
        const workbook = XLSX.read(buffer);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        const rows = jsonData.filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ''));
        const firstRow = rows[0]?.map(c => String(c).toLowerCase()) || [];
        const hasHeader = firstRow.some(c => c.includes('url') || c.includes('name') || c.includes('artist'));
        const dataRows = hasHeader ? rows.slice(1) : rows;
        
        setImportProgress({ current: 0, total: dataRows.length });

        for (let i = 0; i < dataRows.length; i++) {
          const row = dataRows[i];
          let item: any;

          if (importType === 'playlists_sheet') {
            item = {
              url: String(row[0] || ''),
              name: String(row[1] || 'Untitled Playlist'),
              subtitle: String(row[2] || ''),
              songCount: parseInt(String(row[3])) || 0,
              durationSeconds: parseDurationRaw(row[4]),
              creator: String(row[5] || ''),
              creatorUrl: String(row[6] || ''),
              relevance: parseInt(String(row[7])) || 0,
              tags: row[8] ? String(row[8]).split(/[,;]/).map(t => t.trim()).filter(Boolean) : [],
              type: 'playlist',
              aiAnalyzed: false
            };
          } else {
            // Album Spreadsheet: Album Date, Album URL, Album Cover Image, Album Name, Artist Name, Artist URL
            item = {
              releaseDate: String(row[0] || ''),
              url: String(row[1] || ''),
              imageUrl: String(row[2] || ''),
              name: String(row[3] || 'Untitled Album'),
              parentName: String(row[4] || ''),
              artistUrl: String(row[5] || ''),
              type: 'album',
              tags: [], // Ensure tags is present
              aiAnalyzed: false
            };
          }

          if (item.url) {
            if (isDemoMode) {
              // Store locally for demo mode
            } else {
              await addDoc(collection(db, path), {
                ...item,
                userId: user.uid,
                rating: 0,
                notes: '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          }
          
          if (i % 5 === 0 || i === dataRows.length - 1) {
            setImportProgress({ current: i + 1, total: dataRows.length });
          }
        }
      } else {
        if (importType === 'links') {
          finalParsed = await parseMusicLinks(importLinks, preferredAIModel);
        } else if (importType === 'playlists_sheet') {
          finalParsed = await parsePlaylistSpreadsheet(importLinks, preferredAIModel);
        } else if (importType === 'albums_sheet') {
          finalParsed = await parseAlbumSpreadsheet(importLinks, preferredAIModel);
        }

        setImportProgress({ current: 0, total: finalParsed.length });
        for (let i = 0; i < finalParsed.length; i++) {
          const item = finalParsed[i];
          if (!isDemoMode) {
            await addDoc(collection(db, path), {
              ...item,
              userId: user.uid,
              tags: item.tags || [],
              rating: item.rating || 0,
              notes: item.notes || '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              aiAnalyzed: importType !== 'links' ? false : true
            });
          }
          setImportProgress({ current: i + 1, total: finalParsed.length });
        }
      }

      if (isDemoMode) {
        let demoNewItems: MusicItem[] = [];
        if (importType !== 'links' && importFile) {
          const buffer = await importFile.arrayBuffer();
          const workbook = XLSX.read(buffer);
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
          const rows = jsonData.filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ''));
          const firstRow = rows[0]?.map(c => String(c).toLowerCase()) || [];
          const hasHeader = firstRow.some(c => c.includes('url') || c.includes('name') || c.includes('artist'));
          const dataRows = hasHeader ? rows.slice(1) : rows;

          for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            let item: any;
            if (importType === 'playlists_sheet') {
              item = {
                url: String(row[0] || ''),
                name: String(row[1] || 'Untitled Playlist'),
                subtitle: String(row[2] || ''),
                songCount: parseInt(String(row[3])) || 0,
                durationSeconds: parseDurationRaw(row[4]),
                creator: String(row[5] || ''),
                creatorUrl: String(row[6] || ''),
                relevance: parseInt(String(row[7])) || 0,
                tags: row[8] ? String(row[8]).split(/[,;]/).map(t => t.trim()).filter(Boolean) : [],
                type: 'playlist',
                aiAnalyzed: false
              };
            } else {
              item = {
                releaseDate: String(row[0] || ''),
                url: String(row[1] || ''),
                imageUrl: String(row[2] || ''),
                name: String(row[3] || 'Untitled Album'),
                parentName: String(row[4] || ''),
                artistUrl: String(row[5] || ''),
                type: 'album',
                tags: [],
                aiAnalyzed: false
              };
            }
            if (item.url) {
              demoNewItems.push({
                ...item,
                id: 'demo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7) + i,
                userId: 'demo-guest',
                rating: 0,
                notes: '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              });
            }
          }
        } else {
          for (let i = 0; i < finalParsed.length; i++) {
            const item = finalParsed[i];
            demoNewItems.push({
              ...item,
              id: 'demo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7) + i,
              userId: 'demo-guest',
              tags: item.tags || [],
              rating: item.rating || 0,
              notes: item.notes || '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              aiAnalyzed: importType !== 'links' ? false : true
            });
          }
        }
        const combined = [...demoNewItems, ...items];
        setItems(combined);
        try { localStorage.setItem('sonic_vault_demo_session_items', JSON.stringify(combined)); } catch (e) {}
      }

      setImportModalOpen(false);
      setImportLinks('');
      setImportFile(null);
      setImportProgress({ current: 0, total: 0 });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    } finally {
      setIsImporting(false);
    }
  };

  const handleAnalyze = async (item: MusicItem) => {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    setAnalyzingId(item.id);
    try {
      const result = await analyzeItem(item, allTags, preferredAIModel);
      if (result) {
        // Enforce lowercase tags from result
        const normalizedTags = (result.tags || []).map((t: string) => t.toLowerCase());
        const updates: any = {
          ...result,
          tags: normalizedTags,
          aiAnalyzed: true,
          updatedAt: serverTimestamp(),
        };
        if (item.imageUrl || !updates.imageUrl) {
          delete updates.imageUrl;
        }
        await safeUpdateDoc(item.id, updates);
        
        // Update local detailItem state immediately for visual feedback
        if (detailItem && detailItem.id === item.id) {
          setDetailItem(prev => prev ? ({ ...prev, ...updates } as MusicItem) : null);
        }
      } else {
        alert("AI Analysis failed. The model returned an empty response.");
      }
    } catch (error: any) {
      console.error("Analysis failed", error);
      alert(`AI Analysis encountered an error: ${error.message || 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
      setAnalyzingId(null);
    }
  };

  const handleBatchAnalyze = async () => {
    const unanalyzed = selectedIds.length > 0 
      ? items.filter(i => selectedIds.includes(i.id) && !i.aiAnalyzed)
      : items.filter(i => !i.aiAnalyzed);
      
    if (unanalyzed.length === 0 || isAnalyzing) return;
    
    setIsAnalyzing(true);
    for (let i = 0; i < unanalyzed.length; i++) {
      const item = unanalyzed[i];
      setAnalyzingId(item.id);
      try {
        const result = await analyzeItem(item, allTags, preferredAIModel);
        if (result) {
          const normalizedTags = (result.tags || []).map((t: string) => t.toLowerCase());
          const updates: any = {
            ...result,
            tags: normalizedTags,
            aiAnalyzed: true,
            updatedAt: serverTimestamp(),
          };
          if (item.imageUrl || !updates.imageUrl) {
            delete updates.imageUrl;
          }
          await safeUpdateDoc(item.id, updates);
        }
      } catch (e: any) {
        console.error("Batch entry failed", e);
        if (e.message?.includes("GEMINI_API_KEY")) {
          alert(e.message);
          break;
        }
      }
    }
    setAnalyzingId(null);
    setIsAnalyzing(false);
    setSelectedIds([]);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    setConfirmModal({
      isOpen: true,
      title: "Delete Selected Items",
      message: `Are you sure you want to delete ${count} selected item${count > 1 ? 's' : ''} from your library?`,
      confirmText: `Delete ${count} Item${count > 1 ? 's' : ''}`,
      variant: "danger",
      onConfirm: async () => {
        const idsToDelete = [...selectedIds];
        setSelectedIds([]);
        for (const id of idsToDelete) {
          await safeDeleteDoc(id);
        }
        if (detailItem && idsToDelete.includes(detailItem.id)) {
          setDetailItem(null);
        }
      }
    });
  };

  const handleBulkUpdate = async () => {
    if (selectedIds.length === 0) return;
    try {
      const updates: any = { updatedAt: serverTimestamp() };
      
      const tagsToApply = bulkTagInput.split(/[,;]/).map(t => t.trim()).filter(Boolean);
      
      for (const id of selectedIds) {
        const item = items.find(i => i.id === id);
        if (!item) continue;

        let finalUpdates = { ...updates };
        
        if (bulkActionType === 'addTags') {
          finalUpdates.tags = Array.from(new Set([...item.tags, ...tagsToApply]));
        } else if (bulkActionType === 'setTags') {
          finalUpdates.tags = tagsToApply;
        }

        if (bulkRelevanceInput !== '') {
          finalUpdates.relevance = Number(bulkRelevanceInput);
        }

        if (bulkFamiliarityInput !== '') {
          finalUpdates.familiarity = Number(bulkFamiliarityInput);
        }

        await safeUpdateDoc(id, finalUpdates);
      }
      
      setBulkEditModalOpen(false);
      setSelectedIds([]);
      setBulkTagInput('');
      setBulkRelevanceInput('');
      setBulkFamiliarityInput('');
    } catch (error) {
      console.error("Bulk update failed", error);
      alert("Bulk update encountered an error.");
    }
  };

  const fetchHtml = async (url: string) => {
    const proxies = [
      `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?url=${encodeURIComponent(url)}`
    ];
    for (const proxy of proxies) {
      try {
        const res = await fetch(proxy);
        if (res.ok) {
          return await res.text();
        }
      } catch (e) {
        // Continue to next proxy
      }
    }
    throw new Error('All CORS proxies failed to fetch the URL.');
  };

  const extractCoverImageUrl = async (url: string, itemContext?: { name?: string; type?: string; parentName?: string }): Promise<string | null> => {
    try {
      const art = await fetchItemArtwork({
        url,
        name: itemContext?.name || '',
        type: itemContext?.type || 'artist',
        parentName: itemContext?.parentName || '',
      }, lastFmSettings?.apiKey);
      if (art) return art;

      // YouTube
      const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
      if (ytMatch && ytMatch[1]) {
        return `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
      }

      // Spotify oEmbed
      if (url.includes('spotify.com')) {
        try {
          const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.thumbnail_url) return data.thumbnail_url;
          }
        } catch (e) { /* ignore */ }
      }

      // SoundCloud oEmbed
      if (url.includes('soundcloud.com')) {
        try {
          const res = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.thumbnail_url) return data.thumbnail_url;
          }
        } catch (e) { /* ignore */ }
      }

      // Vimeo oEmbed
      if (url.includes('vimeo.com')) {
        try {
          const res = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.thumbnail_url) return data.thumbnail_url;
          }
        } catch (e) { /* ignore */ }
      }

      // Fallback: Generic HTML Meta tags via CORS proxies
      const html = await fetchHtml(url);
      const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) || 
                    html.match(/<meta\s+name=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                    html.match(/<meta\s+itemprop=["']image["']\s+content=["']([^"']+)["']/i) ||
                    html.match(/href=["']([^"']+)["'][^>]+rel=["']image_src["']/i);
      
      if (match && match[1]) {
        return match[1].replace(/&amp;/g, '&');
      }
    } catch (e) {
      console.error(`Failed to extract cover for ${url}`, e);
    }
    return null;
  };

  const handleFetchCovers = async () => {
    if (selectedIds.length === 0 || isFetchingCovers) return;
    
    // Check if any selected items already have covers
    const hasExistingCovers = items.filter(i => selectedIds.includes(i.id) && i.imageUrl && i.imageUrl.trim() !== '').length > 0;
    let overwrite = false;
    if (hasExistingCovers) {
      overwrite = window.confirm("Some selected items already have cover images. Do you want to overwrite them with newly resolved pictures?");
    }

    setIsFetchingCovers(true);
    let successCount = 0;
    const totalSelected = selectedIds.length;

    try {
      for (const id of selectedIds) {
        const item = items.find(i => i.id === id);
        if (!item) continue;
        if (item.imageUrl && item.imageUrl.trim() !== '' && !overwrite) continue;
        
        try {
          const userApiKey = lastFmSettings?.apiKey;
          const imageUrl = await fetchItemArtwork({
            type: item.type,
            name: item.name,
            parentName: item.parentName,
            url: item.url,
            lastFmUrl: item.lastFmUrl
          }, userApiKey);

          if (imageUrl) {
            if (isDemoMode) {
              setItems(prev => {
                const next = prev.map(it => it.id === id ? { ...it, imageUrl, updatedAt: new Date().toISOString() } : it);
                try { localStorage.setItem('sonic_vault_demo_session_items', JSON.stringify(next)); } catch (e) {}
                return next;
              });
            } else {
              await safeUpdateDoc(id, {
                imageUrl,
                updatedAt: serverTimestamp()
              });
            }
            successCount++;
          } else {
            console.warn(`No picture found for ${item.name} (${item.type})`);
          }
        } catch (e) {
          console.error("Failed to fetch cover for " + item.name, e);
        }
      }
      setSelectedIds([]);
      alert(`Successfully fetched and updated pictures for ${successCount} of ${totalSelected} selected items.`);
    } catch (error) {
      console.error("Fetch covers failed", error);
      alert("Encountered an error while fetching covers.");
    } finally {
      setIsFetchingCovers(false);
    }
  };

  const handleNormalizeTags = async () => {
    if (isNormalizing) return;
    setIsNormalizing(true);
    try {
      for (const item of items) {
        const lowerTags = item.tags.map(t => t.toLowerCase());
        const uniqueTags = Array.from(new Set(lowerTags));
        
        // Only update if there's a difference
        if (JSON.stringify(item.tags) !== JSON.stringify(uniqueTags)) {
          await safeUpdateDoc(item.id, {
            tags: uniqueTags,
            updatedAt: serverTimestamp()
          });
        }
      }
      alert('Vault tags have been normalized to lower-case and deduplicated.');
    } catch (error) {
      console.error('Normalization error', error);
    } finally {
      setIsNormalizing(false);
    }
  };

  const getClusterCategory = (cluster: TagCluster): 'vibe' | 'genre' => {
    if (cluster.category === 'vibe' || cluster.category === 'genre') {
      return cluster.category;
    }
    const nameLower = (cluster.name || '').toLowerCase();
    if (
      nameLower.includes('mellow') ||
      nameLower.includes('energetic') ||
      nameLower.includes('vibe') ||
      nameLower.includes('chill') ||
      nameLower.includes('upbeat') ||
      nameLower.includes('ambient') ||
      nameLower.includes('meditative') ||
      nameLower.includes('mood') ||
      nameLower.includes('high-energy') ||
      nameLower.includes('relax') ||
      nameLower.includes('lo-fi') ||
      nameLower.includes('downtempo')
    ) {
      return 'vibe';
    }
    return 'genre';
  };

  const handleDropCluster = (
    sourceName: string, 
    targetCategory: 'vibe' | 'genre', 
    targetClusterName?: string,
    position: 'before' | 'after' = 'after'
  ) => {
    if (!user || !sourceName) return;
    const currentClusters = aiClusters 
      ? [...aiClusters] 
      : getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
    
    const sourceIndex = currentClusters.findIndex(c => c.name === sourceName);
    if (sourceIndex === -1) return;

    const [movedCluster] = currentClusters.splice(sourceIndex, 1);
    movedCluster.category = targetCategory;

    if (targetClusterName && targetClusterName !== sourceName) {
      const targetIndex = currentClusters.findIndex(c => c.name === targetClusterName);
      if (targetIndex !== -1) {
        const insertAt = position === 'before' ? targetIndex : targetIndex + 1;
        currentClusters.splice(insertAt, 0, movedCluster);
      } else {
        currentClusters.push(movedCluster);
      }
    } else {
      let lastCategoryIndex = -1;
      for (let i = currentClusters.length - 1; i >= 0; i--) {
        if (getClusterCategory(currentClusters[i]) === targetCategory) {
          lastCategoryIndex = i;
          break;
        }
      }
      if (lastCategoryIndex !== -1) {
        currentClusters.splice(lastCategoryIndex + 1, 0, movedCluster);
      } else {
        currentClusters.push(movedCluster);
      }
    }

    setAiClusters(currentClusters);
    try { localStorage.setItem(`sonic_vault_clusters_${user.uid}`, JSON.stringify(currentClusters)); } catch (e) {}
    saveUserSettings({ aiClusters: currentClusters });
    setDraggedClusterName(null);
    setDragOverClusterName(null);
    setDragOverPosition('after');
    setDragOverCategory(null);
  };

  const handleToggleClusterCategory = (clusterName: string) => {
    if (!user) return;
    const currentClusters = aiClusters 
      ? [...aiClusters] 
      : getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
    
    const cluster = currentClusters.find(c => c.name === clusterName);
    if (cluster) {
      const currentCat = getClusterCategory(cluster);
      cluster.category = currentCat === 'vibe' ? 'genre' : 'vibe';
      setAiClusters(currentClusters);
      try { localStorage.setItem(`sonic_vault_clusters_${user.uid}`, JSON.stringify(currentClusters)); } catch (e) {}
      saveUserSettings({ aiClusters: currentClusters });
    }
  };

  const handleShiftClusterPosition = (clusterName: string, direction: 'up' | 'down') => {
    if (!user) return;
    const currentClusters = aiClusters 
      ? [...aiClusters] 
      : getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
    
    const clusterObj = currentClusters.find(c => c.name === clusterName);
    if (!clusterObj) return;

    const targetCategory = getClusterCategory(clusterObj);
    const sameCategoryIndices = currentClusters
      .map((c, idx) => getClusterCategory(c) === targetCategory ? idx : -1)
      .filter(idx => idx !== -1);
      
    const currentIdxInCategory = sameCategoryIndices.findIndex(idx => currentClusters[idx].name === clusterName);
    if (currentIdxInCategory === -1) return;

    const targetIdxInCategory = direction === 'up' ? currentIdxInCategory - 1 : currentIdxInCategory + 1;
    if (targetIdxInCategory < 0 || targetIdxInCategory >= sameCategoryIndices.length) return;

    const actualCurrentIdx = sameCategoryIndices[currentIdxInCategory];
    const actualTargetIdx = sameCategoryIndices[targetIdxInCategory];

    const temp = currentClusters[actualCurrentIdx];
    currentClusters[actualCurrentIdx] = currentClusters[actualTargetIdx];
    currentClusters[actualTargetIdx] = temp;

    setAiClusters(currentClusters);
    try { localStorage.setItem(`sonic_vault_clusters_${user.uid}`, JSON.stringify(currentClusters)); } catch (e) {}
    saveUserSettings({ aiClusters: currentClusters });
  };

  const getLocalClusters = (tags: string[]): TagCluster[] => {
    const musicGenresAndStyles = [
      {
        name: "Chill, Lo-Fi & Downtempo (Mellow Vibes)",
        category: "vibe",
        match: ["chill", "chillout", "lo-fi", "lofi", "downtempo", "mellow", "trip hop", "triphop", "lounge", "cafe", "easy listening", "relex", "relaxing", "calm"],
        description: "Head-nodding beats, dusty vinyl crackles, mellow atmospheres, and relaxing sunset grooves"
      },
      {
        name: "Upbeat, High-Energy & Groove (Energetic Vibes)",
        category: "vibe",
        match: ["upbeat", "energetic", "happy", "party", "dance", "high-energy", "infectious", "funky vibe", "dance-pop", "fast"],
        description: "Bright tempos, handclaps, infectious energetic rhythms, and foot-tapping hooks"
      },
      {
        name: "Ambient, Drone & Soundscapes",
        category: "vibe",
        match: ["ambient", "drone", "minimalist", "modular", "soundscape", "space", "celestial", "environmental", "field recording", "dreamy"],
        description: "Atmospheric textures, generative systems, and slow-frequency drones"
      },
      {
        name: "Meditative, Ritual & Yoga",
        category: "vibe",
        match: ["meditation", "meditative", "yoga", "spiritual", "tibetan", "bowl", "sacred", "ceremonial", "healing", "solfeggio", "raga", "oriental"],
        description: "Singing bowls, ancient modal ragas, healing frequencies, and sacred spaces"
      },
      {
        name: "Dark, Atmospheric & Gothic",
        category: "vibe",
        match: ["dark", "gothic", "darkwave", "sad", "melancholy", "moody", "noir", "ethereal"],
        description: "Somber twilight aesthetics, dark synthesizers, and dramatic gothic atmospheres"
      },
      {
        name: "Brazilian Trad & Mod",
        category: "genre",
        match: ["mpb", "samba", "choro", "bossa-nova", "forro", "forró", "baile-funk", "samba-rock", "tropicalia", "pagode", "axe", "brazilian", "nordeste", "bossa", "maracatu", "carimbo", "carimbó", "frevo", "manguebeat", "afoxe"],
        description: "Rich, rhythmic musical traditions of Brazil"
      },
      {
        name: "Japanese & City Pop",
        category: "genre",
        match: ["japanese", "nihon", "j-pop", "j-rock", "city pop", "citypop", "shibuya-kei", "enka", "gagaku", "koto", "shamisen", "anime", "ongaku"],
        description: "From retro Tokyo visual grooves to contemporary Eastern styles"
      },
      {
        name: "Decade Classics: 70s / Vintage",
        category: "genre",
        match: ["1970s", "70s", "seventies", "vinyl", "vintage", "retro", "analog", "crate digging", "classic soul", "mellow 70s"],
        description: "The classic sounds of warmth, gold-era analog, and vintage pressings"
      },
      {
        name: "Decade Classics: 80s / Retro",
        category: "genre",
        match: ["1980s", "80s", "eighties", "synthpop", "synth-pop", "new wave", "post-punk", "hair metal", "italo disco"],
        description: "Synthesizer driven new wave, hair metal, and arcade pop aesthetics"
      },
      {
        name: "Decade Classics: 90s / Alternative",
        category: "genre",
        match: ["1990s", "90s", "nineties", "grunge", "alt-rock", "golden era", "britpop", "90s rap", "90s hip-hop"],
        description: "Raw alternative guitar tones, grunge, and late-century booms"
      },
      {
        name: "Organic Vocal, Chant & Choir",
        category: "genre",
        match: ["a cappella", "acappella", "chant", "choir", "vocal", "body percussion", "beatbox", "overtone", "choral", "vocal jazz", "harmony", "percussion", "rhythm"],
        description: "Human voices, choral ensembles, chants, and vocalizing rhythm art"
      },
      {
        name: "Jazz, Bebop & Swing",
        category: "genre",
        match: ["jazz", "swing", "bebop", "hard bop", "cool jazz", "big band", "dixieland", "standards", "standard", "modal jazz"],
        description: "Pure improvisation, acoustic horns, syncopated swing, and piano standards"
      },
      {
        name: "Jazz Fusion & Krautrock",
        category: "genre",
        match: ["fusion", "jazz-fusion", "prog-rock", "progressive", "canterbury scene", "zeuhl", "krautrock", "jazz funk", "jazz-funk", "math rock"],
        description: "Electric genre-bending, complex time signatures, and kosmische musik"
      },
      {
        name: "Soul, Funk & R&B",
        category: "genre",
        match: ["funk", "soul", "r&b", "motown", "rhythm", "neo-soul", "disco", "groove", "philly", "stax"],
        description: "Passionate velvet melodies, brass stabs, and outstanding syncopated basslines"
      },
      {
        name: "Electronic, House & Techno",
        category: "genre",
        match: ["electronic", "house", "techno", "electro", "synth", "idm", "breakbeat", "dnb", "drum and bass", "jungle", "rave", "edm", "acid house", "deep house"],
        description: "Hypnotic synth-work, four-on-the-floor rhythms, and underground club cultures"
      },
      {
        name: "African Rhythms & Afrobeat",
        category: "genre",
        match: ["african", "afrobeat", "highlife", "desert blues", "gnawa", "rumba congolaise", "soukous", "juju", "apala", "amapiano", "kuduro", "marabi", "ethio-jazz", "ethiojazz"],
        description: "Polyrhythmic excellence, highlife brass, amapiano logs, and Afrobeat grooves"
      },
      {
        name: "Latin, Salsa & Tropical",
        category: "genre",
        match: ["latin", "salsa", "cumbia", "son", "mambo", "merengue", "bachata", "reggeaton", "tango", "milonga", "andean", "mariachi", "tejano", "afro-cuban"],
        description: "Caribbean brass, syncopated percussion, tango string duets, and tropical rhythms"
      },
      {
        name: "Reggae, Dub & Ska",
        category: "genre",
        match: ["reggae", "dub", "ska", "rocksteady", "dancehall", "roots", "sound system"],
        description: "Heavy low-end, off-beat skank guitar, and tape-delay feedback space echo"
      },
      {
        name: "Folk, Bluegrass & Americana",
        category: "genre",
        match: ["folk", "bluegrass", "country", "americana", "acoustic folk", "singer-songwriter", "traditional", "celtic", "old-time"],
        description: "Storytelling circles, mandolins, banjos, and wooden acoustic strings"
      },
      {
        name: "Classic & Hard Rock",
        category: "genre",
        match: ["rock", "hard rock", "classic rock", "psychedelic", "garage rock", "rock & roll", "blues rock", "southern rock"],
        description: "Amplified guitars, driving rhythms, and heavy stadium blues"
      },
      {
        name: "Punk, Post-Punk & Emo",
        category: "genre",
        match: ["punk", "hardcore", "post-hardcore", "post-punk", "emo", "screamo", "pop punk", "skate punk"],
        description: "Aggressive tempos, DIY underground ethics, and post-punk bass-driven grit"
      },
      {
        name: "Alternative, Shoegaze & Indie",
        category: "genre",
        match: ["indie", "indie rock", "alternative", "shoegaze", "dream pop", "dreampop", "spacerock", "noise pop"],
        description: "Swirling fuzzy delay pedalboards, indie hooks, and dreamy reverberations"
      },
      {
        name: "Hip Hop, Rap & Boom Bap",
        category: "genre",
        match: ["hip hop", "hip-hop", "rap", "boom bap", "boombap", "trap", "instrumental hip hop", "turntablim", "g-funk", "lofi hip hop"],
        description: "MPC sampling, vinyl scratches, clever rhymes, and heavy kick-snare beats"
      },
      {
        name: "Classical & Chamber",
        category: "genre",
        match: ["classical", "chamber", "orchestral", "symphony", "opera", "baroque", "romantic", "piano solo", "chopin", "bach", "beethoven"],
        description: "Acoustic elegance, grand concert structures, and intimate chamber woodwinds"
      },
      {
        name: "Global & World Traditions",
        category: "genre",
        match: ["traditional", "world", "ethno", "folk traditional", "roots traditional", "indigenous", "flamenco", "fado", "klezmer"],
        description: "Fado poetry, Spanish acoustic guitar, and ancestral regional sounds"
      },
      {
        name: "Soundtracks & Cinematic",
        category: "genre",
        match: ["cinematic", "soundtrack", "score", "ost", "anime ost", "movie", "theme", "epic"],
        description: "Grand score themes, background immersion, and television/film companion music"
      },
      {
        name: "Avant-Garde & Experimental",
        category: "genre",
        match: ["experimental", "avant-garde", "sound art", "noise", "concrete", "field recordings", "industrial", "glitch", "microtonal"],
        description: "Atonal sound design, extreme textures, glitch, and boundary-pushing audio ideas"
      },
      {
        name: "Lyrical, Poetry & Spoken Word",
        category: "genre",
        match: ["spoken", "poetry", "poem", "lyric", "story", "monologue", "recital", "audiobook", "narrative", "narration", "speech", "interview", "podcast", "word-play"],
        description: "Focus on voice, written poetry, spoken tracks, and spoken-word storytelling"
      },
      {
        name: "Instrumental, Beats & Loops",
        category: "genre",
        match: ["instrumental", "beat", "loop", "grooves", "backing", "karaoke", "no-vocals", "samples", "drum kit", "synth loop"],
        description: "Vocalless layers, pure rhythm beds, electronic loops, and background beats"
      },
      {
        name: "Sound FX, Nature & ASMR",
        category: "genre",
        match: ["sfx", "sound effect", "nature", "rain", "forest", "waves", "wind", "asmr", "whispering", "foley", "field-recording", "environmental sound", "white noise", "pink noise", "binaural"],
        description: "Environmental textures, custom FX recordings, and relaxing ASMR wave triggers"
      },
      {
        name: "Synthwave, Retro & Cyberpunk",
        category: "genre",
        match: ["synthwave", "vaporwave", "cyberpunk", "retrowave", "outrun", "darksynth", "future funk", "lo-fi synth", "electronic retro", "dreamwave"],
        description: "Neon-lit grid-synths, nostalgic retro-futurism, and slow-melt vaporwave aesthetics"
      },
      {
        name: "Heavy Metal, Thrash & Hardcore",
        category: "genre",
        match: ["metal", "heavy metal", "death metal", "black metal", "doom metal", "thrash metal", "sludge", "grindcore", "heavy-metal", "stoner rock", "industrial metal"],
        description: "Down-tuned distorted guitars, blast beats, guttural roars, and industrial heaviness"
      },
      {
        name: "Live, Session & Concert Bootlegs",
        category: "genre",
        match: ["live", "concert", "bootleg", "session", "unplugged", "acoustic live", "performance", "tour", "b-side", "show", "gig"],
        description: "Raw room sound, roaring crowds, unique improvised sets, and session takes"
      },
      {
        name: "Indie Pop, Bedroom & Dream Pop",
        category: "genre",
        match: ["bedroom pop", "indie pop", "dream-pop", "twee", "indie-pop", "shibuya", "mellow indie", "synth-indie", "cute"],
        description: "Cozy DIY lo-fi pop chords, soft vocals, and pastel cassette feelings"
      }
    ];

    const clusters: TagCluster[] = musicGenresAndStyles.map(g => ({
      name: g.name,
      description: g.description,
      category: g.category as 'vibe' | 'genre',
      tags: []
    }));

    const uncategorizedTags: string[] = [];

    tags.forEach(tag => {
      let matched = false;
      clusters.forEach((cluster, idx) => {
        const keywords = musicGenresAndStyles[idx].match;
        const matchesKeyword = keywords.some(kw => tag.toLowerCase().includes(kw));
        if (matchesKeyword) {
          cluster.tags.push(tag);
          matched = true;
        }
      });
      if (!matched) {
        uncategorizedTags.push(tag);
      }
    });

    const activeClusters = clusters.filter(c => c.tags.length > 0);

    if (uncategorizedTags.length > 0) {
      activeClusters.push({
        name: "Other Curation Tags",
        description: "Uncategorized custom tags, specific notes, and descriptors in your collection",
        category: "genre",
        tags: uncategorizedTags
      });
    }

    return activeClusters;
  };

  const handleClusterTagsWithAI = async () => {
    if (!user || allTags.length === 0 || isClustering) return;
    setIsClustering(true);
    try {
      const result = await clusterTagsWithAI(allTags, preferredAIModel);
      if (result && result.clusters) {
        const formattedClusters = result.clusters.map((c: any) => ({
          name: String(c.name),
          description: String(c.description || ''),
          tags: (c.tags || []).map((t: string) => t.toLowerCase())
        }));
        setAiClusters(formattedClusters);
        try { localStorage.setItem(`sonic_vault_clusters_${user.uid}`, JSON.stringify(formattedClusters)); } catch (e) {}
        saveUserSettings({ aiClusters: formattedClusters });
        alert("AI successfully generated custom tags clusters.");
      } else {
        alert("Auto-clustering failed. The model returned an invalid structure.");
      }
    } catch (error: any) {
      console.error("AI Tag clustering failed", error);
      alert(`AI Tag clustering error: ${error.message || 'Unknown error'}`);
    } finally {
      setIsClustering(false);
    }
  };

  const handleResetTagClusters = () => {
    setConfirmModal({
      isOpen: true,
      title: "Reset Tag Clusters",
      message: "Reset to default rule-based clusters? This will remove custom AI tag groupings.",
      confirmText: "Reset Clusters",
      variant: "warning",
      onConfirm: async () => {
        setAiClusters(null);
        if (user) {
          try { localStorage.removeItem(`sonic_vault_clusters_${user.uid}`); } catch (e) {}
          saveUserSettings({ aiClusters: null });
        }
      }
    });
  };

  const handleSaveCustomCluster = () => {
    if (!user) return;
    if (!newClusterName.trim()) {
      alert("Please provide a name for the custom cluster.");
      return;
    }
    if (newClusterTags.length === 0) {
      alert("Please select at least one tag for this custom cluster.");
      return;
    }

    const updatedCluster: TagCluster = {
      name: newClusterName.trim(),
      description: newClusterDescription.trim(),
      tags: newClusterTags.map(t => t.toLowerCase())
    };

    let nextClusters: TagCluster[] = [];
    if (editingCustomClusterName) {
      nextClusters = customClusters.map(c => 
        c.name === editingCustomClusterName ? updatedCluster : c
      );
    } else {
      if (customClusters.some(c => c.name.toLowerCase() === updatedCluster.name.toLowerCase())) {
        alert("A custom cluster with this name already exists.");
        return;
      }
      nextClusters = [...customClusters, updatedCluster];
    }

    setCustomClusters(nextClusters);
    try { localStorage.setItem(`sonic_vault_custom_clusters_${user.uid}`, JSON.stringify(nextClusters)); } catch (e) {}
    saveUserSettings({ customClusters: nextClusters });
    
    setIsCreatingCustomCluster(false);
    setNewClusterName('');
    setNewClusterDescription('');
    setNewClusterTags([]);
    setEditingCustomClusterName(null);
  };

  const handleEditCustomCluster = (cluster: TagCluster) => {
    setNewClusterName(cluster.name);
    setNewClusterDescription(cluster.description || '');
    setNewClusterTags(cluster.tags);
    setEditingCustomClusterName(cluster.name);
    setIsCreatingCustomCluster(true);
  };

  const handleDeleteCustomCluster = (name: string) => {
    if (!user) return;
    setConfirmModal({
      isOpen: true,
      title: "Delete Custom Cluster",
      message: `Are you sure you want to delete custom cluster "${name}"?`,
      confirmText: "Delete Cluster",
      variant: "danger",
      onConfirm: async () => {
        const nextClusters = customClusters.filter(c => c.name !== name);
        setCustomClusters(nextClusters);
        try { localStorage.setItem(`sonic_vault_custom_clusters_${user.uid}`, JSON.stringify(nextClusters)); } catch (e) {}
        saveUserSettings({ customClusters: nextClusters });
      }
    });
  };

  const handleStartEditCluster = (cluster: TagCluster, type: 'custom' | 'ai' | 'default', tagsOnly = false) => {
    setClusterEditTarget({
      cluster,
      originalName: cluster.name,
      type,
      isEditingTagsOnly: tagsOnly
    });
    setEditClusterName(cluster.name);
    setEditClusterDescription(cluster.description || '');
    setEditClusterCategory((cluster.category as 'vibe' | 'genre') || 'vibe');
    setEditClusterColor(cluster.color || getClusterColor(cluster));
    setEditClusterTags(cluster.tags || []);
    setTagSearch('');
  };

  const handleUpdateClusterColor = (clusterName: string, newColor: string) => {
    if (!user && !isDemoMode) return;
    const currentClusters = aiClusters 
      ? [...aiClusters] 
      : getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
    
    const nextClusters = currentClusters.map(c => {
      if (c.name === clusterName) {
        return { ...c, color: newColor };
      }
      return c;
    });

    setAiClusters(nextClusters);
    if (user) {
      try { localStorage.setItem(`sonic_vault_clusters_${user.uid}`, JSON.stringify(nextClusters)); } catch (e) {}
      saveUserSettings({ aiClusters: nextClusters });
    }
    setColorPickerCluster(null);
  };

  const handleSaveClusterEdit = () => {
    if ((!user && !isDemoMode) || !clusterEditTarget) return;
    if (!editClusterName.trim()) {
      alert("Please provide a name for the cluster.");
      return;
    }

    const updatedCluster: TagCluster = {
      name: editClusterName.trim(),
      description: editClusterDescription.trim(),
      category: editClusterCategory,
      color: editClusterColor,
      tags: editClusterTags.map(t => t.toLowerCase())
    };

    const currentClusters = aiClusters 
      ? [...aiClusters] 
      : getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
    let nextClusters: TagCluster[] = [];
    const isNew = !clusterEditTarget.originalName;

    if (isNew) {
      if (currentClusters.some(c => c.name.toLowerCase() === updatedCluster.name.toLowerCase())) {
        alert("A cluster with this name already exists.");
        return;
      }
      nextClusters = [...currentClusters, updatedCluster];
    } else {
      nextClusters = currentClusters.map(c => 
        c.name === clusterEditTarget.originalName ? updatedCluster : c
      );
    }

    setAiClusters(nextClusters);
    if (user) {
      try { localStorage.setItem(`sonic_vault_clusters_${user.uid}`, JSON.stringify(nextClusters)); } catch (e) {}
      saveUserSettings({ aiClusters: nextClusters });
    }
    setClusterEditTarget(null);
  };

  const handleDeleteClusterUnified = (name: string) => {
    if (!user) return;
    setConfirmModal({
      isOpen: true,
      title: "Delete Curation Cluster",
      message: `Are you sure you want to delete curation cluster "${name}"?`,
      confirmText: "Delete Cluster",
      variant: "danger",
      onConfirm: async () => {
        const currentClusters = aiClusters || getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
        const nextClusters = currentClusters.filter(c => c.name !== name);
        setAiClusters(nextClusters);
        try { localStorage.setItem(`sonic_vault_clusters_${user.uid}`, JSON.stringify(nextClusters)); } catch (e) {}
        saveUserSettings({ aiClusters: nextClusters });
      }
    });
  };

  const handleToggleClusterFiltering = (clusterTags: string[]) => {
    if (clusterTags.length === 0) return;
    const activeTagsInVault = clusterTags.filter(tag => tagCounts[tag] !== undefined);
    if (activeTagsInVault.length === 0) return;
    
    const allSelected = activeTagsInVault.every(tag => selectedTags.includes(tag));
    
    if (allSelected) {
      setSelectedTags(prev => prev.filter(tag => !activeTagsInVault.includes(tag)));
    } else {
      setSelectedTags(prev => {
        const next = [...prev];
        activeTagsInVault.forEach(tag => {
          if (!next.includes(tag)) {
            next.push(tag);
          }
        });
        return next;
      });
      setTagMatchStrategy('or');
    }
  };

  const handleStartEditTag = (tag: string) => {
    setTagToRename(tag);
    setNewTagName(tag);
    const currentClusters = aiClusters || getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
    const activeClusters = currentClusters
      .filter(c => c.tags.map(t => t.toLowerCase()).includes(tag.toLowerCase()))
      .map(c => c.name);
    setSelectedClustersForTag(activeClusters);
  };

  const handleRenameTag = async (oldTag: string, newTag: string) => {
    if (!newTag) {
      setTagToRename(null);
      return;
    }
    const cleanOldTag = oldTag.toLowerCase().trim();
    const cleanNewTag = newTag.toLowerCase().trim();
    
    try {
      // 1. Rename tag across items in Firestore if changed
      if (cleanOldTag !== cleanNewTag) {
        const targetItems = items.filter(i => i.tags.includes(oldTag));
        for (const item of targetItems) {
          const updatedTags = item.tags.map(t => t === oldTag ? cleanNewTag : t);
          const uniqueTags = Array.from(new Set(updatedTags));
          await safeUpdateDoc(item.id, {
            tags: uniqueTags,
            updatedAt: serverTimestamp()
          });
        }
      }

      // 2. Update clusters in localStorage and React state
      if (user) {
        const currentClusters = aiClusters || getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
        
        const nextClusters = currentClusters.map(cluster => {
          let clusterTags = (cluster.tags || []).map(t => t.toLowerCase());
          const shouldBeInCluster = selectedClustersForTag.includes(cluster.name);
          
          if (shouldBeInCluster) {
            // Remove old tag if present, add new tag
            clusterTags = clusterTags.filter(t => t !== cleanOldTag);
            clusterTags.push(cleanNewTag);
          } else {
            // Remove old tag
            clusterTags = clusterTags.filter(t => t !== cleanOldTag);
          }
          
          return {
            ...cluster,
            tags: Array.from(new Set(clusterTags))
          };
        });

        setAiClusters(nextClusters);
        try { localStorage.setItem(`sonic_vault_clusters_${user.uid}`, JSON.stringify(nextClusters)); } catch (e) {}
        saveUserSettings({ aiClusters: nextClusters });
      }

      setTagToRename(null);
      setNewTagName('');
      setSelectedClustersForTag([]);
    } catch (error) {
      console.error('Update tag and clusters failed', error);
      alert('Failed to update tag and clusters.');
    }
  };

  const handleDeleteTagGlobal = async (tag: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Tag Globally",
      message: `Are you sure you want to remove tag "#${tag}" from all items in your vault?`,
      confirmText: "Delete Tag",
      variant: "danger",
      onConfirm: async () => {
        const targetItems = items.filter(i => i.tags.includes(tag));
        try {
          for (const item of targetItems) {
            const updatedTags = item.tags.filter(t => t !== tag);
            await safeUpdateDoc(item.id, {
              tags: updatedTags,
              updatedAt: serverTimestamp()
            });
          }
          setSelectedTags(prev => prev.filter(t => t !== tag));
          setSelectedTagsForMgmt(prev => prev.filter(t => t !== tag.toLowerCase()));
        } catch (error) {
          console.error('Delete tag globally failed', error);
        }
      }
    });
  };

  const toggleTagForMgmt = (tag: string) => {
    const clean = tag.toLowerCase().trim();
    setSelectedTagsForMgmt(prev => 
      prev.includes(clean) ? prev.filter(t => t !== clean) : [...prev, clean]
    );
  };

  const handleBulkDeleteTagsGlobal = async () => {
    if (selectedTagsForMgmt.length === 0) return;
    const tagListStr = selectedTagsForMgmt.map(t => `#${t}`).join(', ');
    setConfirmModal({
      isOpen: true,
      title: "Delete Selected Tags",
      message: `Are you sure you want to delete ${selectedTagsForMgmt.length} selected tag(s) (${tagListStr}) from all items in your vault?`,
      confirmText: "Delete Tags",
      variant: "danger",
      onConfirm: async () => {
        try {
          const setOfTagsToDelete = new Set(selectedTagsForMgmt.map(t => t.toLowerCase()));
          const targetItems = items.filter(i => (i.tags || []).some(t => setOfTagsToDelete.has(t.toLowerCase())));

          for (const item of targetItems) {
            const updatedTags = (item.tags || []).filter(t => !setOfTagsToDelete.has(t.toLowerCase()));
            await safeUpdateDoc(item.id, {
              tags: updatedTags,
              updatedAt: serverTimestamp()
            });
          }

          if (user) {
            const currentClusters = aiClusters || getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
            const nextClusters = currentClusters.map(cluster => ({
              ...cluster,
              tags: (cluster.tags || []).filter(t => !setOfTagsToDelete.has(t.toLowerCase()))
            }));
            setAiClusters(nextClusters);
            try { localStorage.setItem(`sonic_vault_clusters_${user.uid}`, JSON.stringify(nextClusters)); } catch (e) {}
            saveUserSettings({ aiClusters: nextClusters });
          }

          setSelectedTags(prev => prev.filter(t => !setOfTagsToDelete.has(t.toLowerCase())));
          setSelectedTagsForMgmt([]);
        } catch (error) {
          console.error('Bulk delete tags failed', error);
        }
      }
    });
  };

  const handleBulkEditTagsSubmit = async () => {
    if (selectedTagsForMgmt.length === 0) return;
    const cleanNewName = bulkTagNewName.toLowerCase().trim();
    const setOfSelected = new Set(selectedTagsForMgmt.map(t => t.toLowerCase()));

    try {
      if (cleanNewName) {
        const targetItems = items.filter(i => (i.tags || []).some(t => setOfSelected.has(t.toLowerCase())));
        for (const item of targetItems) {
          let updated = (item.tags || []).map(t => setOfSelected.has(t.toLowerCase()) ? cleanNewName : t.toLowerCase());
          const uniqueTags = Array.from(new Set(updated));
          await safeUpdateDoc(item.id, {
            tags: uniqueTags,
            updatedAt: serverTimestamp()
          });
        }
      }

      if (user) {
        const targetTags = cleanNewName ? [cleanNewName] : Array.from(setOfSelected);
        const currentClusters = aiClusters || getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
        
        const nextClusters = currentClusters.map(cluster => {
          let clusterTags = (cluster.tags || []).map(t => t.toLowerCase());
          const shouldBeInCluster = bulkTagClusters.includes(cluster.name);

          if (shouldBeInCluster) {
            clusterTags = Array.from(new Set([...clusterTags, ...targetTags]));
          } else {
            clusterTags = clusterTags.filter(t => !setOfSelected.has(t) && (!cleanNewName || t !== cleanNewName));
          }

          return {
            ...cluster,
            tags: clusterTags
          };
        });

        setAiClusters(nextClusters);
        try { localStorage.setItem(`sonic_vault_clusters_${user.uid}`, JSON.stringify(nextClusters)); } catch (e) {}
        saveUserSettings({ aiClusters: nextClusters });
      }

      setBulkTagEditModalOpen(false);
      setSelectedTagsForMgmt([]);
      setBulkTagNewName('');
      setBulkTagClusters([]);
      alert('Selected tags updated successfully.');
    } catch (error) {
      console.error('Bulk edit tags failed', error);
      alert('An error occurred while editing selected tags.');
    }
  };

  const toggleSelection = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedIds.length === filteredItems.length && filteredItems.length > 0) {
      setSelectedIds([]);
    } else if (filteredItems.length > 0) {
      setSelectedIds(filteredItems.map(i => i.id));
    }
  };

  const updateItem = async (id: string, updates: Partial<MusicItem>) => {
    await safeUpdateDoc(id, updates);
  };

  const isLookingInto = (item: MusicItem): boolean => {
    if (!item || !item.tags || !Array.isArray(item.tags)) return false;
    return item.tags.some(t => {
      const clean = t.toLowerCase().trim().replace(/^#/, '');
      return clean === 'looking-into' || clean === 'lookinginto';
    });
  };

  const renderLookingIntoIcon = (isTagged: boolean) => {
    if (isTagged) {
      return <Search className="h-3.5 w-3.5 text-sky-400 fill-sky-400 drop-shadow-[0_0_6px_rgba(56,189,248,0.8)]" />;
    }
    return <Search className="h-3.5 w-3.5 text-white/70 hover:text-sky-400 stroke-[2]" />;
  };

  const handleToggleLookingInto = async (item: MusicItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const currentlyTagged = isLookingInto(item);
    let newTags: string[];
    if (currentlyTagged) {
      newTags = (item.tags || []).filter(t => {
        const clean = t.toLowerCase().trim().replace(/^#/, '');
        return clean !== 'looking-into' && clean !== 'lookinginto';
      });
    } else {
      newTags = [...(item.tags || []), 'looking-into'];
    }

    setItems(prev => prev.map(i => i.id === item.id ? { ...i, tags: newTags } : i));
    if (detailItem && detailItem.id === item.id) {
      setDetailItem(prev => prev ? { ...prev, tags: newTags } : null);
    }

    await updateItem(item.id, { tags: newTags });
  };

  const getStarLevel = (item: MusicItem): number => {
    if (item.favoriteLevel !== undefined && item.favoriteLevel !== null) {
      return item.favoriteLevel;
    }
    if (item.relevance === 95) return 4;
    if (item.relevance === 90) return 3;
    if (item.relevance === 80) return 2;
    if (item.relevance === 70) return 1;
    if (item.relevance && item.relevance >= 95) return 4;
    if (item.relevance && item.relevance >= 90) return 3;
    if (item.relevance && item.relevance >= 80) return 2;
    if (item.relevance && item.relevance >= 70) return 1;
    return 0;
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
      case 0:
      default:
        return <Star className="h-3.5 w-3.5 text-white/70 hover:text-white stroke-[2]" />;
    }
  };

  const isAllSelectedLookingInto = selectedIds.length > 0 && selectedIds.every(id => {
    const item = items.find(i => i.id === id);
    return item ? isLookingInto(item) : false;
  });

  const getStarTitle = (level: number) => {
    switch (level) {
      case 1: return "Yellow Favorite (Relevance: 70)";
      case 2: return "Green Favorite (Relevance: 80)";
      case 3: return "Red Favorite (Relevance: 90)";
      case 4: return "Purple Favorite (Relevance: 95)";
      default: return "Star Outline (Click to favorite)";
    }
  };

  const getBulkStarTitle = (level: number) => {
    switch (level) {
      case 1: return "Bulk Star: Yellow Favorite (Relevance 70) — Click to cycle";
      case 2: return "Bulk Star: Green Favorite (Relevance 80) — Click to cycle";
      case 3: return "Bulk Star: Red Favorite (Relevance 90) — Click to cycle";
      case 4: return "Bulk Star: Purple Favorite (Relevance 95) — Click to cycle";
      default: return "Bulk Star: Unstarred (Click to cycle favorite levels)";
    }
  };

  const handleBulkCycleFavorite = async () => {
    if (selectedIds.length === 0) return;
    const nextLevel = (bulkStarLevel + 1) % 5;
    setBulkStarLevel(nextLevel);

    let newRelevance = 0;
    if (nextLevel === 1) newRelevance = 70;
    else if (nextLevel === 2) newRelevance = 80;
    else if (nextLevel === 3) newRelevance = 90;
    else if (nextLevel === 4) newRelevance = 95;
    else newRelevance = 0;

    // Instant local state update
    setItems(prev => prev.map(item => 
      selectedIds.includes(item.id)
        ? { ...item, favoriteLevel: nextLevel, relevance: newRelevance }
        : item
    ));

    for (const id of selectedIds) {
      await safeUpdateDoc(id, {
        favoriteLevel: nextLevel,
        relevance: newRelevance,
        updatedAt: serverTimestamp()
      });
    }
  };

  const handleBulkToggleLookingInto = async () => {
    if (selectedIds.length === 0) return;
    const shouldRemove = isAllSelectedLookingInto;

    setItems(prev => prev.map(item => {
      if (!selectedIds.includes(item.id)) return item;
      let newTags: string[];
      if (shouldRemove) {
        newTags = (item.tags || []).filter(t => !['looking-into', 'lookinginto'].includes(t.toLowerCase().trim().replace(/^#/, '')));
      } else {
        newTags = Array.from(new Set([...(item.tags || []), 'looking-into']));
      }
      return { ...item, tags: newTags };
    }));

    for (const id of selectedIds) {
      const item = items.find(i => i.id === id);
      if (!item) continue;
      let newTags: string[];
      const newTagSources = { ...(item.tagSources || {}) };
      if (shouldRemove) {
        newTags = (item.tags || []).filter(t => !['looking-into', 'lookinginto'].includes(t.toLowerCase().trim().replace(/^#/, '')));
        delete newTagSources['looking-into'];
        delete newTagSources['lookinginto'];
      } else {
        newTags = Array.from(new Set([...(item.tags || []), 'looking-into']));
        newTagSources['looking-into'] = 'manual';
      }
      await safeUpdateDoc(id, {
        tags: newTags,
        tagSources: newTagSources,
        updatedAt: serverTimestamp()
      });
    }
  };

  const handleCycleFavoriteStar = async (item: MusicItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const currentLevel = getStarLevel(item);
    const nextLevel = (currentLevel + 1) % 5;

    let newRelevance = item.relevance || 0;
    if (nextLevel === 1) {
      newRelevance = 70;
    } else if (nextLevel === 2) {
      newRelevance = 80;
    } else if (nextLevel === 3) {
      newRelevance = 90;
    } else if (nextLevel === 4) {
      newRelevance = 95;
    } else {
      newRelevance = 0;
    }

    // Freeze item's sorting values at their baseline state before the star clicks started
    setSortOverrides(prev => {
      if (item.id in prev) return prev;
      return {
        ...prev,
        [item.id]: {
          relevance: item.relevance ?? 0,
          favoriteLevel: currentLevel,
        }
      };
    });

    // Reset 3-second timer so re-ordering is delayed until 3 seconds after the user's last star click
    if (starClickTimersRef.current[item.id]) {
      clearTimeout(starClickTimersRef.current[item.id]);
    }

    starClickTimersRef.current[item.id] = setTimeout(() => {
      setSortOverrides(prev => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      delete starClickTimersRef.current[item.id];
    }, 3000);

    await updateItem(item.id, {
      favoriteLevel: nextLevel,
      relevance: newRelevance,
    });
  };

  const deleteItem = async (id: string) => {
    if (confirm('Are you sure you want to delete this item?')) {
      await safeDeleteDoc(id);
    }
  };

  const exportData = (scope: 'all' | 'filtered' = 'all') => {
    setExportScope(scope);
    setIsExportModalOpen(true);
  };

  const handleDownloadExport = (format: 'json' | 'markdown', scope: 'all' | 'filtered') => {
    const targetItems = scope === 'filtered' 
      ? (selectedIds.length > 0 ? items.filter(i => selectedIds.includes(i.id)) : (filteredItems.length > 0 ? filteredItems : items))
      : items;
    const scopeLabel = scope === 'filtered' ? (selectedIds.length > 0 ? 'selected_items' : 'filtered_selection') : 'full_library';
    const timestamp = new Date().toISOString().slice(0, 10);
    
    if (format === 'json') {
      const jsonContent = formatExportJSON(targetItems, activeClusters);
      downloadFile(jsonContent, `sonic_vault_${scopeLabel}_${timestamp}.json`, 'application/json');
    } else {
      const scopeName = scope === 'filtered' ? (selectedIds.length > 0 ? `Selected Items (${targetItems.length} items)` : `Filtered Selection (${targetItems.length} items)`) : `Full Library (${targetItems.length} items)`;
      const mdContent = formatExportMarkdown(targetItems, activeClusters, scopeName);
      downloadFile(mdContent, `sonic_vault_${scopeLabel}_${timestamp}.md`, 'text/markdown');
    }
  };

  const handleCopyExport = async (format: 'json' | 'markdown', scope: 'all' | 'filtered') => {
    const targetItems = scope === 'filtered' 
      ? (selectedIds.length > 0 ? items.filter(i => selectedIds.includes(i.id)) : (filteredItems.length > 0 ? filteredItems : items))
      : items;
    let content = '';
    if (format === 'json') {
      content = formatExportJSON(targetItems, activeClusters);
    } else {
      const scopeName = scope === 'filtered' ? (selectedIds.length > 0 ? `Selected Items (${targetItems.length} items)` : `Filtered Selection (${targetItems.length} items)`) : `Full Library (${targetItems.length} items)`;
      content = formatExportMarkdown(targetItems, activeClusters, scopeName);
    }
    try {
      await navigator.clipboard.writeText(content);
      setCopiedExport(true);
      setTimeout(() => setCopiedExport(false), 2500);
    } catch (e) {
      console.error('Clipboard copy failed', e);
    }
  };

  const handleExportSingleItem = (item: MusicItem, format: 'json' | 'markdown') => {
    const timestamp = new Date().toISOString().slice(0, 10);
    const sanitizedName = (item.name || 'item').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 30);
    if (format === 'json') {
      const jsonContent = formatExportJSON([item], activeClusters);
      downloadFile(jsonContent, `${sanitizedName}_${item.type}_${timestamp}.json`, 'application/json');
    } else {
      const mdContent = formatExportMarkdown([item], activeClusters, `Item: ${item.name} (${item.type})`);
      downloadFile(mdContent, `${sanitizedName}_${item.type}_${timestamp}.md`, 'text/markdown');
    }
  };

  const handleCopySingleItemMarkdown = async (item: MusicItem) => {
    const mdContent = formatExportMarkdown([item], activeClusters, `Item: ${item.name} (${item.type})`);
    try {
      await navigator.clipboard.writeText(mdContent);
      setSingleItemCopied(true);
      setTimeout(() => setSingleItemCopied(false), 2500);
    } catch (e) {
      console.error('Single item copy failed', e);
    }
  };

  const tagCounts = items.reduce((acc, item) => {
    (item.tags || []).forEach(tag => {
      const lower = tag.toLowerCase();
      acc[lower] = (acc[lower] || 0) + 1;
    });
    return acc;
  }, {} as Record<string, number>);

  const allTags = Object.keys(tagCounts).sort((a, b) => {
    if (tagSortField === 'alphabetical') {
      const res = a.localeCompare(b);
      return tagSortDirection === 'asc' ? res : -res;
    } else {
      const res = tagCounts[a] - tagCounts[b];
      if (res === 0) return a.localeCompare(b);
      return tagSortDirection === 'asc' ? res : -res;
    }
  });

  const activeClusters = React.useMemo(() => {
    const clusters = aiClusters || getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
    const mappedTagsSet = new Set<string>();
    clusters.forEach(c => {
      (c.tags || []).forEach(t => mappedTagsSet.add(t.toLowerCase()));
    });
    const uncategorizedTags = allTags.filter(tag => !mappedTagsSet.has(tag.toLowerCase()));
    const display = [...clusters];
    if (uncategorizedTags.length > 0) {
      display.push({
        name: "Other Curation Tags",
        description: "Uncategorized custom hashtags and niche descriptors in your music vault",
        tags: uncategorizedTags,
        category: "genre",
      });
    }
    return display;
  }, [aiClusters, allTags]);
  
  const getItemScrobbleCount = (item: MusicItem, timeframe?: string): number => {
    if (timeframe && timeframe !== 'overall' && item.lastFmPeriodPlaycount !== undefined && item.lastFmPeriod === timeframe) {
      return item.lastFmPeriodPlaycount;
    }
    return item.lastFmPlaycount ?? item.lastFmPeriodPlaycount ?? 0;
  };

  const scrobbleRankMap = useMemo(() => {
    const map: Record<string, number> = {};
    const types: ItemType[] = ['artist', 'album', 'track', 'playlist'];
    
    types.forEach(type => {
      const typeItems = items.filter(i => i.type === type);
      const sorted = [...typeItems].sort((a, b) => {
        const scrobblesA = getItemScrobbleCount(a, filters.timeframe);
        const scrobblesB = getItemScrobbleCount(b, filters.timeframe);
        if (scrobblesA !== scrobblesB) {
          return scrobblesB - scrobblesA; // Higher scrobbles = better rank (1, 2, 3...)
        }
        if (a.rank !== undefined && b.rank !== undefined && a.rank !== b.rank) {
          return a.rank - b.rank;
        }
        const famA = a.familiarity ?? 0;
        const famB = b.familiarity ?? 0;
        if (famA !== famB) return famB - famA;
        const ratA = a.rating ?? 0;
        const ratB = b.rating ?? 0;
        if (ratA !== ratB) return ratB - ratA;
        return (a.name || '').localeCompare(b.name || '');
      });

      sorted.forEach((item, idx) => {
        map[item.id] = idx + 1;
      });
    });

    return map;
  }, [items, filters.timeframe]);

  const filteredItems = items.filter(item => {
    const matchesType = activeTab === 'all' || item.type === activeTab;
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (item.parentName?.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          (item.creator?.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesTags = selectedTags.length === 0 || (
      tagMatchStrategy === 'and'
        ? selectedTags.every(t => item.tags.map(tag => tag.toLowerCase()).includes(t.toLowerCase()))
        : selectedTags.some(t => item.tags.map(tag => tag.toLowerCase()).includes(t.toLowerCase()))
    );
    
    // Song Range
    let matchesSongs = true;
    if (filters.songRange !== 'all' && item.type === 'playlist') {
      const count = item.songCount || 0;
      if (filters.songRange === '1-10') matchesSongs = count >= 1 && count <= 10;
      else if (filters.songRange === '10-25') matchesSongs = count > 10 && count <= 25;
      else if (filters.songRange === '25-50') matchesSongs = count > 25 && count <= 50;
      else if (filters.songRange === '50-100') matchesSongs = count > 50 && count <= 100;
      else if (filters.songRange === '100+') matchesSongs = count > 100;
    }

    // Length Range
    let matchesLength = true;
    if (filters.lengthRange !== 'all' && item.type === 'playlist') {
      const sec = item.durationSeconds || 0;
      if (filters.lengthRange === '0-15m') matchesLength = sec <= 900;
      else if (filters.lengthRange === '15-30m') matchesLength = sec > 900 && sec <= 1800;
      else if (filters.lengthRange === '30-60m') matchesLength = sec > 1800 && sec <= 3600;
      else if (filters.lengthRange === '1h-2h') matchesLength = sec > 3600 && sec <= 7200;
      else if (filters.lengthRange === '2h-4h') matchesLength = sec > 7200 && sec <= 14400;
      else if (filters.lengthRange === '4h-8h') matchesLength = sec > 14400 && sec <= 28800;
      else if (filters.lengthRange === '8h-16h') matchesLength = sec > 28800 && sec <= 57600;
      else if (filters.lengthRange === '16h+') matchesLength = sec > 57600;
    }

    // Relevance
    let matchesRelevance = true;
    if (filters.relevanceRange !== 'all' && item.type === 'playlist') {
      const rel = item.relevance || 0;
      if (filters.relevanceRange === '0-49') matchesRelevance = rel <= 49;
      else if (filters.relevanceRange === '50-59') matchesRelevance = rel >= 50 && rel <= 59;
      else if (filters.relevanceRange === '60-69') matchesRelevance = rel >= 60 && rel <= 69;
      else if (filters.relevanceRange === '70-74') matchesRelevance = rel >= 70 && rel <= 74;
      else if (filters.relevanceRange === '75-79') matchesRelevance = rel >= 75 && rel <= 79;
      else if (filters.relevanceRange === '80-84') matchesRelevance = rel >= 80 && rel <= 84;
      else if (filters.relevanceRange === '85-89') matchesRelevance = rel >= 85 && rel <= 89;
      else if (filters.relevanceRange === '90-94') matchesRelevance = rel >= 90 && rel <= 94;
      else if (filters.relevanceRange === '95-100') matchesRelevance = rel >= 95 && rel <= 100;
    }

    // Familiarity
    let matchesFamiliarity = true;
    if (filters.familiarityRange !== 'all') {
      const fam = item.familiarity || 0;
      if (filters.familiarityRange === '0-49') matchesFamiliarity = fam <= 49;
      else if (filters.familiarityRange === '50-59') matchesFamiliarity = fam >= 50 && fam <= 59;
      else if (filters.familiarityRange === '60-69') matchesFamiliarity = fam >= 60 && fam <= 69;
      else if (filters.familiarityRange === '70-74') matchesFamiliarity = fam >= 70 && fam <= 74;
      else if (filters.familiarityRange === '75-79') matchesFamiliarity = fam >= 75 && fam <= 79;
      else if (filters.familiarityRange === '80-84') matchesFamiliarity = fam >= 80 && fam <= 84;
      else if (filters.familiarityRange === '85-89') matchesFamiliarity = fam >= 85 && fam <= 89;
      else if (filters.familiarityRange === '90-94') matchesFamiliarity = fam >= 90 && fam <= 94;
      else if (filters.familiarityRange === '95-100') matchesFamiliarity = fam >= 95 && fam <= 100;
    }

    // Creator filter
    const matchesCreator = filters.creator === 'all' || item.creator === filters.creator;

    // Last.fm Timeframe filter for Artists and Tracks
    let matchesTimeframe = true;
    if (filters.timeframe && filters.timeframe !== 'overall' && (activeTab === 'artist' || activeTab === 'track')) {
      matchesTimeframe = item.lastFmPeriod === filters.timeframe;
    }

    return matchesType && matchesSearch && matchesTags && matchesSongs && matchesLength && matchesRelevance && matchesFamiliarity && matchesCreator && matchesTimeframe;
  }).sort((a, b) => {
    // Low priority tag check: Items containing any low-priority tag are automatically placed at the bottom
    const countLowPriority = (item: MusicItem) => {
      if (!item.tags || item.tags.length === 0) return 0;
      return item.tags.filter(t => lowPriorityTags.includes(t.toLowerCase())).length;
    };

    const lowA = countLowPriority(a) > 0 ? 1 : 0;
    const lowB = countLowPriority(b) > 0 ? 1 : 0;

    if (lowA !== lowB) {
      return lowA - lowB; // Items without low priority tags come first (0), low priority items come last (1)
    }

    // Tier priority calculation for Favorited & #looking-into (when prioritizeStarSearchFirst is enabled):
    // Tier 1: Favorited AND tagged #looking-into (shows first of all)
    // Tier 2: Favorited without #looking-into
    // Tier 3: Not favorited BUT tagged #looking-into (shows right below favorites)
    // Tier 4: Neither favorited nor tagged #looking-into
    if (prioritizeStarSearchFirst) {
      const getItemTier = (item: MusicItem) => {
        let starLvl = getStarLevel(item);
        if (item.id in sortOverrides && sortOverrides[item.id].favoriteLevel !== undefined) {
          starLvl = sortOverrides[item.id].favoriteLevel;
        }
        const isFav = starLvl > 0;
        const isLook = isLookingInto(item);

        if (isFav && isLook) return 1;
        if (isFav && !isLook) return 2;
        if (!isFav && isLook) return 3;
        return 4;
      };

      const tierA = getItemTier(a);
      const tierB = getItemTier(b);

      if (tierA !== tierB) {
        return tierA - tierB;
      }
    }

    // Always sort by relevance score first when filtering or selecting tags / search / filters
    const isFilteringActive = selectedTags.length > 0 || searchQuery.trim() !== '' || activeTab !== 'all' || filters.songRange !== 'all' || filters.lengthRange !== 'all' || filters.relevanceRange !== 'all' || filters.familiarityRange !== 'all' || filters.creator !== 'all';

    const activeSortConfigs = isFilteringActive
      ? [{ field: 'relevance', direction: 'desc' as const }, ...sortConfigs.filter(c => c.field !== 'relevance')]
      : sortConfigs;

    for (const config of activeSortConfigs) {
      let valA: any = a[config.field as keyof MusicItem];
      let valB: any = b[config.field as keyof MusicItem];

      if (config.field === 'lastFmPlaycount') {
        valA = getItemScrobbleCount(a, filters.timeframe);
        valB = getItemScrobbleCount(b, filters.timeframe);
      } else if (config.field === 'relevance' && a.id in sortOverrides) {
        valA = sortOverrides[a.id].relevance;
      } else if (config.field === 'relevance' && b.id in sortOverrides) {
        valB = sortOverrides[b.id].relevance;
      } else if (config.field === 'favoriteLevel' && a.id in sortOverrides) {
        valA = sortOverrides[a.id].favoriteLevel;
      } else if (config.field === 'favoriteLevel' && b.id in sortOverrides) {
        valB = sortOverrides[b.id].favoriteLevel;
      }

      if (valA === undefined || valA === null) valA = typeof valB === 'number' ? 0 : '';
      if (valB === undefined || valB === null) valB = typeof valA === 'number' ? 0 : '';

      // Handle numbers
      if (typeof valA === 'number' && typeof valB === 'number') {
        if (valA < valB) return config.direction === 'asc' ? -1 : 1;
        if (valA > valB) return config.direction === 'asc' ? 1 : -1;
      } else if (typeof valA === 'string' && typeof valB === 'string') {
        const res = valA.localeCompare(valB);
        if (res !== 0) return config.direction === 'asc' ? res : -res;
      }
    }
    return 0;
  });

  const allCreators = Array.from(new Set(items.filter(i => i.type === 'playlist' && i.creator).map(i => i.creator as string))).sort();

  const toggleSort = (field: string) => {
    setSortConfigs(prev => {
      const existing = prev.find(c => c.field === field);
      if (existing) {
        if (existing.direction === 'desc') {
          return prev.map(c => c.field === field ? { ...c, direction: 'asc' } : c);
        } else {
          return prev.filter(c => c.field !== field);
        }
      } else {
        const defaultDesc = ['lastFmPlaycount', 'relevance', 'familiarity', 'songCount', 'createdAt', 'rating'].includes(field);
        return [...prev, { field, direction: defaultDesc ? 'desc' : 'asc' }];
      }
    });
  };

  const getSortIcon = (field: string) => {
    const config = sortConfigs.find(c => c.field === field);
    if (!config) return null;
    return config.direction === 'asc' ? '↑' : '↓';
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-brand-bg">
      <div className="h-10 w-10 border-4 border-brand-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!user) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-brand-bg text-center">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full space-y-6"
      >
        <div className="h-20 w-20 bg-brand-accent/20 rounded-3xl flex items-center justify-center mx-auto mb-2">
          <AudioWaveform className="h-10 w-10 text-brand-accent" />
        </div>
        <h1 className="text-5xl font-bold tracking-tight">Sonic Vault</h1>
        <p className="text-brand-muted text-lg">
          A sophisticated music curation metadata vault. Organize your artists, albums, and playlists with surgical precision.
        </p>

        {connectionError && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-xl text-sm text-left">
            Connection error. Please check your Firebase configuration or network.
          </div>
        )}

        {authError && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm text-left space-y-2">
            <div className="font-semibold text-red-300">Authentication Alert</div>
            <p className="text-xs break-words">{authError}</p>
            {authError.includes('unauthorized') && (
              <div className="text-xs text-brand-muted mt-2 pt-2 border-t border-red-500/20">
                <span className="font-semibold text-white">Fix:</span> In Firebase Console &gt; Authentication &gt; Settings &gt; Authorized Domains, add:
                <code className="block mt-1 p-2 bg-black/40 rounded text-amber-300 select-all font-mono text-[11px] break-all">
                  {window.location.hostname}
                </code>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3 pt-2">
          <Button 
            onClick={handleLogin} 
            disabled={isSigningIn}
            className="w-full py-4 text-lg flex items-center justify-center gap-2"
          >
            {isSigningIn ? (
              <RefreshCw className="h-5 w-5 animate-spin" />
            ) : (
              <UserIcon className="h-5 w-5" />
            )}
            Sign In with Google (Popup)
          </Button>

          <Button 
            variant="secondary"
            onClick={handleRedirectLogin} 
            disabled={isSigningIn}
            className="w-full py-3 text-sm flex items-center justify-center gap-2"
          >
            Sign In with Google (Redirect)
          </Button>

          <div className="pt-3 border-t border-white/10 my-2">
            <button
              onClick={handleEnterDemoMode}
              className="w-full py-3 px-4 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 group shadow-lg shadow-emerald-950/20"
            >
              <Sparkles className="h-4 w-4 text-emerald-400 group-hover:scale-110 transition-transform" />
              <span>Explore Interactive Demo Sandbox</span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold ml-auto">No login required</span>
            </button>
            <p className="text-[11px] text-brand-muted mt-1.5 text-center">
              Play with full curation features in an isolated sandbox. Changes will not save to any real database.
            </p>
          </div>

          {window.self !== window.top && (
            <button
              onClick={() => window.open(window.location.href, '_blank')}
              className="text-xs text-brand-muted hover:text-brand-accent flex items-center justify-center gap-1.5 mx-auto pt-2 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Having trouble in preview iframe? Open app in new tab
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );

  const emailUnverified = user && !user.emailVerified;

  return (
    <div className={cn("min-h-screen bg-brand-bg pb-24 md:pb-6 flex flex-col transition-colors duration-200", `tab-theme-${activeTab}`)}>
      {/* Verification Warning */}
      {emailUnverified && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-orange-500 text-white text-center py-2 text-sm font-bold">
          Please verify your email to enable saving changes to your vault.
        </div>
      )}

      <div className="flex-1 flex">
      {/* Sidebar - Desktop */}
      <aside 
        className={cn(
          "hidden md:flex flex-col border-r border-brand-border sticky top-0 h-screen transition-all duration-300 z-30 shrink-0",
          isSidebarCollapsed ? "w-20 p-3 items-center" : "w-64 p-6 space-y-8"
        )}
      >
        <div className={cn("flex items-center w-full", isSidebarCollapsed ? "flex-col gap-4 justify-center" : "justify-between gap-3")}>
          <div className={cn("flex items-center gap-3", isSidebarCollapsed && "justify-center")}>
            <div className="h-8 w-8 bg-brand-accent rounded-lg flex items-center justify-center shrink-0">
              <AudioWaveform className="h-5 w-5 text-white" />
            </div>
            {!isSidebarCollapsed && (
              <span className="font-bold text-xl tracking-tight whitespace-nowrap overflow-hidden">Sonic Vault</span>
            )}
          </div>
          <button
            type="button"
            onClick={toggleSidebar}
            title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            className="p-1.5 rounded-lg text-brand-muted hover:text-brand-text hover:bg-brand-card transition-colors flex items-center justify-center shrink-0"
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
        </div>

        <nav className={cn("flex-1 space-y-2 w-full", isSidebarCollapsed && "mt-6")}>
          {[
            { id: 'all', label: 'All Library', icon: Library },
            { id: 'artist', label: 'Artists', icon: UserIcon },
            { id: 'album', label: 'Albums', icon: Disc },
            { id: 'playlist', label: 'Playlists', icon: ListMusic },
            { id: 'track', label: 'Tracks', icon: Music },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              title={isSidebarCollapsed ? tab.label : undefined}
              className={cn(
                'w-full flex items-center rounded-xl transition-all',
                isSidebarCollapsed ? 'justify-center p-3' : 'gap-3 px-4 py-3',
                activeTab === tab.id ? 'bg-brand-accent text-white' : 'text-brand-muted hover:bg-brand-card hover:text-brand-text'
              )}
            >
              <tab.icon className="h-5 w-5 shrink-0" />
              {!isSidebarCollapsed && <span className="font-medium whitespace-nowrap">{tab.label}</span>}
            </button>
          ))}
        </nav>

        <div className={cn("border-t border-brand-border space-y-2 w-full", isSidebarCollapsed ? "pt-4" : "pt-6")}>
          <button 
            onClick={() => setIsLastFmModalOpen(true)} 
            title={isSidebarCollapsed ? (lastFmSettings?.username ? `Last.fm (@${lastFmSettings.username})` : "Last.fm Sync") : undefined}
            className={cn(
              "w-full flex items-center text-brand-muted hover:text-red-400 transition-colors relative",
              isSidebarCollapsed ? "justify-center p-3 rounded-xl hover:bg-brand-card" : "gap-3 px-4 py-3"
            )}
          >
            <Radio className="h-5 w-5 shrink-0 text-red-500" />
            {!isSidebarCollapsed && (
              <div className="flex items-center justify-between w-full min-w-0">
                <span className="truncate">Last.fm Sync</span>
                {lastFmSettings?.username ? (
                  <span className="h-2 w-2 rounded-full bg-red-400 shrink-0" title={`Connected as @${lastFmSettings.username}`} />
                ) : null}
              </div>
            )}
          </button>
          <button 
            onClick={() => exportData('all')} 
            title={isSidebarCollapsed ? "Export Data" : undefined}
            className={cn(
              "w-full flex items-center text-brand-muted hover:text-brand-text transition-colors",
              isSidebarCollapsed ? "justify-center p-3 rounded-xl hover:bg-brand-card" : "gap-3 px-4 py-3"
            )}
          >
            <Download className="h-5 w-5 shrink-0" />
            {!isSidebarCollapsed && <span>Export Data</span>}
          </button>
          {user && !isDemoMode && (
            <button 
              onClick={() => setShowPublishDemoModal(true)} 
              title={isSidebarCollapsed ? "Publish Public Demo Snapshot" : undefined}
              className={cn(
                "w-full flex items-center text-emerald-400 hover:text-emerald-300 transition-colors",
                isSidebarCollapsed ? "justify-center p-3 rounded-xl hover:bg-brand-card" : "gap-3 px-4 py-3"
              )}
            >
              <Globe className="h-5 w-5 shrink-0 text-emerald-400" />
              {!isSidebarCollapsed && <span>Publish Public Demo</span>}
            </button>
          )}
          <button 
            onClick={handleLogout} 
            title={isSidebarCollapsed ? (isDemoMode ? "Exit Demo" : "Sign Out") : undefined}
            className={cn(
              "w-full flex items-center text-brand-muted hover:text-red-400 transition-colors",
              isSidebarCollapsed ? "justify-center p-3 rounded-xl hover:bg-brand-card" : "gap-3 px-4 py-3"
            )}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!isSidebarCollapsed && <span>{isDemoMode ? "Exit Demo" : "Sign Out"}</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Navigation */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 md:hidden flex"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-72 bg-brand-bg border-r border-brand-border p-6 flex flex-col h-full space-y-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 bg-brand-accent rounded-lg flex items-center justify-center">
                    <AudioWaveform className="h-5 w-5 text-white" />
                  </div>
                  <span className="font-bold text-xl tracking-tight">Sonic Vault</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg text-brand-muted hover:text-brand-text hover:bg-brand-card"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <nav className="flex-1 space-y-2">
                {[
                  { id: 'all', label: 'All Library', icon: Library },
                  { id: 'artist', label: 'Artists', icon: UserIcon },
                  { id: 'album', label: 'Albums', icon: Disc },
                  { id: 'playlist', label: 'Playlists', icon: ListMusic },
                  { id: 'track', label: 'Tracks', icon: Music },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id as any);
                      setIsMobileMenuOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all',
                      activeTab === tab.id ? 'bg-brand-accent text-white' : 'text-brand-muted hover:bg-brand-card hover:text-brand-text'
                    )}
                  >
                    <tab.icon className="h-5 w-5" />
                    <span className="font-medium">{tab.label}</span>
                  </button>
                ))}
              </nav>

              <div className="pt-6 border-t border-brand-border space-y-2">
                <button 
                  onClick={() => { setIsLastFmModalOpen(true); setIsMobileMenuOpen(false); }} 
                  className="w-full flex items-center gap-3 px-4 py-3 text-brand-muted hover:text-red-400 transition-colors"
                >
                  <Radio className="h-5 w-5 text-red-500" />
                  <span>Last.fm Sync {lastFmSettings?.username ? `(@${lastFmSettings.username})` : ''}</span>
                </button>
                <button 
                  onClick={() => { exportData(); setIsMobileMenuOpen(false); }} 
                  className="w-full flex items-center gap-3 px-4 py-3 text-brand-muted hover:text-brand-text transition-colors"
                >
                  <Download className="h-5 w-5" />
                  <span>Export Data</span>
                </button>
                <button 
                  onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }} 
                  className="w-full flex items-center gap-3 px-4 py-3 text-brand-muted hover:text-red-400 transition-colors"
                >
                  <LogOut className="h-5 w-5" />
                  <span>{isDemoMode ? "Exit Demo" : "Sign Out"}</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10 max-w-6xl mx-auto w-full">
        {/* Mobile Header Bar */}
        <div className="md:hidden flex items-center justify-between mb-6 pb-4 border-b border-brand-border">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-brand-accent rounded-lg flex items-center justify-center">
              <AudioWaveform className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">Sonic Vault</span>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 rounded-xl bg-brand-card border border-brand-border text-brand-text hover:bg-brand-accent hover:text-white transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
        <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <h2 className="text-3xl font-bold flex items-center flex-wrap gap-2.5">
              <span>
                {activeTab === 'artist' ? 'Artists' :
                 activeTab === 'album' ? 'Albums' :
                 activeTab === 'playlist' ? 'Playlists' :
                 activeTab === 'track' ? 'Tracks' :
                 'Your Library'}
              </span>
              {selectedTags.length > 0 && (
                <span className="text-xs font-bold font-mono bg-brand-accent/20 border border-brand-accent/40 text-brand-accent px-2.5 py-1 rounded-lg self-center animate-pulse">
                  {filteredItems.length} of {items.length} items shown
                </span>
              )}
            </h2>
            <p className="text-brand-muted">Curation & Metadata Control</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Visualization Mode Switcher Icons */}
            <div className="flex items-center bg-brand-card/90 border border-brand-border p-1 rounded-xl gap-1 shadow-sm">
              <button
                type="button"
                onClick={() => {
                  setItemViewMode('cards');
                  try { localStorage.setItem('sonic_vault_item_view_mode', 'cards'); } catch(e){}
                }}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
                  itemViewMode === 'cards'
                    ? "bg-brand-accent text-white shadow-sm font-bold"
                    : "text-brand-muted hover:text-brand-text hover:bg-brand-bg/60"
                )}
                title="Cards View"
              >
                <LayoutGrid className="h-4 w-4" />
                <span className="hidden sm:inline">Cards</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setItemViewMode('small-cards');
                  try { localStorage.setItem('sonic_vault_item_view_mode', 'small-cards'); } catch(e){}
                }}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
                  itemViewMode === 'small-cards'
                    ? "bg-brand-accent text-white shadow-sm font-bold"
                    : "text-brand-muted hover:text-brand-text hover:bg-brand-bg/60"
                )}
                title="Small Cards View (30% cover size)"
              >
                <Grid3x3 className="h-4 w-4" />
                <span className="hidden sm:inline">Small Cards</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setItemViewMode('list');
                  try { localStorage.setItem('sonic_vault_item_view_mode', 'list'); } catch(e){}
                }}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer",
                  itemViewMode === 'list'
                    ? "bg-brand-accent text-white shadow-sm font-bold"
                    : "text-brand-muted hover:text-brand-text hover:bg-brand-bg/60"
                )}
                title="List View"
              >
                <LayoutList className="h-4 w-4" />
                <span className="hidden sm:inline">List</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsLastFmModalOpen(true)}
              className="px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
              title="Sync & enrich playcount, tags, and music metadata with Last.fm"
            >
              <Radio className="h-4 w-4 text-red-500 shrink-0" />
              <span>Last.fm</span>
              {lastFmSettings?.username && (
                <span className="hidden lg:inline text-[10px] font-mono opacity-80 max-w-[80px] truncate">@{lastFmSettings.username}</span>
              )}
            </button>

            <Button onClick={() => setImportModalOpen(true)} className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              <span>Import Links</span>
            </Button>
          </div>
        </header>

        {/* Search & Tags */}
        <section className="mb-8 space-y-4">
          {/* Sort & Select All Section */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold text-brand-muted uppercase tracking-widest mr-2">Sort By</span>
              {[
                { label: 'Alphabetical', field: 'name' },
                { label: 'Scrobbles', field: 'lastFmPlaycount' },
                { label: 'Relevance', field: 'relevance' },
                { label: 'Familiarity', field: 'familiarity' },
                { label: 'Length', field: 'durationSeconds' },
                { label: 'Songs', field: 'songCount' },
                { label: 'Created', field: 'createdAt' }
              ].map(opt => (
                <button
                  key={opt.field}
                  onClick={() => toggleSort(opt.field)}
                  className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight transition-all border",
                    sortConfigs.some(c => c.field === opt.field)
                      ? "bg-brand-accent border-brand-accent text-white"
                      : "bg-brand-card border-brand-border text-brand-muted hover:text-brand-text hover:border-brand-text/30"
                  )}
                >
                  {opt.label} {getSortIcon(opt.field)}
                </button>
              ))}
              {sortConfigs.length > 1 && (
                <button 
                  onClick={() => setSortConfigs([{ field: 'createdAt', direction: 'desc' }])}
                  className="text-[10px] text-brand-muted hover:text-brand-text underline px-2"
                >
                  Reset Sort
                </button>
              )}
            </div>

            <Button 
              variant="secondary" 
              onClick={selectAll}
              className="w-full sm:w-auto text-xs py-1.5 px-4 h-auto flex items-center gap-2"
            >
              {selectedIds.length === filteredItems.length && filteredItems.length > 0 ? (
                <><X className="h-3 w-3" /> Deselect All</>
              ) : (
                <><CheckSquare className="h-3 w-3" /> Select All Filtered</>
              )}
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name, artist, album, creator..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-brand-card border border-brand-border rounded-xl py-2 pl-9 pr-4 focus:border-brand-accent outline-none transition-all text-sm"
            />
          </div>

          {/* Range Filters for Playlists */}
          {activeTab === 'playlist' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider ml-1">Songs</label>
                <select 
                  value={filters.songRange}
                  onChange={(e) => setFilters(prev => ({ ...prev, songRange: e.target.value }))}
                  className="w-full bg-brand-card border border-brand-border rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-accent appearance-none transition-colors"
                >
                  <option value="all">Any #</option>
                  <option value="1-10">1-10</option>
                  <option value="10-25">10-25</option>
                  <option value="25-50">25-50</option>
                  <option value="50-100">50-100</option>
                  <option value="100+">100+</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider ml-1">Length</label>
                <select 
                  value={filters.lengthRange}
                  onChange={(e) => setFilters(prev => ({ ...prev, lengthRange: e.target.value }))}
                  className="w-full bg-brand-card border border-brand-border rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-accent appearance-none transition-colors"
                >
                  <option value="all">Any length</option>
                  <option value="0-15m">0-15m</option>
                  <option value="15-30m">15-30m</option>
                  <option value="30-60m">30-60m</option>
                  <option value="1h-2h">1h-2h</option>
                  <option value="2h-4h">2h-4h</option>
                  <option value="4h-8h">4h-8h</option>
                  <option value="8h-16h">8h-16h</option>
                  <option value="16h+">16h+</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider ml-1">Relevance</label>
                <select 
                  value={filters.relevanceRange}
                  onChange={(e) => setFilters(prev => ({ ...prev, relevanceRange: e.target.value }))}
                  className="w-full bg-brand-card border border-brand-border rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-accent appearance-none transition-colors"
                >
                  <option value="all">Any rel.</option>
                  <option value="0-49">0-49</option>
                  <option value="50-59">50-59</option>
                  <option value="60-69">60-69</option>
                  <option value="70-74">70-74</option>
                  <option value="75-79">75-79</option>
                  <option value="80-84">80-84</option>
                  <option value="85-89">85-89</option>
                  <option value="90-94">90-94</option>
                  <option value="95-100">95-100</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider ml-1">Familiarity</label>
                <select 
                  value={filters.familiarityRange}
                  onChange={(e) => setFilters(prev => ({ ...prev, familiarityRange: e.target.value }))}
                  className="w-full bg-brand-card border border-brand-border rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-accent appearance-none transition-colors"
                >
                  <option value="all">Any fam.</option>
                  <option value="0-49">0-49</option>
                  <option value="50-59">50-59</option>
                  <option value="60-69">60-69</option>
                  <option value="70-74">70-74</option>
                  <option value="75-79">75-79</option>
                  <option value="80-84">80-84</option>
                  <option value="85-89">85-89</option>
                  <option value="90-94">90-94</option>
                  <option value="95-100">95-100</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider ml-1">Creator</label>
                <select 
                  value={filters.creator}
                  onChange={(e) => setFilters(prev => ({ ...prev, creator: e.target.value }))}
                  className="w-full bg-brand-card border border-brand-border rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-accent appearance-none transition-colors"
                >
                  <option value="all">All Creators</option>
                  {allCreators.map(creator => (
                    <option key={creator} value={creator}>{creator}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {items.some(i => i.type === activeTab && !i.aiAnalyzed) && selectedIds.length === 0 && (
            <div className="flex items-center justify-between p-4 bg-orange-500/10 border border-orange-500/20 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
                <span className="text-sm font-medium text-orange-500">
                  {items.filter(i => i.type === activeTab && !i.aiAnalyzed).length} {activeTab}s pending analysis
                </span>
              </div>
              <Button 
                onClick={handleBatchAnalyze} 
                className="py-1.5 px-4 text-xs font-bold bg-orange-500 text-white"
                disabled={isAnalyzing}
              >
                {isAnalyzing ? "Analyzing Vault..." : "Analyze Pending Items"}
              </Button>
            </div>
          )}

          {/* Bulk Actions Bar */}
          <AnimatePresence>
            {selectedIds.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="flex flex-col sm:flex-row items-center justify-between p-4 bg-brand-accent text-white rounded-2xl shadow-2xl gap-4 sticky top-4 z-40 transition-all border border-white/20"
              >
                <div className="flex items-center gap-4">
                  <button 
                    onClick={selectAll}
                    className="h-6 w-6 rounded-md border-2 border-white/50 flex items-center justify-center hover:bg-white/10 transition-colors"
                  >
                    {selectedIds.length === filteredItems.length ? <CheckSquare className="h-4 w-4" /> : <div className="h-2 w-2 bg-white/50 rounded-sm" />}
                  </button>
                  <div>
                    <span className="font-bold">{selectedIds.length}</span>
                    <span className="text-sm opacity-80 ml-1.5">Selected Items</span>
                  </div>
                  <button 
                    onClick={() => setSelectedIds([])}
                    className="text-xs opacity-70 hover:opacity-100 hover:underline px-2 border-l border-white/20"
                  >
                    Deselect All
                  </button>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar pb-1 sm:pb-0">
                  {/* Bulk Favorite Multi-Click & Bulk #looking-into (To the left of Bulk Edit) */}
                  <button 
                    type="button"
                    onClick={handleBulkCycleFavorite}
                    title={getBulkStarTitle(bulkStarLevel)}
                    className="h-8 w-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center shrink-0 transition-all border border-white/25 cursor-pointer shadow-sm active:scale-95"
                  >
                    {renderStarIcon(bulkStarLevel)}
                  </button>
                  <button 
                    type="button"
                    onClick={handleBulkToggleLookingInto}
                    title={isAllSelectedLookingInto ? "Remove #looking-into tag from selected items" : "Bulk tag selected items as #looking-into"}
                    className="h-8 w-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center shrink-0 transition-all border border-white/25 cursor-pointer shadow-sm active:scale-95"
                  >
                    {renderLookingIntoIcon(isAllSelectedLookingInto)}
                  </button>

                  <Button 
                    variant="ghost" 
                    onClick={() => {
                      setBulkActionType('combined');
                      setBulkEditModalOpen(true);
                    }}
                    className="text-white hover:bg-white/10 shrink-0 flex items-center gap-1.5 py-1.5 px-3 text-xs"
                  >
                    <Edit3 className="h-4 w-4" />
                    <span>Bulk Edit</span>
                  </Button>
                  {items.some(i => selectedIds.includes(i.id) && !i.aiAnalyzed) && (
                    <Button 
                      variant="ghost" 
                      onClick={handleBatchAnalyze}
                      disabled={isAnalyzing}
                      className="text-white hover:bg-white/10 shrink-0 flex items-center gap-1.5 py-1.5 px-3 text-xs"
                    >
                      <Star className="h-4 w-4" />
                      <span>{isAnalyzing ? "Analyzing..." : "Analyze Selected"}</span>
                    </Button>
                  )}
                  <Button 
                    variant="ghost" 
                    onClick={handleFetchCovers}
                    disabled={isFetchingCovers}
                    className="text-white hover:bg-white/10 shrink-0 flex items-center gap-1.5 py-1.5 px-3 text-xs"
                  >
                    <ImageIcon className="h-4 w-4" />
                    <span>{isFetchingCovers ? "Fetching..." : "Fetch Covers"}</span>
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={() => {
                      setExportScope('filtered');
                      setIsExportModalOpen(true);
                    }}
                    className="text-white hover:bg-white/10 shrink-0 flex items-center gap-1.5 py-1.5 px-3 text-xs"
                  >
                    <Download className="h-4 w-4" />
                    <span>Export</span>
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={handleBulkDelete}
                    className="text-white hover:bg-red-500/20 shrink-0 flex items-center gap-1.5 py-1.5 px-3 text-xs"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Delete</span>
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          
          {allTags.length > 0 && (
            <div className="space-y-4">
              {/* Multi-Selected Tags Bulk Action Banner */}
              <AnimatePresence>
                {selectedTagsForMgmt.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex flex-col sm:flex-row items-center justify-between p-3.5 bg-brand-card border border-brand-accent/50 rounded-2xl shadow-xl gap-3"
                  >
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="h-2 w-2 rounded-full bg-brand-accent animate-pulse shrink-0" />
                      <CheckSquare className="h-4 w-4 text-brand-accent shrink-0" />
                      <span className="text-xs font-bold text-brand-text shrink-0">
                        {selectedTagsForMgmt.length} {selectedTagsForMgmt.length === 1 ? 'Tag' : 'Tags'} Selected:
                      </span>
                      <div className="flex flex-wrap gap-1 max-w-md max-h-12 overflow-y-auto">
                        {selectedTagsForMgmt.map(t => (
                          <span key={t} className="text-[10px] font-mono bg-brand-accent/15 text-brand-accent border border-brand-accent/30 px-2 py-0.5 rounded-md font-semibold flex items-center gap-1">
                            #{t}
                            <button 
                              onClick={() => toggleTagForMgmt(t)}
                              className="hover:text-red-400 cursor-pointer ml-0.5"
                              title="Remove tag from selection"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                      <button
                        onClick={() => {
                          if (selectedTagsForMgmt.length === allTags.length) {
                            setSelectedTagsForMgmt([]);
                          } else {
                            setSelectedTagsForMgmt([...allTags]);
                          }
                        }}
                        className="text-xs font-bold text-brand-muted hover:text-brand-text px-2 py-1 rounded-lg hover:bg-brand-bg transition-colors cursor-pointer"
                      >
                        {selectedTagsForMgmt.length === allTags.length ? 'Deselect All' : 'Select All Tags'}
                      </button>
                      <Button
                        onClick={() => {
                          setBulkTagNewName('');
                          setBulkTagClusters([]);
                          setBulkTagEditModalOpen(true);
                        }}
                        className="py-1.5 px-3 text-xs flex items-center gap-1.5 font-bold bg-brand-accent text-white"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>Edit Selected ({selectedTagsForMgmt.length})</span>
                      </Button>
                      <Button
                        variant="danger"
                        onClick={handleBulkDeleteTagsGlobal}
                        className="py-1.5 px-3 text-xs flex items-center gap-1.5 font-bold"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete Selected ({selectedTagsForMgmt.length})</span>
                      </Button>
                      <button
                        onClick={() => setSelectedTagsForMgmt([])}
                        className="p-1 text-brand-muted hover:text-brand-text hover:bg-brand-bg rounded-lg transition-colors cursor-pointer"
                        title="Clear tag selection"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">Vault Tags</span>
                  <button 
                    onClick={() => setTagsExpanded(!tagsExpanded)}
                    className="text-[10px] font-bold text-brand-accent uppercase hover:underline"
                  >
                    {tagsExpanded ? 'Collapse' : `Show All (${allTags.length})`}
                  </button>
                  {selectedTags.length > 0 && (
                    <span className="text-[10.5px] bg-brand-accent/20 border border-brand-accent/40 text-brand-accent font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 animate-pulse shadow-sm">
                      <Filter className="h-3 w-3" />
                      Showing {filteredItems.length} of {items.length} matching library items
                    </span>
                  )}
                </div>

                {tagsExpanded && (
                  <div className="flex flex-wrap items-center gap-3">
                    {/* View Mode Toggle */}
                    <div className="flex items-center bg-brand-bg/55 border border-brand-border/60 p-0.5 rounded-lg text-[10px] font-bold">
                      <button
                        onClick={() => setTagViewMode('clusters')}
                        className={cn(
                          "px-2.5 py-1.5 rounded-md uppercase transition-all flex items-center gap-1 cursor-pointer",
                          tagViewMode === 'clusters' 
                            ? "bg-brand-accent text-white shadow-sm" 
                            : "text-brand-muted hover:text-brand-text"
                        )}
                      >
                        <Layers className="h-3 w-3" />
                        Clusters
                      </button>
                      <button
                        onClick={() => setTagViewMode('list')}
                        className={cn(
                          "px-2.5 py-1.5 rounded-md uppercase transition-all flex items-center gap-1 cursor-pointer",
                          tagViewMode === 'list' 
                            ? "bg-brand-accent text-white shadow-sm" 
                            : "text-brand-muted hover:text-brand-text"
                        )}
                      >
                        <Tag className="h-3 w-3" />
                        List
                      </button>
                    </div>

                    {/* Tag Matching Strategy Toggle */}
                    <div className="flex items-center bg-brand-bg/55 border border-brand-border/60 p-0.5 rounded-lg text-[10px] font-bold" title="Toggle tag filtering logic">
                      <button
                        onClick={() => {
                          setTagMatchStrategy('or');
                          saveUserSettings({ tagMatchStrategy: 'or' });
                        }}
                        className={cn(
                          "px-2.5 py-1.5 rounded-md uppercase transition-all flex items-center gap-1 cursor-pointer",
                          tagMatchStrategy === 'or' 
                            ? "bg-brand-accent text-white shadow-sm font-extrabold" 
                            : "text-brand-muted hover:text-brand-text"
                        )}
                      >
                        Any (OR)
                      </button>
                      <button
                        onClick={() => {
                          setTagMatchStrategy('and');
                          saveUserSettings({ tagMatchStrategy: 'and' });
                        }}
                        className={cn(
                          "px-2.5 py-1.5 rounded-md uppercase transition-all flex items-center gap-1 cursor-pointer",
                          tagMatchStrategy === 'and' 
                            ? "bg-brand-accent text-white shadow-sm font-extrabold" 
                            : "text-brand-muted hover:text-brand-text"
                        )}
                      >
                        All (AND)
                      </button>
                    </div>

                    {tagViewMode === 'list' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold text-brand-muted uppercase tracking-widest mr-1">Sort:</span>
                        <button 
                          onClick={() => {
                            if (tagSortField === 'alphabetical') setTagSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                            else { setTagSortField('alphabetical'); setTagSortDirection('asc'); }
                          }}
                          className={cn(
                            "px-2 py-1 rounded text-[10px] font-bold uppercase border transition-all",
                            tagSortField === 'alphabetical' ? "bg-brand-accent text-white border-brand-accent" : "bg-brand-card text-brand-muted border-brand-border"
                          )}
                        >
                          A-Z {tagSortField === 'alphabetical' && (tagSortDirection === 'asc' ? '↑' : '↓')}
                        </button>
                        <button 
                          onClick={() => {
                            if (tagSortField === 'count') setTagSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                            else { setTagSortField('count'); setTagSortDirection('desc'); }
                          }}
                          className={cn(
                            "px-2 py-1 rounded text-[10px] font-bold uppercase border transition-all",
                            tagSortField === 'count' ? "bg-brand-accent text-white border-brand-accent" : "bg-brand-card text-brand-muted border-brand-border"
                          )}
                        >
                          Usage {tagSortField === 'count' && (tagSortDirection === 'asc' ? '↑' : '↓')}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {aiClusters ? (
                          <>
                            <span className="text-[9px] font-bold text-green-500 uppercase flex items-center gap-1 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-md">
                              <Sparkles className="h-3 w-3 animate-pulse" />
                              AI Grouped
                            </span>
                            <button 
                              onClick={handleResetTagClusters}
                              className="text-[9px] text-brand-muted hover:text-red-500 hover:underline uppercase font-bold px-1 py-1"
                            >
                              Reset
                            </button>
                          </>
                        ) : (
                          <span className="text-[9px] text-brand-muted font-bold uppercase tracking-wider bg-brand-card border border-brand-border px-2 py-1 rounded-md">
                            Auto Default
                          </span>
                        )}
                        
                        <Button 
                          variant="ghost" 
                          onClick={handleClusterTagsWithAI}
                          disabled={isClustering}
                          className="py-1 px-2 text-[10px] h-auto flex items-center gap-1 border border-brand-border hover:border-brand-accent/40"
                        >
                          {isClustering ? (
                            <div className="h-3 w-3 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3 text-brand-accent" />
                          )}
                          <span>{isClustering ? "Identifying Clusters..." : "AI Auto-Cluster"}</span>
                        </Button>
                      </div>
                    )}
                    
                    <Button 
                      variant="ghost" 
                      onClick={handleNormalizeTags}
                      disabled={isNormalizing}
                      className="py-1 px-3 text-[10px] h-auto flex items-center gap-1.5 border border-brand-border"
                    >
                      {isNormalizing ? <div className="h-3 w-3 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" /> : <Star className="h-3 w-3" />}
                      <span>Normalize</span>
                    </Button>
                  </div>
                )}
              </div>

              {tagViewMode === 'clusters' ? (
                <div className={cn(
                  "transition-all duration-300 w-full space-y-6",
                  tagsExpanded ? "max-h-[8000px] opacity-100 pt-2" : "max-h-[48px] opacity-90 overflow-hidden"
                )}>
                  
                  {/* --- MASTER UNIFIED CURATION & VIBE CLUSTERS --- */}
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-brand-border/40 pb-2.5 gap-3">
                      <div className="space-y-1">
                        <h3 className="text-xs font-bold text-brand-text uppercase tracking-wider flex items-center gap-1.5">
                          <Layers className="h-4 w-4 text-brand-accent" />
                          Curation & Vibe Clusters
                        </h3>
                        <p className="text-[10px] text-brand-muted">
                          Organize library hashtags into custom playlist groupings, styles, and musicologist vibes.
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-2.5 flex-wrap">
                        {/* 🔍⭐ first Toggle Button */}
                        <button
                          type="button"
                          onClick={togglePrioritizeStarSearchFirst}
                          className={cn(
                            "px-2.5 py-1 text-[10px] font-bold rounded-xl border flex items-center gap-1.5 transition-all cursor-pointer select-none shadow-sm whitespace-nowrap shrink-0",
                            prioritizeStarSearchFirst
                              ? "bg-brand-accent text-white border-brand-accent font-extrabold"
                              : "bg-brand-card/70 border-brand-border text-brand-muted hover:text-brand-text hover:border-brand-accent/40"
                          )}
                          title={prioritizeStarSearchFirst 
                            ? "🔍⭐ first: Active (Default) — Click to stop ordering favorited (⭐) and looking-into (🔍) items first"
                            : "🔍⭐ first: Inactive — Click to order favorited (⭐) and looking-into (🔍) items first"
                          }
                        >
                          <span className="leading-none">🔍⭐ first</span>
                        </button>

                        {/* Timeframe Filter on top right of Curation & Vibe Clusters */}
                        {(activeTab === 'artist' || activeTab === 'track') && (
                          <div className="flex items-center gap-1 bg-brand-bg/60 p-1 rounded-xl border border-brand-border/60 shrink-0">
                            <span className="text-[10px] font-bold text-brand-muted uppercase px-1.5 flex items-center gap-1">
                              <Clock className="h-3 w-3 text-brand-accent" />
                              Timeframe:
                            </span>
                            {[
                              { id: 'overall', label: 'all-time' },
                              { id: '12month', label: '1y' },
                              { id: '6month', label: '6mo' },
                              { id: '3month', label: '90d' },
                              { id: '1month', label: '30d' },
                              { id: '7day', label: '7d' },
                            ].map(tf => (
                              <button
                                key={tf.id}
                                type="button"
                                onClick={() => setFilters(prev => ({ ...prev, timeframe: tf.id }))}
                                className={cn(
                                  "px-2 py-0.5 text-[10px] font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0",
                                  (filters.timeframe || 'overall') === tf.id
                                    ? "bg-brand-accent text-white shadow-sm font-extrabold"
                                    : "text-brand-muted hover:text-brand-text hover:bg-brand-card/70"
                                )}
                              >
                                {tf.label}
                              </button>
                            ))}
                          </div>
                        )}

                        {tagsExpanded && (
                          <button
                            onClick={() => {
                              handleStartEditCluster({ name: '', description: '', tags: [] }, 'custom', false);
                            }}
                            className="px-3 py-1 text-[10px] uppercase font-bold text-brand-accent hover:text-white hover:bg-brand-accent/25 border border-brand-accent/40 rounded-xl flex items-center gap-1.5 transition-all self-start cursor-pointer xs:self-auto select-none"
                          >
                            <Plus className="h-4 w-4" />
                            Create Vibe Cluster
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Active Filter Indicator Banner for Clusters Mode */}
                    {selectedTags.length > 0 && (
                      <div className="bg-brand-accent/10 border border-brand-accent/35 rounded-xl px-4 py-2.5 text-xs flex items-center justify-between text-brand-accent font-semibold animate-fadeIn shrink-0">
                        <div className="flex items-center gap-2">
                          <Filter className="h-4 w-4 text-brand-accent animate-pulse" />
                          <span>Active Filter: Showing <strong className="text-brand-text font-bold">{filteredItems.length}</strong> of <strong className="text-brand-text font-bold">{items.length}</strong> total library items matching your selections.</span>
                        </div>
                        <button
                          onClick={() => setSelectedTags([])}
                          className="text-xs hover:underline text-brand-muted hover:text-brand-accent font-bold cursor-pointer"
                        >
                          Clear Filters
                        </button>
                      </div>
                    )}

                    {/* UNIFIED CLUSTERS GRID */}
                    {(() => {
                      const currentClusters = aiClusters || getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
                      
                      // Dynamically calculate "Other Curation Tags" based on what is not mapped
                      const mappedTagsSet = new Set<string>();
                      currentClusters.forEach(c => {
                        c.tags.forEach(t => mappedTagsSet.add(t.toLowerCase()));
                      });
                      const uncategorizedTags = allTags.filter(tag => !mappedTagsSet.has(tag.toLowerCase()));
                      
                      const displayClusters = [...currentClusters];
                      if (uncategorizedTags.length > 0) {
                        displayClusters.push({
                          name: "Other Curation Tags",
                          description: "Uncategorized custom hashtags and niche descriptors in your music vault",
                          tags: uncategorizedTags,
                          category: "genre",
                          isOtherCurationTags: true
                        } as any);
                      }

                      if (displayClusters.length === 0) {
                        return (
                          <div className="text-center py-8 border border-dashed border-brand-border/60 rounded-2xl bg-brand-card/10">
                            <p className="text-xs text-brand-muted">No active curation clusters found. Import music or create a custom cluster above!</p>
                          </div>
                        );
                      }

                      // Split displayClusters into 'vibe' and 'genre'
                      const vibeClusters = displayClusters.filter(c => getClusterCategory(c) === 'vibe');
                      const genreClusters = displayClusters.filter(c => getClusterCategory(c) !== 'vibe');

                      const renderClusterCard = (cluster: TagCluster, sectionCategory: 'vibe' | 'genre') => {
                        const isOther = (cluster as any).isOtherCurationTags;
                        const existingTagsInCluster = cluster.tags.filter(t => tagCounts[t] !== undefined);
                        const clusterColorHex = getClusterColor(cluster);
                        
                        // Selection statuses
                        const allSelected = existingTagsInCluster.length > 0 && existingTagsInCluster.every(t => selectedTags.includes(t));
                        const partiallySelected = existingTagsInCluster.length > 0 && !allSelected && existingTagsInCluster.some(t => selectedTags.includes(t));
                        
                        const isExpanded = !!expandedClusters[cluster.name];
                        const visibleTags = isExpanded ? existingTagsInCluster : existingTagsInCluster.slice(0, 15);
                        const hasMoreTags = existingTagsInCluster.length > 15;
                        const isDragging = draggedClusterName === cluster.name;
                        const isDragOver = dragOverClusterName === cluster.name;

                        return (
                          <div 
                            key={cluster.name} 
                            draggable={true}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', cluster.name);
                              e.dataTransfer.effectAllowed = 'move';
                              setDraggedClusterName(cluster.name);
                            }}
                            onDragEnd={() => {
                              setDraggedClusterName(null);
                              setDragOverClusterName(null);
                              setDragOverPosition('after');
                              setDragOverCategory(null);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              e.dataTransfer.dropEffect = 'move';
                              const rect = e.currentTarget.getBoundingClientRect();
                              const midX = rect.left + rect.width / 2;
                              const pos = e.clientX < midX ? 'before' : 'after';
                              if (dragOverClusterName !== cluster.name || dragOverPosition !== pos) {
                                setDragOverClusterName(cluster.name);
                                setDragOverPosition(pos);
                                setDragOverCategory(sectionCategory);
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const sourceName = draggedClusterName || e.dataTransfer.getData('text/plain');
                              if (sourceName) {
                                handleDropCluster(sourceName, sectionCategory, cluster.name, dragOverPosition);
                              }
                            }}
                            className={cn(
                              "glass rounded-2xl p-4 border transition-all flex flex-col justify-between shadow-sm relative group cursor-grab active:cursor-grabbing",
                              isDragging ? "opacity-30 scale-95 border-dashed border-brand-accent" : "",
                              isDragOver && dragOverPosition === 'before' ? "border-l-4 border-l-brand-accent ring-2 ring-brand-accent/60 bg-brand-accent/10" : "",
                              isDragOver && dragOverPosition === 'after' ? "border-r-4 border-r-brand-accent ring-2 ring-brand-accent/60 bg-brand-accent/10" : "",
                              allSelected 
                                ? "border-brand-accent/55 bg-brand-accent/[0.04]" 
                                : partiallySelected
                                  ? "border-brand-accent/25 bg-brand-card"
                                  : "border-brand-border/40 hover:border-brand-accent/35 bg-brand-card/45"
                            )}
                          >
                            <div className={cn("w-full h-full flex flex-col justify-between", draggedClusterName ? "pointer-events-none" : "")}>
                              <div>
                                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-brand-border/40 gap-1.5">
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                  {/* Drag Handle Icon with Options Dropdown */}
                                  <div className="relative shrink-0">
                                    <button 
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenClusterMenuName(prev => prev === cluster.name ? null : cluster.name);
                                      }}
                                      className={cn(
                                        "p-1.5 rounded-lg text-brand-muted hover:text-brand-accent hover:bg-brand-bg/80 cursor-grab active:cursor-grabbing transition-all flex items-center justify-center",
                                        openClusterMenuName === cluster.name ? "bg-brand-accent/20 text-brand-accent ring-1 ring-brand-accent/30" : ""
                                      )}
                                      title="Drag to reorder/move, or click to open position options"
                                    >
                                      <GripVertical className="h-4 w-4" />
                                    </button>

                                    {openClusterMenuName === cluster.name && (
                                      <div 
                                        className="absolute left-0 top-full mt-1 w-48 bg-brand-card border border-brand-border shadow-2xl rounded-xl p-1.5 z-50 text-xs font-sans space-y-1"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className="text-[10px] font-bold text-brand-muted px-2 py-1 uppercase tracking-wider border-b border-brand-border/40 flex items-center justify-between">
                                          <span>Cluster Options</span>
                                          <span className="text-[9px] font-semibold text-brand-accent uppercase">{sectionCategory}</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleShiftClusterPosition(cluster.name, 'up');
                                            setOpenClusterMenuName(null);
                                          }}
                                          className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-brand-accent/10 hover:text-brand-accent text-brand-text flex items-center gap-2 transition-colors cursor-pointer"
                                        >
                                          <ArrowUp className="h-3.5 w-3.5 text-brand-accent shrink-0" />
                                          <span className="font-medium">Move Up</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleShiftClusterPosition(cluster.name, 'down');
                                            setOpenClusterMenuName(null);
                                          }}
                                          className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-brand-accent/10 hover:text-brand-accent text-brand-text flex items-center gap-2 transition-colors cursor-pointer"
                                        >
                                          <ArrowDown className="h-3.5 w-3.5 text-brand-accent shrink-0" />
                                          <span className="font-medium">Move Down</span>
                                        </button>
                                        <div className="border-t border-brand-border/40 my-1" />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleToggleClusterCategory(cluster.name);
                                            setOpenClusterMenuName(null);
                                          }}
                                          className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-brand-accent/10 hover:text-brand-accent text-brand-text flex items-center gap-2 transition-colors cursor-pointer"
                                        >
                                          <Move className="h-3.5 w-3.5 text-brand-accent shrink-0" />
                                          <span className="font-medium">
                                            {sectionCategory === 'vibe' ? "Move to 'by genre:'" : "Move to 'by vibe:'"}
                                          </span>
                                        </button>
                                        <div className="border-t border-brand-border/40 my-1" />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setColorPickerCluster(cluster);
                                            setOpenClusterMenuName(null);
                                          }}
                                          className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-brand-accent/10 hover:text-brand-accent text-brand-text flex items-center gap-2 transition-colors cursor-pointer"
                                        >
                                          <Palette className="h-3.5 w-3.5 text-brand-accent shrink-0" />
                                          <span className="font-medium">Change Color</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  {!isOther ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setColorPickerCluster(cluster);
                                      }}
                                      className="p-1 hover:bg-brand-bg/85 rounded-lg transition-all shrink-0 cursor-pointer group/icon relative"
                                      title={`Change color for "${cluster.name}" (Click icon)`}
                                    >
                                      <div className="relative flex items-center justify-center">
                                        {sectionCategory === 'vibe' ? (
                                          <Sparkles className="h-3.5 w-3.5 shrink-0 transition-transform group-hover/icon:scale-125" style={{ color: clusterColorHex }} />
                                        ) : (
                                          <Disc className="h-3.5 w-3.5 shrink-0 transition-transform group-hover/icon:scale-125" style={{ color: clusterColorHex }} />
                                        )}
                                        <span 
                                          className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-black"
                                          style={{ backgroundColor: clusterColorHex }}
                                        />
                                      </div>
                                    </button>
                                  ) : (
                                    <div className="p-1 rounded-lg text-brand-muted shrink-0">
                                      <Layers className="h-3.5 w-3.5" />
                                    </div>
                                  )}
                                  
                                  <button
                                    onClick={() => handleToggleClusterFiltering(cluster.tags)}
                                    className="text-left font-bold text-xs md:text-sm text-brand-text hover:text-brand-accent transition-colors truncate hover:underline cursor-pointer"
                                    title="Click to select/filter all tags in this cluster"
                                  >
                                    {cluster.name}
                                  </button>
                                </div>
                                
                                <div className="flex items-center gap-1 shrink-0">
                                  {!isOther && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStartEditCluster(cluster, aiClusters ? 'ai' : 'default', false);
                                      }}
                                      className="p-1 hover:bg-brand-bg rounded-lg text-brand-muted hover:text-brand-accent transition-all cursor-pointer"
                                      title="Rename Cluster & Edit Settings"
                                    >
                                      <Edit3 className="h-3 w-3" />
                                    </button>
                                  )}
                                  {!isOther ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStartEditCluster(cluster, aiClusters ? 'ai' : 'default', true);
                                      }}
                                      className="text-[9px] bg-brand-accent/10 hover:bg-brand-accent/20 border border-brand-accent/25 text-brand-accent font-bold px-2 py-0.5 rounded-full uppercase transition-all flex items-center gap-1 hover:scale-105 cursor-pointer select-none"
                                      title="Click to Edit (Add/Remove) Tags"
                                    >
                                      {existingTagsInCluster.length} Tags
                                    </button>
                                  ) : (
                                    <span className="text-[9px] bg-brand-border/50 text-brand-muted font-bold px-2 py-0.5 rounded-full uppercase select-none">
                                      {existingTagsInCluster.length} Tags
                                    </span>
                                  )}
                                  
                                  {!isOther && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteClusterUnified(cluster.name);
                                      }}
                                      className="p-1 hover:bg-brand-bg rounded-lg text-brand-muted hover:text-red-500 transition-all cursor-pointer"
                                      title="Delete Cluster"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              
                              {cluster.description && (
                                <p className="text-[10px] text-brand-muted mb-3 line-clamp-2 leading-relaxed font-sans">
                                  {cluster.description}
                                </p>
                              )}

                              <div className="flex flex-wrap gap-x-2 gap-y-2 font-sans py-0.5">
                                {visibleTags.map(tag => {
                                  const isLow = lowPriorityTags.includes(tag.toLowerCase());
                                  const tagSrc = getGlobalTagSource(items, tag);
                                  return (
                                    <div key={tag} className="flex group/tag relative my-1">
                                      <button
                                        onClick={() => setSelectedTags(prev => 
                                          prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                                        )}
                                        title={tagSrc === 'lastfm' ? `#${tag} (Synced from Last.fm)` : tagSrc === 'llm' ? `#${tag} (Auto-added by AI)` : `#${tag} (Manually added)`}
                                        className={cn(
                                          'pl-2.5 pr-8 py-0.5 rounded-full text-[11px] font-medium border transition-all relative',
                                          isLow ? 'border-amber-500/50 bg-amber-500/10 text-amber-300' : '',
                                          selectedTagsForMgmt.includes(tag.toLowerCase())
                                            ? 'bg-brand-accent/25 border-brand-accent text-brand-accent ring-2 ring-brand-accent/40 font-bold'
                                            : selectedTags.includes(tag) 
                                              ? 'bg-brand-accent/20 border-brand-accent text-brand-accent ring-1 ring-brand-accent/20 font-semibold' 
                                              : 'bg-brand-card/70 border-brand-border/70 text-brand-muted hover:text-brand-text hover:border-brand-muted/80'
                                        )}
                                      >
                                        <span className="inline-flex items-center gap-0.5">
                                          <span className={cn("font-bold", tagSrc === 'lastfm' ? "text-red-400" : tagSrc === 'llm' ? "text-orange-400" : "text-emerald-400")}>#</span>
                                          <span className={cn("border-b pb-[1px]", tagSrc === 'lastfm' ? "border-red-400/50" : tagSrc === 'llm' ? "border-orange-400/50" : "border-emerald-400/50")}>{tag}</span>
                                        </span>
                                        <span className="absolute right-2 bottom-0.5 text-[8px] font-bold opacity-60">
                                          {tagCounts[tag]}
                                        </span>
                                        {isLow && (
                                          <span 
                                            className="absolute -bottom-1 -right-1 bg-amber-500 text-white font-black text-[8px] h-3.5 w-3.5 rounded-full flex items-center justify-center border border-brand-card shadow-sm leading-none pointer-events-none z-10"
                                            title="Low priority tag (-)"
                                          >
                                            -
                                          </span>
                                        )}
                                      </button>
                                      
                                      {/* Top Right Action Buttons */}
                                      <div className={cn(
                                        "absolute top-0 right-0 translate-x-1/3 -translate-y-1/2 flex gap-0.5 z-20 transition-opacity duration-150",
                                        selectedTagsForMgmt.includes(tag.toLowerCase())
                                          ? "opacity-100 pointer-events-auto"
                                          : "opacity-0 pointer-events-none group-hover/tag:opacity-100 group-hover/tag:pointer-events-auto"
                                      )}>
                                        <button 
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleTagForMgmt(tag);
                                          }}
                                          className={cn(
                                            "p-1 shadow-lg border rounded-full transition-colors cursor-pointer flex items-center justify-center",
                                            selectedTagsForMgmt.includes(tag.toLowerCase())
                                              ? "bg-brand-accent border-brand-accent text-white"
                                              : "bg-brand-card border-brand-border text-brand-accent hover:bg-brand-accent/20 hover:border-brand-accent/50"
                                          )}
                                          title={selectedTagsForMgmt.includes(tag.toLowerCase()) ? "Deselect tag" : "Select tag for bulk edit/delete"}
                                        >
                                          <CheckSquare className="h-2.5 w-2.5" />
                                        </button>
                                        <button 
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleStartEditTag(tag);
                                          }}
                                          className="p-1 bg-brand-card shadow-lg border border-brand-border rounded-full text-brand-accent hover:bg-brand-accent/20 hover:border-brand-accent/50 transition-colors cursor-pointer flex items-center justify-center"
                                          title="Edit tag and clusters"
                                        >
                                          <Edit3 className="h-2.5 w-2.5" />
                                        </button>
                                        <button 
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteTagGlobal(tag);
                                          }}
                                          className="p-1 bg-brand-card shadow-lg border border-brand-border rounded-full text-red-400 hover:bg-red-500/20 hover:border-red-500/50 transition-colors cursor-pointer flex items-center justify-center"
                                          title="Delete tag globally"
                                        >
                                          <Trash2 className="h-2.5 w-2.5" />
                                        </button>
                                      </div>

                                      {/* Bottom Right Low Priority (-) Action Button */}
                                      <div className="absolute bottom-0 right-0 translate-x-1/3 translate-y-1/2 flex gap-0.5 z-20 transition-opacity duration-150 opacity-0 pointer-events-none group-hover/tag:opacity-100 group-hover/tag:pointer-events-auto">
                                        <button 
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleLowPriorityTag(tag);
                                          }}
                                          className={cn(
                                            "p-1 shadow-lg border rounded-full transition-colors cursor-pointer flex items-center justify-center",
                                            isLow
                                              ? "bg-amber-500 border-amber-500 text-white"
                                              : "bg-brand-card border-brand-border text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50"
                                          )}
                                          title={isLow ? "Remove low priority status" : "Mark tag as low priority (-)"}
                                        >
                                          <Minus className="h-2.5 w-2.5 stroke-[3]" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                                
                                {existingTagsInCluster.length === 0 && (
                                  <span className="text-[10px] text-brand-muted italic">No tags present in library items</span>
                                )}
                                
                                {hasMoreTags && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedClusters(prev => ({ ...prev, [cluster.name]: !isExpanded }));
                                    }}
                                    className="text-[9.5px] text-brand-accent hover:underline px-2.5 py-0.5 rounded-full bg-brand-accent/5 hover:bg-brand-accent/10 border border-brand-accent/20 font-semibold transition-all cursor-pointer inline-flex items-center gap-1 ml-0.5 self-center"
                                  >
                                    {isExpanded ? "Show Less" : `+ ${existingTagsInCluster.length - 15} more...`}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                      };

                      return (
                        <div className="space-y-6 pb-2">
                          {/* SECTION 1: BY VIBE */}
                          <div 
                            className={cn(
                              "space-y-3 p-3.5 rounded-2xl transition-all border",
                              dragOverCategory === 'vibe' 
                                ? "bg-brand-accent/10 border-brand-accent/50 ring-2 ring-brand-accent/30" 
                                : "bg-brand-card/20 border-brand-border/30"
                            )}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (dragOverCategory !== 'vibe') setDragOverCategory('vibe');
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const sourceName = draggedClusterName || e.dataTransfer.getData('text/plain');
                              if (sourceName) handleDropCluster(sourceName, 'vibe');
                            }}
                          >
                            <div className="flex items-center justify-between border-b border-brand-border/40 pb-2">
                              <h4 className="text-xs font-black text-brand-accent uppercase tracking-widest flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-brand-accent" />
                                by vibe:
                              </h4>
                              <span className="text-[10px] font-bold text-brand-muted uppercase bg-brand-card/80 border border-brand-border px-2.5 py-0.5 rounded-lg">
                                {vibeClusters.length} {vibeClusters.length === 1 ? 'cluster' : 'clusters'}
                              </span>
                            </div>
                            {vibeClusters.length === 0 ? (
                              <div className="p-6 border border-dashed border-brand-border/60 rounded-2xl text-center text-xs text-brand-muted italic bg-brand-card/20">
                                No vibe clusters in this section. Drag a cluster here or click "→ Vibe" to move a cluster!
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 font-sans">
                                {vibeClusters.map(cluster => renderClusterCard(cluster, 'vibe'))}
                              </div>
                            )}
                          </div>

                          {/* SECTION 2: BY GENRE */}
                          <div 
                            className={cn(
                              "space-y-3 p-3.5 rounded-2xl transition-all border",
                              dragOverCategory === 'genre' 
                                ? "bg-brand-accent/10 border-brand-accent/50 ring-2 ring-brand-accent/30" 
                                : "bg-brand-card/20 border-brand-border/30"
                            )}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (dragOverCategory !== 'genre') setDragOverCategory('genre');
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const sourceName = draggedClusterName || e.dataTransfer.getData('text/plain');
                              if (sourceName) handleDropCluster(sourceName, 'genre');
                            }}
                          >
                            <div className="flex items-center justify-between border-b border-brand-border/40 pb-2">
                              <h4 className="text-xs font-black text-brand-accent uppercase tracking-widest flex items-center gap-2">
                                <Disc className="h-4 w-4 text-brand-accent" />
                                by genre:
                              </h4>
                              <span className="text-[10px] font-bold text-brand-muted uppercase bg-brand-card/80 border border-brand-border px-2.5 py-0.5 rounded-lg">
                                {genreClusters.length} {genreClusters.length === 1 ? 'cluster' : 'clusters'}
                              </span>
                            </div>
                            {genreClusters.length === 0 ? (
                              <div className="p-6 border border-dashed border-brand-border/60 rounded-2xl text-center text-xs text-brand-muted italic bg-brand-card/20">
                                No genre clusters in this section. Drag a cluster here or click "→ Genre" to move a cluster!
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 font-sans">
                                {genreClusters.map(cluster => renderClusterCard(cluster, 'genre'))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* MASTER / CLUSTER VIEW CLEAR FILTERS BUTTON */}
                  {selectedTags.length > 0 && (
                    <div className="flex pt-2 justify-center">
                      <button 
                        onClick={() => setSelectedTags([])} 
                        className="text-xs transition-colors text-brand-muted hover:text-red-500 font-medium hover:underline border border-brand-border/80 px-4 py-2 rounded-xl bg-brand-card/30 flex items-center gap-1.5 h-auto cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                        Clear All Filter Tags ({selectedTags.length})
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className={cn(
                  "flex flex-wrap gap-x-2 gap-y-2.5 py-1.5 transition-all duration-300",
                  tagsExpanded ? "max-h-[2000px] opacity-100 pt-4" : "max-h-[48px] opacity-90 overflow-hidden"
                )}>
                  {allTags.map(tag => {
                    const isLow = lowPriorityTags.includes(tag.toLowerCase());
                    const tagSrc = getGlobalTagSource(items, tag);
                    return (
                      <div key={tag} className="flex group/tag relative my-1">
                        <button
                          onClick={() => setSelectedTags(prev => 
                            prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                          )}
                          title={tagSrc === 'lastfm' ? `#${tag} (Synced from Last.fm)` : tagSrc === 'llm' ? `#${tag} (Auto-added by AI)` : `#${tag} (Manually added)`}
                          className={cn(
                            'pl-3 pr-8 py-1 rounded-full text-xs font-medium border transition-all relative',
                            isLow ? 'border-amber-500/50 bg-amber-500/10 text-amber-300' : '',
                            selectedTagsForMgmt.includes(tag.toLowerCase())
                              ? 'bg-brand-accent/25 border-brand-accent text-brand-accent ring-2 ring-brand-accent/40 font-bold'
                              : selectedTags.includes(tag) 
                                ? 'bg-brand-accent/20 border-brand-accent text-brand-accent ring-1 ring-brand-accent/20 font-semibold' 
                                : 'bg-brand-card/70 border-brand-border/70 text-brand-muted hover:text-brand-text hover:border-brand-muted/80'
                          )}
                        >
                          <span className="inline-flex items-center gap-0.5">
                            <span className={cn("font-bold", tagSrc === 'lastfm' ? "text-red-400" : tagSrc === 'llm' ? "text-orange-400" : "text-emerald-400")}>#</span>
                            <span className={cn("border-b pb-[1px]", tagSrc === 'lastfm' ? "border-red-400/50" : tagSrc === 'llm' ? "border-orange-400/50" : "border-emerald-400/50")}>{tag}</span>
                          </span>
                          <span className="absolute right-2 bottom-1 text-[8px] font-bold opacity-60">
                            {tagCounts[tag]}
                          </span>
                          {isLow && (
                            <span 
                              className="absolute -bottom-1 -right-1 bg-amber-500 text-white font-black text-[8px] h-3.5 w-3.5 rounded-full flex items-center justify-center border border-brand-card shadow-sm leading-none pointer-events-none z-10"
                              title="Low priority tag (-)"
                            >
                              -
                            </span>
                          )}
                        </button>
                        
                        {/* Top Right Action Buttons */}
                        <div className={cn(
                          "absolute top-0 right-0 translate-x-1/3 -translate-y-1/2 flex gap-0.5 z-20 transition-opacity duration-150",
                          selectedTagsForMgmt.includes(tag.toLowerCase())
                            ? "opacity-100 pointer-events-auto"
                            : "opacity-0 pointer-events-none group-hover/tag:opacity-100 group-hover/tag:pointer-events-auto"
                        )}>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTagForMgmt(tag);
                            }}
                            className={cn(
                              "p-1 shadow-lg border rounded-full transition-colors cursor-pointer flex items-center justify-center",
                              selectedTagsForMgmt.includes(tag.toLowerCase())
                                ? "bg-brand-accent border-brand-accent text-white"
                                : "bg-brand-card border-brand-border text-brand-accent hover:bg-brand-accent/20 hover:border-brand-accent/50"
                            )}
                            title={selectedTagsForMgmt.includes(tag.toLowerCase()) ? "Deselect tag" : "Select tag for bulk edit/delete"}
                          >
                            <CheckSquare className="h-2.5 w-2.5" />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEditTag(tag);
                            }}
                            className="p-1 bg-brand-card shadow-lg border border-brand-border rounded-full text-brand-accent hover:bg-brand-accent/20 hover:border-brand-accent/50 transition-colors cursor-pointer flex items-center justify-center"
                            title="Edit tag and clusters"
                          >
                            <Edit3 className="h-2.5 w-2.5" />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTagGlobal(tag);
                            }}
                            className="p-1 bg-brand-card shadow-lg border border-brand-border rounded-full text-red-400 hover:bg-red-500/20 hover:border-red-500/50 transition-colors cursor-pointer flex items-center justify-center"
                            title="Delete tag globally"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        </div>

                        {/* Bottom Right Low Priority (-) Action Button */}
                        <div className="absolute bottom-0 right-0 translate-x-1/3 translate-y-1/2 flex gap-0.5 z-20 transition-opacity duration-150 opacity-0 pointer-events-none group-hover/tag:opacity-100 group-hover/tag:pointer-events-auto">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLowPriorityTag(tag);
                            }}
                            className={cn(
                              "p-1 shadow-lg border rounded-full transition-colors cursor-pointer flex items-center justify-center",
                              isLow
                                ? "bg-amber-500 border-amber-500 text-white"
                                : "bg-brand-card border-brand-border text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50"
                            )}
                            title={isLow ? "Remove low priority status" : "Mark tag as low priority (-)"}
                          >
                            <Minus className="h-2.5 w-2.5 stroke-[3]" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {selectedTags.length > 0 && (
                    <button onClick={() => setSelectedTags([])} className="text-xs text-brand-accent font-medium hover:underline px-2 self-center">
                      Clear Filters
                    </button>
                  )}
                </div>
              )}

              {/* Centered Tag Rename/Edit Modal Overlay */}
              <AnimatePresence>
                {tagToRename && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setTagToRename(null)}
                      className="absolute inset-0 bg-neutral-950/70 backdrop-blur-sm"
                    />
                    
                    {/* Modal Content */}
                    <motion.div 
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.95, opacity: 0 }}
                      className="relative bg-brand-card/95 border border-brand-accent/40 rounded-2xl p-6 w-full max-w-md shadow-2xl z-10 glass max-h-[90vh] flex flex-col"
                    >
                      <button 
                        onClick={() => setTagToRename(null)}
                        className="absolute right-4 top-4 text-brand-muted hover:text-brand-text p-1 hover:bg-brand-bg rounded-lg transition-all cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>

                      <div className="space-y-4 flex flex-col overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-brand-border/40 pb-2 shrink-0">
                          <Tag className="h-4 w-4 text-brand-accent" />
                          <h4 className="font-bold text-xs uppercase text-brand-text tracking-wider">Edit Curation Tag & Clusters</h4>
                        </div>
                        
                        <div className="space-y-4 overflow-y-auto pr-1 flex-1">
                          <div>
                            <p className="text-[10px] font-bold text-brand-muted uppercase mb-1">Current Tag Base:</p>
                            <span className="text-xs font-mono font-bold bg-brand-bg/65 border border-brand-border/60 px-2.5 py-1 rounded inline-block text-brand-text mb-2">
                              #{tagToRename}
                            </span>
                            
                            <p className="text-[10px] font-bold text-brand-muted uppercase mb-1 mt-2">New Tag Name:</p>
                            <input 
                              type="text"
                              value={newTagName}
                              onChange={(e) => setNewTagName(e.target.value)}
                              className="w-full bg-brand-bg border border-brand-border rounded-xl px-3 py-2 text-sm text-brand-text focus:outline-none focus:border-brand-accent outline-none"
                              autoFocus
                            />
                          </div>

                          <div>
                            <p className="text-[10px] font-bold text-brand-muted uppercase mb-1.5">Add / Remove from Clusters:</p>
                            <div className="space-y-1.5 border border-brand-border/60 rounded-xl p-3 bg-brand-bg/60 max-h-[35vh] overflow-y-auto">
                              {(() => {
                                const currentClusters = aiClusters || getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
                                if (currentClusters.length === 0) {
                                  return (
                                    <div className="text-center py-4 text-xs text-brand-muted">
                                      No active curation clusters found.
                                    </div>
                                  );
                                }
                                return currentClusters.map(cluster => {
                                  const isMember = selectedClustersForTag.includes(cluster.name);
                                  return (
                                    <label 
                                      key={cluster.name} 
                                      className="flex items-start gap-2.5 p-2 hover:bg-brand-card/60 rounded-lg cursor-pointer transition-colors text-xs text-brand-text select-none"
                                    >
                                      <input 
                                        type="checkbox"
                                        checked={isMember}
                                        onChange={() => {
                                          setSelectedClustersForTag(prev => 
                                            isMember 
                                              ? prev.filter(c => c !== cluster.name) 
                                              : [...prev, cluster.name]
                                          );
                                        }}
                                        className="mt-0.5 rounded border-brand-border text-brand-accent focus:ring-brand-accent bg-brand-bg accent-brand-accent"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <p className="font-semibold truncate">{cluster.name}</p>
                                        {cluster.description && (
                                          <p className="text-[10px] text-brand-muted truncate mt-0.5">{cluster.description}</p>
                                        )}
                                      </div>
                                    </label>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-3 justify-end pt-2 border-t border-brand-border/40 shrink-0">
                          <Button variant="ghost" onClick={() => setTagToRename(null)} className="py-2 px-4 text-xs font-bold border border-brand-border">
                            Cancel
                          </Button>
                          <Button onClick={() => handleRenameTag(tagToRename, newTagName)} className="py-2 px-5 text-xs font-bold text-white bg-brand-accent">
                            Save Changes
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>

              {/* Universal Cluster Edit Modal Overlay */}
              <AnimatePresence>
                {clusterEditTarget && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setClusterEditTarget(null)}
                      className="absolute inset-0 bg-neutral-950/70 backdrop-blur-sm"
                    />
                    
                    {/* Modal Content */}
                    <motion.div 
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.95, opacity: 0 }}
                      className="relative bg-brand-card/95 border border-brand-accent/40 rounded-2xl p-6 w-full max-w-2xl shadow-2xl z-10 glass max-h-[85vh] flex flex-col"
                    >
                      <button 
                        onClick={() => setClusterEditTarget(null)}
                        className="absolute right-4 top-4 text-brand-muted hover:text-brand-text p-1 hover:bg-brand-bg rounded-lg transition-all cursor-pointer"
                      >
                        <X className="h-4 w-4" />
                      </button>

                      <div className="space-y-4 flex-1 flex flex-col overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-brand-border/40 pb-2 shrink-0">
                          <Sparkles className="h-4 w-4 text-brand-accent animate-pulse" />
                          <h4 className="font-bold text-xs uppercase text-brand-text tracking-wider">
                            {clusterEditTarget.isEditingTagsOnly 
                              ? `Configure tags for: "${clusterEditTarget.cluster.name}"` 
                              : `Edit cluster details: "${clusterEditTarget.cluster.name}"`
                            }
                          </h4>
                        </div>
                        
                        <div className="space-y-4 overflow-y-auto pr-1 flex-1 min-h-[300px]">
                          {/* If not editing tags only, let user edit name, description, category and pick color */}
                          {!clusterEditTarget.isEditingTagsOnly ? (
                            <div className="space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                  <label className="block text-[10px] font-bold text-brand-muted uppercase">Cluster Name</label>
                                  <input
                                    type="text"
                                    value={editClusterName}
                                    onChange={(e) => setEditClusterName(e.target.value)}
                                    placeholder="Cluster name..."
                                    className="w-full bg-brand-bg border border-brand-border/80 focus:border-brand-accent rounded-xl px-3 py-2 text-sm text-brand-text focus:outline-none"
                                  />
                                </div>
                                
                                <div className="space-y-1.5">
                                  <label className="block text-[10px] font-bold text-brand-muted uppercase">Category / Grouping</label>
                                  <div className="grid grid-cols-2 gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setEditClusterCategory('vibe')}
                                      className={cn(
                                        "py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                                        editClusterCategory === 'vibe'
                                          ? "bg-brand-accent/15 border-brand-accent text-brand-accent"
                                          : "bg-brand-bg border-brand-border/60 text-brand-muted hover:text-brand-text"
                                      )}
                                    >
                                      <Sparkles className="h-3.5 w-3.5" />
                                      <span>By Vibe</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditClusterCategory('genre')}
                                      className={cn(
                                        "py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                                        editClusterCategory === 'genre'
                                          ? "bg-brand-accent/15 border-brand-accent text-brand-accent"
                                          : "bg-brand-bg border-brand-border/60 text-brand-muted hover:text-brand-text"
                                      )}
                                    >
                                      <Disc className="h-3.5 w-3.5" />
                                      <span>By Genre</span>
                                    </button>
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <label className="block text-[10px] font-bold text-brand-muted uppercase">Vibe Description</label>
                                <input
                                  type="text"
                                  value={editClusterDescription}
                                  onChange={(e) => setEditClusterDescription(e.target.value)}
                                  placeholder="Vibe description..."
                                  className="w-full bg-brand-bg border border-brand-border/80 focus:border-brand-accent rounded-xl px-3 py-2 text-sm text-brand-text focus:outline-none"
                                />
                              </div>

                              <div className="space-y-2 border-t border-brand-border/40 pt-3">
                                <label className="block text-[10px] font-bold text-brand-muted uppercase">
                                  Cluster Color Theme (Consonant Palette)
                                </label>
                                <ClusterColorGrid 
                                  currentColor={editClusterColor} 
                                  onSelectColor={(color) => setEditClusterColor(color)} 
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="bg-brand-accent/10 border border-brand-accent/20 rounded-xl p-3 text-xs text-brand-muted leading-relaxed">
                              Configure which curation tags belong in this cluster grouping. Deselecting active tags will automatically shift them under <strong className="text-brand-text">"Other Curation Tags"</strong>.
                            </div>
                          )}

                          {/* Select Tags Grid */}
                          <div className="space-y-3 flex flex-col pt-2 overflow-hidden">
                            <label className="block text-[10px] font-bold text-brand-muted uppercase flex items-center justify-between shrink-0">
                              <span>Configure Cluster Tags ({editClusterTags.length} active tags)</span>
                              {editClusterTags.length > 0 && (
                                <button 
                                  onClick={() => setEditClusterTags([])}
                                  className="text-[9px] text-red-500 hover:underline hover:text-red-400 capitalize cursor-pointer font-bold"
                                >
                                  Deselect all
                                </button>
                              )}
                            </label>

                            {/* Dynamic Tag Search Bar inside the cluster editing interface */}
                            <div className="relative shrink-0 font-sans">
                              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-brand-muted" />
                              <input
                                type="text"
                                value={tagSearch}
                                onChange={(e) => setTagSearch(e.target.value)}
                                placeholder="Search tags to add/remove..."
                                className="w-full bg-brand-bg/95 border border-brand-border/80 focus:border-brand-accent/70 rounded-xl pl-9 pr-3.5 py-1.5 text-xs text-brand-text placeholder-brand-muted/70 focus:outline-none focus:ring-1 focus:ring-brand-accent/25"
                              />
                              {tagSearch && (
                                <button
                                  onClick={() => setTagSearch('')}
                                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-brand-muted hover:text-brand-text font-bold cursor-pointer"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                            
                            <div className="max-h-60 overflow-y-auto border border-brand-border/40 rounded-xl p-3.5 bg-brand-bg/50 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                              {(() => {
                                const filteredTags = allTags.filter(tag => 
                                  tag.toLowerCase().includes(tagSearch.toLowerCase())
                                );
                                if (filteredTags.length === 0) {
                                  return (
                                    <div className="col-span-full py-6 text-center text-xs text-brand-muted">
                                      No tags match "{tagSearch}"
                                    </div>
                                  );
                                }
                                return filteredTags.map(tag => {
                                  const isSelected = editClusterTags.map(t => t.toLowerCase()).includes(tag.toLowerCase());
                                  return (
                                    <button
                                      key={tag}
                                      type="button"
                                      onClick={() => {
                                        setEditClusterTags(prev => {
                                          const cleanTag = tag.toLowerCase();
                                          const lowerPrev = prev.map(t => t.toLowerCase());
                                          if (lowerPrev.includes(cleanTag)) {
                                            return prev.filter(t => t.toLowerCase() !== cleanTag);
                                          } else {
                                            return [...prev, cleanTag];
                                          }
                                        });
                                      }}
                                      className={cn(
                                        "px-3 py-2 rounded-xl text-xs font-semibold border text-left flex items-center justify-between transition-all truncate cursor-pointer",
                                        isSelected 
                                          ? "bg-brand-accent text-white border-brand-accent shadow-md shadow-brand-accent/15" 
                                          : "bg-brand-card/45 border-brand-border/60 text-brand-muted hover:border-brand-muted hover:bg-brand-card/75"
                                      )}
                                    >
                                      <span className="truncate">#{tag}</span>
                                      <span className={cn(
                                        "text-[9px] font-extrabold px-1.5 py-0.5 rounded-full shrink-0",
                                        isSelected 
                                          ? "bg-white/20 text-white" 
                                          : "bg-brand-bg text-brand-muted"
                                      )}>{tagCounts[tag]}</span>
                                    </button>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 justify-end pt-3 border-t border-brand-border/40 shrink-0">
                          {clusterEditTarget.type === 'default' && (
                            <span className="text-[9.5px] text-brand-muted mr-auto max-w-[50%] leading-tight text-left">
                              💡 Editing default templates promotes them to your custom active rules.
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            onClick={() => setClusterEditTarget(null)}
                            className="px-4 py-2 text-xs text-brand-muted border border-brand-border"
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={handleSaveClusterEdit}
                            className="px-5 py-2 text-xs text-white bg-brand-accent hover:bg-brand-accent/90 shadow-md font-bold"
                          >
                            Save Changes
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* Grid / List Visualization Modes */}
        <AnimatePresence mode="popLayout">
          {itemViewMode === 'cards' ? (
            /* Cards View (Standard cards - 4 per row) */
            <motion.div 
              key="cards-view"
              layout
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
            >
              {filteredItems.map((item, index) => {
                const rankDisplay = scrobbleRankMap[item.id] ?? item.rank ?? (index + 1);
                return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={cn(
                    "group relative transition-all hover:z-30",
                    selectedIds.includes(item.id) ? "translate-y-[-4px]" : ""
                  )}
                >
                  {/* Selection Overlay */}
                  <button 
                    onClick={(e) => toggleSelection(item.id, e)}
                    className={cn(
                      "absolute top-3 left-3 z-30 h-6 w-6 rounded-lg border-2 flex items-center justify-center transition-all",
                      selectedIds.includes(item.id) 
                        ? "bg-brand-accent border-brand-accent text-white scale-110 shadow-lg" 
                        : "bg-black/20 border-white/50 text-white/0 opacity-0 group-hover:opacity-100"
                    )}
                  >
                    <CheckSquare className="h-4 w-4" />
                  </button>

                  <Card 
                    className={cn(
                      "neo-border h-full flex flex-col p-0 cursor-pointer active:scale-[0.98] transition-all relative overflow-visible rounded-xl",
                      selectedIds.includes(item.id) ? "border-brand-accent/50 ring-2 ring-brand-accent/20" : ""
                    )}
                    onClick={(e: React.MouseEvent) => {
                      if ((e.ctrlKey || e.metaKey) && item.url) {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(item.url, '_blank', 'noopener,noreferrer');
                      } else {
                        setDetailItem(item);
                      }
                    }}
                    onAuxClick={(e: React.MouseEvent) => {
                      if (e.button === 1 && item.url) {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(item.url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    title={item.url ? `${item.name} • Rank #${rankDisplay} • Click to view details • Ctrl+Click (or Cmd+Click) to open link directly` : `${item.name} • Rank #${rankDisplay}`}
                  >
                    <div className="aspect-square bg-brand-border relative overflow-hidden rounded-t-xl">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-brand-muted">
                          <Music className="h-12 w-12" />
                        </div>
                      )}

                      {/* Rank Badge on Cover Image */}
                      <div 
                        className="absolute top-2.5 left-10 z-20 bg-black/80 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-amber-300 border border-amber-400/40 shadow-md flex items-center gap-0.5" 
                        title={`Rank #${rankDisplay}`}
                      >
                        <span>#{rankDisplay}</span>
                      </div>

                      <div className="absolute top-2.5 right-2.5 glass px-2 py-1 rounded text-[10px] uppercase font-bold tracking-widest flex items-center gap-1.5 z-20">
                        <button
                          type="button"
                          onClick={(e) => handleToggleLookingInto(item, e)}
                          className="p-0.5 hover:scale-125 transition-all cursor-pointer flex items-center justify-center focus:outline-none"
                          title={isLookingInto(item) ? "Tagged as #looking-into (Click to remove tag)" : "Tag as #looking-into"}
                        >
                          {renderLookingIntoIcon(isLookingInto(item))}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleCycleFavoriteStar(item, e)}
                          className="p-0.5 hover:scale-125 transition-all cursor-pointer flex items-center justify-center focus:outline-none"
                          title={getStarTitle(getStarLevel(item))}
                        >
                          {renderStarIcon(getStarLevel(item))}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => promptDeleteSingleItem(item, e)}
                          className="p-0.5 hover:scale-125 text-white/70 hover:text-red-400 transition-all cursor-pointer flex items-center justify-center focus:outline-none"
                          title="Delete item from library"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-0.5 hover:scale-125 text-white/70 hover:text-brand-accent transition-all cursor-pointer flex items-center justify-center focus:outline-none"
                            title="Open associated link directly (or Ctrl+Click card)"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {analyzingId === item.id ? (
                          <div className="h-2 w-2 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
                        ) : (!item.aiAnalyzed) ? (
                          <div className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
                        ) : null}
                        {analyzingId === item.id ? (
                          <span>Analyzing...</span>
                        ) : activeTab === 'all' ? (
                          <span>{item.type}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="p-3.5 flex-1 flex flex-col justify-between min-w-0">
                      {/* Fixed height title & artist block so vibe/genre cluster position is strictly aligned */}
                      <div className="min-h-[42px] flex flex-col justify-center mb-1.5">
                        <h3 className="font-bold text-base leading-tight line-clamp-1 text-brand-text group-hover:text-brand-accent transition-colors" title={item.name}>
                          {item.name}
                        </h3>
                        {item.parentName ? (
                          <p className="text-brand-muted text-xs line-clamp-1 mt-0.5" title={item.parentName}>
                            {item.parentName}
                          </p>
                        ) : (
                          <span className="text-xs text-transparent select-none mt-0.5">&nbsp;</span>
                        )}
                      </div>

                      {/* Stats Pill Row with Rank, Familiarity, Scrobbles, and Relevance across all items */}
                      <div className="flex items-center gap-1.5 flex-wrap text-[10.5px] font-mono mb-2 py-1 px-2.5 rounded-lg bg-brand-bg/90 border border-brand-border/60">
                        <div className="flex items-center gap-0.5 text-amber-400 font-bold" title={`Rank #${rankDisplay}`}>
                          <span className="text-[9px] uppercase font-bold text-amber-500/70">#</span>
                          <span>{rankDisplay}</span>
                        </div>
                        <span className="text-brand-border">•</span>
                        <div className="flex items-center gap-1 text-brand-text" title={`Familiarity: ${item.familiarity || 0}%`}>
                          <span className="text-[9px] uppercase font-bold text-brand-muted">Fam</span>
                          <span className="text-brand-accent font-bold">{item.familiarity || 0}%</span>
                        </div>
                        {item.lastFmPlaycount !== undefined && (
                          <>
                            <span className="text-brand-border">•</span>
                            {item.lastFmPeriodPlaycount !== undefined && item.lastFmPeriod && item.lastFmPeriod !== 'overall' ? (
                              <div 
                                className="flex items-center gap-1 text-red-400 font-medium" 
                                title={`${Number(item.lastFmPeriodPlaycount).toLocaleString()} scrobbles in ${getTimeframeFullLabel(item.lastFmPeriod)} • ${item.lastFmPlaycount !== undefined ? Number(item.lastFmPlaycount).toLocaleString() : '0'} total lifetime scrobbles`}
                              >
                                <Radio className="h-3 w-3 text-red-500 shrink-0" />
                                <span>{Number(item.lastFmPeriodPlaycount).toLocaleString()}/{getTimeframeShortLabel(item.lastFmPeriod)}</span>
                                <span className="text-[9px] text-brand-muted font-normal">({Number(item.lastFmPlaycount).toLocaleString()} tot)</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-red-400 font-medium" title={`Total Lifetime Scrobbles: ${Number(item.lastFmPlaycount).toLocaleString()} plays`}>
                                <Radio className="h-3 w-3 text-red-500 shrink-0" />
                                <span>{Number(item.lastFmPlaycount).toLocaleString()}</span>
                              </div>
                            )}
                          </>
                        )}
                        {item.relevance !== undefined && item.relevance !== null && item.relevance > 0 ? (
                          <>
                            <span className="text-brand-border">•</span>
                            <div className="flex items-center gap-1 text-brand-accent font-medium" title={`Relevance: ${item.relevance}%`}>
                              <span className="text-[9px] uppercase font-bold text-brand-muted">Rel</span>
                              <span>{item.relevance}%</span>
                            </div>
                          </>
                        ) : null}
                      </div>

                      {/* Vibe / Genre Cluster Badge Slot - Always at exact same Y position on every card */}
                      <div className="min-h-[26px] mb-2 flex items-center">
                        <ItemClusterBadges item={item} activeClusters={activeClusters} viewMode="cards" onUpdateItem={updateItem} />
                      </div>

                      {/* Tags section - shows more than 3 tags, never exceeds 2 rows, shows +X for remaining */}
                      {item.tags && item.tags.length > 0 && (() => {
                        const maxDisplay = 5;
                        const hasMore = item.tags.length > maxDisplay;
                        const visibleTags = hasMore ? item.tags.slice(0, 4) : item.tags;
                        const remainingCount = item.tags.length - visibleTags.length;

                        return (
                          <div 
                            className="flex flex-wrap gap-1 items-center border-t border-brand-border/30 pt-2 mt-auto min-h-[28px]"
                            title={item.tags.map(t => `#${t}`).join(', ')}
                          >
                            {visibleTags.map(tag => {
                              const src = getTagSource(item, tag);
                              return (
                                <span 
                                  key={tag} 
                                  title={src === 'lastfm' ? `#${tag} (Synced from Last.fm)` : src === 'llm' ? `#${tag} (Auto-added by AI)` : `#${tag} (Manually added)`} 
                                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium bg-brand-bg/80 border border-brand-border/60 text-brand-text h-[19px] leading-none shrink-0 max-w-[110px]"
                                >
                                  <span className={cn("font-bold shrink-0", src === 'lastfm' ? "text-red-400" : src === 'llm' ? "text-orange-400" : "text-emerald-400")}>#</span>
                                  <span className={cn("border-b pb-[1px] truncate", src === 'lastfm' ? "border-red-400/40" : src === 'llm' ? "border-orange-400/40" : "border-emerald-400/40")}>{tag}</span>
                                </span>
                              );
                            })}
                            {hasMore && (
                              <span 
                                title={`+${remainingCount} more tags: ${item.tags.slice(visibleTags.length).map(t => `#${t}`).join(', ')}`}
                                className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-semibold bg-brand-bg/90 border border-brand-border/60 text-brand-muted h-[19px] leading-none shrink-0 cursor-help hover:text-brand-text hover:border-brand-accent/50 transition-colors"
                              >
                                +{remainingCount}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </Card>
                </motion.div>
                );
              })}
            </motion.div>
          ) : itemViewMode === 'small-cards' ? (
            /* Small Cards View (75% larger than before) */
            <motion.div 
              key="small-cards-view"
              layout
              className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
            >
              {filteredItems.map((item, index) => {
                const rankDisplay = scrobbleRankMap[item.id] ?? item.rank ?? (index + 1);
                return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={cn(
                    "group relative transition-all hover:z-30",
                    selectedIds.includes(item.id) ? "scale-[1.02]" : ""
                  )}
                >
                  {/* Selection Overlay */}
                  <button 
                    onClick={(e) => toggleSelection(item.id, e)}
                    className={cn(
                      "absolute top-2.5 left-2.5 z-30 h-5.5 w-5.5 rounded border flex items-center justify-center transition-all",
                      selectedIds.includes(item.id) 
                        ? "bg-brand-accent border-brand-accent text-white scale-110 shadow-md" 
                        : "bg-black/40 border-white/50 text-white/0 opacity-0 group-hover:opacity-100"
                    )}
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                  </button>

                  <Card 
                    className={cn(
                      "neo-border h-full flex flex-col p-0 cursor-pointer active:scale-[0.98] transition-all hover:border-brand-accent/50 relative overflow-visible rounded-xl",
                      selectedIds.includes(item.id) ? "border-brand-accent ring-1 ring-brand-accent/30" : ""
                    )}
                    onClick={(e: React.MouseEvent) => {
                      if ((e.ctrlKey || e.metaKey) && item.url) {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(item.url, '_blank', 'noopener,noreferrer');
                      } else {
                        setDetailItem(item);
                      }
                    }}
                    onAuxClick={(e: React.MouseEvent) => {
                      if (e.button === 1 && item.url) {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(item.url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    title={item.url ? `${item.name} • Rank #${rankDisplay} • Click for details • Ctrl+Click to open link` : `${item.name} • Rank #${rankDisplay}`}
                  >
                    {/* Cover Container */}
                    <div className="aspect-square bg-brand-border relative overflow-hidden rounded-t-xl">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-brand-muted">
                          <Music className="h-8 w-8" />
                        </div>
                      )}

                      {/* Rank Badge on Cover Image */}
                      <div 
                        className="absolute top-2 left-9 z-20 bg-black/80 backdrop-blur-md px-1.5 py-0.5 rounded text-[9px] font-mono font-bold text-amber-300 border border-amber-400/40 shadow-sm flex items-center gap-0.5" 
                        title={`Rank #${rankDisplay}`}
                      >
                        <span>#{rankDisplay}</span>
                      </div>

                      {/* Top Action Overlay Icons */}
                      <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded-md text-[9px] uppercase font-bold flex items-center gap-1 z-20">
                        <button
                          type="button"
                          onClick={(e) => handleToggleLookingInto(item, e)}
                          className="p-0.5 hover:scale-125 transition-all cursor-pointer flex items-center justify-center"
                          title={isLookingInto(item) ? "Tagged as #looking-into" : "Tag as #looking-into"}
                        >
                          {renderLookingIntoIcon(isLookingInto(item))}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleCycleFavoriteStar(item, e)}
                          className="p-0.5 hover:scale-125 transition-all cursor-pointer flex items-center justify-center"
                          title={getStarTitle(getStarLevel(item))}
                        >
                          {renderStarIcon(getStarLevel(item))}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => promptDeleteSingleItem(item, e)}
                          className="p-0.5 hover:scale-125 text-white/70 hover:text-red-400 transition-all cursor-pointer flex items-center justify-center"
                          title="Delete item from library"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-0.5 hover:scale-125 text-white/70 hover:text-brand-accent transition-all cursor-pointer flex items-center justify-center"
                            title="Open link"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Small Card Body */}
                    <div className="p-3 flex-1 flex flex-col justify-start gap-2 min-w-0">
                      {/* Fixed height title & artist header so cluster badge is always in exact same Y position */}
                      <div className="min-h-[36px] flex flex-col justify-center">
                        <h3 className="font-bold text-sm leading-tight line-clamp-1 text-brand-text group-hover:text-brand-accent transition-colors">
                          {item.name}
                        </h3>
                        {item.parentName && (
                          <p className="text-brand-muted text-xs line-clamp-1 mt-0.5">
                            {item.parentName}
                          </p>
                        )}
                      </div>

                      {/* Main Genre / Vibe Cluster - Always near top in exact same position */}
                      <div>
                        <ItemClusterBadges item={item} activeClusters={activeClusters} viewMode="small-cards" onUpdateItem={updateItem} />
                      </div>

                      {/* Stats Pill Row with Rank, Familiarity, Scrobbles, and Relevance across all items */}
                      <div className="flex items-center gap-1.5 flex-wrap text-[9.5px] font-mono py-1 px-2 rounded-md bg-brand-bg/90 border border-brand-border/60">
                        <div className="flex items-center gap-0.5 text-amber-400 font-bold" title={`Rank #${rankDisplay}`}>
                          <span className="text-[8px] uppercase font-bold text-amber-500/70">#</span>
                          <span>{rankDisplay}</span>
                        </div>
                        <span className="text-brand-border">•</span>
                        <div className="flex items-center gap-0.5 text-brand-text font-semibold" title={`Familiarity: ${item.familiarity || 0}%`}>
                          <span className="text-[8.5px] uppercase font-bold text-brand-muted">Fam</span>
                          <span className="text-brand-accent font-bold">{item.familiarity || 0}%</span>
                        </div>
                        {item.lastFmPlaycount !== undefined && (
                          <>
                            <span className="text-brand-border">•</span>
                            {item.lastFmPeriodPlaycount !== undefined && item.lastFmPeriod && item.lastFmPeriod !== 'overall' ? (
                              <div 
                                className="flex items-center gap-0.5 text-red-400 font-semibold" 
                                title={`${Number(item.lastFmPeriodPlaycount).toLocaleString()} scrobbles in ${getTimeframeFullLabel(item.lastFmPeriod)} • ${item.lastFmPlaycount !== undefined ? Number(item.lastFmPlaycount).toLocaleString() : '0'} total lifetime scrobbles`}
                              >
                                <Radio className="h-2.5 w-2.5 text-red-500 shrink-0" />
                                <span>{Number(item.lastFmPeriodPlaycount).toLocaleString()}/{getTimeframeShortLabel(item.lastFmPeriod)}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-0.5 text-red-400 font-semibold" title={`Total Lifetime Scrobbles: ${Number(item.lastFmPlaycount).toLocaleString()}`}>
                                <Radio className="h-2.5 w-2.5 text-red-500 shrink-0" />
                                <span>{Number(item.lastFmPlaycount).toLocaleString()}</span>
                              </div>
                            )}
                          </>
                        )}
                        {item.relevance !== undefined && item.relevance !== null && item.relevance > 0 ? (
                          <>
                            <span className="text-brand-border">•</span>
                            <div className="flex items-center gap-0.5 text-brand-accent font-semibold" title={`Relevance: ${item.relevance}%`}>
                              <span className="text-[8.5px] uppercase font-bold text-brand-muted">Rel</span>
                              <span>{item.relevance}%</span>
                            </div>
                          </>
                        ) : null}
                      </div>

                      {/* Tags section - limited to max 3 tags to keep small cards compact (max ~3 lines) */}
                      {(activeTab === 'all' || (item.tags && item.tags.length > 0)) && (
                        <div className="flex flex-col gap-1 text-[10px] text-brand-muted font-mono border-t border-brand-border/30 pt-1.5">
                          <div className="flex flex-wrap items-center gap-1 min-w-0 max-h-[68px] overflow-hidden">
                            {activeTab === 'all' && (
                              <span className="uppercase font-bold tracking-wider text-[9px] text-brand-accent shrink-0 mr-0.5 bg-brand-accent/10 px-1.5 py-0.5 rounded border border-brand-accent/20">
                                {item.type}
                              </span>
                            )}
                            {item.tags && item.tags.slice(0, 3).map(tag => {
                              const src = getTagSource(item, tag);
                              return (
                                <span 
                                  key={tag} 
                                  title={src === 'lastfm' ? `#${tag} (Synced from Last.fm)` : src === 'llm' ? `#${tag} (Auto-added by AI)` : `#${tag} (Manually added)`} 
                                  className="inline-flex items-center gap-0.5 text-[9.5px] px-1.5 py-0.5 rounded font-medium bg-brand-bg/80 border border-brand-border/60 text-brand-text max-w-full"
                                >
                                  <span className={cn("font-bold shrink-0", src === 'lastfm' ? "text-red-400" : src === 'llm' ? "text-orange-400" : "text-emerald-400")}>#</span>
                                  <span className={cn("truncate border-b pb-[1px]", src === 'lastfm' ? "border-red-400/40" : src === 'llm' ? "border-orange-400/40" : "border-emerald-400/40")}>{tag}</span>
                                </span>
                              );
                            })}
                            {item.tags && item.tags.length > 3 && (
                              <span 
                                className="text-[9.5px] text-brand-muted bg-brand-bg/60 border border-brand-border/40 px-1 py-0.5 rounded cursor-help font-semibold shrink-0"
                                title={item.tags.slice(3).map(t => `#${t}`).join(', ')}
                              >
                                +{item.tags.length - 3}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                </motion.div>
                );
              })}
            </motion.div>
          ) : (
            /* List View */
            <motion.div 
              key="list-view"
              layout
              className="flex flex-col space-y-1.5"
            >
              {filteredItems.map((item, index) => {
                const rankDisplay = scrobbleRankMap[item.id] ?? item.rank ?? (index + 1);
                return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="group relative hover:z-30"
                >
                  <Card 
                    className={cn(
                      "neo-border px-3 py-2 flex items-center justify-between gap-3 cursor-pointer transition-all hover:border-brand-accent/50 active:scale-[0.995] relative overflow-visible rounded-xl",
                      selectedIds.includes(item.id) ? "border-brand-accent ring-1 ring-brand-accent/30 bg-brand-accent/5" : ""
                    )}
                    onClick={(e: React.MouseEvent) => {
                      if ((e.ctrlKey || e.metaKey) && item.url) {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(item.url, '_blank', 'noopener,noreferrer');
                      } else {
                        setDetailItem(item);
                      }
                    }}
                    onAuxClick={(e: React.MouseEvent) => {
                      if (e.button === 1 && item.url) {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(item.url, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    title={item.url ? `${item.name} • Rank #${rankDisplay} • Click for details • Ctrl+Click to open link` : `${item.name} • Rank #${rankDisplay}`}
                  >
                    {/* Left Section: Checkbox + Rank Badge + Small Album Cover + Cluster Badge + Title & Left-Aligned Tags */}
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <button 
                        onClick={(e) => toggleSelection(item.id, e)}
                        className={cn(
                          "h-4.5 w-4.5 rounded border flex items-center justify-center shrink-0 transition-all",
                          selectedIds.includes(item.id) 
                            ? "bg-brand-accent border-brand-accent text-white scale-105" 
                            : "bg-brand-bg border-brand-border text-white/0 hover:border-brand-accent/60"
                        )}
                      >
                        <CheckSquare className="h-3 w-3" />
                      </button>

                      {/* Rank Badge in List View */}
                      <span 
                        className="min-w-[32px] px-1.5 py-0.5 text-center text-[10px] font-mono font-bold bg-brand-bg border border-brand-border/80 text-amber-300 rounded shrink-0 shadow-sm inline-flex items-center justify-center leading-none" 
                        title={`Rank #${rankDisplay}`}
                      >
                        #{rankDisplay}
                      </span>

                      {/* Cover image half size (h-6 w-6 ~ 24px) */}
                      <div className="h-6 w-6 rounded-md bg-brand-border shrink-0 overflow-hidden relative shadow-sm">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-brand-muted">
                            <Music className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </div>

                      {/* Main Title, Parent, Type Badge, Vibe/Genre Clusters, and Right-aligned Compact Two-Line Tags */}
                      <div className="min-w-0 flex-1 flex flex-col md:flex-row md:items-center justify-between gap-1.5 md:gap-3">
                        <div className="flex items-center gap-2 min-w-0 flex-1 shrink overflow-hidden">
                          <h3 className="font-bold text-xs sm:text-sm text-brand-text truncate shrink min-w-0 group-hover:text-brand-accent transition-colors">
                            {item.name}
                          </h3>
                          {item.parentName && (
                            <span className="text-xs text-brand-muted truncate shrink min-w-0">
                              • {item.parentName}
                            </span>
                          )}
                          {activeTab === 'all' && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wider bg-brand-bg border border-brand-border text-brand-accent shrink-0">
                              {item.type}
                            </span>
                          )}
                          {item.songCount !== undefined && item.songCount > 0 && (
                            <span className="text-[10px] font-mono text-brand-muted bg-brand-bg/60 border border-brand-border/40 px-1.5 py-0.5 rounded shrink-0 hidden sm:inline-block">
                              {item.songCount} songs
                            </span>
                          )}
                          {/* Stats in List View */}
                          <div className="flex items-center gap-1.5 text-[9.5px] font-mono bg-brand-bg/90 border border-brand-border/60 px-2 py-0.5 rounded-md shrink-0 whitespace-nowrap">
                            <span title={`Familiarity: ${item.familiarity || 0}%`} className="flex items-center gap-0.5">
                              <span className="text-[8px] uppercase font-bold text-brand-muted">Fam</span>
                              <span className="text-brand-accent font-bold">{item.familiarity || 0}%</span>
                            </span>
                            {item.lastFmPlaycount !== undefined && (
                              <>
                                <span className="text-brand-border">•</span>
                                {item.lastFmPeriodPlaycount !== undefined && item.lastFmPeriod && item.lastFmPeriod !== 'overall' ? (
                                  <span 
                                    title={`${Number(item.lastFmPeriodPlaycount).toLocaleString()} scrobbles in ${getTimeframeFullLabel(item.lastFmPeriod)} • ${Number(item.lastFmPlaycount).toLocaleString()} total lifetime scrobbles`} 
                                    className="flex items-center gap-1 text-red-400 font-medium"
                                  >
                                    <Radio className="h-2.5 w-2.5 text-red-500 shrink-0" />
                                    <span>{Number(item.lastFmPeriodPlaycount).toLocaleString()}/{getTimeframeShortLabel(item.lastFmPeriod)}</span>
                                    <span className="text-[8px] text-brand-muted">({Number(item.lastFmPlaycount).toLocaleString()} tot)</span>
                                  </span>
                                ) : (
                                  <span title={`Total Lifetime Scrobbles: ${Number(item.lastFmPlaycount).toLocaleString()}`} className="flex items-center gap-1 text-red-400 font-medium">
                                    <Radio className="h-2.5 w-2.5 text-red-500 shrink-0" />
                                    <span>{Number(item.lastFmPlaycount).toLocaleString()}</span>
                                  </span>
                                )}
                              </>
                            )}
                            {item.relevance !== undefined && item.relevance !== null && item.relevance > 0 ? (
                              <>
                                <span className="text-brand-border">•</span>
                                <span title={`Relevance: ${item.relevance}%`} className="flex items-center gap-0.5 text-brand-accent font-medium">
                                  <span className="text-[8px] uppercase font-bold text-brand-muted">Rel</span>
                                  <span>{item.relevance}%</span>
                                </span>
                              </>
                            ) : null}
                          </div>

                          {/* Cluster Badge to the right of title / type identifier, and to the left of tags */}
                          <ItemClusterBadges item={item} activeClusters={activeClusters} viewMode="list" onUpdateItem={updateItem} />
                        </div>

                        {/* Tags (split into two balanced, compact rows occupying minimal horizontal width) */}
                        {item.tags && item.tags.length > 0 && (() => {
                          const totalVisible = Math.min(4, item.tags.length);
                          const splitIndex = totalVisible <= 2 ? 1 : 2;
                          const row1Tags = item.tags.slice(0, splitIndex);
                          const row2Tags = item.tags.slice(splitIndex, totalVisible);
                          const remainingCount = item.tags.length - totalVisible;

                          return (
                            <div className="flex flex-col items-start md:items-end gap-0.5 shrink-0 ml-auto max-w-[170px] sm:max-w-[200px]">
                              {/* Row 1 */}
                              <div className="flex items-center gap-1 flex-nowrap max-w-full overflow-hidden justify-start md:justify-end">
                                {row1Tags.map(tag => {
                                  const src = getTagSource(item, tag);
                                  return (
                                    <span 
                                      key={tag} 
                                      title={src === 'lastfm' ? `#${tag} (Synced from Last.fm)` : src === 'llm' ? `#${tag} (Auto-added by AI)` : `#${tag} (Manually added)`} 
                                      className="inline-flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded bg-brand-bg/80 border border-brand-border/60 text-brand-text max-w-[80px] sm:max-w-[92px] truncate hover:max-w-none transition-all cursor-pointer font-medium leading-none shrink-0"
                                    >
                                      <span className={cn("font-bold shrink-0", src === 'lastfm' ? "text-red-400" : src === 'llm' ? "text-orange-400" : "text-emerald-400")}>#</span>
                                      <span className={cn("truncate border-b pb-[0.5px]", src === 'lastfm' ? "border-red-400/40" : src === 'llm' ? "border-orange-400/40" : "border-emerald-400/40")}>{tag}</span>
                                    </span>
                                  );
                                })}
                              </div>

                              {/* Row 2 */}
                              {(row2Tags.length > 0 || remainingCount > 0) && (
                                <div className="flex items-center gap-1 flex-nowrap max-w-full overflow-hidden justify-start md:justify-end">
                                  {row2Tags.map(tag => {
                                    const src = getTagSource(item, tag);
                                    return (
                                      <span 
                                        key={tag} 
                                        title={src === 'lastfm' ? `#${tag} (Synced from Last.fm)` : src === 'llm' ? `#${tag} (Auto-added by AI)` : `#${tag} (Manually added)`} 
                                        className="inline-flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded bg-brand-bg/80 border border-brand-border/60 text-brand-text max-w-[80px] sm:max-w-[92px] truncate hover:max-w-none transition-all cursor-pointer font-medium leading-none shrink-0"
                                      >
                                        <span className={cn("font-bold shrink-0", src === 'lastfm' ? "text-red-400" : src === 'llm' ? "text-orange-400" : "text-emerald-400")}>#</span>
                                        <span className={cn("truncate border-b pb-[0.5px]", src === 'lastfm' ? "border-red-400/40" : src === 'llm' ? "border-orange-400/40" : "border-emerald-400/40")}>{tag}</span>
                                      </span>
                                    );
                                  })}
                                  {remainingCount > 0 && (
                                    <span 
                                      title={item.tags.slice(totalVisible).map(t => `#${t}`).join(', ')} 
                                      className="text-[8.5px] font-mono font-semibold text-brand-muted bg-brand-bg/60 border border-brand-border/40 px-1.5 py-0.5 rounded cursor-help shrink-0 leading-none"
                                    >
                                      +{remainingCount}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Right Section: Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleToggleLookingInto(item, e)}
                        className="p-1 hover:bg-brand-bg rounded-lg transition-all cursor-pointer text-brand-muted hover:text-brand-accent"
                        title={isLookingInto(item) ? "Tagged as #looking-into (Click to remove)" : "Tag as #looking-into"}
                      >
                        {renderLookingIntoIcon(isLookingInto(item))}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => handleCycleFavoriteStar(item, e)}
                        className="p-1 hover:bg-brand-bg rounded-lg transition-all cursor-pointer text-brand-muted hover:text-brand-accent"
                        title={getStarTitle(getStarLevel(item))}
                      >
                        {renderStarIcon(getStarLevel(item))}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => promptDeleteSingleItem(item, e)}
                        className="p-1 hover:bg-brand-bg rounded-lg text-brand-muted hover:text-red-400 transition-all cursor-pointer"
                        title="Delete item from library"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>

                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 hover:bg-brand-bg rounded-lg text-brand-muted hover:text-brand-accent transition-all"
                          title="Open link in new tab"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </Card>
                </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {filteredItems.length === 0 && (
          <div className="py-20 text-center space-y-4">
            <div className="h-16 w-16 bg-brand-card rounded-full flex items-center justify-center mx-auto text-brand-muted">
              <Search className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-medium">No items found</h3>
            <p className="text-brand-muted">Try adjusting your filters or import some links.</p>
          </div>
        )}
      </main>

      {/* Mobile Bottom Nav */}
      <footer className="md:hidden fixed bottom-0 left-0 right-0 glass border-t border-brand-border flex justify-around p-2 z-40">
        {[
          { id: 'all', icon: Library },
          { id: 'artist', icon: UserIcon },
          { id: 'album', icon: Disc },
          { id: 'playlist', icon: ListMusic },
          { id: 'track', icon: Music },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              'p-3 rounded-xl transition-all',
              activeTab === tab.id ? 'text-brand-accent bg-brand-accent/10' : 'text-brand-muted'
            )}
          >
            <tab.icon className="h-6 w-6" />
          </button>
        ))}
      </footer>

      {/* --- Modals --- */}

      {/* Bulk Tag Edit Modal */}
      <AnimatePresence>
        {bulkTagEditModalOpen && (
          <div className="fixed inset-0 z-[65] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setBulkTagEditModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-brand-card border border-brand-border rounded-3xl p-6 shadow-2xl overflow-hidden glass max-h-[85vh] flex flex-col z-10"
            >
              <button 
                onClick={() => setBulkTagEditModalOpen(false)}
                className="absolute top-4 right-4 p-2 text-brand-muted hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex items-center gap-2 border-b border-brand-border/40 pb-3 mb-4 shrink-0">
                <Tag className="h-5 w-5 text-brand-accent" />
                <h2 className="text-lg font-bold text-brand-text">Bulk Edit {selectedTagsForMgmt.length} Tags</h2>
              </div>

              <div className="space-y-4 overflow-y-auto pr-1 flex-1">
                <div>
                  <label className="block text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-1.5">Selected Tags ({selectedTagsForMgmt.length}):</label>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-2 bg-brand-bg/60 border border-brand-border/60 rounded-xl">
                    {selectedTagsForMgmt.map(t => (
                      <span key={t} className="text-xs font-mono font-semibold bg-brand-accent/20 border border-brand-accent/30 text-brand-accent px-2 py-0.5 rounded-md">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-1.5">Rename or Merge Selected Tags To (Optional):</label>
                  <input 
                    type="text"
                    value={bulkTagNewName}
                    onChange={(e) => setBulkTagNewName(e.target.value)}
                    placeholder="e.g. electronic-synth (leave blank to keep individual names)"
                    className="w-full bg-brand-bg border border-brand-border rounded-xl px-3.5 py-2.5 text-xs text-brand-text outline-none focus:border-brand-accent"
                  />
                  <p className="text-[10px] text-brand-muted mt-1 leading-normal">
                    Entering a name here will replace all {selectedTagsForMgmt.length} selected tags with this new merged tag across all music items.
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-1.5">Assign Selected Tags to Clusters:</label>
                  <div className="space-y-1.5 border border-brand-border/60 rounded-xl p-3 bg-brand-bg/60 max-h-48 overflow-y-auto">
                    {(() => {
                      const currentClusters = aiClusters || getLocalClusters(allTags).filter(c => c.name !== "Other Curation Tags");
                      if (currentClusters.length === 0) {
                        return <p className="text-xs text-brand-muted text-center py-2">No active clusters found.</p>;
                      }
                      return currentClusters.map(cluster => {
                        const isChecked = bulkTagClusters.includes(cluster.name);
                        return (
                          <label key={cluster.name} className="flex items-center gap-2.5 p-1.5 hover:bg-brand-card/60 rounded-lg cursor-pointer text-xs text-brand-text select-none">
                            <input 
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setBulkTagClusters(prev => 
                                  isChecked ? prev.filter(c => c !== cluster.name) : [...prev, cluster.name]
                                );
                              }}
                              className="rounded border-brand-border text-brand-accent focus:ring-brand-accent bg-brand-bg accent-brand-accent"
                            />
                            <span className="font-semibold">{cluster.name}</span>
                          </label>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>

              <div className="pt-4 mt-2 border-t border-brand-border/40 flex gap-3 justify-end shrink-0">
                <Button variant="secondary" onClick={() => setBulkTagEditModalOpen(false)} className="py-2 px-4 text-xs font-bold">
                  Cancel
                </Button>
                <Button onClick={handleBulkEditTagsSubmit} className="py-2 px-5 text-xs font-bold text-white bg-brand-accent">
                  Apply Bulk Changes
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bulk Edit Modal */}
      <AnimatePresence>
        {bulkEditModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setBulkEditModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-brand-card border border-brand-border rounded-3xl p-8 shadow-2xl overflow-hidden"
            >
              <button 
                onClick={() => setBulkEditModalOpen(false)}
                className="absolute top-4 right-4 p-2 text-brand-muted hover:text-white"
              >
                <X className="h-6 w-6" />
              </button>
              
              <h2 className="text-2xl font-bold mb-6">Bulk Edit {selectedIds.length} Items</h2>
              
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-sm font-bold uppercase tracking-widest text-brand-muted">Tag Action</label>
                  <div className="flex bg-brand-bg rounded-xl p-1 border border-brand-border gap-1">
                    <button 
                      onClick={() => setBulkActionType('addTags')}
                      className={cn("flex-1 py-2 rounded-lg text-xs font-medium transition-all", bulkActionType === 'addTags' ? "bg-brand-accent text-white" : "text-brand-muted hover:text-brand-text")}
                    >
                      Add Tags
                    </button>
                    <button 
                      onClick={() => setBulkActionType('setTags')}
                      className={cn("flex-1 py-2 rounded-lg text-xs font-medium transition-all", bulkActionType === 'setTags' ? "bg-brand-accent text-white" : "text-brand-muted hover:text-brand-text")}
                    >
                      Replace All
                    </button>
                    <button 
                      onClick={() => setBulkActionType('combined')}
                      className={cn("flex-1 py-2 rounded-lg text-xs font-medium transition-all", bulkActionType === 'combined' ? "bg-brand-accent text-white" : "text-brand-muted hover:text-brand-text")}
                    >
                      No Change
                    </button>
                  </div>
                  {bulkActionType !== 'combined' && (
                    <input
                      type="text"
                      placeholder="tag1, tag2, tag3"
                      value={bulkTagInput}
                      onChange={(e) => setBulkTagInput(e.target.value)}
                      className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 outline-none focus:border-brand-accent text-sm"
                    />
                  )}
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-bold uppercase tracking-widest text-brand-muted">Update Relevance (0-100)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="Leave blank to keep current"
                    value={bulkRelevanceInput}
                    onChange={(e) => setBulkRelevanceInput(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 outline-none focus:border-brand-accent text-sm"
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-bold uppercase tracking-widest text-brand-muted">Update Familiarity (0-100)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="Leave blank to keep current"
                    value={bulkFamiliarityInput}
                    onChange={(e) => setBulkFamiliarityInput(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 outline-none focus:border-brand-accent text-sm"
                  />
                </div>

                <div className="pt-4 flex gap-3">
                  <Button variant="secondary" onClick={() => setBulkEditModalOpen(false)} className="flex-1">Cancel</Button>
                  <Button 
                    onClick={handleBulkUpdate}
                    className="flex-1"
                  >
                    Apply Changes
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {importModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setImportModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-brand-card border border-brand-border rounded-3xl p-8 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-brand-accent" />
              <button 
                onClick={() => setImportModalOpen(false)}
                className="absolute top-4 right-4 p-2 text-brand-muted hover:text-white"
              >
                <X className="h-6 w-6" />
              </button>
              
              <h2 className="text-2xl font-bold mb-2">Import Metadata</h2>
              
              <div className="mb-6">
                <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-2 block">AI Model Choice (Free Tier Fallback Enabled)</label>
                <div className="grid grid-cols-2 gap-2">
                  {AVAILABLE_MODELS.map(model => (
                    <button
                      key={model.id}
                      onClick={() => {
                        setPreferredAIModel(model.id);
                        saveUserSettings({ preferredAIModel: model.id });
                      }}
                      className={cn(
                        "px-3 py-2 rounded-xl text-xs font-medium border transition-all text-left",
                        preferredAIModel === model.id 
                          ? "bg-brand-accent/10 border-brand-accent text-brand-accent" 
                          : "bg-brand-bg border-brand-border text-brand-muted hover:border-brand-muted"
                      )}
                    >
                      {model.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex bg-brand-bg rounded-xl p-1 mb-6 border border-brand-border">
                <button 
                  onClick={() => setImportType('links')}
                  className={cn("flex-1 py-1 rounded-lg text-[10px] font-bold uppercase transition-all", importType === 'links' ? "bg-brand-accent text-white" : "text-brand-muted hover:text-brand-text")}
                >
                  Links
                </button>
                <button 
                  onClick={() => setImportType('playlists_sheet')}
                  className={cn("flex-1 py-1 rounded-lg text-[10px] font-bold uppercase transition-all", importType === 'playlists_sheet' ? "bg-brand-accent text-white" : "text-brand-muted hover:border-brand-text")}
                >
                  Playlists
                </button>
                <button 
                  onClick={() => setImportType('albums_sheet')}
                  className={cn("flex-1 py-1 rounded-lg text-[10px] font-bold uppercase transition-all", importType === 'albums_sheet' ? "bg-brand-accent text-white" : "text-brand-muted hover:border-brand-text")}
                >
                  Albums
                </button>
              </div>

              {importType === 'links' ? (
                <>
                  <p className="text-brand-muted mb-6 text-sm">Paste playlist, artist, album, or track links. Gemini will analyze and categorize them.</p>
                  <textarea
                    value={importLinks}
                    onChange={(e) => setImportLinks(e.target.value)}
                    placeholder="https://open.spotify.com/playlist/..."
                    className="w-full h-48 bg-brand-bg border border-brand-border rounded-2xl p-4 outline-none focus:border-brand-accent mb-6 resize-none font-mono text-sm"
                  />
                </>
              ) : (
                <div className="mb-6 space-y-6">
                  <div className="space-y-2">
                    <p className="text-brand-muted text-sm font-medium">Upload an Excel (.xlsx) file or paste data with these columns:</p>
                    <div className="bg-brand-bg border border-brand-border rounded-lg p-2 text-[10px] text-brand-muted flex flex-wrap gap-x-3 gap-y-1 font-mono uppercase">
                      {importType === 'playlists_sheet' ? (
                        <><span>1. URL</span><span>2. Title</span><span>3. Subtitle</span><span>4. # Songs</span><span>5. Length</span><span>6. Creator</span><span>7. Creator URL</span><span>8. Relevance</span><span>9. Tags</span></>
                      ) : (
                        <><span>1. Date</span><span>2. Album URL</span><span>3. Image URL</span><span>4. Album Name</span><span>5. Artist Name</span><span>6. Artist URL</span></>
                      )}
                    </div>
                  </div>

                  {!importFile ? (
                    <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-brand-border rounded-2xl hover:border-brand-accent transition-colors cursor-pointer group bg-brand-bg/50">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <Upload className="w-10 h-10 mb-3 text-brand-muted group-hover:text-brand-accent" />
                        <p className="mb-2 text-sm text-brand-text font-medium">Click to upload spreadsheet</p>
                        <p className="text-xs text-brand-muted">XLSX files only</p>
                      </div>
                      <input 
                        type="file" 
                        className="hidden" 
                        accept=".xlsx" 
                        onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                      />
                    </label>
                  ) : (
                    <div className="w-full h-48 border border-brand-accent bg-brand-accent/5 rounded-2xl p-6 flex flex-col items-center justify-center relative">
                      <button 
                        onClick={() => setImportFile(null)}
                        className="absolute top-4 right-4 p-1 hover:bg-brand-accent/20 rounded-full transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <FileSpreadsheet className="h-12 w-12 text-brand-accent mb-2" />
                      <p className="font-medium text-brand-text">{importFile.name}</p>
                      <p className="text-xs text-brand-muted">{(importFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  )}

                  <div className="relative">
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-brand-border" />
                    <span className="relative z-10 bg-brand-card px-4 text-[10px] font-bold text-brand-muted uppercase tracking-widest left-1/2 -translate-x-1/2">Or Paste Data</span>
                  </div>

                  <textarea
                    value={importLinks}
                    onChange={(e) => setImportLinks(e.target.value)}
                    placeholder={importType === 'playlists_sheet' ? "URL\tTitle\tSubtitle\t#Songs\tLength\tCreator\tURL\tRel\tTags" : "Date\tURL\tImage\tAlbum\tArtist\tArtistURL"}
                    className="w-full h-32 bg-brand-bg border border-brand-border rounded-2xl p-4 outline-none focus:border-brand-accent resize-none font-mono text-sm"
                  />
                </div>
              )}
              
              {isImporting && importProgress.total > 0 && (
                <div className="mb-6 space-y-2">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-brand-muted">
                    <span>Importing...</span>
                    <span>{importProgress.current} / {importProgress.total}</span>
                  </div>
                  <div className="h-2 w-full bg-brand-bg rounded-full overflow-hidden border border-brand-border">
                    <motion.div 
                      className="h-full bg-brand-accent"
                      initial={{ width: 0 }}
                      animate={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
              
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setImportModalOpen(false)} className="flex-1">Cancel</Button>
                <Button 
                  onClick={handleImport} 
                  disabled={isImporting || (importType === 'links' ? !importLinks.trim() : (!importFile && !importLinks.trim()))}
                  className="flex-1"
                >
                  {isImporting ? 'Processing...' : 'Import Metadata'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Item Modal */}
      <AnimatePresence>
        {detailItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDetailItem(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              className="relative w-full max-w-5xl h-[92vh] bg-brand-card border border-brand-border rounded-3xl shadow-2xl flex flex-col md:flex-row overflow-hidden"
            >
              <button 
                onClick={() => setDetailItem(null)}
                className="absolute top-4 right-4 z-10 p-2 glass rounded-full text-white"
              >
                <X className="h-6 w-6" />
              </button>

              {/* Left - Visual */}
              <div className="w-full md:w-1/2 bg-brand-border relative h-64 md:h-auto">
                {detailItem.imageUrl ? (
                  <img src={detailItem.imageUrl} alt={detailItem.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-brand-muted">
                    <Music className="h-20 w-20" />
                  </div>
                )}
                <div className="absolute top-4 left-4 glass px-2.5 py-1 rounded-lg text-xs uppercase font-bold tracking-widest flex items-center gap-2 z-20">
                  <button
                    type="button"
                    onClick={(e) => handleToggleLookingInto(detailItem, e)}
                    className="p-0.5 hover:scale-125 transition-all cursor-pointer flex items-center justify-center focus:outline-none"
                    title={isLookingInto(detailItem) ? "Tagged as #looking-into (Click to remove tag)" : "Tag as #looking-into"}
                  >
                    {renderLookingIntoIcon(isLookingInto(detailItem))}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleCycleFavoriteStar(detailItem, e)}
                    className="p-0.5 hover:scale-125 transition-all cursor-pointer flex items-center justify-center focus:outline-none"
                    title={getStarTitle(getStarLevel(detailItem))}
                  >
                    {renderStarIcon(getStarLevel(detailItem))}
                  </button>
                  <span>{detailItem.type}</span>
                </div>
                <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-brand-card to-transparent">
                  <span className="text-xs font-bold uppercase tracking-widest text-brand-accent mb-2 block">{detailItem.type}</span>
                  <h2 className="text-4xl font-bold mb-2">{detailItem.name}</h2>
                  {detailItem.subtitle && <p className="text-sm font-medium text-brand-accent/80 tracking-wide mb-1 uppercase">{detailItem.subtitle}</p>}
                  {detailItem.parentName && <p className="text-xl text-brand-muted">{detailItem.parentName}</p>}
                  {detailItem.creator && (
                    <div className="mt-4 flex items-center gap-2 text-sm text-brand-muted">
                      <span>Curated by</span>
                      {detailItem.creatorUrl ? (
                        <a href={detailItem.creatorUrl} target="_blank" rel="noreferrer" className="text-brand-text font-bold hover:text-brand-accent transition-colors flex items-center gap-1">
                          {detailItem.creator}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-brand-text font-bold">{detailItem.creator}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Right - Metadata */}
              <div className="flex-1 p-6 md:p-8 overflow-y-auto overflow-x-hidden space-y-6 md:space-y-8 min-w-0">
                {/* AI Analysis Status */}
                {detailItem.type === 'playlist' && (
                  <div className={cn(
                    "p-4 rounded-2xl flex items-center justify-between gap-4",
                    detailItem.aiAnalyzed ? "bg-green-500/10 border border-green-500/20" : "bg-orange-500/10 border border-orange-500/20"
                  )}>
                    <div className="flex items-center gap-3">
                      <div className={cn("h-2 w-2 rounded-full", detailItem.aiAnalyzed ? "bg-green-500" : "bg-orange-500 animate-pulse")} />
                      <div>
                        <p className={cn("text-xs font-bold uppercase tracking-widest", detailItem.aiAnalyzed ? "text-green-500" : "text-orange-500")}>
                          {detailItem.aiAnalyzed ? "AI Analyzed & Tagged" : "Pending AI Analysis"}
                        </p>
                        <p className="text-[10px] text-brand-muted mt-0.5">
                          {detailItem.aiAnalyzed ? "Enhanced metadata has been extracted" : "Analyze this playlist to extract deeper metadata and tags"}
                        </p>
                      </div>
                    </div>
                    {!detailItem.aiAnalyzed && (
                      <Button 
                        onClick={() => handleAnalyze(detailItem)} 
                        disabled={isAnalyzing}
                        className="py-1.5 px-3 text-xs flex items-center gap-2"
                      >
                        {isAnalyzing && analyzingId === detailItem.id && <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                        {isAnalyzing && analyzingId === detailItem.id ? "Analyzing..." : "Analyze Now"}
                      </Button>
                    )}
                  </div>
                )}

                {/* Common Stats */}
                <div className={cn(
                  "grid gap-2.5 sm:gap-3",
                  detailItem.type === 'track'
                    ? "grid-cols-2 sm:grid-cols-4"
                    : "grid-cols-2 sm:grid-cols-5"
                )}>
                  {/* Rank Card */}
                  <div className="bg-brand-bg border border-brand-border rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center flex flex-col justify-between min-w-0 overflow-hidden">
                    <span className="text-[10px] sm:text-[11px] font-bold text-amber-400 uppercase tracking-wider block mb-1 truncate px-0.5" title="Rank Position">Rank</span>
                    <span className="text-xl sm:text-2xl font-mono text-amber-300 font-bold truncate">#{scrobbleRankMap[detailItem.id] ?? detailItem.rank ?? '-'}</span>
                  </div>
                  <div className="bg-brand-bg border border-brand-border rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center flex flex-col justify-between min-w-0 overflow-hidden">
                    <span className="text-[10px] sm:text-[11px] font-bold text-brand-muted uppercase tracking-wider block mb-1 truncate px-0.5" title="Familiarity">Familiarity</span>
                    <span className="text-xl sm:text-2xl font-mono text-brand-accent font-bold truncate">{detailItem.familiarity || 0}%</span>
                  </div>
                  <div className="bg-brand-bg border border-brand-border rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center flex flex-col justify-between min-w-0 overflow-hidden">
                    <span className="text-[10px] sm:text-[11px] font-bold text-brand-muted uppercase tracking-wider block mb-1 truncate px-0.5" title="Relevance">Relevance</span>
                    <span className="text-xl sm:text-2xl font-mono text-brand-accent font-bold truncate">{detailItem.relevance || 0}%</span>
                  </div>
                  {detailItem.type !== 'track' && (
                    <div className="bg-brand-bg border border-brand-border rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center flex flex-col justify-between min-w-0 overflow-hidden">
                      <span className="text-[10px] sm:text-[11px] font-bold text-brand-muted uppercase tracking-wider block mb-1 truncate px-0.5" title="Songs">Songs</span>
                      <span className="text-xl sm:text-2xl font-mono font-bold truncate">{detailItem.songCount || 0}</span>
                    </div>
                  )}
                  <div className="bg-brand-bg border border-brand-border rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-center flex flex-col justify-between min-w-0 overflow-hidden">
                    <div className="flex items-center justify-center gap-1 text-[10px] sm:text-[11px] font-bold text-brand-muted uppercase tracking-wider mb-1 min-w-0 px-0.5" title="Total Scrobbles">
                      <Radio className="h-3 w-3 text-red-500 shrink-0" />
                      <span className="truncate">Scrobbles</span>
                    </div>
                    <span className="text-xl sm:text-2xl font-mono text-red-400 font-bold truncate" title="Absolute lifetime scrobbles on Last.fm">
                      {detailItem.lastFmPlaycount !== undefined ? Number(detailItem.lastFmPlaycount).toLocaleString() : '0'}
                    </span>
                    {detailItem.lastFmPeriodPlaycount !== undefined && detailItem.lastFmPeriod && detailItem.lastFmPeriod !== 'overall' ? (
                      <div 
                        className="mt-1 py-0.5 px-1.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-300 text-[9px] sm:text-[10px] font-mono flex items-center justify-center gap-1 min-w-0" 
                        title={`${Number(detailItem.lastFmPeriodPlaycount).toLocaleString()} scrobbles in ${getTimeframeFullLabel(detailItem.lastFmPeriod)}`}
                      >
                        <span className="font-semibold truncate">{Number(detailItem.lastFmPeriodPlaycount).toLocaleString()}</span>
                        <span className="text-red-400/80 shrink-0">/{getTimeframeShortLabel(detailItem.lastFmPeriod)}</span>
                      </div>
                    ) : (
                      <div className="text-[9px] text-brand-muted font-mono mt-0.5 truncate px-0.5">
                        All-time Total
                      </div>
                    )}
                    <div className="text-[9px] sm:text-[10px] text-brand-muted flex items-center justify-center gap-1 mt-1 font-mono min-w-0 px-0.5">
                      {detailItem.lastFmEnrichedAt ? (
                        <span className="truncate" title={`Synced with Last.fm on ${new Date(detailItem.lastFmEnrichedAt).toLocaleString()}`}>
                          Synced {new Date(detailItem.lastFmEnrichedAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })}
                        </span>
                      ) : (
                        <span className="text-neutral-500 truncate">Not synced</span>
                      )}
                      {(detailItem.type === 'artist' || detailItem.type === 'track' || detailItem.type === 'album') && (
                        <button
                          type="button"
                          onClick={() => handleEnrichSingleItem(detailItem)}
                          disabled={isEnrichingSingleItem}
                          title="Sync with Last.fm"
                          className="hover:text-red-400 text-brand-muted transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center shrink-0"
                        >
                          <RefreshCw className={cn("h-2.5 w-2.5", isEnrichingSingleItem && "animate-spin text-red-400")} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <a href={detailItem.url} target="_blank" rel="noreferrer" className="flex-1">
                    <Button className="w-full flex items-center justify-center gap-2">
                      <ExternalLink className="h-5 w-5" />
                      Open Link
                    </Button>
                  </a>
                  <Button 
                    variant="danger" 
                    onClick={() => promptDeleteSingleItem(detailItem)} 
                    className="px-3"
                    title="Delete item from library"
                  >
                    <Trash2 className="h-5 w-5" />
                  </Button>
                </div>

                {/* Rating & Levels */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
                  <section className="bg-brand-bg/60 border border-brand-border/60 rounded-2xl p-4 space-y-2.5 min-w-0">
                    <div className="flex items-center justify-between gap-2 text-xs font-bold text-brand-muted uppercase tracking-wider">
                      <span className="truncate">Familiarity Level</span>
                      <span className="text-xs font-mono text-brand-accent font-bold bg-brand-accent/15 border border-brand-accent/30 px-2 py-0.5 rounded-md shrink-0">
                        {detailItem.familiarity || 0}%
                      </span>
                    </div>
                    <div className="flex items-center gap-3 min-w-0">
                      <input 
                        type="range" 
                        min="0" max="100" 
                        value={detailItem.familiarity || 0} 
                        onChange={(e) => updateItem(detailItem.id, { familiarity: parseInt(e.target.value) })}
                        className="w-full min-w-0 flex-1 accent-brand-accent cursor-pointer h-2 bg-brand-border rounded-lg"
                      />
                    </div>
                  </section>

                  <section className="bg-brand-bg/60 border border-brand-border/60 rounded-2xl p-4 space-y-2.5 min-w-0">
                    <div className="flex items-center justify-between gap-2 text-xs font-bold text-brand-muted uppercase tracking-wider">
                      <span className="truncate">Relevance Score</span>
                      <span className="text-xs font-mono text-brand-accent font-bold bg-brand-accent/15 border border-brand-accent/30 px-2 py-0.5 rounded-md shrink-0">
                        {detailItem.relevance || 0}%
                      </span>
                    </div>
                    <div className="flex items-center gap-3 min-w-0">
                      <input 
                        type="range" 
                        min="0" max="100" 
                        value={detailItem.relevance || 0} 
                        onChange={(e) => updateItem(detailItem.id, { relevance: parseInt(e.target.value) })}
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
                      value={detailItem.imageUrl || ''}
                      onChange={(e) => updateItem(detailItem.id, { imageUrl: e.target.value })}
                      placeholder="https://..."
                      className="flex-1 bg-brand-bg border border-brand-border rounded-xl px-4 py-2 outline-none focus:border-brand-accent text-sm"
                    />
                    <Button 
                      onClick={async () => {
                        if (isFetchingSingleCover) return;
                        setIsFetchingSingleCover(true);
                        try {
                          const imageUrl = await fetchItemArtwork({
                            type: detailItem.type,
                            name: detailItem.name,
                            parentName: detailItem.parentName,
                            url: detailItem.url,
                            lastFmUrl: detailItem.lastFmUrl
                          }, lastFmSettings?.apiKey);
                          if (imageUrl) {
                             updateItem(detailItem.id, { imageUrl });
                          } else {
                             alert('Could not find a cover image or artist photo automatically.');
                          }
                        } catch (e) {
                          console.error("Fetch cover error", e);
                          alert('Error fetching cover image automatically.');
                        } finally {
                          setIsFetchingSingleCover(false);
                        }
                      }}
                      disabled={isFetchingSingleCover}
                      className="whitespace-nowrap px-4 py-2 flex items-center gap-2"
                    >
                      {isFetchingSingleCover && <RefreshCw className="h-4 w-4 animate-spin" />}
                      {isFetchingSingleCover ? 'Fetching...' : 'Fetch Cover'}
                    </Button>
                  </div>
                </section>

                {/* Vibe & Genre Clusters */}
                <DetailClusterManager 
                  item={detailItem} 
                  activeClusters={activeClusters} 
                  onUpdateItem={updateItem} 
                  onOpenColorPicker={(cluster) => setColorPickerCluster(cluster)}
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
                    {detailItem.tags.map(tag => {
                      const src = getTagSource(detailItem, tag);
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
                              const updatedTags = detailItem.tags.filter(t => t !== tag);
                              const updatedSources = { ...(detailItem.tagSources || {}) };
                              delete updatedSources[tag.toLowerCase().trim().replace(/^#/, '')];
                              updateItem(detailItem.id, { tags: updatedTags, tagSources: updatedSources });
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
                    placeholder="Add tag and press Enter..."
                    onKeyDown={(e: any) => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        const newTag = e.target.value.trim().toLowerCase().replace(/^#/, '');
                        if (!detailItem.tags.includes(newTag)) {
                          const updatedTags = [...detailItem.tags, newTag];
                          const updatedSources = {
                            ...(detailItem.tagSources || {}),
                            [newTag]: 'manual' as const
                          };
                          updateItem(detailItem.id, { tags: updatedTags, tagSources: updatedSources });
                        }
                        e.target.value = '';
                      }
                    }}
                    className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 outline-none focus:border-brand-accent text-sm"
                  />
                </section>

                {/* Fillable Curation Metadata Fields (Track & Artist Details) */}
                {(detailItem.type === 'artist' || detailItem.type === 'track') && (
                  <section className="space-y-4 bg-brand-bg/50 border border-brand-border/80 rounded-2xl p-4 sm:p-5">
                    <div className="flex items-center justify-between border-b border-brand-border/40 pb-2">
                      <label className="text-xs font-bold text-brand-muted uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-brand-accent" />
                        <span>Curation Metadata</span>
                      </label>
                      <span className="text-[10px] font-mono text-brand-accent uppercase tracking-widest bg-brand-accent/10 px-2 py-0.5 rounded border border-brand-accent/20">
                        {detailItem.type} Details
                      </span>
                    </div>

                    {/* On Artists: Artist metadata (related to / source) */}
                    {detailItem.type === 'artist' && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-brand-text flex items-center justify-between">
                          <span>Artist Metadata: Related To / Source</span>
                          <span className="text-[10px] text-brand-muted font-normal">Lineage, labels, associations</span>
                        </label>
                        <input
                          type="text"
                          value={detailItem.relatedToSource || ''}
                          onChange={(e) => updateItem(detailItem.id, { relatedToSource: e.target.value })}
                          placeholder="e.g. Associated with Blue Note, collaborated with Wayne Shorter, Miles Davis..."
                          className="w-full bg-brand-bg border border-brand-border rounded-xl px-3.5 py-2.5 outline-none focus:border-brand-accent text-sm text-brand-text placeholder:text-brand-muted/50 transition-colors"
                        />
                      </div>
                    )}

                    {/* On Tracks: BPM, Key, Instrumentation Details */}
                    {detailItem.type === 'track' && (
                      <div className="space-y-3.5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                          <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-brand-text flex items-center justify-between">
                              <span>BPM</span>
                              <span className="text-[10px] text-brand-muted font-normal">Tempo</span>
                            </label>
                            <input
                              type="text"
                              value={detailItem.bpm !== undefined && detailItem.bpm !== null ? String(detailItem.bpm) : ''}
                              onChange={(e) => updateItem(detailItem.id, { bpm: e.target.value ? (isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) : '' })}
                              placeholder="e.g. 124"
                              className="w-full bg-brand-bg border border-brand-border rounded-xl px-3.5 py-2.5 outline-none focus:border-brand-accent text-sm font-mono text-brand-text placeholder:text-brand-muted/50 transition-colors"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-brand-text flex items-center justify-between">
                              <span>Key</span>
                              <span className="text-[10px] text-brand-muted font-normal">Scale / Camelot</span>
                            </label>
                            <input
                              type="text"
                              value={detailItem.key || ''}
                              onChange={(e) => updateItem(detailItem.id, { key: e.target.value })}
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
                            value={detailItem.instrumentationDetails || ''}
                            onChange={(e) => updateItem(detailItem.id, { instrumentationDetails: e.target.value })}
                            placeholder="e.g. Fender Rhodes, brushed snare, Moog sub-bass, tenor sax"
                            className="w-full bg-brand-bg border border-brand-border rounded-xl px-3.5 py-2.5 outline-none focus:border-brand-accent text-sm text-brand-text placeholder:text-brand-muted/50 transition-colors"
                          />
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {/* Notes */}
                <section className="flex-1 flex flex-col">
                  <label className="text-sm font-bold text-brand-muted uppercase tracking-widest mb-4 block">Curation Notes (Markdown)</label>
                  <textarea
                    value={detailItem.notes}
                    onChange={(e) => updateItem(detailItem.id, { notes: e.target.value })}
                    placeholder="Write your analysis, mood details, or track lists here..."
                    className="w-full h-48 bg-brand-bg border border-brand-border rounded-2xl p-4 outline-none focus:border-brand-accent mb-4 resize-none"
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
                      onClick={() => handleExportSingleItem(detailItem, 'json')}
                      className="px-3 py-1.5 text-xs font-bold bg-brand-card hover:bg-brand-bg border border-brand-border hover:border-brand-accent rounded-xl text-brand-text transition-colors flex items-center gap-1.5 cursor-pointer"
                      title="Download single item JSON"
                    >
                      <FileText className="h-3.5 w-3.5 text-brand-accent" />
                      <span>JSON</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportSingleItem(detailItem, 'markdown')}
                      className="px-3 py-1.5 text-xs font-bold bg-brand-card hover:bg-brand-bg border border-brand-border hover:border-brand-accent rounded-xl text-brand-text transition-colors flex items-center gap-1.5 cursor-pointer"
                      title="Download single item Markdown"
                    >
                      <FileText className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Markdown (.md)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopySingleItemMarkdown(detailItem)}
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
        )}
      </AnimatePresence>

      {/* Publish Demo Snapshot Modal */}
      <AnimatePresence>
        {showPublishDemoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-brand-card border border-emerald-500/30 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl relative"
            >
              <button
                onClick={() => setShowPublishDemoModal(false)}
                className="absolute top-6 right-6 p-2 rounded-xl text-brand-muted hover:text-brand-text hover:bg-brand-bg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-emerald-500/20 text-emerald-400 rounded-2xl border border-emerald-500/30">
                  <Globe className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Publish Public Demo Snapshot</h3>
                  <p className="text-xs text-brand-muted">Share your curated library as the default interactive sandbox</p>
                </div>
              </div>

              <div className="space-y-4 text-sm text-brand-muted my-6">
                <p className="text-brand-text/90">
                  Publishing will capture your current live library database and save it as the default public snapshot.
                </p>
                <div className="bg-brand-bg/80 border border-brand-border rounded-2xl p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>Total Library Items:</span>
                    <strong className="text-emerald-400 font-mono">{items.length} items</strong>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>Storage Partitioning:</span>
                    <strong className="text-brand-accent font-mono">{Math.max(1, Math.ceil(items.length / 35))} chunk(s) (&lt;1MB safe)</strong>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>Custom Vibe & Genre Clusters:</span>
                    <strong className="text-emerald-400 font-mono">{customClusters.length} clusters</strong>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>Target Firestore Location:</span>
                    <strong className="text-brand-text font-mono">/demoSnapshots/default</strong>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-amber-300/80 bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl">
                  💡 Anyone visiting the app without logging in can click <strong>"Explore Interactive Demo Sandbox"</strong> to browse, search, and experiment with this snapshot!
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={() => setShowPublishDemoModal(false)} disabled={isPublishingDemo}>
                  Cancel
                </Button>
                <Button
                  onClick={handlePublishDemoSnapshot}
                  disabled={isPublishingDemo}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-2"
                >
                  {isPublishingDemo && <RefreshCw className="h-4 w-4 animate-spin" />}
                  <span>{isPublishingDemo ? 'Publishing...' : 'Publish Public Snapshot'}</span>
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Comprehensive Export Modal */}
      <AnimatePresence>
        {isExportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-brand-card border border-brand-border rounded-3xl p-6 md:p-8 max-w-2xl w-full shadow-2xl relative max-h-[90vh] flex flex-col"
            >
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="absolute top-6 right-6 p-2 rounded-xl text-brand-muted hover:text-brand-text hover:bg-brand-bg transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex items-center gap-3.5 mb-6">
                <div className="p-3.5 bg-brand-accent/20 text-brand-accent rounded-2xl border border-brand-accent/30 shrink-0">
                  <Download className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold">Export Curation & Library Data</h3>
                  <p className="text-xs text-brand-muted mt-0.5">Download or copy your complete vault including all custom metadata fields, clusters, tags, and notes</p>
                </div>
              </div>

              <div className="space-y-5 overflow-y-auto pr-1 flex-1">
                {/* Scope Selection */}
                <div>
                  <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-2">1. Select Scope</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setExportScope('all')}
                      className={cn(
                        "p-3.5 rounded-2xl border text-left transition-all cursor-pointer",
                        exportScope === 'all'
                          ? "bg-brand-accent/15 border-brand-accent text-brand-text ring-1 ring-brand-accent"
                          : "bg-brand-bg/60 border-brand-border text-brand-muted hover:border-brand-accent/50"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-sm text-brand-text">Full Library</span>
                        <span className="text-xs font-mono font-bold bg-brand-bg px-2 py-0.5 rounded border border-brand-border text-brand-accent">
                          {items.length} items
                        </span>
                      </div>
                      <p className="text-[11px] text-brand-muted">Exports all tracks, albums, playlists, and artists in your vault</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExportScope('filtered')}
                      className={cn(
                        "p-3.5 rounded-2xl border text-left transition-all cursor-pointer",
                        exportScope === 'filtered'
                          ? "bg-brand-accent/15 border-brand-accent text-brand-text ring-1 ring-brand-accent"
                          : "bg-brand-bg/60 border-brand-border text-brand-muted hover:border-brand-accent/50"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-sm text-brand-text">Filtered Selection</span>
                        <span className="text-xs font-mono font-bold bg-brand-bg px-2 py-0.5 rounded border border-brand-border text-emerald-400">
                          {filteredItems.length} items
                        </span>
                      </div>
                      <p className="text-[11px] text-brand-muted">Exports only currently visible items matching your active search/filters</p>
                    </button>
                  </div>
                </div>

                {/* Format Selection */}
                <div>
                  <label className="text-xs font-bold text-brand-muted uppercase tracking-wider block mb-2">2. Select Export Format</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setExportFormat('json')}
                      className={cn(
                        "p-3.5 rounded-2xl border text-left transition-all cursor-pointer",
                        exportFormat === 'json'
                          ? "bg-brand-accent/15 border-brand-accent text-brand-text ring-1 ring-brand-accent"
                          : "bg-brand-bg/60 border-brand-border text-brand-muted hover:border-brand-accent/50"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <FileText className="h-4 w-4 text-brand-accent" />
                        <span className="font-bold text-sm text-brand-text">JSON Format (.json)</span>
                      </div>
                      <p className="text-[11px] text-brand-muted leading-relaxed">
                        Full machine-readable array of objects with all fields (genres, rhythms, BPM, key, instrumentation, related source, ratings, tags, clusters, notes).
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExportFormat('markdown')}
                      className={cn(
                        "p-3.5 rounded-2xl border text-left transition-all cursor-pointer",
                        exportFormat === 'markdown'
                          ? "bg-emerald-500/15 border-emerald-500 text-brand-text ring-1 ring-emerald-500"
                          : "bg-brand-bg/60 border-brand-border text-brand-muted hover:border-emerald-500/50"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <FileText className="h-4 w-4 text-emerald-400" />
                        <span className="font-bold text-sm text-brand-text">Markdown Format (.md)</span>
                      </div>
                      <p className="text-[11px] text-brand-muted leading-relaxed">
                        Beautifully formatted documentation categorized by Artists, Playlists, Albums, and Tracks with bulleted metadata lists and full curation notes.
                      </p>
                    </button>
                  </div>
                </div>

                {/* Live Preview Snippet */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-brand-muted uppercase tracking-wider">Preview (First Item)</label>
                    <span className="text-[10px] font-mono text-brand-muted">
                      Target items: {exportScope === 'filtered' ? (selectedIds.length > 0 ? selectedIds.length : filteredItems.length) : items.length}
                    </span>
                  </div>
                  <pre className="bg-brand-bg/90 border border-brand-border rounded-2xl p-3.5 text-[11px] font-mono text-brand-muted overflow-x-auto max-h-36 select-all">
                    {(() => {
                      const sampleTarget = exportScope === 'filtered'
                        ? (selectedIds.length > 0 ? items.filter(i => selectedIds.includes(i.id)) : (filteredItems.length > 0 ? filteredItems : items))
                        : items;
                      return exportFormat === 'json'
                        ? formatExportJSON(sampleTarget.slice(0, 1), activeClusters)
                        : formatExportMarkdown(sampleTarget.slice(0, 1), activeClusters, "Preview Sample").slice(0, 500) + "\n...";
                    })()}
                  </pre>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-5 mt-2 border-t border-brand-border">
                <Button variant="secondary" onClick={() => setIsExportModalOpen(false)} className="w-full sm:w-auto">
                  Close
                </Button>
                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => handleCopyExport(exportFormat, exportScope)}
                    className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-brand-border bg-brand-bg hover:bg-brand-card text-brand-text font-bold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {copiedExport ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    <span>{copiedExport ? 'Copied to Clipboard!' : 'Copy to Clipboard'}</span>
                  </button>
                  <Button
                    onClick={() => handleDownloadExport(exportFormat, exportScope)}
                    className="flex-1 sm:flex-none px-5 py-2.5 font-bold flex items-center justify-center gap-2 shadow-lg"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download {exportFormat === 'json' ? '.json' : '.md'}</span>
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Confirmation Modal */}
      <AnimatePresence>
        {confirmModal?.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-brand-card border border-brand-border rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl relative"
            >
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="absolute top-6 right-6 p-2 rounded-xl text-brand-muted hover:text-brand-text hover:bg-brand-bg transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="flex items-center gap-3.5 mb-4">
                <div className={cn(
                  "p-3.5 rounded-2xl border shrink-0",
                  confirmModal.variant === 'warning'
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                    : "bg-red-500/20 text-red-400 border-red-500/30"
                )}>
                  <Trash2 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">{confirmModal.title}</h3>
                  <p className="text-xs text-brand-muted mt-0.5">Please confirm your action</p>
                </div>
              </div>

              <p className="text-sm text-brand-text/90 leading-relaxed my-5 bg-brand-bg/80 border border-brand-border p-4 rounded-2xl">
                {confirmModal.message}
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={() => setConfirmModal(null)}>
                  Cancel
                </Button>
                <Button
                  variant={confirmModal.variant === 'warning' ? 'secondary' : 'danger'}
                  onClick={async () => {
                    const action = confirmModal.onConfirm;
                    setConfirmModal(null);
                    await action();
                  }}
                  className={cn(
                    "font-bold px-5",
                    confirmModal.variant === 'warning' && "bg-amber-600 hover:bg-amber-500 text-white"
                  )}
                >
                  {confirmModal.confirmText || 'Confirm'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Last.fm Sync & Enrichment Modal */}
      <LastFmSyncModal
        isOpen={isLastFmModalOpen}
        onClose={() => setIsLastFmModalOpen(false)}
        items={items}
        activeClusters={aiClusters || getLocalClusters(allTags)}
        userSettingsLastFm={lastFmSettings}
        onSaveSettings={handleSaveLastFmSettings}
        onImportItems={handleImportLastFmItems}
        onBatchUpdateItems={handleBatchUpdateLastFmItems}
        isDemoMode={isDemoMode}
      />

      {/* Cluster Color Picker Modal */}
      <ClusterColorModal
        cluster={colorPickerCluster}
        isOpen={!!colorPickerCluster}
        onClose={() => setColorPickerCluster(null)}
        onColorChange={(clusterName, color) => {
          handleUpdateClusterColor(clusterName, color);
        }}
      />
      </div>
    </div>
  );
}
