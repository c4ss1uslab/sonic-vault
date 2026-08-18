export interface ClusterColorOption {
  hex: string;
  name: string;
  vibe: string;
}

export const CLUSTER_COLOR_PALETTE: ClusterColorOption[] = [
  { hex: '#10b981', name: 'Emerald Chill', vibe: 'Chill, Lo-Fi & Mellow' },
  { hex: '#14b8a6', name: 'Teal Lagoon', vibe: 'Tropical, Coastal & Breezy' },
  { hex: '#06b6d4', name: 'Cyan Wave', vibe: 'Fresh, Airy & Upbeat' },
  { hex: '#0ea5e9', name: 'Sky Azure', vibe: 'Daylight, Open & Uplifting' },
  { hex: '#2563eb', name: 'Electric Blue', vibe: 'City Pop, Modern & Synth' },
  { hex: '#6366f1', name: 'Indigo Twilight', vibe: 'Late Night, Moody & Space' },
  { hex: '#7c3aed', name: 'Violet Nebula', vibe: 'Ambient, Drone & Soundscape' },
  { hex: '#9333ea', name: 'Purple Psyche', vibe: 'Eclectic, Dreamy & Fusion' },
  { hex: '#c084fc', name: 'Lavender Mist', vibe: 'Downtempo & Meditative' },
  { hex: '#d946ef', name: 'Fuchsia Groove', vibe: 'Dance, Funk & Nu-Disco' },
  { hex: '#ec4899', name: 'Tokyo Pink', vibe: 'City Pop & 80s Disco' },
  { hex: '#f43f5e', name: 'Velvet Rose', vibe: 'Soul, R&B & Romantic' },
  { hex: '#dc2626', name: 'Crimson Flame', vibe: 'Energetic, Rock & High-Tempo' },
  { hex: '#f97316', name: 'Sunset Coral', vibe: 'Golden Hour, Bossa & Warmth' },
  { hex: '#ea580c', name: 'Vintage Copper', vibe: '70s Classics & Hard Bop' },
  { hex: '#f59e0b', name: 'Amber Gold', vibe: 'Jazz, Bebop & Vinyl' },
  { hex: '#eab308', name: 'Solar Yellow', vibe: 'Bright, Happy & Sun-Drenched' },
  { hex: '#84cc16', name: 'Lime Pulse', vibe: 'Afrobeat, Latin & Carnival' },
  { hex: '#22c55e', name: 'Sage Green', vibe: 'Brazilian Trad, MPB & Organic' },
  { hex: '#059669', name: 'Deep Forest', vibe: 'Folk, Roots & Acoustic' },
  { hex: '#7e22ce', name: 'Dark Plum', vibe: 'Gothic, Darkwave & Noir' },
  { hex: '#b45309', name: 'Warm Bronze', vibe: 'Soul, Blues & Roots' },
  { hex: '#64748b', name: 'Slate Gray', vibe: 'Minimalist & Cold Wave' },
  { hex: '#475569', name: 'Charcoal Steel', vibe: 'Industrial & Experimental' },
];

/**
 * Deterministic color mapping for default clusters based on category and title keywords
 */
export const DEFAULT_CLUSTER_COLOR_MAP: Record<string, string> = {
  'Chill, Lo-Fi & Downtempo (Mellow Vibes)': '#10b981', // Emerald
  'Upbeat, High-Energy & Groove (Energetic Vibes)': '#f97316', // Coral Orange
  'Ambient, Drone & Soundscapes': '#7c3aed', // Violet
  'Meditative, Ritual & Yoga': '#06b6d4', // Cyan
  'Dark, Atmospheric & Gothic': '#7e22ce', // Dark Plum
  'Brazilian Trad & Mod': '#22c55e', // Sage Green
  'Japanese & City Pop': '#ec4899', // Tokyo Pink
  'Decade Classics: 70s / Vintage': '#ea580c', // Vintage Copper
  'Decade Classics: 80s / Retro': '#d946ef', // Fuchsia
  'Decade Classics: 90s / Alternative': '#6366f1', // Indigo
  'Organic Vocal, Chant & Choir': '#14b8a6', // Teal
  'Jazz, Bebop & Swing': '#f59e0b', // Amber
  'Jazz Fusion & Krautrock': '#9333ea', // Purple
  'Soul, Funk & R&B': '#f43f5e', // Velvet Rose
  'Electronic, House & Techno': '#2563eb', // Electric Blue
  'African Rhythms & Afrobeat': '#84cc16', // Lime Pulse
  'Latin, Salsa & Tropical': '#f97316', // Coral
  'Reggae, Dub & Ska': '#22c55e', // Green
  'Folk, Bluegrass & Americana': '#059669', // Forest
  'Classic & Hard Rock': '#dc2626', // Crimson Red
  'Punk, Post-Punk & Emo': '#dc2626', // Red
  'Alternative, Shoegaze & Indie': '#6366f1', // Indigo
  'Hip Hop, Rap & Boom Bap': '#eab308', // Yellow/Gold
  'Classical & Chamber': '#0ea5e9', // Sky Blue
  'Global & World Traditions': '#14b8a6', // Teal
  'Soundtracks & Cinematic': '#7c3aed', // Violet
  'Avant-Garde & Experimental': '#475569', // Steel
  'Lyrical, Poetry & Spoken Word': '#b45309', // Bronze
  'Instrumental, Beats & Loops': '#06b6d4', // Cyan
  'Sound FX, Nature & ASMR': '#10b981', // Emerald
  'Synthwave, Retro & Cyberpunk': '#d946ef', // Neon Fuchsia
  'Heavy Metal, Thrash & Hardcore': '#e11d48', // Ruby
  'Live, Session & Concert Bootlegs': '#f59e0b', // Amber
  'Indie Pop, Bedroom & Dream Pop': '#c084fc', // Lavender
  'Other Curation Tags': '#64748b', // Slate Gray
};

/**
 * Returns a valid hex color for a given cluster.
 * 1. Returns cluster.color if defined
 * 2. Matches known default cluster names
 * 3. Falls back to deterministic hash among the 24 palette colors
 */
export function getClusterColor(cluster: { name: string; color?: string; category?: string } | string): string {
  if (typeof cluster === 'object' && cluster.color && cluster.color.trim() !== '') {
    return cluster.color;
  }
  
  const name = typeof cluster === 'string' ? cluster : cluster.name;
  if (!name) return CLUSTER_COLOR_PALETTE[0].hex;

  // Direct map check
  if (DEFAULT_CLUSTER_COLOR_MAP[name]) {
    return DEFAULT_CLUSTER_COLOR_MAP[name];
  }

  // Keyword check
  const lower = name.toLowerCase();
  if (lower.includes('chill') || lower.includes('lo-fi') || lower.includes('lofi') || lower.includes('mellow')) return '#10b981';
  if (lower.includes('upbeat') || lower.includes('groove') || lower.includes('energy')) return '#f97316';
  if (lower.includes('ambient') || lower.includes('drone') || lower.includes('space')) return '#7c3aed';
  if (lower.includes('brazil') || lower.includes('samba') || lower.includes('bossa')) return '#22c55e';
  if (lower.includes('japan') || lower.includes('city pop') || lower.includes('citypop')) return '#ec4899';
  if (lower.includes('jazz') || lower.includes('bebop')) return '#f59e0b';
  if (lower.includes('rock') || lower.includes('metal')) return '#dc2626';
  if (lower.includes('electronic') || lower.includes('house') || lower.includes('synth')) return '#2563eb';
  if (lower.includes('soul') || lower.includes('funk') || lower.includes('r&b')) return '#f43f5e';
  if (lower.includes('folk') || lower.includes('acoustic')) return '#059669';
  if (lower.includes('disco') || lower.includes('dance')) return '#d946ef';
  if (lower.includes('dark') || lower.includes('goth')) return '#7e22ce';

  // Deterministic hash fallback
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % CLUSTER_COLOR_PALETTE.length;
  return CLUSTER_COLOR_PALETTE[index].hex;
}
