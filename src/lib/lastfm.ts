export type LastFmPeriod = 'overall' | '7day' | '1month' | '3month' | '6month' | '12month';

export interface LastFmSettings {
  username: string;
  apiKey: string;
  autoEnrich?: boolean;
  lastSync?: string;
  defaultPeriod?: LastFmPeriod | string;
}

export function getTimeframeShortLabel(period?: LastFmPeriod | string | null): string {
  if (!period) return '';
  switch (period) {
    case '7day': return '7d';
    case '1month': return '30d';
    case '3month': return '90d';
    case '6month': return '180d';
    case '12month': return '1 yr';
    case 'overall': return 'All-time';
    case 'recent': return 'Recent';
    default: return String(period);
  }
}

export function getTimeframeFullLabel(period?: LastFmPeriod | string | null): string {
  if (!period) return 'Specified Timeframe';
  switch (period) {
    case '7day': return 'Last 7 Days (7d)';
    case '1month': return 'Last 30 Days (1 Month)';
    case '3month': return 'Last 90 Days (3 Months)';
    case '6month': return 'Last 180 Days (6 Months)';
    case '12month': return 'Last 1 Year (12 Months)';
    case 'overall': return 'All-Time (Overall)';
    case 'recent': return 'Recent Live Scrobbles';
    default: return String(period);
  }
}

export interface LastFmTrackItem {
  id: string;
  name: string;
  artist: string;
  album?: string;
  playcount: number; // General playcount
  periodPlaycount: number; // Scrobbles during selected timeframe
  totalPlaycount: number; // Total absolute lifetime scrobbles
  period?: LastFmPeriod | string;
  inferredFamiliarity: number;
  durationSeconds?: number;
  url: string;
  imageUrl?: string;
  tags: string[];
  dateText?: string;
  isNowPlaying?: boolean;
  type: 'track';
  listeners?: number;
  bioSummary?: string;
  rank?: number;
}

export interface LastFmArtistItem {
  id: string;
  name: string;
  playcount: number;
  periodPlaycount: number;
  totalPlaycount: number;
  period?: LastFmPeriod | string;
  inferredFamiliarity: number;
  url: string;
  imageUrl?: string;
  tags: string[];
  type: 'artist';
  listeners?: number;
  bioSummary?: string;
  genres?: string;
  similarArtists?: string[];
  rank?: number;
}

export interface LastFmAlbumItem {
  id: string;
  name: string;
  artist: string;
  playcount: number;
  periodPlaycount: number;
  totalPlaycount: number;
  period?: LastFmPeriod | string;
  inferredFamiliarity: number;
  url: string;
  imageUrl?: string;
  tags: string[];
  type: 'album';
  songCount?: number;
  releaseDate?: string;
  listeners?: number;
  bioSummary?: string;
  genres?: string;
  rank?: number;
}

export type LastFmFetchedItem = LastFmTrackItem | LastFmArtistItem | LastFmAlbumItem;

// Built-in working public demo key if user doesn't have one yet, while encouraging them to provide their own
export const DEFAULT_FALLBACK_API_KEY = '2c6e6d1b7dfbca821cf3e78ecb1b4d08';

/**
 * Smoothly interpolates along calibrated anchor points.
 * Ensures monotonic, proportional, and continuous growth where every single play
 * moves familiarity slightly up without flat brackets or sudden jumps.
 * Max familiarity is strictly capped at 98% (never 100%).
 */
function interpolateFamiliarity(playcount: number, anchors: Array<[number, number]>): number {
  if (!playcount || playcount <= 0) return 0;
  
  if (playcount <= anchors[0][0]) {
    const ratio = playcount / anchors[0][0];
    return Math.max(1, Math.round(ratio * anchors[0][1]));
  }

  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];

    if (playcount >= x0 && playcount <= x1) {
      const t = (playcount - x0) / (x1 - x0);
      const val = y0 + t * (y1 - y0);
      return Math.min(98, Math.max(1, Math.round(val)));
    }
  }

  // Beyond top anchor: smoothly approach 98%
  const last = anchors[anchors.length - 1];
  const excess = playcount - last[0];
  const tail = last[1] + (98 - last[1]) * (1 - Math.exp(-excess / 1500));
  return Math.min(98, Math.max(1, Math.round(tail)));
}

const TRACK_ANCHORS: Array<[number, number]> = [
  [1, 4],
  [2, 7],
  [3, 10],
  [5, 14],
  [10, 20],
  [20, 28],
  [35, 38],
  [60, 50],
  [80, 60],
  [100, 70],
  [140, 78],
  [180, 84],
  [250, 90],
  [350, 94],
  [500, 96],
  [800, 97],
  [1500, 98],
];

const ALBUM_ANCHORS: Array<[number, number]> = [
  [1, 2],
  [5, 6],
  [15, 14],
  [30, 24],
  [50, 35],
  [80, 45],
  [100, 50],
  [150, 60],
  [200, 70],
  [300, 78],
  [450, 85],
  [700, 91],
  [1000, 95],
  [1800, 97],
  [3000, 98],
];

const ARTIST_ANCHORS: Array<[number, number]> = [
  [1, 1],
  [5, 4],
  [15, 8],
  [40, 16],
  [100, 26],
  [200, 38],
  [300, 50],
  [450, 60],
  [600, 70],
  [900, 78],
  [1400, 84],
  [2200, 89],
  [3500, 93],
  [5000, 96],
  [8000, 97],
  [15000, 98],
];

/**
 * Calculates Familiarity Level (0 - 98%) strictly from playcount using calibrated continuous curves.
 * 100% is NEVER reached (capped at 98%).
 * - Tracks: 60 plays ~ 50%, 100 plays ~ 70%, 500 plays ~ 96%, proportional per play.
 * - Albums: 100 plays ~ 50%, 200 plays ~ 70%, 1000 plays ~ 95%, proportional per play.
 * - Artists: 300 plays ~ 50%, 600 plays ~ 70%, 5000 plays ~ 96%, proportional per play.
 * Relevance Score is strictly NEVER calculated or modified by Last.fm (it remains manual-only).
 */
export function inferFamiliarityFromPlaycount(
  playcount: number,
  type: 'artist' | 'track' | 'album' | 'playlist' = 'track'
): number {
  if (!playcount || playcount <= 0) return 0;

  if (type === 'artist') {
    return interpolateFamiliarity(playcount, ARTIST_ANCHORS);
  }

  if (type === 'album') {
    return interpolateFamiliarity(playcount, ALBUM_ANCHORS);
  }

  // Tracks, Playlists, and general audio items
  return interpolateFamiliarity(playcount, TRACK_ANCHORS);
}

export function getFamiliarityTierDescription(score: number): { label: string; color: string } {
  if (score >= 95) return { label: 'Obsession / Core Rotation (95-98%)', color: 'text-purple-400' };
  if (score >= 90) return { label: 'Heavy Rotation (90-94%)', color: 'text-red-400' };
  if (score >= 80) return { label: 'Well Known (80-89%)', color: 'text-emerald-400' };
  if (score >= 70) return { label: 'Familiar (70-79%)', color: 'text-amber-400' };
  if (score >= 40) return { label: 'Moderate Familiarity (40-69%)', color: 'text-blue-400' };
  if (score > 0) return { label: 'Casual / Discovered (1-39%)', color: 'text-neutral-400' };
  return { label: 'Unplayed / New (0%)', color: 'text-neutral-500' };
}

const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

const imageCache = new Map<string, string>();

/**
 * Robust image cleaner for Last.fm responses
 */
function cleanImage(images?: Array<{ '#text': string; size: string }>): string | undefined {
  if (!images || images.length === 0) return undefined;
  const extralarge = images.find(img => img.size === 'extralarge' || img.size === 'large' || img.size === 'mega');
  const fallback = images[images.length - 1];
  const url = extralarge?.['#text'] || fallback?.['#text'];
  if (!url || url.includes('2a96cbd8b46e442fc41c2b86b821562f') || url.trim() === '') {
    // Last.fm placeholder star image or empty
    return undefined;
  }
  return url;
}

/**
 * Multi-source CORS proxy fetcher for public web resources
 */
async function fetchViaProxies(url: string, timeoutMs: number = 5000): Promise<string | null> {
  const proxies = [
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`
  ];

  for (const proxyUrl of proxies) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 50) {
          return text;
        }
      }
    } catch (e) {
      // try next proxy
    }
  }
  return null;
}

/**
 * Universal JSONP fetcher for Deezer API (zero CORS restrictions)
 */
function fetchDeezerJsonp(endpoint: string, timeoutMs: number = 4500): Promise<any> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const callbackName = 'deezer_cb_' + Math.random().toString(36).substring(2, 10);
    const script = document.createElement('script');
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(null);
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      try {
        if ((window as any)[callbackName]) delete (window as any)[callbackName];
      } catch (e) {}
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    (window as any)[callbackName] = (data: any) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(data);
      }
    };

    script.src = `${endpoint}${endpoint.includes('?') ? '&' : '?'}output=jsonp&callback=${callbackName}`;
    script.onerror = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(null);
      }
    };
    document.head.appendChild(script);
  });
}

/**
 * Resolves artist profile picture from Last.fm CDN, Deezer, Wikipedia, iTunes, and TheAudioDB
 */
export async function fetchArtistPicture(artistName: string, apiKey?: string): Promise<string | undefined> {
  const cleanName = artistName.trim();
  if (!cleanName) return undefined;
  const cacheKey = `artist_${cleanName.toLowerCase()}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  // 1. Try Last.fm Web Scraping for direct CDN profile photo
  try {
    const lfmUrl = `https://www.last.fm/music/${encodeURIComponent(cleanName)}`;
    const html = await fetchViaProxies(lfmUrl, 4000);
    if (html) {
      // Look for Last.fm high-res avatar / header / gallery images
      const fastlyMatch = html.match(/https:\/\/lastfm\.freetls\.fastly\.net\/i\/u\/(?:avatar170s|ar0|300x300|770x0|174s|avatar70s)\/([a-zA-Z0-9]+)\.(?:jpg|png|jpeg|webp)/i) ||
                          html.match(/https:\/\/lastfm\.freetls\.fastly\.net\/i\/u\/([a-zA-Z0-9]+)\.(?:jpg|png|jpeg|webp)/i);
      if (fastlyMatch && fastlyMatch[1]) {
        // Upgrade to high-res 770x0 or ar0 Last.fm CDN format
        const highResLfm = `https://lastfm.freetls.fastly.net/i/u/770x0/${fastlyMatch[1]}.jpg`;
        imageCache.set(cacheKey, highResLfm);
        return highResLfm;
      }

      // Check header background image
      const bgMatch = html.match(/header-new-background-image[^>]+style=["']background-image:\s*url\((?:&quot;|["'])?([^"'\)]+)(?:&quot;|["'])?\)/i);
      if (bgMatch && bgMatch[1] && !bgMatch[1].includes('placeholder')) {
        const bgUrl = bgMatch[1].replace(/&amp;/g, '&');
        imageCache.set(cacheKey, bgUrl);
        return bgUrl;
      }
    }
  } catch (e) { /* continue */ }

  // 2. Try Deezer API (Outstanding coverage, zero API key needed, high-res 1000x1000)
  try {
    const deezerData = await fetchDeezerJsonp(`https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName)}&limit=1`);
    if (deezerData?.data && deezerData.data.length > 0) {
      const art = deezerData.data[0];
      const pic = art.picture_xl || art.picture_big || art.picture_medium;
      if (pic && !pic.includes('default_artist')) {
        imageCache.set(cacheKey, pic);
        return pic;
      }
    }
  } catch (e) { /* continue */ }

  // 3. Try Wikipedia MediaWiki PageImages API (Native CORS with origin=*, high resolution portraits)
  try {
    const wikiQueries = [
      cleanName,
      `${cleanName} (band)`,
      `${cleanName} (musician)`,
      `${cleanName} (singer)`,
      `${cleanName} (group)`
    ];
    const titlesParam = wikiQueries.map(q => encodeURIComponent(q)).join('|');
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages&piprop=original|thumbnail&pithumbsize=600&titles=${titlesParam}`;
    const res = await fetch(wikiUrl);
    if (res.ok) {
      const data = await res.json();
      const pages = data.query?.pages || {};
      for (const pageId in pages) {
        const page = pages[pageId];
        if (page && page.pageid && page.pageid > 0) {
          const imgUrl = page.original?.source || page.thumbnail?.source;
          if (imgUrl && !imgUrl.includes('question_mark') && !imgUrl.includes('Disambig')) {
            imageCache.set(cacheKey, imgUrl);
            return imgUrl;
          }
        }
      }
    }
  } catch (e) { /* continue */ }

  // 4. Try Wikipedia REST Summary
  try {
    const wikiSummaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanName.replace(/\s+/g, '_'))}`;
    const res = await fetch(wikiSummaryUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.thumbnail?.source && !data.thumbnail.source.includes('question_mark')) {
        const pic = data.thumbnail.source;
        imageCache.set(cacheKey, pic);
        return pic;
      }
      if (data.originalimage?.source) {
        const pic = data.originalimage.source;
        imageCache.set(cacheKey, pic);
        return pic;
      }
    }
  } catch (e) { /* continue */ }

  // 5. Try iTunes Search API for Artist & Artist releases
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=musicArtist&limit=1`;
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const artistId = data.results[0].artistId;
        if (artistId) {
          const lookupUrl = `https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=1`;
          const lRes = await fetch(lookupUrl);
          if (lRes.ok) {
            const lData = await lRes.json();
            const albumResult = lData.results?.find((r: any) => r.wrapperType === 'collection');
            if (albumResult?.artworkUrl100) {
              const highRes = albumResult.artworkUrl100.replace('100x100bb', '600x600bb');
              imageCache.set(cacheKey, highRes);
              return highRes;
            }
          }
        }
      }
    }
  } catch (e) { /* continue */ }

  // 6. Try iTunes Album artwork for this artist
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanName)}&entity=album&limit=1`;
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.results?.[0]?.artworkUrl100) {
        const highRes = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
        imageCache.set(cacheKey, highRes);
        return highRes;
      }
    }
  } catch (e) { /* continue */ }

  // 7. Try TheAudioDB
  try {
    const tadbUrl = `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(cleanName)}`;
    const res = await fetch(tadbUrl);
    if (res.ok) {
      const data = await res.json();
      const artistObj = data.artists?.[0];
      if (artistObj?.strArtistThumb || artistObj?.strArtistFanart) {
        const pic = artistObj.strArtistThumb || artistObj.strArtistFanart;
        imageCache.set(cacheKey, pic);
        return pic;
      }
    }
  } catch (e) { /* continue */ }

  // 8. Try Last.fm API artist.getInfo
  try {
    const key = apiKey || DEFAULT_FALLBACK_API_KEY;
    const lfmApiUrl = `${BASE_URL}?method=artist.getinfo&artist=${encodeURIComponent(cleanName)}&api_key=${encodeURIComponent(key)}&format=json`;
    const res = await fetch(lfmApiUrl);
    if (res.ok) {
      const data = await res.json();
      const img = cleanImage(data.artist?.image);
      if (img) {
        imageCache.set(cacheKey, img);
        return img;
      }
    }
  } catch (e) { /* continue */ }

  return undefined;
}

/**
 * Resolves album cover image from Deezer, iTunes Search API, Last.fm, and Wikipedia
 */
export async function fetchAlbumCover(artistName: string, albumName: string, apiKey?: string): Promise<string | undefined> {
  const cleanArtist = artistName.trim();
  const cleanAlbum = albumName.trim();
  if (!cleanAlbum) return undefined;
  const cacheKey = `album_${cleanArtist.toLowerCase()}_${cleanAlbum.toLowerCase()}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  // 1. Try Deezer Search API
  try {
    const query = `${cleanArtist} ${cleanAlbum}`.trim();
    const deezerData = await fetchDeezerJsonp(`https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=1`);
    if (deezerData?.data && deezerData.data.length > 0) {
      const alb = deezerData.data[0];
      const pic = alb.cover_xl || alb.cover_big || alb.cover_medium;
      if (pic) {
        imageCache.set(cacheKey, pic);
        return pic;
      }
    }
  } catch (e) { /* continue */ }

  // 2. Try iTunes Search API with Artist + Album
  try {
    const query = `${cleanArtist} ${cleanAlbum}`.trim();
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=1`;
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.results?.[0]?.artworkUrl100) {
        const highRes = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
        imageCache.set(cacheKey, highRes);
        return highRes;
      }
    }
  } catch (e) { /* continue */ }

  // 3. Try iTunes Search API with Album title alone
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanAlbum)}&entity=album&limit=1`;
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.results?.[0]?.artworkUrl100) {
        const highRes = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
        imageCache.set(cacheKey, highRes);
        return highRes;
      }
    }
  } catch (e) { /* continue */ }

  // 4. Try Last.fm album.getInfo API
  try {
    const key = apiKey || DEFAULT_FALLBACK_API_KEY;
    const lfmUrl = `${BASE_URL}?method=album.getinfo&artist=${encodeURIComponent(cleanArtist)}&album=${encodeURIComponent(cleanAlbum)}&api_key=${encodeURIComponent(key)}&format=json`;
    const res = await fetch(lfmUrl);
    if (res.ok) {
      const data = await res.json();
      const img = cleanImage(data.album?.image);
      if (img) {
        imageCache.set(cacheKey, img);
        return img;
      }
    }
  } catch (e) { /* continue */ }

  // 5. Try Wikipedia
  try {
    const wikiSummaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent((cleanAlbum + ' (album)').replace(/\s+/g, '_'))}`;
    const res = await fetch(wikiSummaryUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.thumbnail?.source) {
        const pic = data.thumbnail.source;
        imageCache.set(cacheKey, pic);
        return pic;
      }
    }
  } catch (e) { /* continue */ }

  return undefined;
}

/**
 * Resolves track cover image from Deezer, iTunes, album artwork, or artist photo
 */
export async function fetchTrackCover(artistName: string, trackName: string, albumName?: string, apiKey?: string): Promise<string | undefined> {
  const cleanArtist = artistName.trim();
  const cleanTrack = trackName.trim();
  if (!cleanTrack) return undefined;
  const cacheKey = `track_${cleanArtist.toLowerCase()}_${cleanTrack.toLowerCase()}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  // 1. Try Deezer Search API
  try {
    const query = cleanArtist ? `artist:"${cleanArtist}" track:"${cleanTrack}"` : cleanTrack;
    const deezerData = await fetchDeezerJsonp(`https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=1`);
    if (deezerData?.data && deezerData.data.length > 0) {
      const trk = deezerData.data[0];
      const pic = trk.album?.cover_xl || trk.album?.cover_big || trk.artist?.picture_xl || trk.artist?.picture_big;
      if (pic) {
        imageCache.set(cacheKey, pic);
        return pic;
      }
    }
  } catch (e) { /* continue */ }

  // 2. Try iTunes Search API for song
  try {
    const query = `${cleanArtist} ${cleanTrack}`.trim();
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.results?.[0]?.artworkUrl100) {
        const highRes = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
        imageCache.set(cacheKey, highRes);
        return highRes;
      }
    }
  } catch (e) { /* continue */ }

  // 3. Fallback to album cover if album title is provided
  if (albumName) {
    const albumCover = await fetchAlbumCover(cleanArtist, albumName, apiKey);
    if (albumCover) {
      imageCache.set(cacheKey, albumCover);
      return albumCover;
    }
  }

  // 4. Try Last.fm track.getInfo API
  try {
    const key = apiKey || DEFAULT_FALLBACK_API_KEY;
    const lfmUrl = `${BASE_URL}?method=track.getinfo&artist=${encodeURIComponent(cleanArtist)}&track=${encodeURIComponent(cleanTrack)}&api_key=${encodeURIComponent(key)}&format=json`;
    const res = await fetch(lfmUrl);
    if (res.ok) {
      const data = await res.json();
      const img = cleanImage(data.track?.album?.image);
      if (img) {
        imageCache.set(cacheKey, img);
        return img;
      }
    }
  } catch (e) { /* continue */ }

  // 5. Fallback to artist photo
  if (cleanArtist) {
    const artistPic = await fetchArtistPicture(cleanArtist, apiKey);
    if (artistPic) {
      return artistPic;
    }
  }

  return undefined;
}

/**
 * Universal artwork resolver for any vault item or external music link
 */
export async function fetchItemArtwork(
  item: {
    type?: string;
    name: string;
    parentName?: string;
    url?: string;
    lastFmUrl?: string;
  },
  apiKey?: string
): Promise<string | undefined> {
  const url = (item.url || item.lastFmUrl || '').trim();
  const name = (item.name || '').trim();
  const type = item.type || 'artist';
  const parent = (item.parentName || '').trim();

  // 1. If YouTube link
  if (url) {
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
  }

  // 2. Resolve by music entity type
  if (type === 'artist') {
    const pic = await fetchArtistPicture(name, apiKey);
    if (pic) return pic;
  } else if (type === 'album') {
    const pic = await fetchAlbumCover(parent, name, apiKey);
    if (pic) return pic;
    if (parent) {
      const artPic = await fetchArtistPicture(parent, apiKey);
      if (artPic) return artPic;
    }
  } else if (type === 'track') {
    const pic = await fetchTrackCover(parent, name, undefined, apiKey);
    if (pic) return pic;
    if (parent) {
      const artPic = await fetchArtistPicture(parent, apiKey);
      if (artPic) return artPic;
    }
  } else {
    // Playlist or generic item
    if (name) {
      const pic = await fetchArtistPicture(name, apiKey);
      if (pic) return pic;
    }
  }

  // 3. Fallback: Generic URL scraping via proxies
  if (url) {
    try {
      const html = await fetchViaProxies(url, 3500);
      if (html) {
        const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) || 
                      html.match(/<meta\s+name=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                      html.match(/<meta\s+itemprop=["']image["']\s+content=["']([^"']+)["']/i) ||
                      html.match(/href=["']([^"']+)["'][^>]+rel=["']image_src["']/i);
        if (match && match[1] && !match[1].includes('placeholder')) {
          return match[1].replace(/&amp;/g, '&');
        }
      }
    } catch (e) { /* ignore */ }
  }

  return undefined;
}

function cleanBio(rawBio?: string): string {
  if (!rawBio) return '';
  // Strip HTML tags and the "<a href=... >Read more on Last.fm</a>" footer
  let text = rawBio.replace(/<a\b[^>]*>.*?<\/a>/gi, '');
  text = text.replace(/<\/?[^>]+(>|$)/g, '');
  text = text.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  text = text.replace(/Read more on Last\.fm\..*$/gi, '');
  return text.trim();
}

/**
 * Validates connection with Last.fm user account
 */
export async function testLastFmConnection(username: string, apiKey: string): Promise<{ success: boolean; user?: any; error?: string }> {
  if (!username.trim()) {
    return { success: false, error: 'Please provide a Last.fm username.' };
  }
  const key = apiKey.trim() || DEFAULT_FALLBACK_API_KEY;

  try {
    const url = `${BASE_URL}?method=user.getinfo&user=${encodeURIComponent(username.trim())}&api_key=${encodeURIComponent(key)}&format=json`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      return { success: false, error: data.message || `Last.fm Error Code ${data.error}` };
    }

    if (data.user) {
      return {
        success: true,
        user: {
          name: data.user.name,
          realname: data.user.realname || data.user.name,
          url: data.user.url,
          playcount: parseInt(data.user.playcount || '0', 10),
          artistCount: parseInt(data.user.artist_count || '0', 10),
          trackCount: parseInt(data.user.track_count || '0', 10),
          albumCount: parseInt(data.user.album_count || '0', 10),
          imageUrl: cleanImage(data.user.image),
          registered: data.user.registered?.['#text'] || ''
        }
      };
    }

    return { success: false, error: 'Could not find user info in Last.fm response.' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error connecting to Last.fm' };
  }
}

/**
 * Concurrency runner for parallel API requests in manageable batches
 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Fetches user's Top Artists for a specified period & page
 */
export async function fetchLastFmTopArtists(
  username: string,
  apiKey: string,
  period: LastFmPeriod = 'overall',
  limit: number = 50,
  page: number = 1
): Promise<LastFmArtistItem[]> {
  const key = apiKey.trim() || DEFAULT_FALLBACK_API_KEY;
  const url = `${BASE_URL}?method=user.gettopartists&user=${encodeURIComponent(username.trim())}&period=${period}&limit=${limit}&page=${page}&api_key=${encodeURIComponent(key)}&format=json`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(data.message || `Last.fm Error Code ${data.error}`);
  }

  const rawArtists = data.topartists?.artist || [];
  const list = Array.isArray(rawArtists) ? rawArtists : [rawArtists];

  // Fetch pictures and enrich each artist with tags, bio, playcount, listeners in parallel batches
  const items = await mapConcurrent(list, 12, async (a: any, idx: number) => {
    const rank = parseInt(a['@attr']?.rank || String((page - 1) * limit + idx + 1), 10);
    const periodPlaycount = parseInt(a.playcount || '0', 10);
    let totalPlaycount = period === 'overall' ? periodPlaycount : periodPlaycount;
    let imageUrl = cleanImage(a.image);
    let tags: string[] = [];
    let bioSummary: string | undefined = undefined;
    let genres: string | undefined = undefined;
    let listeners: number | undefined = a.listeners ? parseInt(a.listeners, 10) : undefined;
    let similarArtists: string[] | undefined = undefined;

    try {
      const enrich = await enrichArtistFromLastFm(a.name, key, username);
      if (enrich) {
        if (enrich.tags && enrich.tags.length > 0) {
          tags = enrich.tags;
        }
        if (enrich.genres) genres = enrich.genres;
        if (enrich.bioSummary) bioSummary = enrich.bioSummary;
        if (enrich.listeners) listeners = enrich.listeners;
        if (enrich.similarArtists) similarArtists = enrich.similarArtists;
        if (enrich.imageUrl) imageUrl = enrich.imageUrl;
        if (enrich.userPlaycount !== undefined && enrich.userPlaycount > 0) {
          totalPlaycount = Math.max(enrich.userPlaycount, periodPlaycount);
        }
      }
    } catch (e) { /* ignore */ }

    if (!imageUrl) {
      try {
        imageUrl = await fetchArtistPicture(a.name, key);
      } catch (e) { /* ignore */ }
    }

    return {
      id: `lfm_artist_${a.mbid || a.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_r${rank}`,
      name: a.name,
      playcount: totalPlaycount,
      periodPlaycount,
      totalPlaycount,
      period,
      inferredFamiliarity: inferFamiliarityFromPlaycount(totalPlaycount, 'artist'),
      url: a.url || `https://www.last.fm/music/${encodeURIComponent(a.name)}`,
      imageUrl,
      tags,
      type: 'artist' as const,
      listeners,
      bioSummary,
      genres,
      similarArtists,
      rank,
    };
  });

  return items;
}

/**
 * Fetches user's Top Artists across multiple pages / rank slices
 */
export async function fetchLastFmTopArtistsRange(
  username: string,
  apiKey: string,
  period: LastFmPeriod = 'overall',
  startPage: number = 1,
  endPage: number = 1,
  limitPerPage: number = 100,
  onPageProgress?: (current: number, total: number, pageNum: number) => void
): Promise<LastFmArtistItem[]> {
  const allItems: LastFmArtistItem[] = [];
  const totalPages = Math.max(1, endPage - startPage + 1);

  for (let page = startPage; page <= endPage; page++) {
    const pageIndex = page - startPage + 1;
    if (onPageProgress) onPageProgress(pageIndex, totalPages, page);
    const pageItems = await fetchLastFmTopArtists(username, apiKey, period, limitPerPage, page);
    allItems.push(...pageItems);
    if (pageItems.length < limitPerPage) break; // End of library reached
  }

  return allItems;
}

/**
 * Fetches user's Top Tracks for a specified period & page
 */
export async function fetchLastFmTopTracks(
  username: string,
  apiKey: string,
  period: LastFmPeriod = 'overall',
  limit: number = 50,
  page: number = 1
): Promise<LastFmTrackItem[]> {
  const key = apiKey.trim() || DEFAULT_FALLBACK_API_KEY;
  const url = `${BASE_URL}?method=user.gettoptracks&user=${encodeURIComponent(username.trim())}&period=${period}&limit=${limit}&page=${page}&api_key=${encodeURIComponent(key)}&format=json`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(data.message || `Last.fm Error Code ${data.error}`);
  }

  const rawTracks = data.toptracks?.track || [];
  const list = Array.isArray(rawTracks) ? rawTracks : [rawTracks];

  // Fetch track / album cover art and enrich in parallel batches
  const items = await mapConcurrent(list, 12, async (t: any, idx: number) => {
    const rank = parseInt(t['@attr']?.rank || String((page - 1) * limit + idx + 1), 10);
    const periodPlaycount = parseInt(t.playcount || '0', 10);
    let totalPlaycount = period === 'overall' ? periodPlaycount : periodPlaycount;
    const duration = parseInt(t.duration || '0', 10);
    const artistName = typeof t.artist === 'string' ? t.artist : (t.artist?.name || 'Unknown Artist');
    let imageUrl = cleanImage(t.image);
    let tags: string[] = [];
    let listeners = t.listeners ? parseInt(t.listeners, 10) : undefined;
    let albumName: string | undefined = undefined;
    let durationSec = duration > 0 ? duration : undefined;

    try {
      const enrich = await enrichTrackFromLastFm(t.name, artistName, key, username);
      if (enrich) {
        if (enrich.tags && enrich.tags.length > 0) tags = enrich.tags;
        if (enrich.imageUrl && !imageUrl) imageUrl = enrich.imageUrl;
        if (enrich.listeners) listeners = enrich.listeners;
        if (enrich.albumName) albumName = enrich.albumName;
        if (enrich.durationSeconds && (!durationSec || durationSec === 0)) durationSec = enrich.durationSeconds;
        if (enrich.userPlaycount !== undefined && enrich.userPlaycount > 0) {
          totalPlaycount = Math.max(enrich.userPlaycount, periodPlaycount);
        }
      }
    } catch (e) { /* ignore */ }

    if (!imageUrl) {
      try {
        imageUrl = await fetchTrackCover(artistName, t.name, albumName);
      } catch (e) { /* ignore */ }
    }

    return {
      id: `lfm_track_${t.mbid || (t.name + '_' + artistName).toLowerCase().replace(/[^a-z0-9]/g, '_')}_r${rank}`,
      name: t.name,
      artist: artistName,
      album: albumName,
      playcount: totalPlaycount,
      periodPlaycount,
      totalPlaycount,
      period,
      inferredFamiliarity: inferFamiliarityFromPlaycount(totalPlaycount, 'track'),
      durationSeconds: durationSec,
      url: t.url || `https://www.last.fm/music/${encodeURIComponent(artistName)}/_/${encodeURIComponent(t.name)}`,
      imageUrl,
      tags,
      type: 'track' as const,
      listeners,
      rank,
    };
  });

  return items;
}

/**
 * Fetches user's Top Tracks across multiple pages / rank slices
 */
export async function fetchLastFmTopTracksRange(
  username: string,
  apiKey: string,
  period: LastFmPeriod = 'overall',
  startPage: number = 1,
  endPage: number = 1,
  limitPerPage: number = 100,
  onPageProgress?: (current: number, total: number, pageNum: number) => void
): Promise<LastFmTrackItem[]> {
  const allItems: LastFmTrackItem[] = [];
  const totalPages = Math.max(1, endPage - startPage + 1);

  for (let page = startPage; page <= endPage; page++) {
    const pageIndex = page - startPage + 1;
    if (onPageProgress) onPageProgress(pageIndex, totalPages, page);
    const pageItems = await fetchLastFmTopTracks(username, apiKey, period, limitPerPage, page);
    allItems.push(...pageItems);
    if (pageItems.length < limitPerPage) break; // End of library reached
  }

  return allItems;
}

/**
 * Fetches user's Recent Scrobbles / Listening history (with pagination support)
 */
export async function fetchLastFmRecentTracks(
  username: string,
  apiKey: string,
  limit: number = 50,
  page: number = 1
): Promise<LastFmTrackItem[]> {
  const key = apiKey.trim() || DEFAULT_FALLBACK_API_KEY;
  const url = `${BASE_URL}?method=user.getrecenttracks&user=${encodeURIComponent(username.trim())}&limit=${limit}&page=${page}&extended=1&api_key=${encodeURIComponent(key)}&format=json`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(data.message || `Last.fm Error Code ${data.error}`);
  }

  const rawTracks = data.recenttracks?.track || [];
  const list = Array.isArray(rawTracks) ? rawTracks : [rawTracks];

  const items = await mapConcurrent(list, 12, async (t: any, idx: number) => {
    const rank = (page - 1) * limit + idx + 1;
    const isNowPlaying = Boolean(t['@attr']?.nowplaying === 'true');
    const artistName = typeof t.artist === 'string' ? t.artist : (t.artist?.name || t.artist?.['#text'] || 'Unknown Artist');
    const albumName = typeof t.album === 'string' ? t.album : (t.album?.['#text'] || undefined);
    const dateText = t.date?.['#text'] || (isNowPlaying ? 'Now Playing' : undefined);
    
    let totalPlaycount = t.userplaycount ? parseInt(t.userplaycount, 10) : (t.playcount ? parseInt(t.playcount, 10) : 1);
    let imageUrl = cleanImage(t.image);
    let tags: string[] = [];

    try {
      const enrich = await enrichTrackFromLastFm(t.name, artistName, key, username);
      if (enrich) {
        if (enrich.tags && enrich.tags.length > 0) tags = enrich.tags;
        if (enrich.imageUrl && !imageUrl) imageUrl = enrich.imageUrl;
        if (enrich.userPlaycount !== undefined && enrich.userPlaycount > 0) {
          totalPlaycount = Math.max(enrich.userPlaycount, totalPlaycount);
        }
      }
    } catch (e) { /* ignore */ }

    if (!imageUrl) {
      try {
        imageUrl = await fetchTrackCover(artistName, t.name, albumName);
      } catch (e) { /* ignore */ }
    }

    return {
      id: `lfm_recent_p${page}_${idx}_${Date.now()}`,
      name: t.name,
      artist: artistName,
      album: albumName,
      playcount: totalPlaycount,
      periodPlaycount: 1,
      totalPlaycount,
      period: 'recent',
      inferredFamiliarity: inferFamiliarityFromPlaycount(totalPlaycount, 'track'),
      url: t.url || `https://www.last.fm/music/${encodeURIComponent(artistName)}/_/${encodeURIComponent(t.name)}`,
      imageUrl,
      tags,
      dateText,
      isNowPlaying,
      type: 'track' as const,
      rank,
    };
  });

  return items;
}

/**
 * Fetches user's Recent Scrobbles across multiple pages
 */
export async function fetchLastFmRecentTracksRange(
  username: string,
  apiKey: string,
  startPage: number = 1,
  endPage: number = 1,
  limitPerPage: number = 100,
  onPageProgress?: (current: number, total: number, pageNum: number) => void
): Promise<LastFmTrackItem[]> {
  const allItems: LastFmTrackItem[] = [];
  const totalPages = Math.max(1, endPage - startPage + 1);

  for (let page = startPage; page <= endPage; page++) {
    const pageIndex = page - startPage + 1;
    if (onPageProgress) onPageProgress(pageIndex, totalPages, page);
    const pageItems = await fetchLastFmRecentTracks(username, apiKey, limitPerPage, page);
    allItems.push(...pageItems);
    if (pageItems.length < limitPerPage) break;
  }

  return allItems;
}

/**
 * Fetches user's Top Albums for a specified period & page
 */
export async function fetchLastFmTopAlbums(
  username: string,
  apiKey: string,
  period: LastFmPeriod = 'overall',
  limit: number = 50,
  page: number = 1
): Promise<LastFmAlbumItem[]> {
  const key = apiKey.trim() || DEFAULT_FALLBACK_API_KEY;
  const url = `${BASE_URL}?method=user.gettopalbums&user=${encodeURIComponent(username.trim())}&period=${period}&limit=${limit}&page=${page}&api_key=${encodeURIComponent(key)}&format=json`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    throw new Error(data.message || `Last.fm Error Code ${data.error}`);
  }

  const rawAlbums = data.topalbums?.album || [];
  const list = Array.isArray(rawAlbums) ? rawAlbums : [rawAlbums];

  const items = await mapConcurrent(list, 12, async (a: any, idx: number) => {
    const rank = parseInt(a['@attr']?.rank || String((page - 1) * limit + idx + 1), 10);
    const periodPlaycount = parseInt(a.playcount || '0', 10);
    let totalPlaycount = period === 'overall' ? periodPlaycount : periodPlaycount;
    const artistName = typeof a.artist === 'string' ? a.artist : (a.artist?.name || 'Unknown Artist');
    let imageUrl = cleanImage(a.image);
    let tags: string[] = [];
    let songCount: number | undefined = undefined;
    let releaseDate: string | undefined = undefined;
    let listeners: number | undefined = undefined;
    let bioSummary: string | undefined = undefined;
    let genres: string | undefined = undefined;

    try {
      const enrich = await enrichAlbumFromLastFm(a.name, artistName, key, username);
      if (enrich) {
        if (enrich.tags && enrich.tags.length > 0) tags = enrich.tags;
        if (enrich.genres) genres = enrich.genres;
        if (enrich.imageUrl && !imageUrl) imageUrl = enrich.imageUrl;
        if (enrich.listeners) listeners = enrich.listeners;
        if (enrich.songCount) songCount = enrich.songCount;
        if (enrich.releaseDate) releaseDate = enrich.releaseDate;
        if (enrich.notes) bioSummary = enrich.notes;
        if (enrich.userPlaycount !== undefined && enrich.userPlaycount > 0) {
          totalPlaycount = Math.max(enrich.userPlaycount, periodPlaycount);
        }
      }
    } catch (e) { /* ignore */ }

    if (!imageUrl) {
      try {
        imageUrl = await fetchAlbumCover(artistName, a.name);
      } catch (e) { /* ignore */ }
    }

    return {
      id: `lfm_album_${a.mbid || (a.name + '_' + artistName).toLowerCase().replace(/[^a-z0-9]/g, '_')}_r${rank}`,
      name: a.name,
      artist: artistName,
      playcount: totalPlaycount,
      periodPlaycount,
      totalPlaycount,
      period,
      inferredFamiliarity: inferFamiliarityFromPlaycount(totalPlaycount, 'album'),
      url: a.url || `https://www.last.fm/music/${encodeURIComponent(artistName)}/${encodeURIComponent(a.name)}`,
      imageUrl,
      tags,
      type: 'album' as const,
      songCount,
      releaseDate,
      listeners,
      bioSummary,
      genres,
      rank,
    };
  });

  return items;
}

/**
 * Fetches user's Top Albums across multiple pages / rank slices
 */
export async function fetchLastFmTopAlbumsRange(
  username: string,
  apiKey: string,
  period: LastFmPeriod = 'overall',
  startPage: number = 1,
  endPage: number = 1,
  limitPerPage: number = 100,
  onPageProgress?: (current: number, total: number, pageNum: number) => void
): Promise<LastFmAlbumItem[]> {
  const allItems: LastFmAlbumItem[] = [];
  const totalPages = Math.max(1, endPage - startPage + 1);

  for (let page = startPage; page <= endPage; page++) {
    const pageIndex = page - startPage + 1;
    if (onPageProgress) onPageProgress(pageIndex, totalPages, page);
    const pageItems = await fetchLastFmTopAlbums(username, apiKey, period, limitPerPage, page);
    allItems.push(...pageItems);
    if (pageItems.length < limitPerPage) break;
  }

  return allItems;
}

/**
 * Enriches an artist by fetching bio, top tags, listener count, user playcount, and similar artists from Last.fm
 */
export async function enrichArtistFromLastFm(
  artistName: string,
  apiKey: string,
  username?: string
): Promise<{
  bioSummary?: string;
  tags: string[];
  genres?: string;
  imageUrl?: string;
  listeners?: number;
  userPlaycount?: number;
  inferredFamiliarity?: number;
  url?: string;
  similarArtists?: string[];
} | null> {
  const key = apiKey.trim() || DEFAULT_FALLBACK_API_KEY;
  const userParam = username?.trim() ? `&username=${encodeURIComponent(username.trim())}` : '';
  const url = `${BASE_URL}?method=artist.getinfo&artist=${encodeURIComponent(artistName.trim())}${userParam}&api_key=${encodeURIComponent(key)}&format=json&autocorrect=1`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error || !data.artist) return null;

    const artist = data.artist;
    const rawTags = artist.tags?.tag || [];
    const tagArray = Array.isArray(rawTags) ? rawTags : (rawTags && typeof rawTags === 'object' && rawTags.name ? [rawTags] : []);
    let tags = tagArray
      .map((t: any) => (typeof t === 'string' ? t : (t?.name || '')).toLowerCase().trim().replace(/^#/, ''))
      .filter(Boolean);

    // If artist.getinfo returned few or no tags, also try artist.gettoptags to retrieve rich community tags
    if (tags.length < 2) {
      try {
        const topTagsUrl = `${BASE_URL}?method=artist.gettoptags&artist=${encodeURIComponent(artistName.trim())}&api_key=${encodeURIComponent(key)}&format=json&autocorrect=1`;
        const topTagsRes = await fetch(topTagsUrl);
        const topTagsData = await topTagsRes.json();
        const rawTop = topTagsData.toptags?.tag || [];
        const topArray = Array.isArray(rawTop) ? rawTop : (rawTop && typeof rawTop === 'object' && rawTop.name ? [rawTop] : []);
        const extraTags = topArray
          .map((t: any) => (typeof t === 'string' ? t : (t?.name || '')).toLowerCase().trim().replace(/^#/, ''))
          .filter(Boolean);
        tags = Array.from(new Set([...tags, ...extraTags]));
      } catch (e) { /* ignore */ }
    }

    const rawSimilar = artist.similar?.artist || [];
    const simArray = Array.isArray(rawSimilar) ? rawSimilar : [rawSimilar];
    const similarArtists = simArray.map((s: any) => (typeof s === 'string' ? s : (s?.name || '')).trim()).filter(Boolean);

    const userPlaycount = artist.stats?.userplaycount ? parseInt(artist.stats.userplaycount, 10) : undefined;
    const listeners = artist.stats?.listeners ? parseInt(artist.stats.listeners, 10) : undefined;
    const bioSummary = cleanBio(artist.bio?.summary || artist.bio?.content);

    let imageUrl = cleanImage(artist.image);
    if (!imageUrl) {
      try {
        imageUrl = await fetchArtistPicture(artistName, key);
      } catch (e) { /* ignore */ }
    }

    return {
      bioSummary: bioSummary || undefined,
      tags,
      genres: tags.slice(0, 3).join(', '),
      imageUrl,
      listeners,
      userPlaycount,
      inferredFamiliarity: userPlaycount !== undefined ? inferFamiliarityFromPlaycount(userPlaycount, 'artist') : undefined,
      url: artist.url,
      similarArtists: similarArtists.slice(0, 5)
    };
  } catch (e) {
    console.warn(`Failed to enrich artist "${artistName}" from Last.fm:`, e);
    return null;
  }
}

/**
 * Enriches a track by fetching tags, duration, album, listener count, user playcount, and wiki summary from Last.fm
 */
export async function enrichTrackFromLastFm(
  trackName: string,
  artistName: string,
  apiKey: string,
  username?: string
): Promise<{
  albumName?: string;
  durationSeconds?: number;
  tags: string[];
  genres?: string;
  imageUrl?: string;
  listeners?: number;
  userPlaycount?: number;
  inferredFamiliarity?: number;
  url?: string;
  notes?: string;
} | null> {
  const key = apiKey.trim() || DEFAULT_FALLBACK_API_KEY;
  const userParam = username?.trim() ? `&username=${encodeURIComponent(username.trim())}` : '';
  const url = `${BASE_URL}?method=track.getinfo&track=${encodeURIComponent(trackName.trim())}&artist=${encodeURIComponent(artistName.trim())}${userParam}&api_key=${encodeURIComponent(key)}&format=json&autocorrect=1`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error || !data.track) return null;

    const track = data.track;
    const rawTags = track.toptags?.tag || [];
    const tagArray = Array.isArray(rawTags) ? rawTags : [rawTags];
    const tags = tagArray.map((t: any) => (t.name || '').toLowerCase().trim()).filter(Boolean);

    const duration = track.duration ? Math.floor(parseInt(track.duration, 10) / 1000) : undefined;
    const userPlaycount = track.userplaycount ? parseInt(track.userplaycount, 10) : undefined;
    const listeners = track.listeners ? parseInt(track.listeners, 10) : undefined;
    const wiki = cleanBio(track.wiki?.summary || track.wiki?.content);

    let imageUrl = cleanImage(track.album?.image);
    if (!imageUrl) {
      try {
        imageUrl = await fetchTrackCover(artistName, trackName, track.album?.title);
      } catch (e) { /* ignore */ }
    }

    return {
      albumName: track.album?.title || undefined,
      durationSeconds: duration && duration > 0 ? duration : undefined,
      tags,
      genres: tags.slice(0, 3).join(', '),
      imageUrl,
      listeners,
      userPlaycount,
      inferredFamiliarity: userPlaycount !== undefined ? inferFamiliarityFromPlaycount(userPlaycount, 'track') : undefined,
      url: track.url,
      notes: wiki || undefined
    };
  } catch (e) {
    console.warn(`Failed to enrich track "${trackName}" from Last.fm:`, e);
    return null;
  }
}

/**
 * Enriches an album by fetching tags, release date, track list count, and wiki from Last.fm
 */
export async function enrichAlbumFromLastFm(
  albumName: string,
  artistName: string,
  apiKey: string,
  username?: string
): Promise<{
  tags: string[];
  genres?: string;
  imageUrl?: string;
  listeners?: number;
  userPlaycount?: number;
  inferredFamiliarity?: number;
  url?: string;
  songCount?: number;
  releaseDate?: string;
  notes?: string;
} | null> {
  const key = apiKey.trim() || DEFAULT_FALLBACK_API_KEY;
  const userParam = username?.trim() ? `&username=${encodeURIComponent(username.trim())}` : '';
  const url = `${BASE_URL}?method=album.getinfo&album=${encodeURIComponent(albumName.trim())}&artist=${encodeURIComponent(artistName.trim())}${userParam}&api_key=${encodeURIComponent(key)}&format=json&autocorrect=1`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error || !data.album) return null;

    const album = data.album;
    const rawTags = album.tags?.tag || [];
    const tagArray = Array.isArray(rawTags) ? rawTags : [rawTags];
    const tags = tagArray.map((t: any) => (t.name || '').toLowerCase().trim()).filter(Boolean);

    const userPlaycount = album.userplaycount ? parseInt(album.userplaycount, 10) : (album.playcount ? parseInt(album.playcount, 10) : undefined);
    const listeners = album.listeners ? parseInt(album.listeners, 10) : undefined;
    const wiki = cleanBio(album.wiki?.summary || album.wiki?.content);
    
    let songCount: number | undefined;
    if (album.tracks?.track) {
      const tracks = Array.isArray(album.tracks.track) ? album.tracks.track : [album.tracks.track];
      songCount = tracks.length;
    }

    let imageUrl = cleanImage(album.image);
    if (!imageUrl) {
      try {
        imageUrl = await fetchAlbumCover(artistName, albumName);
      } catch (e) { /* ignore */ }
    }

    return {
      tags,
      genres: tags.slice(0, 3).join(', '),
      imageUrl,
      listeners,
      userPlaycount,
      inferredFamiliarity: userPlaycount !== undefined ? inferFamiliarityFromPlaycount(userPlaycount, 'album') : undefined,
      url: album.url,
      songCount,
      releaseDate: album.releasedate?.trim() || undefined,
      notes: wiki || undefined
    };
  } catch (e) {
    console.warn(`Failed to enrich album "${albumName}" from Last.fm:`, e);
    return null;
  }
}
