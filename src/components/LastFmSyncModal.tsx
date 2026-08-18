import React, { useState, useEffect } from 'react';
import { 
  X, 
  Radio, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles, 
  Music, 
  User as UserIcon, 
  Disc, 
  Clock, 
  TrendingUp, 
  CheckSquare, 
  Square, 
  ExternalLink, 
  HelpCircle, 
  Sliders, 
  DownloadCloud, 
  Check, 
  Layers, 
  Database,
  ArrowRight,
  Info,
  Search,
  ChevronLeft,
  ChevronRight,
  Hash
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { 
  LastFmSettings, 
  LastFmPeriod, 
  LastFmFetchedItem, 
  LastFmArtistItem, 
  LastFmTrackItem, 
  LastFmAlbumItem,
  fetchLastFmTopArtists, 
  fetchLastFmTopTracks, 
  fetchLastFmRecentTracks, 
  fetchLastFmTopAlbums,
  fetchLastFmTopArtistsRange,
  fetchLastFmTopTracksRange,
  fetchLastFmRecentTracksRange,
  fetchLastFmTopAlbumsRange,
  enrichArtistFromLastFm, 
  enrichTrackFromLastFm, 
  enrichAlbumFromLastFm,
  testLastFmConnection,
  inferFamiliarityFromPlaycount,
  getFamiliarityTierDescription,
  getTimeframeShortLabel,
  getTimeframeFullLabel,
  DEFAULT_FALLBACK_API_KEY
} from '../lib/lastfm';
import { MusicItem, TagCluster } from '../types';

export interface LastFmRangeOption {
  id: string;
  label: string;
  shortLabel: string;
  category: 'quick' | 'slice' | 'batch' | 'custom';
  startPage: number;
  endPage: number;
  limitPerPage: number;
  rankStart: number;
  rankEnd: number;
}

const TOP_RANGE_OPTIONS: LastFmRangeOption[] = [
  // Quick Presets
  { id: 'top-10', label: 'Top 10 (Rank 1 – 10)', shortLabel: '1–10', category: 'quick', startPage: 1, endPage: 1, limitPerPage: 10, rankStart: 1, rankEnd: 10 },
  { id: 'top-25', label: 'Top 25 (Rank 1 – 25)', shortLabel: '1–25', category: 'quick', startPage: 1, endPage: 1, limitPerPage: 25, rankStart: 1, rankEnd: 25 },
  { id: 'top-50', label: 'Top 50 (Rank 1 – 50)', shortLabel: '1–50', category: 'quick', startPage: 1, endPage: 1, limitPerPage: 50, rankStart: 1, rankEnd: 50 },
  { id: 'top-100', label: 'Top 1 – 100 (Rank 1 – 100 • Page 1)', shortLabel: '1–100', category: 'quick', startPage: 1, endPage: 1, limitPerPage: 100, rankStart: 1, rankEnd: 100 },
  
  // 100-Item Rank Slices (100 to 1000)
  { id: '100-200', label: 'Rank 100 – 200 (Rank 101 – 200 • Page 2)', shortLabel: '100–200', category: 'slice', startPage: 2, endPage: 2, limitPerPage: 100, rankStart: 101, rankEnd: 200 },
  { id: '200-300', label: 'Rank 200 – 300 (Rank 201 – 300 • Page 3)', shortLabel: '200–300', category: 'slice', startPage: 3, endPage: 3, limitPerPage: 100, rankStart: 201, rankEnd: 300 },
  { id: '300-400', label: 'Rank 300 – 400 (Rank 301 – 400 • Page 4)', shortLabel: '300–400', category: 'slice', startPage: 4, endPage: 4, limitPerPage: 100, rankStart: 301, rankEnd: 400 },
  { id: '400-500', label: 'Rank 400 – 500 (Rank 401 – 500 • Page 5)', shortLabel: '400–500', category: 'slice', startPage: 5, endPage: 5, limitPerPage: 100, rankStart: 401, rankEnd: 500 },
  { id: '500-600', label: 'Rank 500 – 600 (Rank 501 – 600 • Page 6)', shortLabel: '500–600', category: 'slice', startPage: 6, endPage: 6, limitPerPage: 100, rankStart: 501, rankEnd: 600 },
  { id: '600-700', label: 'Rank 600 – 700 (Rank 601 – 700 • Page 7)', shortLabel: '600–700', category: 'slice', startPage: 7, endPage: 7, limitPerPage: 100, rankStart: 601, rankEnd: 700 },
  { id: '700-800', label: 'Rank 700 – 800 (Rank 701 – 800 • Page 8)', shortLabel: '700–800', category: 'slice', startPage: 8, endPage: 8, limitPerPage: 100, rankStart: 701, rankEnd: 800 },
  { id: '800-900', label: 'Rank 800 – 900 (Rank 801 – 900 • Page 9)', shortLabel: '800–900', category: 'slice', startPage: 9, endPage: 9, limitPerPage: 100, rankStart: 801, rankEnd: 900 },
  { id: '900-1000', label: 'Rank 900 – 1000 (Rank 901 – 1000 • Page 10)', shortLabel: '900–1000', category: 'slice', startPage: 10, endPage: 10, limitPerPage: 100, rankStart: 901, rankEnd: 1000 },
  
  // Multi-Page Full Batches
  { id: 'all-200', label: 'All Top 200 (Rank 1 – 200 • 2 Pages)', shortLabel: 'All 1–200', category: 'batch', startPage: 1, endPage: 2, limitPerPage: 100, rankStart: 1, rankEnd: 200 },
  { id: 'all-300', label: 'All Top 300 (Rank 1 – 300 • 3 Pages)', shortLabel: 'All 1–300', category: 'batch', startPage: 1, endPage: 3, limitPerPage: 100, rankStart: 1, rankEnd: 300 },
  { id: 'all-500', label: 'All Top 500 (Rank 1 – 500 • 5 Pages)', shortLabel: 'All 1–500', category: 'batch', startPage: 1, endPage: 5, limitPerPage: 100, rankStart: 1, rankEnd: 500 },
  { id: 'all-1000', label: 'All Top 1000 (Rank 1 – 1000 • 10 Pages)', shortLabel: 'All 1–1000', category: 'batch', startPage: 1, endPage: 10, limitPerPage: 100, rankStart: 1, rankEnd: 1000 },

  // Custom
  { id: 'custom', label: 'Custom Page Range...', shortLabel: 'Custom', category: 'custom', startPage: 1, endPage: 1, limitPerPage: 100, rankStart: 1, rankEnd: 100 }
];

const RECENT_RANGE_OPTIONS: LastFmRangeOption[] = [
  { id: 'recent-25', label: 'Last 25 Scrobbles', shortLabel: '1–25', category: 'quick', startPage: 1, endPage: 1, limitPerPage: 25, rankStart: 1, rankEnd: 25 },
  { id: 'recent-50', label: 'Last 50 Scrobbles', shortLabel: '1–50', category: 'quick', startPage: 1, endPage: 1, limitPerPage: 50, rankStart: 1, rankEnd: 50 },
  { id: 'recent-100', label: 'Last 100 Scrobbles (Page 1)', shortLabel: '1–100', category: 'quick', startPage: 1, endPage: 1, limitPerPage: 100, rankStart: 1, rankEnd: 100 },
  { id: '100-200', label: 'Scrobbles 100 – 200 (Page 2)', shortLabel: '100–200', category: 'slice', startPage: 2, endPage: 2, limitPerPage: 100, rankStart: 101, rankEnd: 200 },
  { id: '200-300', label: 'Scrobbles 200 – 300 (Page 3)', shortLabel: '200–300', category: 'slice', startPage: 3, endPage: 3, limitPerPage: 100, rankStart: 201, rankEnd: 300 },
  { id: '300-400', label: 'Scrobbles 300 – 400 (Page 4)', shortLabel: '300–400', category: 'slice', startPage: 4, endPage: 4, limitPerPage: 100, rankStart: 301, rankEnd: 400 },
  { id: '400-500', label: 'Scrobbles 400 – 500 (Page 5)', shortLabel: '400–500', category: 'slice', startPage: 5, endPage: 5, limitPerPage: 100, rankStart: 401, rankEnd: 500 },
  { id: '500-600', label: 'Scrobbles 500 – 600 (Page 6)', shortLabel: '500–600', category: 'slice', startPage: 6, endPage: 6, limitPerPage: 100, rankStart: 501, rankEnd: 600 },
  { id: '600-700', label: 'Scrobbles 600 – 700 (Page 7)', shortLabel: '600–700', category: 'slice', startPage: 7, endPage: 7, limitPerPage: 100, rankStart: 601, rankEnd: 700 },
  { id: '700-800', label: 'Scrobbles 700 – 800 (Page 8)', shortLabel: '700–800', category: 'slice', startPage: 8, endPage: 8, limitPerPage: 100, rankStart: 701, rankEnd: 800 },
  { id: '800-900', label: 'Scrobbles 800 – 900 (Page 9)', shortLabel: '800–900', category: 'slice', startPage: 9, endPage: 9, limitPerPage: 100, rankStart: 801, rankEnd: 900 },
  { id: '900-1000', label: 'Scrobbles 900 – 1000 (Page 10)', shortLabel: '900–1000', category: 'slice', startPage: 10, endPage: 10, limitPerPage: 100, rankStart: 901, rankEnd: 1000 },
  { id: 'all-200', label: 'All Last 200 Scrobbles (Pages 1–2)', shortLabel: 'All 1–200', category: 'batch', startPage: 1, endPage: 2, limitPerPage: 100, rankStart: 1, rankEnd: 200 },
  { id: 'all-500', label: 'All Last 500 Scrobbles (Pages 1–5)', shortLabel: 'All 1–500', category: 'batch', startPage: 1, endPage: 5, limitPerPage: 100, rankStart: 1, rankEnd: 500 },
  { id: 'all-1000', label: 'All Last 1,000 Scrobbles (Pages 1–10)', shortLabel: 'All 1–1000', category: 'batch', startPage: 1, endPage: 10, limitPerPage: 100, rankStart: 1, rankEnd: 1000 },
  { id: 'custom', label: 'Custom Page Range...', shortLabel: 'Custom', category: 'custom', startPage: 1, endPage: 1, limitPerPage: 100, rankStart: 1, rankEnd: 100 }
];

const STANDARD_SLICES = ['top-100', '100-200', '200-300', '300-400', '400-500', '500-600', '600-700', '700-800', '800-900', '900-1000'];

interface LastFmSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: MusicItem[];
  activeClusters: TagCluster[];
  userSettingsLastFm?: LastFmSettings;
  onSaveSettings: (settings: LastFmSettings) => void;
  onImportItems: (
    newItems: Partial<MusicItem>[],
    onProgress?: (current: number, total: number, currentItemName?: string, phase?: 'preparing' | 'writing') => void
  ) => Promise<void>;
  onBatchUpdateItems: (updates: { id: string; changes: Partial<MusicItem> }[]) => Promise<void>;
  isDemoMode?: boolean;
}

export const LastFmSyncModal: React.FC<LastFmSyncModalProps> = ({
  isOpen,
  onClose,
  items,
  activeClusters,
  userSettingsLastFm,
  onSaveSettings,
  onImportItems,
  onBatchUpdateItems,
  isDemoMode = false
}) => {
  const [activeTab, setActiveTab] = useState<'sync' | 'enrich' | 'settings'>('sync');
  
  // Settings State
  const [username, setUsername] = useState(userSettingsLastFm?.username || '');
  const [apiKey, setApiKey] = useState(userSettingsLastFm?.apiKey || '');
  const [testResult, setTestResult] = useState<{ success: boolean; user?: any; error?: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Sync Fetch State
  const [syncType, setSyncType] = useState<'artists' | 'tracks' | 'recent' | 'albums'>('artists');
  const [period, setPeriod] = useState<LastFmPeriod>('overall');
  const [rankRange, setRankRange] = useState<string>('top-50');
  const [customStartPage, setCustomStartPage] = useState<number>(1);
  const [customEndPage, setCustomEndPage] = useState<number>(1);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<{ current: number; total: number; pageNum: number } | null>(null);
  const [fetchedItems, setFetchedItems] = useState<LastFmFetchedItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [deselectExisting, setDeselectExisting] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [targetCluster, setTargetCluster] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [activeLoadedRange, setActiveLoadedRange] = useState<LastFmRangeOption | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    currentItemName?: string;
    phase: 'preparing' | 'writing';
  } | null>(null);
  const [importSuccessCount, setImportSuccessCount] = useState<number | null>(null);
  const [importDetails, setImportDetails] = useState<{ newCount: number; updateCount: number } | null>(null);

  // Enrichment State
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ current: number; total: number; currentItemName?: string } | null>(null);
  const [enrichResults, setEnrichResults] = useState<{ updatedCount: number; errorCount: number } | null>(null);
  const [enrichScope, setEnrichScope] = useState<'all' | 'unrated_familiarity' | 'artists_only' | 'tracks_only'>('unrated_familiarity');

  // Load initial settings
  useEffect(() => {
    if (userSettingsLastFm) {
      if (userSettingsLastFm.username) setUsername(userSettingsLastFm.username);
      if (userSettingsLastFm.apiKey) setApiKey(userSettingsLastFm.apiKey);
    }
  }, [userSettingsLastFm]);

  if (!isOpen) return null;

  const getActiveRangeOptions = () => syncType === 'recent' ? RECENT_RANGE_OPTIONS : TOP_RANGE_OPTIONS;

  const getCurrentRangeConfig = (rangeId: string = rankRange): LastFmRangeOption => {
    const options = getActiveRangeOptions();
    const found = options.find(o => o.id === rangeId);
    if (found) {
      if (found.id === 'custom') {
        const sp = Math.max(1, customStartPage || 1);
        const ep = Math.max(sp, customEndPage || sp);
        return {
          ...found,
          startPage: sp,
          endPage: ep,
          rankStart: (sp - 1) * 100 + 1,
          rankEnd: ep * 100,
          label: `Custom Pages ${sp}–${ep} (Rank ${(sp - 1) * 100 + 1}–${ep * 100})`
        };
      }
      return found;
    }
    return options[2] || options[0];
  };

  const handleTestConnection = async () => {
    if (!username.trim()) {
      setTestResult({ success: false, error: 'Please enter your Last.fm username.' });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testLastFmConnection(username, apiKey);
      setTestResult(res);
      if (res.success) {
        onSaveSettings({
          username: username.trim(),
          apiKey: apiKey.trim(),
          defaultPeriod: period
        });
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 3000);
      }
    } catch (e: any) {
      setTestResult({ success: false, error: e?.message || 'Connection test failed.' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveSettingsOnly = () => {
    if (!username.trim()) {
      setTestResult({ success: false, error: 'Please enter a username first.' });
      return;
    }
    onSaveSettings({
      username: username.trim(),
      apiKey: apiKey.trim(),
      defaultPeriod: period
    });
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 3000);
  };

  const handleFetchData = async (rangeKeyOverride?: string) => {
    if (!username.trim()) {
      setActiveTab('settings');
      setTestResult({ success: false, error: 'Please enter your Last.fm username to fetch data.' });
      return;
    }

    const targetRangeKey = rangeKeyOverride || rankRange;
    if (rangeKeyOverride) {
      setRankRange(rangeKeyOverride);
    }

    const rangeConfig = getCurrentRangeConfig(targetRangeKey);
    setActiveLoadedRange(rangeConfig);

    setIsFetching(true);
    setFetchProgress(null);
    setFetchError(null);
    setFetchedItems([]);
    setSelectedItemIds([]);
    setImportSuccessCount(null);

    try {
      let results: LastFmFetchedItem[] = [];
      const isMultiPage = rangeConfig.startPage !== rangeConfig.endPage;

      if (syncType === 'artists') {
        if (isMultiPage) {
          results = await fetchLastFmTopArtistsRange(
            username, 
            apiKey, 
            period, 
            rangeConfig.startPage, 
            rangeConfig.endPage, 
            rangeConfig.limitPerPage,
            (curr, tot, pageNum) => setFetchProgress({ current: curr, total: tot, pageNum })
          );
        } else {
          results = await fetchLastFmTopArtists(
            username, 
            apiKey, 
            period, 
            rangeConfig.limitPerPage, 
            rangeConfig.startPage
          );
        }
      } else if (syncType === 'tracks') {
        if (isMultiPage) {
          results = await fetchLastFmTopTracksRange(
            username, 
            apiKey, 
            period, 
            rangeConfig.startPage, 
            rangeConfig.endPage, 
            rangeConfig.limitPerPage,
            (curr, tot, pageNum) => setFetchProgress({ current: curr, total: tot, pageNum })
          );
        } else {
          results = await fetchLastFmTopTracks(
            username, 
            apiKey, 
            period, 
            rangeConfig.limitPerPage, 
            rangeConfig.startPage
          );
        }
      } else if (syncType === 'recent') {
        if (isMultiPage) {
          results = await fetchLastFmRecentTracksRange(
            username, 
            apiKey, 
            rangeConfig.startPage, 
            rangeConfig.endPage, 
            rangeConfig.limitPerPage,
            (curr, tot, pageNum) => setFetchProgress({ current: curr, total: tot, pageNum })
          );
        } else {
          results = await fetchLastFmRecentTracks(
            username, 
            apiKey, 
            rangeConfig.limitPerPage, 
            rangeConfig.startPage
          );
        }
      } else if (syncType === 'albums') {
        if (isMultiPage) {
          results = await fetchLastFmTopAlbumsRange(
            username, 
            apiKey, 
            period, 
            rangeConfig.startPage, 
            rangeConfig.endPage, 
            rangeConfig.limitPerPage,
            (curr, tot, pageNum) => setFetchProgress({ current: curr, total: tot, pageNum })
          );
        } else {
          results = await fetchLastFmTopAlbums(
            username, 
            apiKey, 
            period, 
            rangeConfig.limitPerPage, 
            rangeConfig.startPage
          );
        }
      }

      setFetchedItems(results);
      if (deselectExisting) {
        const newIds = results.filter(r => !isItemInVault(r)).map(r => r.id);
        setSelectedItemIds(newIds);
      } else {
        const allIds = results.map(r => r.id);
        setSelectedItemIds(allIds);
      }
    } catch (err: any) {
      console.error('Last.fm fetch error:', err);
      setFetchError(err?.message || 'Failed to fetch data from Last.fm. Please check your username and connection.');
    } finally {
      setIsFetching(false);
      setFetchProgress(null);
    }
  };

  // Helper to check if an item already exists in the vault
  const isItemInVault = (item: LastFmFetchedItem): boolean => {
    const cleanName = item.name.toLowerCase().trim();
    if (item.type === 'artist') {
      return items.some(i => i.type === 'artist' && i.name.toLowerCase().trim() === cleanName);
    } else if (item.type === 'track') {
      const track = item as LastFmTrackItem;
      return items.some(i => 
        i.type === 'track' && 
        i.name.toLowerCase().trim() === cleanName && 
        (!track.artist || (i.parentName && i.parentName.toLowerCase().trim() === track.artist.toLowerCase().trim()))
      );
    } else if (item.type === 'album') {
      const album = item as LastFmAlbumItem;
      return items.some(i => 
        i.type === 'album' && 
        i.name.toLowerCase().trim() === cleanName && 
        (!album.artist || (i.parentName && i.parentName.toLowerCase().trim() === album.artist.toLowerCase().trim()))
      );
    }
    return false;
  };

  const handleToggleDeselectExisting = (checked: boolean) => {
    setDeselectExisting(checked);
    if (fetchedItems.length > 0) {
      if (checked) {
        setSelectedItemIds(prev => prev.filter(id => {
          const item = fetchedItems.find(f => f.id === id);
          return item ? !isItemInVault(item) : true;
        }));
      } else {
        setSelectedItemIds(fetchedItems.map(f => f.id));
      }
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedItemIds.length === fetchedItems.length) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(fetchedItems.map(i => i.id));
    }
  };

  const handleToggleSelectId = (id: string) => {
    setSelectedItemIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleImportSelected = async () => {
    const itemsToImport = fetchedItems.filter(i => selectedItemIds.includes(i.id));
    if (itemsToImport.length === 0) return;

    const newCount = itemsToImport.filter(i => !isItemInVault(i)).length;
    const updateCount = itemsToImport.filter(i => isItemInVault(i)).length;

    setIsImporting(true);
    setFetchError(null);
    setImportSuccessCount(null);
    setImportProgress({
      current: 0,
      total: itemsToImport.length,
      currentItemName: 'Preparing items & metadata...',
      phase: 'preparing'
    });

    try {
      const newPayloads: Partial<MusicItem>[] = [];

      for (let i = 0; i < itemsToImport.length; i++) {
        const item = itemsToImport[i];
        setImportProgress({
          current: i + 1,
          total: itemsToImport.length,
          currentItemName: item.name,
          phase: 'preparing'
        });

        let tagList = [...item.tags];
        if (targetCluster) {
          const clusterObj = activeClusters.find(c => c.name === targetCluster);
          if (clusterObj && clusterObj.tags.length > 0) {
            tagList.push(clusterObj.tags[0]);
          }
        }

        const tagSources: Record<string, 'lastfm' | 'manual'> = {};
        tagList.forEach(t => {
          tagSources[t.toLowerCase().trim().replace(/^#/, '')] = 'lastfm';
        });

        if (item.type === 'artist') {
          const artist = item as LastFmArtistItem;
          let artistTags = [...(artist.tags || [])];
          let artistGenres = artist.genres;
          let artistBio = artist.bioSummary;
          let artistListeners = artist.listeners;
          let artistImg = artist.imageUrl;

          // If artist tags are somehow empty, enrich on the fly before saving
          if (artistTags.length === 0) {
            try {
              const enrich = await enrichArtistFromLastFm(artist.name, apiKey, username);
              if (enrich) {
                if (enrich.tags && enrich.tags.length > 0) artistTags = enrich.tags;
                if (enrich.genres && !artistGenres) artistGenres = enrich.genres;
                if (enrich.bioSummary && !artistBio) artistBio = enrich.bioSummary;
                if (enrich.listeners && !artistListeners) artistListeners = enrich.listeners;
                if (enrich.imageUrl && !artistImg) artistImg = enrich.imageUrl;
              }
            } catch (e) {}
          }

          let tagList = [...artistTags];
          if (targetCluster) {
            const clusterObj = activeClusters.find(c => c.name === targetCluster);
            if (clusterObj && clusterObj.tags.length > 0) {
              tagList.push(clusterObj.tags[0]);
            }
          }

          const cleanTags = Array.from(new Set(tagList.map(t => t.toLowerCase().trim().replace(/^#/, '')))).filter(Boolean);
          const tagSources: Record<string, 'lastfm' | 'manual'> = {};
          cleanTags.forEach(t => {
            tagSources[t] = 'lastfm';
          });

          newPayloads.push({
            name: artist.name,
            type: 'artist',
            url: artist.url,
            imageUrl: artistImg,
            familiarity: artist.inferredFamiliarity, // INFERRED FROM TOTAL PLAYCOUNT
            relevance: 0, // STRICTLY MANUAL ONLY: NOT touched or set by Last.fm
            rating: 50,
            favoriteLevel: 0,
            rank: artist.rank || (i + 1),
            tags: cleanTags,
            tagSources,
            primaryCluster: targetCluster || undefined,
            genres: artistGenres || (cleanTags.length > 0 ? cleanTags.slice(0, 3).join(', ') : undefined),
            notes: artistBio ? `Last.fm Bio:\n${artistBio}` : '',
            lastFmPlaycount: artist.totalPlaycount ?? artist.playcount,
            lastFmPeriodPlaycount: artist.period !== 'overall' ? artist.periodPlaycount : undefined,
            lastFmPeriod: artist.period,
            lastFmUrl: artist.url,
            lastFmListeners: artistListeners,
            lastFmEnrichedAt: new Date().toISOString(),
          });
        } else if (item.type === 'track') {
          const track = item as LastFmTrackItem;
          let tagList = [...(track.tags || [])];
          if (targetCluster) {
            const clusterObj = activeClusters.find(c => c.name === targetCluster);
            if (clusterObj && clusterObj.tags.length > 0) {
              tagList.push(clusterObj.tags[0]);
            }
          }
          const cleanTrackTags = Array.from(new Set(tagList.map(t => t.toLowerCase().trim().replace(/^#/, '')))).filter(Boolean);
          const trackTagSources: Record<string, 'lastfm' | 'manual'> = {};
          cleanTrackTags.forEach(t => {
            trackTagSources[t] = 'lastfm';
          });

          newPayloads.push({
            name: track.name,
            type: 'track',
            url: track.url,
            parentName: track.artist,
            imageUrl: track.imageUrl,
            durationSeconds: track.durationSeconds,
            familiarity: track.inferredFamiliarity, // INFERRED FROM TOTAL PLAYCOUNT
            relevance: 0, // STRICTLY MANUAL ONLY
            rating: 50,
            favoriteLevel: 0,
            rank: track.rank || (i + 1),
            tags: cleanTrackTags,
            tagSources: trackTagSources,
            primaryCluster: targetCluster || undefined,
            notes: track.album ? `Album: ${track.album}` : (track.bioSummary || ''),
            lastFmPlaycount: track.totalPlaycount ?? track.playcount,
            lastFmPeriodPlaycount: track.period !== 'overall' ? track.periodPlaycount : undefined,
            lastFmPeriod: track.period,
            lastFmUrl: track.url,
            lastFmListeners: track.listeners,
            lastFmEnrichedAt: new Date().toISOString(),
          });
        } else if (item.type === 'album') {
          const album = item as LastFmAlbumItem;
          let tagList = [...(album.tags || [])];
          if (targetCluster) {
            const clusterObj = activeClusters.find(c => c.name === targetCluster);
            if (clusterObj && clusterObj.tags.length > 0) {
              tagList.push(clusterObj.tags[0]);
            }
          }
          const cleanAlbumTags = Array.from(new Set(tagList.map(t => t.toLowerCase().trim().replace(/^#/, '')))).filter(Boolean);
          const albumTagSources: Record<string, 'lastfm' | 'manual'> = {};
          cleanAlbumTags.forEach(t => {
            albumTagSources[t] = 'lastfm';
          });

          newPayloads.push({
            name: album.name,
            type: 'album',
            url: album.url,
            parentName: album.artist,
            imageUrl: album.imageUrl,
            familiarity: album.inferredFamiliarity, // INFERRED FROM TOTAL PLAYCOUNT
            relevance: 0, // STRICTLY MANUAL ONLY
            rating: 50,
            favoriteLevel: 0,
            rank: album.rank || (i + 1),
            tags: cleanAlbumTags,
            tagSources: albumTagSources,
            primaryCluster: targetCluster || undefined,
            notes: album.bioSummary || '',
            songCount: album.songCount,
            releaseDate: album.releaseDate,
            genres: album.genres,
            lastFmPlaycount: album.totalPlaycount ?? album.playcount,
            lastFmPeriodPlaycount: album.period !== 'overall' ? album.periodPlaycount : undefined,
            lastFmPeriod: album.period,
            lastFmUrl: album.url,
            lastFmListeners: album.listeners,
            lastFmEnrichedAt: new Date().toISOString(),
          });
        }
      }

      setImportProgress({
        current: 0,
        total: newPayloads.length,
        currentItemName: 'Saving to Sonic Vault...',
        phase: 'writing'
      });

      await onImportItems(newPayloads, (curr, total, name, phase) => {
        setImportProgress({
          current: curr,
          total,
          currentItemName: name,
          phase: phase || 'writing'
        });
      });

      setImportSuccessCount(newPayloads.length);
      setImportDetails({ newCount, updateCount });
      setSelectedItemIds([]);
    } catch (err: any) {
      console.error('Import error:', err);
      setFetchError(err?.message || 'Failed to import selected items into vault.');
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  // Batch Enrich Existing Vault Items
  const handleBatchEnrich = async () => {
    if (!username.trim()) {
      setActiveTab('settings');
      setTestResult({ success: false, error: 'Please enter your Last.fm username to enrich items with your personal scrobble playcounts.' });
      return;
    }

    let targetsToEnrich: MusicItem[] = [];
    if (enrichScope === 'unrated_familiarity') {
      targetsToEnrich = items.filter(i => (i.familiarity === undefined || i.familiarity === 0) && (i.type === 'artist' || i.type === 'track' || i.type === 'album'));
    } else if (enrichScope === 'artists_only') {
      targetsToEnrich = items.filter(i => i.type === 'artist');
    } else if (enrichScope === 'tracks_only') {
      targetsToEnrich = items.filter(i => i.type === 'track');
    } else {
      targetsToEnrich = items.filter(i => i.type === 'artist' || i.type === 'track' || i.type === 'album');
    }

    if (targetsToEnrich.length === 0) {
      setEnrichResults({ updatedCount: 0, errorCount: 0 });
      return;
    }

    setIsEnriching(true);
    setEnrichResults(null);
    setEnrichProgress({ current: 0, total: targetsToEnrich.length });

    const batchUpdates: { id: string; changes: Partial<MusicItem> }[] = [];
    let errorCount = 0;

    for (let i = 0; i < targetsToEnrich.length; i++) {
      const item = targetsToEnrich[i];
      setEnrichProgress({ current: i + 1, total: targetsToEnrich.length, currentItemName: item.name });

      try {
        if (item.type === 'artist') {
          const enrichData = await enrichArtistFromLastFm(item.name, apiKey, username);
          if (enrichData) {
            const newTags = Array.from(new Set([...(item.tags || []), ...enrichData.tags]));
            const tagSources = { ...(item.tagSources || {}) };
            enrichData.tags.forEach(t => {
              const clean = t.toLowerCase().trim();
              if (!tagSources[clean]) tagSources[clean] = 'lastfm';
            });

            const changes: Partial<MusicItem> = {
              lastFmEnrichedAt: new Date().toISOString(),
              tags: newTags,
              tagSources,
            };

            if (enrichData.imageUrl && !item.imageUrl) changes.imageUrl = enrichData.imageUrl;
            if (enrichData.bioSummary && (!item.notes || item.notes.trim() === '')) changes.notes = `Last.fm Summary:\n${enrichData.bioSummary}`;
            if (enrichData.genres && !item.genres) changes.genres = enrichData.genres;
            if (enrichData.listeners) changes.lastFmListeners = enrichData.listeners;
            if (enrichData.url && !item.url) changes.url = enrichData.url;

            // Inferred familiarity from user playcount if returned
            if (enrichData.inferredFamiliarity !== undefined) {
              changes.familiarity = enrichData.inferredFamiliarity;
              if (enrichData.userPlaycount !== undefined) changes.lastFmPlaycount = enrichData.userPlaycount;
            }

            // NOTE: Relevance is STRICTLY not touched (manual only)
            batchUpdates.push({ id: item.id, changes });
          }
        } else if (item.type === 'track') {
          const artistName = item.parentName || item.creator || '';
          if (artistName) {
            const enrichData = await enrichTrackFromLastFm(item.name, artistName, apiKey, username);
            if (enrichData) {
              const newTags = Array.from(new Set([...(item.tags || []), ...enrichData.tags]));
              const tagSources = { ...(item.tagSources || {}) };
              enrichData.tags.forEach(t => {
                const clean = t.toLowerCase().trim();
                if (!tagSources[clean]) tagSources[clean] = 'lastfm';
              });

              const changes: Partial<MusicItem> = {
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

              // Inferred familiarity from user playcount
              if (enrichData.inferredFamiliarity !== undefined) {
                changes.familiarity = enrichData.inferredFamiliarity;
                if (enrichData.userPlaycount !== undefined) changes.lastFmPlaycount = enrichData.userPlaycount;
              }

              batchUpdates.push({ id: item.id, changes });
            }
          }
        } else if (item.type === 'album') {
          const artistName = item.parentName || item.creator || '';
          if (artistName) {
            const enrichData = await enrichAlbumFromLastFm(item.name, artistName, apiKey, username);
            if (enrichData) {
              const newTags = Array.from(new Set([...(item.tags || []), ...enrichData.tags]));
              const tagSources = { ...(item.tagSources || {}) };
              enrichData.tags.forEach(t => {
                const clean = t.toLowerCase().trim();
                if (!tagSources[clean]) tagSources[clean] = 'lastfm';
              });

              const changes: Partial<MusicItem> = {
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

              batchUpdates.push({ id: item.id, changes });
            }
          }
        }
      } catch (err) {
        console.warn(`Enrichment failed for ${item.name}:`, err);
        errorCount++;
      }

      // Small delay to respect Last.fm API polite rate limit
      if (i % 5 === 0) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    if (batchUpdates.length > 0) {
      await onBatchUpdateItems(batchUpdates);
    }

    setIsEnriching(false);
    setEnrichProgress(null);
    setEnrichResults({ updatedCount: batchUpdates.length, errorCount });
  };

  const handleAttemptClose = () => {
    if (isImporting) {
      if (window.confirm("A sync to your vault is currently in progress! Closing now will interrupt saving the remaining items. Are you sure you want to close?")) {
        onClose();
      }
    } else if (isEnriching) {
      if (window.confirm("Library enrichment is currently in progress! Closing now will stop enriching remaining items. Are you sure you want to close?")) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleAttemptClose}
        className="fixed inset-0 bg-black/75 backdrop-blur-md"
      />

      {/* Main Modal Dialog */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="relative bg-brand-card/95 border border-brand-accent/40 rounded-3xl w-full max-w-4xl shadow-2xl z-10 glass max-h-[92vh] flex flex-col overflow-hidden text-brand-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="p-4 sm:p-5 border-b border-brand-border/60 flex items-center justify-between gap-4 bg-brand-bg/40 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center shadow-lg shadow-red-500/20 text-white font-black text-base shrink-0">
              <Radio className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  Last.fm Sync & Enrichment
                </h3>
                {username ? (
                  <span className="text-[10px] font-mono font-bold bg-red-500/15 border border-red-500/30 text-red-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                    @{username}
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-brand-muted bg-brand-card border border-brand-border px-2 py-0.5 rounded-full">
                    Not connected
                  </span>
                )}

                {/* Real-time Status Badges in Top Header */}
                {isImporting && (
                  <span className="text-[10px] sm:text-xs font-mono font-bold bg-amber-500/15 border border-amber-500/30 text-amber-300 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 animate-pulse">
                    <RefreshCw className="h-3 w-3 animate-spin text-amber-400" />
                    Syncing to Vault ({importProgress?.current || 0}/{importProgress?.total || 0})
                  </span>
                )}
                {isEnriching && (
                  <span className="text-[10px] sm:text-xs font-mono font-bold bg-purple-500/15 border border-purple-500/30 text-purple-300 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 animate-pulse">
                    <RefreshCw className="h-3 w-3 animate-spin text-purple-400" />
                    Enriching Vault ({enrichProgress?.current || 0}/{enrichProgress?.total || 0})
                  </span>
                )}
                {isFetching && (
                  <span className="text-[10px] sm:text-xs font-mono font-bold bg-red-500/15 border border-red-500/30 text-red-300 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 animate-pulse">
                    <RefreshCw className="h-3 w-3 animate-spin text-red-400" />
                    Fetching Data...
                  </span>
                )}
              </div>
              <p className="text-xs text-brand-muted mt-0.5 truncate">
                Sync scrobbles, top tracks & artists. Infer familiarity from playcounts with zero coding.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAttemptClose}
            className="text-brand-muted hover:text-brand-text p-2 hover:bg-brand-card rounded-xl transition-all shrink-0 cursor-pointer"
            title={isImporting || isEnriching ? "Sync in progress (Click to close)" : "Close modal"}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation - Fixed Vertical Spacing & Non-Squished Tabs */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-brand-border/40 flex items-center gap-2 bg-brand-bg/30 overflow-x-auto no-scrollbar shrink-0 min-h-[56px]">
          {[
            { id: 'sync', label: 'Sync & Import', icon: DownloadCloud, isBusy: isImporting },
            { id: 'enrich', label: 'Enrich Library', icon: Sparkles, isBusy: isEnriching },
            { id: 'settings', label: 'Account & Settings', icon: Sliders, isBusy: false },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 min-h-[42px] leading-normal select-none",
                  isSelected
                    ? "bg-brand-accent/20 text-white border border-brand-accent/50 shadow-sm font-bold"
                    : "text-brand-muted hover:text-brand-text hover:bg-brand-card/70 border border-transparent"
                )}
              >
                {tab.isBusy ? (
                  <RefreshCw className="h-4 w-4 animate-spin text-amber-400 shrink-0" />
                ) : (
                  <Icon className={cn("h-4 w-4 shrink-0", isSelected ? "text-brand-accent" : "text-brand-muted")} />
                )}
                <span>{tab.label}</span>
                {tab.isBusy && (
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse ml-0.5" />
                )}
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 min-h-0 space-y-6">

          {/* TAB 1: SYNC & IMPORT */}
          {activeTab === 'sync' && (
            <div className="space-y-6">
              {/* Guidance Callout */}
              <div className="p-4 bg-brand-accent/10 border border-brand-accent/30 rounded-2xl flex items-start gap-3 text-xs text-brand-text">
                <Info className="h-5 w-5 text-brand-accent shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-brand-accent">
                    Playcount → Familiarity Calibration
                  </p>
                  <p className="text-brand-muted leading-relaxed">
                    Last.fm scrobbles are used to calculate your <strong className="text-brand-text">Familiarity Level (0–98% max, 100% is never reached)</strong> using calibrated logarithmic curves scaled for artists vs individual track plays. 
                    Your <strong className="text-brand-text">Relevance Score</strong> is strictly preserved as a manual curation metric and is never modified by Last.fm.
                  </p>
                </div>
              </div>

              {/* Source, Period & Extended Rank Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider">Sync Source</label>
                  <select
                    value={syncType}
                    onChange={(e) => {
                      setSyncType(e.target.value as any);
                      setFetchedItems([]);
                      setActiveLoadedRange(null);
                    }}
                    className="w-full bg-brand-card border border-brand-border rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-brand-accent cursor-pointer"
                  >
                    <option value="artists">Top Artists</option>
                    <option value="tracks">Top Tracks</option>
                    <option value="albums">Top Albums</option>
                    <option value="recent">Recent Scrobbles (Live)</option>
                  </select>
                </div>

                {syncType !== 'recent' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider">Time Period</label>
                    <select
                      value={period}
                      onChange={(e) => setPeriod(e.target.value as any)}
                      className="w-full bg-brand-card border border-brand-border rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-brand-accent cursor-pointer"
                    >
                      <option value="7day">Last 7 Days</option>
                      <option value="1month">Last 1 Month (30 Days)</option>
                      <option value="3month">Last 3 Months</option>
                      <option value="6month">Last 6 Months</option>
                      <option value="12month">Last 12 Months (1 Year)</option>
                      <option value="overall">All-Time Overall</option>
                    </select>
                  </div>
                )}

                <div className={cn("space-y-1.5", syncType === 'recent' ? "sm:col-span-2" : "")}>
                  <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider flex items-center justify-between">
                    <span>Rank Range / Limit</span>
                    <span className="text-[9px] text-brand-accent font-normal lowercase">up to rank 1000</span>
                  </label>
                  <select
                    value={rankRange}
                    onChange={(e) => setRankRange(e.target.value)}
                    className="w-full bg-brand-card border border-brand-border rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-brand-accent cursor-pointer"
                  >
                    <optgroup label="⚡ Quick Limits">
                      {getActiveRangeOptions().filter(o => o.category === 'quick').map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="🎯 100-Item Rank Slices (100–1000)">
                      {getActiveRangeOptions().filter(o => o.category === 'slice').map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="📦 Bulk Multi-Page Batches">
                      {getActiveRangeOptions().filter(o => o.category === 'batch').map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="⚙️ Custom Page Scope">
                      <option value="custom">Custom Page Range...</option>
                    </optgroup>
                  </select>
                </div>

                <div className="space-y-1.5 flex flex-col justify-end">
                  <button
                    onClick={() => handleFetchData()}
                    disabled={isFetching || !username.trim()}
                    className="w-full py-2 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", isFetching ? "animate-spin" : "")} />
                    <span>{isFetching ? "Fetching Data & Images..." : "Fetch from Last.fm"}</span>
                  </button>
                </div>
              </div>

              {/* Custom Page Range Inputs (if custom chosen) */}
              {rankRange === 'custom' && (
                <div className="p-3.5 bg-brand-card border border-brand-border rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-brand-text">Custom Scope:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-brand-muted">Page</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={customStartPage}
                        onChange={(e) => setCustomStartPage(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-16 bg-brand-bg border border-brand-border rounded-lg px-2 py-1 text-xs font-mono font-bold text-center outline-none focus:border-brand-accent"
                      />
                      <span className="text-[11px] text-brand-muted">to</span>
                      <input
                        type="number"
                        min={customStartPage}
                        max={100}
                        value={customEndPage}
                        onChange={(e) => setCustomEndPage(Math.max(customStartPage, parseInt(e.target.value, 10) || customStartPage))}
                        className="w-16 bg-brand-bg border border-brand-border rounded-lg px-2 py-1 text-xs font-mono font-bold text-center outline-none focus:border-brand-accent"
                      />
                    </div>
                  </div>
                  <div className="text-xs text-brand-muted font-mono">
                    Fetches Rank <strong className="text-brand-accent">#{(customStartPage - 1) * 100 + 1}</strong> to <strong className="text-brand-accent">#{customEndPage * 100}</strong> ({customEndPage - customStartPage + 1} page{customEndPage > customStartPage ? 's' : ''}, up to {(customEndPage - customStartPage + 1) * 100} items)
                  </div>
                </div>
              )}

              {/* Quick Rank Slice Navigation Bar (100-200 to 900-1000) */}
              <div className="space-y-1.5 p-3.5 bg-brand-card/60 border border-brand-border/70 rounded-2xl">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <span className="text-[10px] font-bold text-brand-muted uppercase tracking-wider flex items-center gap-1.5">
                    <Hash className="h-3 w-3 text-red-400" />
                    Quick 100-Item Rank Slices (1–1000)
                  </span>
                  <span className="text-[10.5px] text-brand-muted">
                    Click any rank block to jump & fetch immediately
                  </span>
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                  {STANDARD_SLICES.map((sliceId, idx) => {
                    const opt = (syncType === 'recent' ? RECENT_RANGE_OPTIONS : TOP_RANGE_OPTIONS).find(o => o.id === sliceId);
                    if (!opt) return null;
                    const isActive = rankRange === sliceId;

                    return (
                      <button
                        key={sliceId}
                        type="button"
                        onClick={() => {
                          setRankRange(sliceId);
                          handleFetchData(sliceId);
                        }}
                        disabled={isFetching}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer flex items-center gap-1 border",
                          isActive
                            ? "bg-red-600 text-white border-red-500 shadow-sm"
                            : "bg-brand-bg hover:bg-brand-card text-brand-muted hover:text-brand-text border-brand-border/60"
                        )}
                      >
                        <span>{idx === 0 ? "1–100" : `${idx * 100}–${(idx + 1) * 100}`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* De-select Existing Vault Items Checkbox */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-brand-card border border-brand-border/80 rounded-xl">
                <label className="flex items-center gap-2.5 text-xs font-semibold text-brand-text cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={deselectExisting}
                    onChange={(e) => handleToggleDeselectExisting(e.target.checked)}
                    className="h-4 w-4 rounded bg-brand-bg border-brand-border text-brand-accent focus:ring-brand-accent cursor-pointer accent-sky-500"
                  />
                  <span>
                    {syncType === 'artists'
                      ? "De-select existing artists"
                      : syncType === 'tracks'
                      ? "De-select existing tracks"
                      : syncType === 'albums'
                      ? "De-select existing albums"
                      : "De-select existing items"}
                  </span>
                </label>
                <span className="text-[11px] text-brand-muted">
                  {deselectExisting
                    ? "Existing vault items will be skipped during import"
                    : "Existing vault items will re-sync and update scrobbles & familiarity"}
                </span>
              </div>

              {/* Multi-Page Fetch Progress Banner */}
              {isFetching && fetchProgress && (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-between gap-3 text-xs text-red-300 animate-in fade-in">
                  <div className="flex items-center gap-2.5">
                    <RefreshCw className="h-4 w-4 text-red-400 animate-spin" />
                    <span>
                      Fetching Page <strong className="text-white">{fetchProgress.current}</strong> of <strong className="text-white">{fetchProgress.total}</strong> (Page #{fetchProgress.pageNum}, Rank {(fetchProgress.pageNum - 1) * 100 + 1}–{fetchProgress.pageNum * 100})...
                    </span>
                  </div>
                  <span className="font-mono font-bold text-red-400">
                    {Math.round((fetchProgress.current / Math.max(1, fetchProgress.total)) * 100)}%
                  </span>
                </div>
              )}

              {/* Error Banner */}
              {fetchError && (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center gap-3 text-xs text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{fetchError}</span>
                </div>
              )}

              {/* LIVE SYNC IN PROGRESS CARD */}
              {isImporting && importProgress && (
                <div className="p-4 sm:p-5 bg-gradient-to-br from-amber-500/10 via-brand-card to-brand-bg border border-amber-500/40 rounded-2xl space-y-3 shadow-lg shadow-amber-500/5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                        <RefreshCw className="h-4 w-4 text-amber-400 animate-spin" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-2">
                          <span>
                            {importProgress.phase === 'preparing' ? 'Preparing & Enriching Metadata...' : 'Writing Items to Sonic Vault...'}
                          </span>
                          <span className="text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.2 rounded-full">
                            Item {importProgress.current} of {importProgress.total}
                          </span>
                        </div>
                        <p className="text-[11px] text-brand-muted truncate max-w-md mt-0.5">
                          Currently processing: <strong className="text-amber-200">{importProgress.currentItemName || 'Metadata batch'}</strong>
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-mono font-bold text-amber-400">
                        {Math.round((importProgress.current / Math.max(1, importProgress.total)) * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-brand-bg/80 h-2.5 rounded-full overflow-hidden border border-brand-border/60">
                    <div 
                      className="bg-gradient-to-r from-amber-500 to-amber-400 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${Math.max(4, Math.round((importProgress.current / Math.max(1, importProgress.total)) * 100))}%` }}
                    />
                  </div>

                  {/* Safety Advisory Banner */}
                  <div className="pt-1 flex items-start gap-2 text-[11px] text-amber-300/90 font-medium">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
                    <span>
                      <strong>Please keep this sync tab / modal open:</strong> Items and scrobble playcounts are saving to your vault. You will see a green confirmation once safe to close.
                    </span>
                  </div>
                </div>
              )}

              {/* SUCCESS IMPORT NOTIFICATION */}
              {!isImporting && importSuccessCount !== null && (
                <div className="p-4 sm:p-5 bg-emerald-500/10 border border-emerald-500/40 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-300">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-sm">
                          Sync to Vault Complete!
                        </span>
                        <span className="text-[10px] font-mono font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Safe to close tab
                        </span>
                      </div>
                      <p className="text-brand-muted text-[11px]">
                        Successfully synced <strong className="text-emerald-300">{importSuccessCount} items</strong>
                        {importDetails ? ` (${importDetails.newCount} newly added to vault, ${importDetails.updateCount} existing updated with latest scrobbles & calibrated familiarity)` : ''}.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="py-1.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors shrink-0 cursor-pointer text-center"
                  >
                    View in Vault
                  </button>
                </div>
              )}

              {/* Fetched Preview List */}
              {fetchedItems.length > 0 && (() => {
                const currentSelected = fetchedItems.filter(i => selectedItemIds.includes(i.id));
                const newSelectedCount = currentSelected.filter(i => !isItemInVault(i)).length;
                const updateSelectedCount = currentSelected.filter(i => isItemInVault(i)).length;

                const currentRangeIndex = STANDARD_SLICES.indexOf(rankRange);
                const prevSliceId = currentRangeIndex > 0 ? STANDARD_SLICES[currentRangeIndex - 1] : null;
                const nextSliceId = currentRangeIndex >= 0 && currentRangeIndex < STANDARD_SLICES.length - 1 ? STANDARD_SLICES[currentRangeIndex + 1] : null;

                const filteredFetchedItems = fetchedItems.filter(item => {
                  if (!searchFilter.trim()) return true;
                  const q = searchFilter.toLowerCase().trim();
                  const nameMatch = item.name.toLowerCase().includes(q);
                  const artistMatch = (item as any).artist?.toLowerCase().includes(q) || (item as any).parentName?.toLowerCase().includes(q);
                  const tagMatch = item.tags?.some(t => t.toLowerCase().includes(q));
                  const rankMatch = item.rank ? String(item.rank).includes(q) : false;
                  return nameMatch || artistMatch || tagMatch || rankMatch;
                });

                return (
                  <div className="space-y-4 pt-2 border-t border-brand-border/40">
                    {/* Header Controls for Fetched Items */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-brand-card/40 p-3 rounded-2xl border border-brand-border/60">
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={handleToggleSelectAll}
                          className="text-xs font-bold flex items-center gap-1.5 text-brand-accent hover:underline cursor-pointer"
                        >
                          {selectedItemIds.length === fetchedItems.length ? (
                            <><CheckSquare className="h-4 w-4" /> Deselect All</>
                          ) : (
                            <><Square className="h-4 w-4" /> Select All ({fetchedItems.length})</>
                          )}
                        </button>
                        <span className="text-xs text-brand-muted">
                          • {selectedItemIds.length} chosen ({newSelectedCount} new, {updateSelectedCount} re-syncing)
                        </span>
                      </div>

                      {/* Search Filter & Step Controls */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Search in preview */}
                        <div className="relative">
                          <Search className="h-3.5 w-3.5 text-brand-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={searchFilter}
                            onChange={(e) => setSearchFilter(e.target.value)}
                            placeholder="Filter fetched items..."
                            className="bg-brand-bg border border-brand-border rounded-lg pl-8 pr-2.5 py-1 text-xs font-medium outline-none focus:border-brand-accent w-44"
                          />
                        </div>

                        {/* Prev / Next 100 Step Buttons */}
                        {prevSliceId && (
                          <button
                            type="button"
                            onClick={() => {
                              setRankRange(prevSliceId);
                              handleFetchData(prevSliceId);
                            }}
                            disabled={isFetching}
                            className="px-2.5 py-1 rounded-lg bg-brand-bg border border-brand-border text-xs font-semibold text-brand-muted hover:text-brand-text flex items-center gap-1 transition-colors cursor-pointer"
                            title="Load previous 100 items"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                            <span>Prev 100</span>
                          </button>
                        )}
                        {nextSliceId && (
                          <button
                            type="button"
                            onClick={() => {
                              setRankRange(nextSliceId);
                              handleFetchData(nextSliceId);
                            }}
                            disabled={isFetching}
                            className="px-2.5 py-1 rounded-lg bg-brand-bg border border-brand-border text-xs font-semibold text-brand-muted hover:text-brand-text flex items-center gap-1 transition-colors cursor-pointer"
                            title="Load next 100 items"
                          >
                            <span>Next 100</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Optional Vibe Cluster Assignment */}
                        {activeClusters.length > 0 && (
                          <select
                            value={targetCluster}
                            onChange={(e) => setTargetCluster(e.target.value)}
                            className="bg-brand-bg border border-brand-border rounded-lg px-2 py-1 text-xs font-medium outline-none focus:border-brand-accent"
                          >
                            <option value="">No Cluster</option>
                            {activeClusters.map(c => (
                              <option key={c.name} value={c.name}>{c.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>

                    {/* Active Range & Count Summary Bar */}
                    <div className="flex items-center justify-between text-xs px-1 text-brand-muted">
                      <span>
                        Showing <strong className="text-brand-text">{filteredFetchedItems.length}</strong> {filteredFetchedItems.length === 1 ? 'item' : 'items'}
                        {searchFilter.trim() && ` (filtered from ${fetchedItems.length})`}
                        {activeLoadedRange && ` • ${activeLoadedRange.label}`}
                      </span>
                      <span className="font-mono text-[11px] text-brand-muted">
                        Rank #{fetchedItems[0]?.rank || 1} – #{fetchedItems[fetchedItems.length - 1]?.rank || fetchedItems.length}
                      </span>
                    </div>

                    {/* List of Fetched Items */}
                    <div className="border border-brand-border/60 rounded-2xl overflow-hidden bg-brand-card/50 divide-y divide-brand-border/40 max-h-[380px] overflow-y-auto">
                      {filteredFetchedItems.map((item, idx) => {
                        const isSelected = selectedItemIds.includes(item.id);
                        const inVault = isItemInVault(item);
                        const tier = getFamiliarityTierDescription(item.inferredFamiliarity);
                        const rankNumber = item.rank || (idx + 1);

                        return (
                          <div
                            key={item.id || idx}
                            onClick={() => handleToggleSelectId(item.id)}
                            className={cn(
                              "p-3 flex items-center gap-3.5 transition-colors cursor-pointer select-none",
                              isSelected ? "bg-brand-accent/10" : "hover:bg-brand-card/80",
                              inVault && !isSelected ? "opacity-60" : ""
                            )}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleSelectId(item.id);
                              }}
                              className="text-brand-accent"
                            >
                              {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-brand-muted" />}
                            </button>

                            {/* Rank Badge */}
                            <span className="w-9 text-center text-[10px] font-mono font-bold bg-brand-bg/90 border border-brand-border/80 text-brand-muted px-1.5 py-0.5 rounded shrink-0">
                              #{rankNumber}
                            </span>

                            {/* Image or Icon Thumbnail with high-res picture */}
                            <div className="h-10 w-10 rounded-lg bg-brand-bg border border-brand-border flex items-center justify-center overflow-hidden shrink-0">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt={item.name}
                                  className="h-full w-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = 'none';
                                  }}
                                />
                              ) : item.type === 'artist' ? (
                                <UserIcon className="h-4 w-4 text-brand-muted" />
                              ) : item.type === 'album' ? (
                                <Disc className="h-4 w-4 text-brand-muted" />
                              ) : (
                                <Music className="h-4 w-4 text-brand-muted" />
                              )}
                            </div>

                            {/* Title & Details */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-xs text-brand-text truncate">
                                  {item.name}
                                </span>
                                {inVault ? (
                                  isSelected ? (
                                    <span className="text-[9px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0" title="Will re-sync playcount and recalculate familiarity">
                                      <RefreshCw className="h-2.5 w-2.5 text-sky-400" />
                                      In Vault • Re-syncing
                                    </span>
                                  ) : (
                                    <span className="text-[9px] font-bold bg-brand-bg text-brand-muted border border-brand-border px-1.5 py-0.5 rounded shrink-0">
                                      In Vault • Skipped
                                    </span>
                                  )
                                ) : (
                                  <span className="text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded shrink-0">
                                    New Item
                                  </span>
                                )}
                                {(item as LastFmTrackItem).isNowPlaying && (
                                  <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-1.5 py-0.5 rounded-full animate-pulse shrink-0">
                                    Now Playing
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 text-[11px] text-brand-muted truncate mt-0.5">
                                {item.type === 'track' && (
                                  <span>{(item as LastFmTrackItem).artist}</span>
                                )}
                                {item.type === 'album' && (
                                  <span>{(item as LastFmAlbumItem).artist}</span>
                                )}
                                {(item as LastFmTrackItem).durationSeconds && (
                                  <span>• {Math.floor((item as LastFmTrackItem).durationSeconds! / 60)}:{( (item as LastFmTrackItem).durationSeconds! % 60).toString().padStart(2, '0')}</span>
                                )}
                                {(item as LastFmTrackItem).dateText && !(item as LastFmTrackItem).isNowPlaying && (
                                  <span>• {(item as LastFmTrackItem).dateText}</span>
                                )}
                              </div>

                              {/* Tags from Last.fm */}
                              {item.tags && item.tags.length > 0 && (
                                <div className="flex items-center gap-1 flex-wrap mt-1">
                                  {item.tags.slice(0, 4).map(t => (
                                    <span key={t} className="inline-flex items-center text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-brand-bg border border-brand-border/60 text-red-400">
                                      <span className="text-red-500 font-bold mr-0.5">#</span>
                                      {t}
                                    </span>
                                  ))}
                                  {item.tags.length > 4 && (
                                    <span className="text-[8.5px] text-brand-muted font-mono" title={item.tags.slice(4).map(t => `#${t}`).join(', ')}>
                                      +{item.tags.length - 4} more
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Playcount & Inferred Familiarity Pill */}
                            <div className="text-right shrink-0">
                              {item.period && item.period !== 'overall' ? (
                                <div className="flex flex-col items-end">
                                  <div className="flex items-center justify-end gap-1 font-mono">
                                    <span className="text-[11px] font-bold text-red-400">
                                      {item.periodPlaycount.toLocaleString()}
                                    </span>
                                    <span className="text-[9.5px] font-bold text-red-300 bg-red-500/15 border border-red-500/30 px-1 py-0.2 rounded" title={getTimeframeFullLabel(item.period)}>
                                      /{getTimeframeShortLabel(item.period)}
                                    </span>
                                  </div>
                                  <div className="text-[9.5px] font-mono text-brand-muted mt-0.5" title={`Total lifetime plays on Last.fm: ${item.totalPlaycount.toLocaleString()}`}>
                                    {item.totalPlaycount.toLocaleString()} total
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-col items-end">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <span className="text-[11px] font-mono font-bold text-white">
                                      {item.totalPlaycount.toLocaleString()} {item.totalPlaycount === 1 ? 'play' : 'plays'}
                                    </span>
                                  </div>
                                  <div className="text-[9.5px] font-mono text-brand-muted">
                                    All-time total
                                  </div>
                                </div>
                              )}
                              <div className="flex items-center justify-end gap-1 mt-1">
                                <span className="text-[9.5px] text-brand-muted">Fam:</span>
                                <span className={cn("text-[10px] font-mono font-bold", tier.color)}>
                                  {item.inferredFamiliarity}%
                                </span>
                              </div>
                            </div>

                            {/* Last.fm Web Link */}
                            {item.url && (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1 text-brand-muted hover:text-brand-text hover:bg-brand-bg rounded-md"
                                title="View on Last.fm"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Import Button */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                      <span className="text-xs text-brand-muted">
                        {isImporting && importProgress ? (
                          <span className="text-amber-300 font-semibold flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                            Writing item {importProgress.current} of {importProgress.total} ({Math.round((importProgress.current / Math.max(1, importProgress.total)) * 100)}%) to vault...
                          </span>
                        ) : (
                          <span>{selectedItemIds.length} items selected ({newSelectedCount} new, {updateSelectedCount} existing to re-sync)</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={handleImportSelected}
                        disabled={isImporting || selectedItemIds.length === 0}
                        className={cn(
                          "py-2.5 px-6 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 cursor-pointer",
                          isImporting
                            ? "bg-amber-600/90 text-white cursor-wait"
                            : "bg-brand-accent hover:opacity-90 text-white disabled:opacity-50 disabled:pointer-events-none"
                        )}
                      >
                        {isImporting ? (
                          <>
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            <span>
                              Syncing {importProgress ? `${importProgress.current}/${importProgress.total} (${Math.round((importProgress.current / Math.max(1, importProgress.total)) * 100)}%)` : 'to Vault...'}
                            </span>
                          </>
                        ) : (
                          <>
                            <DownloadCloud className="h-4 w-4" />
                            <span>Sync & Import {selectedItemIds.length} Items</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* TAB 2: ENRICH EXISTING LIBRARY */}
          {activeTab === 'enrich' && (
            <div className="space-y-6">
              <div className="p-4 bg-purple-500/10 border border-purple-500/25 rounded-2xl flex items-start gap-3 text-xs text-brand-text">
                <Sparkles className="h-5 w-5 text-purple-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-purple-300">
                    Smart Vault Enrichment
                  </p>
                  <p className="text-brand-muted leading-relaxed">
                    Scan your existing artists, albums, and tracks to query Last.fm for your personal playcount (inferring familiarity), artist bios, album covers, genre tags, and track lengths. 
                    <strong className="text-brand-text block mt-1">Manual Relevance scores are strictly preserved.</strong>
                  </p>
                </div>
              </div>

              {/* Vault Statistics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-2xl bg-brand-card border border-brand-border/60 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-brand-muted">Total Vault Items</span>
                  <p className="text-xl font-bold text-white">{items.length}</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-brand-card border border-brand-border/60 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-brand-muted">Without Familiarity</span>
                  <p className="text-xl font-bold text-amber-400">
                    {items.filter(i => (i.familiarity === undefined || i.familiarity === 0)).length}
                  </p>
                </div>
                <div className="p-3.5 rounded-2xl bg-brand-card border border-brand-border/60 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-brand-muted">Artists in Vault</span>
                  <p className="text-xl font-bold text-emerald-400">
                    {items.filter(i => i.type === 'artist').length}
                  </p>
                </div>
                <div className="p-3.5 rounded-2xl bg-brand-card border border-brand-border/60 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-brand-muted">Tracks in Vault</span>
                  <p className="text-xl font-bold text-blue-400">
                    {items.filter(i => i.type === 'track').length}
                  </p>
                </div>
              </div>

              {/* Enrichment Configuration */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-brand-muted uppercase tracking-wider">Enrichment Scope</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    { id: 'unrated_familiarity', label: 'Items Missing Familiarity / Plays', desc: 'Fastest: enrich items that currently have 0% familiarity' },
                    { id: 'all', label: 'Entire Vault Library', desc: 'Re-sync scrobbles, tags, and covers for all items' },
                    { id: 'artists_only', label: 'Artists Only', desc: 'Fetch bios, genre tags, and listener stats' },
                    { id: 'tracks_only', label: 'Tracks Only', desc: 'Fetch durations, user scrobbles, and tags' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setEnrichScope(opt.id as any)}
                      className={cn(
                        "p-3 rounded-xl border text-left transition-all cursor-pointer",
                        enrichScope === opt.id
                          ? "bg-brand-accent/15 border-brand-accent text-white"
                          : "bg-brand-card border-brand-border text-brand-muted hover:border-brand-text/30"
                      )}
                    >
                      <div className="font-semibold text-xs text-brand-text">{opt.label}</div>
                      <div className="text-[10px] text-brand-muted mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Enrichment Progress Bar */}
              {isEnriching && enrichProgress && (
                <div className="p-4 sm:p-5 bg-gradient-to-br from-purple-500/10 via-brand-card to-brand-bg border border-purple-500/40 rounded-2xl space-y-3 shadow-lg shadow-purple-500/5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center shrink-0">
                        <RefreshCw className="h-4 w-4 text-purple-400 animate-spin" />
                      </div>
                      <div>
                        <div className="font-bold text-white flex items-center gap-2">
                          <span>Enriching Vault Metadata...</span>
                          <span className="text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.2 rounded-full">
                            Item {enrichProgress.current} of {enrichProgress.total}
                          </span>
                        </div>
                        <p className="text-[11px] text-brand-muted truncate max-w-md mt-0.5">
                          Currently querying: <strong className="text-purple-200">{enrichProgress.currentItemName || 'Fetching metadata...'}</strong>
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-mono font-bold text-purple-400">
                        {Math.round((enrichProgress.current / Math.max(1, enrichProgress.total)) * 100)}%
                      </span>
                    </div>
                  </div>

                  <div className="w-full bg-brand-bg/80 h-2.5 rounded-full overflow-hidden border border-brand-border/60">
                    <div 
                      className="bg-gradient-to-r from-purple-600 to-purple-400 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${Math.max(4, Math.round((enrichProgress.current / Math.max(1, enrichProgress.total)) * 100))}%` }}
                    />
                  </div>

                  <div className="pt-1 flex items-start gap-2 text-[11px] text-purple-300/90 font-medium">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-purple-400 mt-0.5" />
                    <span>
                      <strong>Enrichment in progress:</strong> Please keep this tab / modal open until finished. Querying Last.fm and updating item metadata in real-time.
                    </span>
                  </div>
                </div>
              )}

              {/* Enrichment Results */}
              {!isEnriching && enrichResults && (
                <div className="p-4 sm:p-5 bg-emerald-500/10 border border-emerald-500/40 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-300">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-sm">
                          Library Enrichment Complete!
                        </span>
                        <span className="text-[10px] font-mono font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Safe to close tab
                        </span>
                      </div>
                      <p className="text-brand-muted text-[11px]">
                        Successfully enriched and updated <strong className="text-emerald-300">{enrichResults.updatedCount} items</strong> with Last.fm playcounts, genre tags, and artwork
                        {enrichResults.errorCount > 0 ? ` (${enrichResults.errorCount} skipped/not found)` : ''}.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="py-1.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors shrink-0 cursor-pointer text-center"
                  >
                    View in Vault
                  </button>
                </div>
              )}

              {/* Action Button */}
              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleBatchEnrich}
                  disabled={isEnriching || !username.trim()}
                  className="py-2.5 px-6 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>{isEnriching ? "Enriching Vault..." : "Start Library Enrichment"}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: ACCOUNT & SETTINGS */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Connection Form */}
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-brand-text flex items-center justify-between">
                      <span>Last.fm Username</span>
                      <span className="text-[10px] text-brand-muted">Required for scrobbles</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. cassius_carv"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-brand-card border border-brand-border rounded-xl px-3.5 py-2.5 text-xs text-brand-text outline-none focus:border-brand-accent transition-all font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-brand-text flex items-center justify-between">
                      <span>Last.fm API Key (Optional / Personal)</span>
                      <span className="text-[10px] text-emerald-400 font-normal">Default key included</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Leave blank to use default or paste personal key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="w-full bg-brand-card border border-brand-border rounded-xl px-3.5 py-2.5 text-xs text-brand-text outline-none focus:border-brand-accent transition-all font-mono text-[11px]"
                    />
                    <p className="text-[10px] text-brand-muted">
                      A default public key is provided for instant use. You can also paste your own 32-character key.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={isTesting || !username.trim()}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", isTesting ? "animate-spin" : "")} />
                      <span>{isTesting ? "Testing..." : "Test Connection & Save"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveSettingsOnly}
                      className="py-2.5 px-4 rounded-xl bg-brand-card border border-brand-border hover:border-brand-accent text-brand-text font-bold text-xs transition-all cursor-pointer"
                    >
                      Save
                    </button>
                  </div>

                  {settingsSaved && (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-xs text-emerald-400">
                      <Check className="h-4 w-4" />
                      <span>Settings saved to your profile!</span>
                    </div>
                  )}

                  {testResult && (
                    <div className={cn(
                      "p-3.5 rounded-xl border text-xs",
                      testResult.success 
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                        : "bg-red-500/10 border-red-500/30 text-red-400"
                    )}>
                      {testResult.success ? (
                        <div className="space-y-1">
                          <div className="font-bold flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Connected to @{testResult.user?.name}</span>
                          </div>
                          <p className="text-[11px] opacity-80">
                            Total Scrobbles: {testResult.user?.playcount?.toLocaleString()} • Artists: {testResult.user?.artistCount?.toLocaleString()}
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          <span>{testResult.error}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Step-by-Step Guide Card */}
                <div className="p-5 rounded-2xl bg-brand-card/60 border border-brand-border/60 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
                    <HelpCircle className="h-4 w-4 text-brand-accent" />
                    <span>How to get your own Last.fm API key</span>
                  </div>

                  <ol className="space-y-2.5 text-xs text-brand-muted list-decimal list-inside leading-relaxed">
                    <li>
                      Log into your account at{' '}
                      <a 
                        href="https://www.last.fm" 
                        target="_blank" 
                        rel="noreferrer" 
                        className="text-red-400 hover:underline font-medium inline-flex items-center gap-0.5"
                      >
                        last.fm <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </li>
                    <li>
                      Visit the{' '}
                      <a 
                        href="https://www.last.fm/api/account/create" 
                        target="_blank" 
                        rel="noreferrer" 
                        className="text-red-400 hover:underline font-medium inline-flex items-center gap-0.5"
                      >
                        API Account Creation <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </li>
                    <li>
                      Fill in Application name (e.g. <code className="bg-brand-bg px-1 rounded text-brand-text">Sonic Vault</code>) and submit.
                    </li>
                    <li>
                      Copy the generated <strong className="text-brand-text">API Key</strong> and paste it into the field here.
                    </li>
                  </ol>

                  <div className="pt-2 border-t border-brand-border/40 text-[11px] text-brand-muted space-y-1">
                    <strong className="text-brand-text">Calibrated Familiarity inference (0–98% maximum, 100% never reached):</strong>
                    <p className="mt-0.5">
                      • <strong className="text-brand-text/90">Artists:</strong> progressive curve across thousands of plays (e.g. 10 plays ≈ 24%, 100 plays ≈ 58%, 300 plays ≈ 75%, 1,000 plays ≈ 86%, 5,000 plays ≈ 97%, cap at 98%).
                    </p>
                    <p>
                      • <strong className="text-brand-text/90">Tracks:</strong> scaled for repeat track listens (e.g. 1 play = 15%, 5 plays = 40%, 20 plays = 70%, 100 plays = 93%, 600+ plays = 98%).
                    </p>
                    <p className="text-brand-accent/90 font-medium">
                      • Relevance score is strictly 100% manual.
                    </p>
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-brand-border/60 bg-brand-bg/40 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-brand-muted">
            <Radio className="h-3.5 w-3.5 text-red-500" />
            <span>
              {isImporting ? (
                <span className="text-amber-400 font-semibold animate-pulse">Syncing items to vault...</span>
              ) : isEnriching ? (
                <span className="text-purple-400 font-semibold animate-pulse">Enriching vault items...</span>
              ) : (
                'Last.fm Public API Integration'
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={handleAttemptClose}
            className="py-2 px-5 rounded-xl bg-brand-card border border-brand-border hover:border-brand-accent text-brand-text font-bold text-xs transition-colors cursor-pointer"
          >
            {isImporting || isEnriching ? 'Cancel / Close' : 'Close'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
