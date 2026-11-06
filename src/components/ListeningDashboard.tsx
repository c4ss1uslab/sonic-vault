import { useCallback, useEffect, useMemo, useState } from 'react';
import { Headphones, Radio, RefreshCw, Play, Flame, Calendar, Clock, Music, ExternalLink, Library, AlertTriangle } from 'lucide-react';
import { MusicItem, LastFmSettings, ListenLogEntry } from '../types';
import {
  LastFmPeriod,
  LastFmChartEntry,
  LastFmScrobble,
  fetchLastFmChartLite,
  fetchLastFmScrobblesSince,
  testLastFmConnection,
  getTimeframeFullLabel,
} from '../lib/lastfm';
import { cn } from '../lib/utils';

const DAY_MS = 86_400_000;
const ACTIVITY_DAYS = 30;
const PERIODS: { id: LastFmPeriod; label: string }[] = [
  { id: '7day', label: '7d' },
  { id: '1month', label: '1m' },
  { id: '3month', label: '3m' },
  { id: '12month', label: '12m' },
  { id: 'overall', label: 'All' },
];

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmt = (n: number) => n.toLocaleString();
const relTime = (at: number) => {
  const min = Math.floor((Date.now() - at) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(at).toLocaleDateString();
};
const norm = (s?: string) => (s || '').toLowerCase().trim();

/** Bucket timestamps (ms) into the last N calendar days, oldest first. */
const dailyBuckets = (times: number[], days: number, now: number) => {
  const today = startOfDay(now);
  const out = Array.from({ length: days }, (_, i) => {
    const day = today - (days - 1 - i) * DAY_MS;
    return { day, count: 0 };
  });
  for (const t of times) {
    const idx = days - 1 - Math.round((today - startOfDay(t)) / DAY_MS);
    if (idx >= 0 && idx < days) out[idx].count++;
  }
  return out;
};

const hourBuckets = (times: number[]) => {
  const out = Array.from({ length: 24 }, () => 0);
  for (const t of times) out[new Date(t).getHours()]++;
  return out;
};

const dayStreak = (times: number[], now: number) => {
  const days = new Set(times.map(startOfDay));
  let d = startOfDay(now);
  if (!days.has(d)) d -= DAY_MS; // today not listened yet doesn't break the streak
  let streak = 0;
  while (days.has(d)) { streak++; d -= DAY_MS; }
  return streak;
};

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

const Section = ({ title, icon: Icon, right, children }: { title: string; icon: any; right?: React.ReactNode; children: React.ReactNode }) => (
  <section className="space-y-4">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h3 className="text-lg font-bold flex items-center gap-2"><Icon className="h-5 w-5 text-brand-accent" />{title}</h3>
      {right}
    </div>
    {children}
  </section>
);

const Card = ({ title, sub, children, className }: { title?: string; sub?: string; children: React.ReactNode; className?: string }) => (
  <div className={cn('bg-brand-card border border-brand-border rounded-2xl p-4 min-w-0', className)}>
    {title && (
      <div className="mb-3">
        <div className="text-sm font-semibold">{title}</div>
        {sub && <div className="text-[11px] text-brand-muted mt-0.5">{sub}</div>}
      </div>
    )}
    {children}
  </div>
);

const Stat = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div className="bg-brand-card border border-brand-border rounded-2xl px-4 py-3 min-w-0">
    <div className="text-[11px] uppercase tracking-wider text-brand-muted font-semibold truncate">{label}</div>
    <div className="text-2xl font-bold mt-1 tabular-nums truncate">{value}</div>
    {hint && <div className="text-[11px] text-brand-muted mt-0.5 truncate">{hint}</div>}
  </div>
);

/** Single-series column chart with a per-bar hover tooltip. */
const Columns = ({ data, height = 96, axis }: { data: { value: number; label: string }[]; height?: number; axis?: [string, string, string?] }) => {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map(d => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div>
      <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
        <div className="absolute inset-x-0 bottom-0 border-b border-brand-border" />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {data.map((d, i) => (
            <div
              key={i}
              className="flex-1 h-full flex items-end cursor-default"
              onMouseEnter={() => setHover(i)}
              title={`${d.label}: ${fmt(d.value)}`}
            >
              <div
                className={cn('w-full rounded-t-[4px] transition-opacity', d.value > 0 ? 'bg-brand-accent' : '', hover !== null && hover !== i ? 'opacity-50' : 'opacity-100')}
                style={{ height: d.value > 0 ? `${Math.max(3, (d.value / max) * 100)}%` : 0 }}
              />
            </div>
          ))}
        </div>
        {hover !== null && (
          <div
            className="absolute -top-2 -translate-y-full -translate-x-1/2 pointer-events-none bg-zinc-900 border border-brand-border rounded-lg px-2 py-1 text-[11px] whitespace-nowrap shadow-xl z-10"
            style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
          >
            <span className="text-brand-muted">{data[hover].label}</span> · <span className="font-semibold tabular-nums">{fmt(data[hover].value)}</span>
          </div>
        )}
      </div>
      {axis && (
        <div className="flex justify-between text-[10px] text-brand-muted mt-1.5 font-mono">
          <span>{axis[0]}</span>{axis[2] && <span>{axis[2]}</span>}<span>{axis[1]}</span>
        </div>
      )}
      {total === 0 && <div className="text-[11px] text-brand-muted mt-2">No activity in this window yet.</div>}
    </div>
  );
};

interface RankRow { key: string; name: string; sub?: string; value: number; href?: string; badge?: string; onPlay?: () => void }

/** Ranked horizontal bars: name + bar scaled to the top value + value in text ink. */
const Ranked = ({ rows, unit, empty }: { rows: RankRow[]; unit: string; empty: string }) => {
  const max = Math.max(1, ...rows.map(r => r.value));
  if (rows.length === 0) return <div className="text-[12px] text-brand-muted py-2">{empty}</div>;
  return (
    <ol className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.key} className="group" title={`${r.name}${r.sub ? ` — ${r.sub}` : ''}: ${fmt(r.value)} ${unit}`}>
          <div className="flex items-baseline gap-2 text-[12.5px] min-w-0">
            <span className="text-brand-muted font-mono text-[10.5px] w-4 shrink-0 text-right">{i + 1}</span>
            {r.onPlay && (
              <button type="button" onClick={r.onPlay} className="self-center p-0.5 rounded text-brand-muted hover:text-brand-accent cursor-pointer" title="Play">
                <Play className="h-3 w-3 fill-current" />
              </button>
            )}
            <span className="truncate min-w-0">
              {r.href ? <a href={r.href} target="_blank" rel="noreferrer" className="hover:underline font-medium">{r.name}</a> : <span className="font-medium">{r.name}</span>}
              {r.sub && <span className="text-brand-muted"> · {r.sub}</span>}
            </span>
            {r.badge && <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-wider text-brand-muted border border-brand-border rounded px-1">{r.badge}</span>}
            <span className="ml-auto shrink-0 tabular-nums font-semibold">{fmt(r.value)}</span>
          </div>
          <div className="ml-6 mt-1 h-1.5 rounded-full bg-brand-border/40 overflow-hidden">
            <div className="h-full rounded-full bg-brand-accent" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

interface Props {
  items: MusicItem[];
  lastFmSettings?: LastFmSettings;
  onConnectLastFm: () => void;
  onPlayExcerpt: (item: MusicItem, segmentId?: string) => void;
}

interface LfmState {
  user?: { playcount: number; artistCount: number; trackCount: number; albumCount: number; registered?: string; url?: string };
  artists: LastFmChartEntry[];
  tracks: LastFmChartEntry[];
  albums: LastFmChartEntry[];
  scrobbles: LastFmScrobble[];
  scrobbleTotal: number;
  truncated: boolean;
  fetchedAt?: number;
  error?: string;
}

export const ListeningDashboard = ({ items, lastFmSettings, onConnectLastFm, onPlayExcerpt }: Props) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ---- Excerpt listening (live from listenLog) ----
  const excerpt = useMemo(() => {
    type Ev = ListenLogEntry & { item: MusicItem };
    const segEvents: Ev[] = [];
    const cardEvents: Ev[] = [];
    let totalSegments = 0;
    for (const it of items) {
      if (it.type !== 'excerpt') continue;
      totalSegments += Math.max(1, it.segments?.length || 0);
      for (const e of it.listenLog || []) (e.scope === 'segment' ? segEvents : cardEvents).push({ ...e, item: it });
    }
    const segTimes = segEvents.map(e => e.at);

    const bySeg = new Map<string, { item: MusicItem; segmentId?: string; count: number; last: number }>();
    for (const e of segEvents) {
      const k = `${e.item.id}::${e.segmentId || ''}`;
      const cur = bySeg.get(k) || { item: e.item, segmentId: e.segmentId, count: 0, last: 0 };
      cur.count++; cur.last = Math.max(cur.last, e.at);
      bySeg.set(k, cur);
    }
    const segName = (it: MusicItem, id?: string) => (id && it.segments?.find(s => s.id === id)?.name) || it.name;
    const segOf = (it: MusicItem, id?: string) => (id ? it.segments?.find(s => s.id === id) : undefined);

    const top: RankRow[] = [...bySeg.entries()]
      .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)
      .slice(0, 8)
      .map(([k, v]) => ({
        key: k,
        name: segName(v.item, v.segmentId),
        sub: v.segmentId ? v.item.name : (v.item.linkedArtistName || undefined),
        value: v.count,
        onPlay: () => onPlayExcerpt(v.item, v.segmentId),
      }));

    const tagCounts = new Map<string, number>();
    for (const e of segEvents) {
      const tags = new Set([...(segOf(e.item, e.segmentId)?.tags || []), ...(e.item.tags || [])].map(t => t.replace(/^#/, '').trim()).filter(Boolean));
      for (const t of tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
    const topTags: RankRow[] = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, c]) => ({ key: t, name: `#${t}`, value: c }));

    const recent = [...segEvents].sort((a, b) => b.at - a.at).slice(0, 8).map(e => ({
      key: `${e.item.id}-${e.at}-${e.segmentId}`,
      name: segName(e.item, e.segmentId),
      card: e.item.name,
      at: e.at,
      play: () => onPlayExcerpt(e.item, e.segmentId),
    }));

    const today = startOfDay(now);
    return {
      segCount: segEvents.length,
      cardCount: cardEvents.length,
      today: segTimes.filter(t => t >= today).length,
      week: segTimes.filter(t => t >= now - 7 * DAY_MS).length,
      heard: bySeg.size,
      totalSegments,
      streak: dayStreak(segTimes, now),
      daily: dailyBuckets(segTimes, ACTIVITY_DAYS, now),
      hours: hourBuckets(segTimes),
      top,
      topTags,
      recent,
    };
  }, [items, now, onPlayExcerpt]);

  // ---- Library's synced Last.fm fields ----
  const library = useMemo(() => {
    const kinds = ['artist', 'album', 'track'] as const;
    const coverage = kinds.map(k => {
      const all = items.filter(i => i.type === k);
      return { kind: k, total: all.length, synced: all.filter(i => (i.lastFmPlaycount ?? 0) > 0).length };
    });
    const topByKind = Object.fromEntries(kinds.map(k => [k,
      items.filter(i => i.type === k && (i.lastFmPlaycount ?? 0) > 0)
        .sort((a, b) => (b.lastFmPlaycount ?? 0) - (a.lastFmPlaycount ?? 0))
        .slice(0, 6)
        .map<RankRow>(i => ({ key: i.id, name: i.name, sub: i.parentName || i.creator || undefined, value: i.lastFmPlaycount ?? 0, href: i.lastFmUrl || undefined })),
    ])) as Record<typeof kinds[number], RankRow[]>;
    const famBins = [0, 0, 0, 0, 0];
    for (const i of items) {
      if (i.familiarity === undefined || i.familiarity === null || i.type === 'excerpt') continue;
      famBins[Math.min(4, Math.floor(i.familiarity / 20))]++;
    }
    const lastSync = lastFmSettings?.lastSync;
    return { coverage, topByKind, famBins, lastSync };
  }, [items, lastFmSettings?.lastSync]);

  const vaultNames = useMemo(() => {
    const s = { artist: new Set<string>(), track: new Set<string>(), album: new Set<string>() };
    for (const i of items) if (i.type in s) (s as any)[i.type].add(norm(i.name));
    return s;
  }, [items]);

  // ---- Live Last.fm ----
  const username = lastFmSettings?.username?.trim();
  const apiKey = lastFmSettings?.apiKey || '';
  const [period, setPeriod] = useState<LastFmPeriod>(() => {
    const p = lastFmSettings?.defaultPeriod as LastFmPeriod | undefined;
    return p && PERIODS.some(x => x.id === p) ? p : '1month';
  });
  const [lfm, setLfm] = useState<LfmState>({ artists: [], tracks: [], albums: [], scrobbles: [], scrobbleTotal: 0, truncated: false });
  const [loading, setLoading] = useState(false);

  const loadCharts = useCallback(async () => {
    if (!username) return;
    const [artists, tracks, albums] = await Promise.all([
      fetchLastFmChartLite(username, apiKey, 'artists', period, 10),
      fetchLastFmChartLite(username, apiKey, 'tracks', period, 10),
      fetchLastFmChartLite(username, apiKey, 'albums', period, 10),
    ]);
    setLfm(s => ({ ...s, artists, tracks, albums }));
  }, [username, apiKey, period]);

  const loadActivity = useCallback(async () => {
    if (!username) return;
    const from = Math.floor((startOfDay(Date.now()) - (ACTIVITY_DAYS - 1) * DAY_MS) / 1000);
    const [info, recent] = await Promise.all([
      testLastFmConnection(username, apiKey),
      fetchLastFmScrobblesSince(username, apiKey, from, 10),
    ]);
    if (!info.success) throw new Error(info.error || 'Could not load Last.fm profile');
    setLfm(s => ({ ...s, user: info.user, scrobbles: recent.scrobbles, scrobbleTotal: recent.total, truncated: recent.truncated, fetchedAt: Date.now(), error: undefined }));
  }, [username, apiKey]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try { await Promise.all([loadActivity(), loadCharts()]); }
    catch (e: any) { setLfm(s => ({ ...s, error: e?.message || String(e) })); }
    finally { setLoading(false); }
  }, [loadActivity, loadCharts]);

  useEffect(() => { refreshAll(); }, [username, apiKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadCharts().catch(e => setLfm(s => ({ ...s, error: e?.message || String(e) }))); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep "now playing" and recent scrobbles fresh while the dashboard is open.
  useEffect(() => {
    if (!username) return;
    const id = setInterval(() => { if (!document.hidden) loadActivity().catch(() => {}); }, 60_000);
    return () => clearInterval(id);
  }, [username, loadActivity]);

  const scrobbleTimes = useMemo(() => lfm.scrobbles.filter(s => s.uts > 0).map(s => s.uts * 1000), [lfm.scrobbles]);
  const lfmDaily = useMemo(() => dailyBuckets(scrobbleTimes, ACTIVITY_DAYS, now), [scrobbleTimes, now]);
  const lfmHours = useMemo(() => hourBuckets(scrobbleTimes), [scrobbleTimes]);
  const nowPlaying = lfm.scrobbles.find(s => s.nowPlaying);
  const registeredDays = lfm.user?.registered ? Math.max(1, Math.round((now - Date.parse(lfm.user.registered)) / DAY_MS)) : 0;

  const dayLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const hourData = (h: number[]) => h.map((v, i) => ({ value: v, label: `${String(i).padStart(2, '0')}:00–${String(i).padStart(2, '0')}:59` }));
  const toRows = (entries: LastFmChartEntry[], kind: 'artist' | 'track' | 'album'): RankRow[] =>
    entries.map((e, i) => ({
      key: `${kind}-${i}-${e.name}`,
      name: e.name,
      sub: e.artist,
      value: e.playcount,
      href: e.url,
      badge: vaultNames[kind].has(norm(e.name)) ? 'in vault' : undefined,
    }));

  return (
    <div className="space-y-10 pb-10">
      <header>
        <h2 className="text-3xl font-bold">Dashboard</h2>
        <p className="text-brand-muted mt-1 text-sm">Excerpt listens update live as you play. Last.fm activity refreshes every minute.</p>
      </header>

      {/* ---------------- Excerpts ---------------- */}
      <Section title="Excerpt listening" icon={Headphones} right={<span className="text-[11px] text-brand-muted">A listen counts after &gt;50% of an excerpt plays</span>}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Excerpt listens" value={fmt(excerpt.segCount)} />
          <Stat label="Full-card listens" value={fmt(excerpt.cardCount)} />
          <Stat label="Today" value={fmt(excerpt.today)} />
          <Stat label="Last 7 days" value={fmt(excerpt.week)} />
          <Stat label="Excerpts heard" value={`${fmt(excerpt.heard)}`} hint={`of ${fmt(excerpt.totalSegments)} in vault`} />
          <Stat label="Streak" value={<span className="inline-flex items-center gap-1.5">{excerpt.streak}<Flame className="h-5 w-5 text-brand-muted" /></span>} hint={excerpt.streak === 1 ? 'day' : 'days'} />
        </div>
        <div className="grid lg:grid-cols-3 gap-3">
          <Card title="Daily excerpt listens" sub={`Last ${ACTIVITY_DAYS} days`} className="lg:col-span-2">
            <Columns data={excerpt.daily.map(d => ({ value: d.count, label: dayLabel(d.day) }))} axis={[dayLabel(excerpt.daily[0].day), 'Today']} />
          </Card>
          <Card title="Time of day" sub="All excerpt listens, by hour">
            <Columns data={hourData(excerpt.hours)} axis={['00h', '23h', '12h']} />
          </Card>
        </div>
        <div className="grid lg:grid-cols-3 gap-3">
          <Card title="Most played excerpts">
            <Ranked rows={excerpt.top} unit="listens" empty="Play an excerpt past its halfway point to start tracking." />
          </Card>
          <Card title="Top tags by listens" sub="Excerpt + card tags">
            <Ranked rows={excerpt.topTags} unit="listens" empty="No tagged excerpt listens yet." />
          </Card>
          <Card title="Recently heard">
            {excerpt.recent.length === 0 ? (
              <div className="text-[12px] text-brand-muted py-2">Nothing yet.</div>
            ) : (
              <ul className="space-y-2">
                {excerpt.recent.map(r => (
                  <li key={r.key} className="flex items-center gap-2 text-[12.5px] min-w-0">
                    <button type="button" onClick={r.play} className="p-1 rounded text-brand-muted hover:text-brand-accent cursor-pointer shrink-0" title="Play"><Play className="h-3 w-3 fill-current" /></button>
                    <span className="truncate min-w-0"><span className="font-medium">{r.name}</span>{r.name !== r.card && <span className="text-brand-muted"> · {r.card}</span>}</span>
                    <span className="ml-auto text-[11px] text-brand-muted shrink-0">{relTime(r.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Section>

      {/* ---------------- Last.fm live ---------------- */}
      <Section
        title="Last.fm"
        icon={Radio}
        right={username && (
          <div className="flex items-center gap-2 flex-wrap">
            <a href={`https://www.last.fm/user/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer" className="text-[12px] text-brand-muted hover:text-brand-text inline-flex items-center gap-1">@{username}<ExternalLink className="h-3 w-3" /></a>
            {lfm.fetchedAt && <span className="text-[11px] text-brand-muted">updated {relTime(lfm.fetchedAt)}</span>}
            <button type="button" onClick={refreshAll} disabled={loading} className="p-1.5 rounded-lg border border-brand-border text-brand-muted hover:text-brand-text hover:border-brand-accent disabled:opacity-50 cursor-pointer" title="Refresh from Last.fm">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>
        )}
      >
        {!username ? (
          <Card>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="text-sm text-brand-muted">Connect your Last.fm account to see scrobbles, top charts and listening activity here.</div>
              <button type="button" onClick={onConnectLastFm} className="px-4 py-2 rounded-xl bg-brand-accent text-white text-sm font-semibold cursor-pointer hover:brightness-110">Connect Last.fm</button>
            </div>
          </Card>
        ) : (
          <>
            {lfm.error && (
              <div className="flex items-center gap-2 text-[12.5px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />Last.fm: {lfm.error}
              </div>
            )}
            {nowPlaying && (
              <div className="flex items-center gap-3 bg-brand-card border border-brand-accent/40 rounded-2xl p-3">
                {nowPlaying.imageUrl ? <img src={nowPlaying.imageUrl} alt="" className="h-11 w-11 rounded-lg object-cover" /> : <div className="h-11 w-11 rounded-lg bg-brand-border/40 flex items-center justify-center"><Music className="h-5 w-5 text-brand-muted" /></div>}
                <div className="min-w-0">
                  <div className="text-[10.5px] uppercase tracking-wider font-bold text-brand-accent">Now scrobbling</div>
                  <div className="text-sm font-semibold truncate">{nowPlaying.name} <span className="text-brand-muted font-normal">· {nowPlaying.artist}</span></div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Stat label="Total scrobbles" value={lfm.user ? fmt(lfm.user.playcount) : '—'} hint={registeredDays ? `${fmt(Math.round(lfm.user!.playcount / registeredDays))}/day lifetime` : undefined} />
              <Stat label="Artists" value={lfm.user ? fmt(lfm.user.artistCount) : '—'} />
              <Stat label="Tracks" value={lfm.user ? fmt(lfm.user.trackCount) : '—'} />
              <Stat label="Albums" value={lfm.user ? fmt(lfm.user.albumCount) : '—'} />
              <Stat label={`Last ${ACTIVITY_DAYS} days`} value={lfm.fetchedAt ? fmt(lfm.scrobbleTotal) : '—'} hint={lfm.fetchedAt ? `${(lfm.scrobbleTotal / ACTIVITY_DAYS).toFixed(1)}/day` : undefined} />
              <Stat label="Today" value={lfm.fetchedAt ? fmt(lfmDaily[lfmDaily.length - 1].count) : '—'} />
            </div>
            <div className="grid lg:grid-cols-3 gap-3">
              <Card title="Daily scrobbles" sub={`Last ${ACTIVITY_DAYS} days${lfm.truncated ? ' · oldest days partially loaded (2,000 scrobble cap)' : ''}`} className="lg:col-span-2">
                <Columns data={lfmDaily.map(d => ({ value: d.count, label: dayLabel(d.day) }))} axis={[dayLabel(lfmDaily[0].day), 'Today']} />
              </Card>
              <Card title="Time of day" sub={`Scrobbles, last ${ACTIVITY_DAYS} days`}>
                <Columns data={hourData(lfmHours)} axis={['00h', '23h', '12h']} />
              </Card>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] text-brand-muted inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />Top charts:</span>
              <div className="flex bg-brand-card border border-brand-border rounded-lg p-0.5 text-[11px] font-bold">
                {PERIODS.map(p => (
                  <button key={p.id} type="button" onClick={() => setPeriod(p.id)} className={cn('px-2.5 py-1 rounded-md cursor-pointer', period === p.id ? 'bg-brand-accent text-white' : 'text-brand-muted hover:text-brand-text')}>{p.label}</button>
                ))}
              </div>
              <span className="text-[11px] text-brand-muted">{getTimeframeFullLabel(period)}</span>
            </div>
            <div className="grid lg:grid-cols-3 gap-3">
              <Card title="Top artists"><Ranked rows={toRows(lfm.artists, 'artist')} unit="scrobbles" empty={loading ? 'Loading…' : 'No scrobbles in this period.'} /></Card>
              <Card title="Top tracks"><Ranked rows={toRows(lfm.tracks, 'track')} unit="scrobbles" empty={loading ? 'Loading…' : 'No scrobbles in this period.'} /></Card>
              <Card title="Top albums"><Ranked rows={toRows(lfm.albums, 'album')} unit="scrobbles" empty={loading ? 'Loading…' : 'No scrobbles in this period.'} /></Card>
            </div>
            <Card title="Recent scrobbles">
              {lfm.scrobbles.length === 0 ? (
                <div className="text-[12px] text-brand-muted py-2">{loading ? 'Loading…' : 'No recent scrobbles.'}</div>
              ) : (
                <ul className="grid md:grid-cols-2 gap-x-6 gap-y-2">
                  {lfm.scrobbles.filter(s => !s.nowPlaying).slice(0, 12).map((s, i) => (
                    <li key={`${s.uts}-${i}`} className="flex items-center gap-2 text-[12.5px] min-w-0">
                      <Clock className="h-3 w-3 text-brand-muted shrink-0" />
                      <a href={s.url} target="_blank" rel="noreferrer" className="truncate min-w-0 hover:underline"><span className="font-medium">{s.name}</span><span className="text-brand-muted"> · {s.artist}</span></a>
                      <span className="ml-auto text-[11px] text-brand-muted shrink-0">{relTime(s.uts * 1000)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </Section>

      {/* ---------------- Library sync ---------------- */}
      <Section title="Synced to your vault" icon={Library} right={library.lastSync && <span className="text-[11px] text-brand-muted">Last sync {relTime(Date.parse(library.lastSync))}</span>}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {library.coverage.map(c => (
            <Stat
              key={c.kind}
              label={`${c.kind}s with Last.fm plays`}
              value={`${fmt(c.synced)} / ${fmt(c.total)}`}
              hint={c.total ? `${Math.round((c.synced / c.total) * 100)}% synced` : 'none in vault'}
            />
          ))}
        </div>
        <div className="grid lg:grid-cols-3 gap-3">
          <Card title="Most-played artists in vault" sub="Lifetime scrobbles"><Ranked rows={library.topByKind.artist} unit="scrobbles" empty="Sync artists from Last.fm to fill this." /></Card>
          <Card title="Most-played tracks in vault" sub="Lifetime scrobbles"><Ranked rows={library.topByKind.track} unit="scrobbles" empty="Sync tracks from Last.fm to fill this." /></Card>
          <Card title="Most-played albums in vault" sub="Lifetime scrobbles"><Ranked rows={library.topByKind.album} unit="scrobbles" empty="Sync albums from Last.fm to fill this." /></Card>
        </div>
        <Card title="Familiarity across your vault" sub="Artists, albums, playlists and tracks by familiarity score">
          <Columns
            height={80}
            data={library.famBins.map((v, i) => ({ value: v, label: `${i * 20}–${i === 4 ? 100 : i * 20 + 19}% familiar` }))}
            axis={['0%', '100%']}
          />
        </Card>
      </Section>

    </div>
  );
};
