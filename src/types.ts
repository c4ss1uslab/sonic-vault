export type ItemType = 'artist' | 'album' | 'playlist' | 'track' | 'excerpt';

export type LastFmPeriod = 'overall' | '7day' | '1month' | '3month' | '6month' | '12month';

export interface AudioSegment {
  id: string;
  name: string; // e.g. "Intro riff", "Guitar solo", "Hook", or "Excerpt 1"
  startTime: number; // in seconds (e.g. 14 for 0:14)
  endTime: number; // in seconds (e.g. 38 for 0:38)
  comments?: string; // Commentary or feedback for this specific demarcated section
  tags?: string[];
}

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
  // Excerpt & Sample audio fields
  audioUrl?: string;
  audioStorageKey?: string;
  audioFileName?: string;
  audioMimeType?: string;
  audioDuration?: number;
  segments?: AudioSegment[]; // List of demarcated excerpts within this concentrated audio file
  activeSegmentId?: string; // Currently active / playing excerpt segment
  startTime?: number; // Optional custom start time
  endTime?: number; // Optional custom end time
  linkedArtistId?: string;
  linkedArtistName?: string;
  linkedTrackId?: string;
  linkedTrackName?: string;
  isLooping?: boolean;
  comments?: string; // Excerpt commentary and feedback
  parentItemId?: string; // If this item represents an individual segment of an excerpt
  originalSegmentId?: string; // ID of the specific segment if rendered individually
  isIndividualExcerpt?: boolean; // Flag indicating this item is an expanded individual excerpt
  // Fillable curation metadata fields
  relatedToSource?: string; // on artists: artist metadata: related to/source
  genres?: string; // on artists/playlists/albums/tracks/excerpts: genre(s)
  rhythms?: string; // on artists/playlists/albums/tracks/excerpts: rhythm(s)
  bpm?: number | string; // on tracks/excerpts: BPM
  instrumentationDetails?: string; // on tracks/excerpts: instrumentation details
  key?: string; // on tracks/excerpts: key
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
  excerptCount: number;
}
