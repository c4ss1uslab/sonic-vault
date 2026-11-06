import React, { useMemo, useRef, useState } from 'react';
import { Check, Library, User, UserPlus, X } from 'lucide-react';
import { MusicItem } from '../types';
import { cn } from '../lib/utils';

export interface ArtistSelection {
  id?: string; // library artist card id (absent for artists not in the library)
  name: string;
}

interface ArtistPickerProps {
  artists: MusicItem[]; // library artist cards
  knownNames?: string[]; // extra artist names already used elsewhere (e.g. on other excerpts) but without a card
  valueId?: string;
  valueName?: string;
  onChange: (selection: ArtistSelection) => void;
  placeholder?: string;
  variant?: 'zinc' | 'brand';
  className?: string;
}

type Option =
  | { kind: 'library'; id: string; name: string; subtitle?: string }
  | { kind: 'known'; name: string }
  | { kind: 'new'; name: string };

/**
 * Searchable artist field: suggests library artist cards (and previously used names),
 * and lets you keep any free-typed name for an artist that isn't in the library yet.
 */
export const ArtistPicker: React.FC<ArtistPickerProps> = ({
  artists,
  knownNames = [],
  valueId,
  valueName = '',
  onChange,
  placeholder = 'Search library or type a new artist...',
  variant = 'zinc',
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = valueName.trim().toLowerCase();

  const options = useMemo<Option[]>(() => {
    const libraryNames = new Set(artists.map((a) => a.name.toLowerCase()));
    const lib: Option[] = artists
      .filter((a) => !query || a.name.toLowerCase().includes(query))
      .sort((a, b) => {
        // Prefix matches first, then alphabetical
        const ap = a.name.toLowerCase().startsWith(query) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(query) ? 0 : 1;
        return ap - bp || a.name.localeCompare(b.name);
      })
      .slice(0, 8)
      .map((a) => ({ kind: 'library', id: a.id, name: a.name, subtitle: a.genres || a.subtitle }));

    const seen = new Set<string>();
    const known: Option[] = knownNames
      .map((n) => n.trim())
      .filter((n) => {
        const k = n.toLowerCase();
        if (!n || libraryNames.has(k) || seen.has(k)) return false;
        seen.add(k);
        return !query || k.includes(query);
      })
      .slice(0, 4)
      .map((name) => ({ kind: 'known', name }));

    const exactExists =
      libraryNames.has(query) || knownNames.some((n) => n.trim().toLowerCase() === query);
    const extra: Option[] = query && !exactExists ? [{ kind: 'new', name: valueName.trim() }] : [];

    return [...lib, ...known, ...extra];
  }, [artists, knownNames, query, valueName]);

  const activeIndex = Math.min(highlight, Math.max(0, options.length - 1));

  const select = (opt: Option) => {
    onChange(opt.kind === 'library' ? { id: opt.id, name: opt.name } : { name: opt.name });
    setOpen(false);
  };

  const handleType = (val: string) => {
    const match = artists.find((a) => a.name.toLowerCase() === val.trim().toLowerCase());
    onChange(match ? { id: match.id, name: val } : { name: val });
    setOpen(true);
    setHighlight(0);
  };

  const isZinc = variant === 'zinc';
  const isLinked = Boolean(valueId);
  const isUnlistedName = Boolean(valueName.trim()) && !valueId;

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <User
          className={cn(
            'absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none',
            isLinked ? 'text-emerald-400' : isZinc ? 'text-zinc-500' : 'text-brand-muted'
          )}
        />
        <input
          ref={inputRef}
          type="text"
          value={valueName}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => handleType(e.target.value)}
          onKeyDown={(e) => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) setOpen(true);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(options.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              if (open && options[activeIndex]) {
                e.preventDefault();
                select(options[activeIndex]);
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className={cn(
            'w-full pl-8 pr-24 py-1.5 rounded-lg text-xs focus:outline-none',
            isZinc
              ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:border-emerald-400'
              : 'bg-brand-bg border border-brand-border/80 text-brand-text placeholder:text-brand-muted/50 focus:border-emerald-400'
          )}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {isLinked && (
            <span className="inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-emerald-400" title="Linked to an artist card in your library">
              <Library className="w-3 h-3" /> Library
            </span>
          )}
          {isUnlistedName && (
            <span className="inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-amber-400" title="This artist has no card in your library yet">
              <UserPlus className="w-3 h-3" /> New
            </span>
          )}
          {valueName && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange({ name: '' });
                inputRef.current?.focus();
              }}
              className={cn('cursor-pointer', isZinc ? 'text-zinc-400 hover:text-zinc-100' : 'text-brand-muted hover:text-brand-text')}
              title="Clear excerpt artist"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {open && options.length > 0 && (
        <div
          className={cn(
            'absolute z-30 top-full left-0 right-0 mt-1 rounded-lg shadow-xl max-h-56 overflow-y-auto border',
            isZinc ? 'bg-zinc-800 border-zinc-700' : 'bg-brand-card border-brand-border'
          )}
          // Keep focus in the input so onBlur doesn't close the list before the click lands
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((opt, i) => {
            const active = i === activeIndex;
            const base = cn(
              'px-3 py-1.5 text-xs cursor-pointer flex items-center justify-between gap-2',
              active
                ? 'bg-emerald-500/20 text-emerald-300'
                : isZinc
                ? 'text-zinc-200 hover:bg-emerald-500/10'
                : 'text-brand-text hover:bg-emerald-500/10'
            );
            if (opt.kind === 'new') {
              return (
                <div key="__new" className={cn(base, 'border-t', isZinc ? 'border-zinc-700' : 'border-brand-border')} onMouseEnter={() => setHighlight(i)} onClick={() => select(opt)}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <UserPlus className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate">
                      Use “<strong>{opt.name}</strong>”
                    </span>
                  </span>
                  <span className="text-[10px] text-amber-400/80 shrink-0">not in library</span>
                </div>
              );
            }
            return (
              <div key={`${opt.kind}_${opt.kind === 'library' ? opt.id : opt.name}`} className={base} onMouseEnter={() => setHighlight(i)} onClick={() => select(opt)}>
                <span className="min-w-0">
                  <span className="block truncate">{opt.name}</span>
                  {opt.kind === 'library' && opt.subtitle && (
                    <span className={cn('block truncate text-[10px]', isZinc ? 'text-zinc-400' : 'text-brand-muted')}>{opt.subtitle}</span>
                  )}
                </span>
                {opt.kind === 'library' ? (
                  valueId === opt.id ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <span className="text-[10px] text-emerald-400/70 shrink-0">library</span>
                  )
                ) : (
                  <span className={cn('text-[10px] shrink-0', isZinc ? 'text-zinc-500' : 'text-brand-muted')}>used before</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
