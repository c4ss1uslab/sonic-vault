import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Sparkles, X } from 'lucide-react';
import { CLUSTER_COLOR_PALETTE, getClusterColor } from '../lib/clusterColors';
import { TagCluster } from '../types';

interface ClusterColorPickerProps {
  currentColor?: string;
  onSelectColor: (colorHex: string) => void;
  className?: string;
}

export const ClusterColorGrid: React.FC<ClusterColorPickerProps> = ({
  currentColor,
  onSelectColor,
  className = '',
}) => {
  const activeColor = currentColor || CLUSTER_COLOR_PALETTE[0].hex;

  return (
    <div className={`grid grid-cols-6 sm:grid-cols-8 gap-2 p-1 ${className}`}>
      {CLUSTER_COLOR_PALETTE.map((color) => {
        const isSelected = activeColor.toLowerCase() === color.hex.toLowerCase();
        return (
          <button
            key={color.hex}
            type="button"
            onClick={() => onSelectColor(color.hex)}
            title={`${color.name} (${color.vibe})`}
            className={`group relative h-7 w-7 rounded-lg transition-all duration-150 flex items-center justify-center cursor-pointer focus:outline-none ${
              isSelected
                ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-brand-card shadow-lg shadow-black/60 z-10'
                : 'hover:scale-105 hover:shadow-md'
            }`}
            style={{ backgroundColor: color.hex }}
          >
            {isSelected && <Check className="h-3.5 w-3.5 text-white stroke-[3] drop-shadow" />}
            
            {/* Tooltip */}
            <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/90 px-1.5 py-0.5 text-[9px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 z-30 shadow-md">
              {color.name}
            </span>
          </button>
        );
      })}
    </div>
  );
};

interface ClusterColorModalProps {
  isOpen: boolean;
  cluster: TagCluster | null;
  onClose: () => void;
  onColorChange: (clusterName: string, newColor: string) => void;
}

export const ClusterColorModal: React.FC<ClusterColorModalProps> = ({
  isOpen,
  cluster,
  onClose,
  onColorChange,
}) => {
  if (!isOpen || !cluster) return null;

  const currentColor = getClusterColor(cluster);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-md bg-brand-card/95 border border-brand-border/80 rounded-3xl p-6 shadow-2xl overflow-hidden glass z-10 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-brand-border/40 pb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="h-7 w-7 rounded-xl flex items-center justify-center shadow-md shrink-0"
                style={{ backgroundColor: currentColor }}
              >
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-brand-text truncate">{cluster.name}</h3>
                <p className="text-[10px] text-brand-muted uppercase font-bold tracking-wider">
                  Choose Cluster Vibe Color
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-brand-muted hover:text-white rounded-lg hover:bg-brand-bg/80 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Live Preview Badge */}
          <div className="p-3 rounded-2xl bg-brand-bg/70 border border-brand-border/60 flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-brand-muted">Preview Badge:</span>
            <div
              className="px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm border"
              style={{
                backgroundColor: `${currentColor}1c`,
                borderColor: `${currentColor}50`,
                color: currentColor,
              }}
            >
              <Sparkles className="h-3 w-3" style={{ color: currentColor }} />
              <span>{cluster.name}</span>
            </div>
          </div>

          {/* 24 Palette Colors */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase font-bold text-brand-muted tracking-wider">
                Consonant Palette ({CLUSTER_COLOR_PALETTE.length} Vibe Colors)
              </label>
              <span className="text-[10px] font-mono text-brand-muted font-bold">
                {CLUSTER_COLOR_PALETTE.find(c => c.hex.toLowerCase() === currentColor.toLowerCase())?.name || currentColor}
              </span>
            </div>

            <div className="bg-brand-bg/50 border border-brand-border/60 rounded-2xl p-2.5">
              <ClusterColorGrid
                currentColor={currentColor}
                onSelectColor={(hex) => {
                  onColorChange(cluster.name, hex);
                }}
              />
            </div>
          </div>

          <div className="pt-2 border-t border-brand-border/40 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-xs font-bold text-white rounded-xl cursor-pointer shadow-md transition-all"
              style={{ backgroundColor: currentColor }}
            >
              Done
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
