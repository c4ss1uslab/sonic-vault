import React, { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { formatPreciseTime, parseTimeToSeconds, roundToMs } from '../lib/audioDb';
import { cn } from '../lib/utils';

interface PreciseTimeInputProps {
  value: number; // seconds
  onChange: (seconds: number) => void;
  min?: number;
  max?: number;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  title?: string;
}

const NUDGE_HINT = '↑/↓ = ±10ms · Shift = ±100ms · Alt = ±1ms';

/**
 * Time field with millisecond precision (m:ss.mmm).
 * Accepts "1:14.250", "74.25", "0:14", "1:02:03.5". Commits on blur / Enter.
 * Arrow keys and the -/+ buttons nudge the value.
 */
export const PreciseTimeInput: React.FC<PreciseTimeInputProps> = ({
  value,
  onChange,
  min = 0,
  max,
  className,
  inputClassName,
  buttonClassName,
  title,
}) => {
  const [draft, setDraft] = useState(formatPreciseTime(value));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) setDraft(formatPreciseTime(value));
  }, [value, isEditing]);

  const clamp = (sec: number) => {
    let v = Math.max(min, sec);
    if (max !== undefined && max > 0) v = Math.min(max, v);
    return roundToMs(v);
  };

  const commit = (raw: string) => {
    const sec = clamp(parseTimeToSeconds(raw, value));
    setDraft(formatPreciseTime(sec));
    if (sec !== value) onChange(sec);
  };

  const nudge = (delta: number) => {
    const base = isEditing ? parseTimeToSeconds(draft, value) : value;
    const sec = clamp(base + delta);
    setDraft(formatPreciseTime(sec));
    onChange(sec);
  };

  const stepFor = (e: React.KeyboardEvent | React.MouseEvent) =>
    e.altKey ? 0.001 : e.shiftKey ? 0.1 : 0.01;

  const btn = cn(
    'shrink-0 p-1 rounded-md transition cursor-pointer disabled:opacity-40',
    buttonClassName ?? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700'
  );

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        className={btn}
        onClick={(e) => nudge(-stepFor(e))}
        title={`−10ms (Shift: −100ms, Alt: −1ms)`}
      >
        <Minus className="w-3 h-3" />
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onFocus={() => setIsEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          setIsEditing(false);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            nudge((e.key === 'ArrowUp' ? 1 : -1) * stepFor(e));
          } else if (e.key === 'Escape') {
            setDraft(formatPreciseTime(value));
          }
        }}
        placeholder="0:00.000"
        title={title ? `${title} — ${NUDGE_HINT}` : NUDGE_HINT}
        className={cn('min-w-0 font-mono tabular-nums text-center', inputClassName)}
      />
      <button
        type="button"
        className={btn}
        onClick={(e) => nudge(stepFor(e))}
        title={`+10ms (Shift: +100ms, Alt: +1ms)`}
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
};
