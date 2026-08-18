export type ItemType = 'artist' | 'album' | 'playlist' | 'track';

export type LastFmPeriod = 'overall' | '7day' | '1month' | '3month' | '6month' | '12month';

export interface TagCluster {
  name: string;
  tags: string[];
  description?: string;
  category?: 'vibe' | 'genre';
  color?: string;
}

export interface LastFmSettings {
  username: string;
  apiKey: string;
  autoEnrich?: boolean;
  lastSync?: string;
  defaultPeriod?: LastFmPeriod | string;
}

export interface MusicItem {
  id: string;
  userId: string;
  type: ItemType;
  name: string;
  url: string;
  imageUrl?: string;
  parentId?: string;
  parentName?: string;
  subtitle?: string;
  releaseDate?: string;
  songCount?: number;
  durationSeconds?: number;
  creator?: string;
  creatorUrl?: string;
  relevance?: number; // 0-100 (MANUAL ONLY: strictly not touched by Last.fm auto-sync)
  favoriteLevel?: number; // 0 (unstarred), 1 (70/yellow), 2 (80/green), 3 (90/red), 4 (95/purple)
  familiarity?: number; // 0-100 (inferred from playcount or manually adjusted)
  rank?: number; // Ranking position in library or Last.fm charts
  aiAnalyzed?: boolean;
  tags: string[];
  tagSources?: Record<string, 'llm' | 'manual' | 'lastfm'>;
  primaryCluster?: string;
  rating: number; // 0-100
  notes: string;
  // Fillable curation metadata fields
  relatedToSource?: string; // on artists: artist metadata: related to/source
  genres?: string; // on artists/playlists/albums/tracks: genre(s)
  rhythms?: string; // on artists/playlists/albums/tracks: rhythm(s)
  bpm?: number | string; // on tracks: BPM
  instrumentationDetails?: string; // on tracks: instrumentation details
  key?: string; // on tracks: key
  // Last.fm Integration metadata
  lastFmPlaycount?: number; // Total / lifetime absolute scrobbles
  lastFmPeriodPlaycount?: number; // Scrobbles in specific timeframe (e.g. 7d, 30d, 90d, 180d, 1yr)
  lastFmPeriod?: LastFmPeriod | string; // Timeframe period identifier
  lastFmUrl?: string;
  lastFmListeners?: number;
  lastFmEnrichedAt?: string;
  createdAt: any;
  updatedAt: any;
}

export interface UserStats {
  totalItems: number;
  artistCount: number;
  albumCount: number;
  playlistCount: number;
  trackCount: number;
}
