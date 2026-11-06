import { Headphones } from 'lucide-react';
import { ListenLogEntry, MusicItem } from '../types';

/** Listens for a single excerpt (segment) or for the whole card. */
export const getListenEntries = (log: ListenLogEntry[] | undefined, segmentId?: string | null): ListenLogEntry[] =>
  (log || []).filter(e => (segmentId ? e.scope === 'segment' && e.segmentId === segmentId : e.scope === 'card'));

/** Entries for an item as displayed: an expanded individual excerpt counts its segment, a card counts full-card listens. */
export const getItemListenEntries = (item: MusicItem): ListenLogEntry[] =>
  getListenEntries(item.listenLog, item.isIndividualExcerpt ? item.originalSegmentId : null);

const formatLastListened = (at: number): string => {
  const diff = Date.now() - at;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(at).toLocaleDateString();
};

export const ListenCountBadge = ({
  entries,
  label,
  compact = false,
}: {
  entries: ListenLogEntry[];
  label?: string;
  compact?: boolean;
}) => {
  const count = entries.length;
  const last = count > 0 ? Math.max(...entries.map(e => e.at)) : null;
  const title = count > 0
    ? `${label ? `${label}: ` : ''}Listened ${count} time${count === 1 ? '' : 's'} (>50% of its length)\nLast listened ${formatLastListened(last!)} — ${new Date(last!).toLocaleString()}`
    : `${label ? `${label}: ` : ''}Not listened yet (a listen counts after >50% of its length)`;

  return (
    <span
      title={title}
      className={
        'inline-flex items-center gap-1 rounded-full border font-mono font-bold shrink-0 ' +
        (compact ? 'px-1.5 py-0 text-[9.5px] ' : 'px-2 py-0.5 text-[10.5px] ') +
        (count > 0
          ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
          : 'bg-zinc-800/40 text-zinc-500 border-zinc-700/60')
      }
    >
      <Headphones className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      {label && <span className="font-sans font-semibold opacity-80">{label}</span>}
      <span>{count}</span>
    </span>
  );
};
