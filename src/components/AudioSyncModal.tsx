import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Download, 
  Upload, 
  FolderSync, 
  CheckCircle2, 
  AlertCircle, 
  Smartphone, 
  Laptop, 
  FileAudio, 
  HardDrive, 
  Layers, 
  Sparkles,
  ArrowRight,
  RefreshCw,
  Music
} from 'lucide-react';
import { 
  getAllStoredAudioRecords, 
  getStoredAudioIds, 
  exportAudioVaultZip, 
  importAudioVaultZip, 
  matchAndImportAudioFiles,
  formatAudioDuration,
  StoredAudioRecord
} from '../lib/audioDb';
import { MusicItem } from '../types';

interface AudioSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: MusicItem[];
  onSyncComplete?: () => void;
}

export function AudioSyncModal({
  isOpen,
  onClose,
  items,
  onSyncComplete,
}: AudioSyncModalProps) {
  const [storedRecords, setStoredRecords] = useState<StoredAudioRecord[]>([]);
  const [storedIds, setStoredIds] = useState<Set<string>>(new Set());
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
    details?: string;
  }>({ type: null, message: '' });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const excerptItems = items.filter(i => i.type === 'excerpt');

  const loadStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const records = await getAllStoredAudioRecords();
      const ids = await getStoredAudioIds();
      setStoredRecords(records);
      setStoredIds(ids);
    } catch (e) {
      console.error('Failed to inspect audio status:', e);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadStatus();
      setImportStatus({ type: null, message: '' });
    }
  }, [isOpen, items]);

  const totalBytes = storedRecords.reduce((acc, r) => acc + (r.blob?.size || 0), 0);
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);

  const availableLocallyCount = excerptItems.filter(i => storedIds.has(i.audioStorageKey || i.id)).length;
  const missingLocallyCount = Math.max(0, excerptItems.length - availableLocallyCount);

  const handleExportZip = async () => {
    if (storedRecords.length === 0) {
      setImportStatus({
        type: 'error',
        message: 'No audio files found on this device to export.',
        details: 'Upload an excerpt first or import audio files to this device.',
      });
      return;
    }

    try {
      setIsExporting(true);
      const { blob, count } = await exportAudioVaultZip(items);
      
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `sonic-vault-audio-pack-${dateStr}.zip`;
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setImportStatus({
        type: 'success',
        message: `Successfully exported ${count} audio file(s) (${totalMb} MB).`,
        details: 'Transfer this .zip to your phone or other device (via AirDrop, Google Drive, iCloud, or email) and tap "Import Audio Pack" on that device.',
      });
    } catch (err: any) {
      setImportStatus({
        type: 'error',
        message: 'Export failed',
        details: err?.message || 'Unknown error occurred during packaging.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsImporting(true);
    setImportStatus({ type: null, message: '' });

    try {
      // Check if it's a zip file
      const firstFile = files[0];
      if (files.length === 1 && (firstFile.name.endsWith('.zip') || firstFile.type.includes('zip'))) {
        const result = await importAudioVaultZip(firstFile, items);
        await loadStatus();
        onSyncComplete?.();

        setImportStatus({
          type: 'success',
          message: `Imported ${result.importedCount} audio file(s) successfully!`,
          details: `${result.matchedCount} audio file(s) matched and connected to your vault excerpt items on this device.`,
        });
      } else {
        // Raw audio file(s) (MP3, WAV, etc.)
        const result = await matchAndImportAudioFiles(files, items);
        await loadStatus();
        onSyncComplete?.();

        setImportStatus({
          type: 'success',
          message: `Imported ${result.importedCount} audio file(s)!`,
          details: result.matchedCount > 0
            ? `Matched ${result.matchedCount} audio file(s) directly to your vault excerpts: ${result.matchedItems.slice(0, 3).join(', ')}${result.matchedItems.length > 3 ? '...' : ''}`
            : 'Audio saved to local vault. You can link them directly in excerpt items.',
        });
      }
    } catch (err: any) {
      setImportStatus({
        type: 'error',
        message: 'Import failed',
        details: err?.message || 'Could not process the uploaded audio files.',
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-brand-card border border-brand-border rounded-3xl p-6 md:p-8 max-w-2xl w-full shadow-2xl relative max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-brand-border/60">
          <div className="flex items-center gap-3.5">
            <div className="p-3 bg-emerald-500/15 text-emerald-400 rounded-2xl border border-emerald-500/25 shrink-0">
              <FolderSync className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-bold text-brand-text flex items-center gap-2">
                <span>Cross-Device Audio Sync & Backup</span>
              </h2>
              <p className="text-xs text-brand-muted mt-0.5">
                Keep your raw MP3s & audio loops in sync between Desktop, Mobile, and Tablets
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-brand-muted hover:text-brand-text hover:bg-brand-bg rounded-xl transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto py-5 space-y-6 custom-scrollbar pr-1">
          {/* Architecture explainer card */}
          <div className="bg-brand-bg/60 border border-brand-border/80 rounded-2xl p-4.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> How Sync Works
              </span>
              <span className="text-[11px] font-mono text-brand-muted bg-brand-card px-2 py-0.5 rounded border border-brand-border">
                Zero Cloud Size Limits
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-brand-card/70 border border-brand-border/60 p-3 rounded-xl space-y-1">
                <div className="flex items-center gap-2 font-bold text-brand-text">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Cloud Vault (Automatic)</span>
                </div>
                <p className="text-brand-muted leading-relaxed text-[11px]">
                  All metadata (titles, tags, BPM, keys, audio segment cue-points, notes, ratings) syncs across every device automatically.
                </p>
              </div>

              <div className="bg-brand-card/70 border border-brand-border/60 p-3 rounded-xl space-y-1">
                <div className="flex items-center gap-2 font-bold text-brand-text">
                  <HardDrive className="h-4 w-4 text-blue-400 shrink-0" />
                  <span>Local Audio Files (IndexedDB)</span>
                </div>
                <p className="text-brand-muted leading-relaxed text-[11px]">
                  Raw audio MP3s are stored in your device's browser for instant playback with no cloud audio limits. Use the sync buttons below to copy audio between devices.
                </p>
              </div>
            </div>
          </div>

          {/* Current Device Status */}
          <div className="bg-brand-card/80 border border-brand-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-brand-text flex items-center gap-2">
                <Layers className="h-4 w-4 text-brand-accent" />
                <span>Audio Status on This Device</span>
              </h3>
              <button
                type="button"
                onClick={loadStatus}
                className="text-[11px] text-brand-muted hover:text-brand-text flex items-center gap-1 cursor-pointer transition-colors"
                title="Refresh storage status"
              >
                <RefreshCw className={isLoadingStatus ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
                <span>Refresh</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="bg-brand-bg/70 border border-brand-border/70 p-3 rounded-xl">
                <span className="block text-[11px] text-brand-muted">Total Excerpts</span>
                <span className="text-base font-bold font-mono text-brand-text mt-0.5 block">{excerptItems.length}</span>
              </div>
              <div className="bg-brand-bg/70 border border-brand-border/70 p-3 rounded-xl">
                <span className="block text-[11px] text-brand-muted">On This Device</span>
                <span className="text-base font-bold font-mono text-emerald-400 mt-0.5 block">
                  {availableLocallyCount} <span className="text-[10px] text-brand-muted font-normal">({totalMb} MB)</span>
                </span>
              </div>
              <div className="bg-brand-bg/70 border border-brand-border/70 p-3 rounded-xl">
                <span className="block text-[11px] text-brand-muted">Missing Locally</span>
                <span className={`text-base font-bold font-mono mt-0.5 block ${missingLocallyCount > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>
                  {missingLocallyCount}
                </span>
              </div>
            </div>
          </div>

          {/* Status / Feedback Banner */}
          {importStatus.type && (
            <div className={`p-4 rounded-2xl border text-xs flex items-start gap-3 ${
              importStatus.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}>
              {importStatus.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5">
                <p className="font-bold text-sm">{importStatus.message}</p>
                {importStatus.details && <p className="opacity-90 leading-relaxed text-[11px]">{importStatus.details}</p>}
              </div>
            </div>
          )}

          {/* Dual Action Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Step 1: Export Card */}
            <div className="bg-brand-bg/50 border border-brand-border rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-emerald-500/40 transition-all">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-brand-text font-bold text-sm">
                  <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20">
                    <Laptop className="h-4 w-4" />
                  </div>
                  <span>1. Export from Desktop</span>
                </div>
                <p className="text-xs text-brand-muted leading-relaxed">
                  Download all audio files stored on this machine into a clean, portable <code className="text-emerald-400 font-mono">.zip</code> audio package.
                </p>
              </div>

              <button
                type="button"
                onClick={handleExportZip}
                disabled={isExporting || storedRecords.length === 0}
                className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20 transition-all cursor-pointer"
              >
                {isExporting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Packaging Audio Zip...</span>
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    <span>Download Audio Pack ({storedRecords.length} files)</span>
                  </>
                )}
              </button>
            </div>

            {/* Step 2: Import Card */}
            <div className="bg-brand-bg/50 border border-brand-border rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-emerald-500/40 transition-all">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-brand-text font-bold text-sm">
                  <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
                    <Smartphone className="h-4 w-4" />
                  </div>
                  <span>2. Import to Mobile / Other</span>
                </div>
                <p className="text-xs text-brand-muted leading-relaxed">
                  Select the exported <code className="text-emerald-400 font-mono">.zip</code> package or pick raw MP3s to load them into this device's audio library.
                </p>
              </div>

              <label className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 transition-all cursor-pointer">
                {isImporting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Extracting & Syncing...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    <span>Import Audio Bundle / Files</span>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac"
                  multiple
                  onChange={handleFileSelect}
                  disabled={isImporting}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-brand-border/60 flex items-center justify-between">
          <span className="text-[11px] text-brand-muted">
            All audio stays in your browser's private local storage.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-brand-card hover:bg-brand-border border border-brand-border text-xs font-semibold text-brand-text transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}
