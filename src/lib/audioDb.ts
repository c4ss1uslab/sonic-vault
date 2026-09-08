import JSZip from 'jszip';

/**
 * Sonic Vault Audio IndexedDB Storage & Playback Utilities
 *
 * Stores raw audio files (mp3, wav, ogg, m4a, flac, aac, webm) in client-side IndexedDB
 * so user files persist across sessions and never encounter the 1MB Firestore document limit.
 */

const DB_NAME = 'SonicVaultAudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'audio_files';

export interface StoredAudioRecord {
  id: string; // matches item.id or audioStorageKey
  fileName: string;
  mimeType: string;
  blob: Blob;
  durationSeconds: number;
  updatedAt: number;
}

let dbInstance: IDBDatabase | null = null;

async function getAudioDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result as IDBDatabase;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event: any) => {
      dbInstance = event.target.result as IDBDatabase;
      resolve(dbInstance);
    };

    request.onerror = (event: any) => {
      console.error('Failed to open IndexedDB for audio:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Get all stored audio records from local IndexedDB
 */
export async function getAllStoredAudioRecords(): Promise<StoredAudioRecord[]> {
  try {
    const db = await getAudioDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        resolve((req.result as StoredAudioRecord[]) || []);
      };
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    console.error('Error fetching all audio records:', err);
    return [];
  }
}

/**
 * Get Set of all audio IDs stored locally in IndexedDB
 */
export async function getStoredAudioIds(): Promise<Set<string>> {
  try {
    const db = await getAudioDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const keys = req.result as (string | number)[];
        resolve(new Set(keys.map(k => String(k))));
      };
      req.onerror = () => resolve(new Set());
    });
  } catch (err) {
    console.error('Error fetching audio keys:', err);
    return new Set();
  }
}

/**
 * Check if a specific audio file is present locally
 */
export async function hasLocalAudio(id: string): Promise<boolean> {
  if (!id) return false;
  try {
    const db = await getAudioDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getKey(id);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Export all local audio files as a single standard .ZIP bundle
 */
export async function exportAudioVaultZip(items?: Array<{ id: string; name: string; audioFileName?: string }>): Promise<{ blob: Blob; count: number; totalBytes: number }> {
  const records = await getAllStoredAudioRecords();
  if (records.length === 0) {
    throw new Error('No audio files found in local storage to export.');
  }

  const zip = new JSZip();
  const manifest: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    durationSeconds: number;
    updatedAt: number;
    itemName?: string;
    zipPath: string;
  }> = [];

  let totalBytes = 0;

  for (const record of records) {
    totalBytes += record.blob.size;
    const item = items?.find(i => i.id === record.id);
    // Sanitize file name for zip path
    const safeName = (record.fileName || `${record.id}.mp3`).replace(/[\\/:*?"<>|]/g, '_');
    const zipPath = `audio/${record.id}__${safeName}`;
    
    zip.file(zipPath, record.blob);
    manifest.push({
      id: record.id,
      fileName: record.fileName || safeName,
      mimeType: record.mimeType || 'audio/mpeg',
      durationSeconds: record.durationSeconds || 0,
      updatedAt: record.updatedAt || Date.now(),
      itemName: item?.name,
      zipPath,
    });
  }

  zip.file('manifest.json', JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    itemCount: records.length,
    totalBytes,
    manifest,
  }, null, 2));

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  return { blob: zipBlob, count: records.length, totalBytes };
}

/**
 * Import an audio vault ZIP package into local IndexedDB
 */
export async function importAudioVaultZip(
  zipFileOrBlob: Blob,
  existingItems?: Array<{ id: string; name: string; audioFileName?: string }>
): Promise<{ importedCount: number; matchedCount: number; errors: string[] }> {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(zipFileOrBlob);
  const errors: string[] = [];
  let importedCount = 0;
  let matchedCount = 0;

  // 1. Try reading manifest.json
  const manifestFile = loadedZip.file('manifest.json');
  let manifestMap: Record<string, any> = {};

  if (manifestFile) {
    try {
      const manifestText = await manifestFile.async('text');
      const manifestJson = JSON.parse(manifestText);
      if (Array.isArray(manifestJson.manifest)) {
        for (const entry of manifestJson.manifest) {
          if (entry.zipPath) {
            manifestMap[entry.zipPath] = entry;
          }
        }
      }
    } catch (e: any) {
      console.warn('Could not parse manifest in zip, falling back to heuristic matching:', e);
    }
  }

  // 2. Iterate through all files in zip
  const fileEntries: Array<{ relativePath: string; zipEntry: JSZip.JSZipObject }> = [];
  loadedZip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir && relativePath !== 'manifest.json' && !relativePath.startsWith('__MACOSX/')) {
      fileEntries.push({ relativePath, zipEntry });
    }
  });

  for (const { relativePath, zipEntry } of fileEntries) {
    try {
      const audioBlob = await zipEntry.async('blob');
      const manifestEntry = manifestMap[relativePath];

      let targetId = '';
      let targetFileName = '';
      let mimeType = 'audio/mpeg';

      if (manifestEntry) {
        targetId = manifestEntry.id;
        targetFileName = manifestEntry.fileName || relativePath.split('/').pop() || 'audio.mp3';
        mimeType = manifestEntry.mimeType || 'audio/mpeg';
      } else {
        // Parse from relativePath e.g. "audio/itemId__filename.mp3" or "itemId.mp3" or "filename.mp3"
        const baseName = relativePath.split('/').pop() || '';
        const matchDoubleUnderscore = baseName.match(/^([a-zA-Z0-9_-]+)__(.+)$/);
        if (matchDoubleUnderscore) {
          targetId = matchDoubleUnderscore[1];
          targetFileName = matchDoubleUnderscore[2];
        } else {
          // Check if filename without ext matches an existing item ID
          const nameWithoutExt = baseName.replace(/\.[^/.]+$/, '');
          const matchingItem = existingItems?.find(
            it => it.id === nameWithoutExt ||
                  it.audioFileName?.toLowerCase() === baseName.toLowerCase() ||
                  it.name?.toLowerCase() === nameWithoutExt.toLowerCase()
          );
          if (matchingItem) {
            targetId = matchingItem.id;
            targetFileName = baseName;
          } else {
            targetId = `imported_audio_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            targetFileName = baseName;
          }
        }
      }

      if (targetId) {
        const duration = await getAudioDuration(audioBlob);
        await saveAudioFile(targetId, audioBlob, targetFileName, mimeType, duration);
        importedCount++;

        if (existingItems?.some(it => it.id === targetId)) {
          matchedCount++;
        }
      }
    } catch (err: any) {
      errors.push(`Error importing ${relativePath}: ${err?.message || err}`);
    }
  }

  return { importedCount, matchedCount, errors };
}

/**
 * Import and match multiple raw audio files (MP3/WAV/etc.) to existing vault items
 */
export async function matchAndImportAudioFiles(
  files: FileList | File[],
  existingItems?: Array<{ id: string; name: string; audioFileName?: string }>
): Promise<{ importedCount: number; matchedCount: number; matchedItems: string[] }> {
  const fileArray = Array.from(files);
  let importedCount = 0;
  let matchedCount = 0;
  const matchedItems: string[] = [];

  for (const file of fileArray) {
    try {
      const fileName = file.name;
      const cleanName = fileName.replace(/\.[^/.]+$/, '').toLowerCase().trim();

      // Find matching item in vault
      const matchingItem = existingItems?.find(it => {
        if (it.audioFileName && it.audioFileName.toLowerCase() === fileName.toLowerCase()) return true;
        if (it.name && it.name.toLowerCase().trim() === cleanName) return true;
        if (it.id === cleanName) return true;
        return false;
      });

      const targetId = matchingItem ? matchingItem.id : `audio_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const duration = await getAudioDuration(file);

      await saveAudioFile(targetId, file, fileName, file.type || 'audio/mpeg', duration);
      importedCount++;

      if (matchingItem) {
        matchedCount++;
        matchedItems.push(matchingItem.name || matchingItem.id);
      }
    } catch (err) {
      console.error('Error importing single audio file:', file.name, err);
    }
  }

  return { importedCount, matchedCount, matchedItems };
}

/**
 * Save an audio file blob to IndexedDB
 */
export async function saveAudioFile(
  id: string,
  blob: Blob,
  fileName?: string,
  mimeType?: string,
  durationSeconds?: number
): Promise<void> {
  try {
    const db = await getAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredAudioRecord = {
        id,
        fileName: fileName || (blob instanceof File ? blob.name : 'audio.mp3'),
        mimeType: mimeType || blob.type || 'audio/mpeg',
        blob,
        durationSeconds: durationSeconds || 0,
        updatedAt: Date.now(),
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = (e: any) => reject(e.target.error);
    });
  } catch (err) {
    console.error('Error saving audio file to IndexedDB:', err);
  }
}

/**
 * Retrieve audio blob directly
 */
export async function getRawAudioBlob(id: string): Promise<Blob | null> {
  try {
    const db = await getAudioDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const record = req.result as StoredAudioRecord | undefined;
        if (record && record.blob) {
          resolve(record.blob);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.error('Error reading audio blob from IndexedDB:', err);
    return null;
  }
}

/**
 * Retrieve audio blob and create an object URL for playback
 */
export async function getAudioBlobUrl(id: string): Promise<string | null> {
  try {
    const blob = await getRawAudioBlob(id);
    if (blob) {
      return URL.createObjectURL(blob);
    }
    return null;
  } catch (err) {
    console.error('Error creating audio URL from IndexedDB:', err);
    return null;
  }
}

/**
 * Delete an audio record from IndexedDB
 */
export async function deleteAudioFile(id: string): Promise<void> {
  try {
    const db = await getAudioDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch (err) {
    console.error('Error deleting audio file from IndexedDB:', err);
  }
}

/**
 * Calculate duration of an audio File or Blob using HTML5 Audio
 */
export async function getAudioDuration(fileOrBlob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const tempUrl = URL.createObjectURL(fileOrBlob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = tempUrl;

    const cleanup = () => {
      URL.revokeObjectURL(tempUrl);
      audio.remove();
    };

    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      cleanup();
      resolve(Number.isFinite(duration) ? Math.round(duration) : 0);
    };

    audio.onerror = () => {
      cleanup();
      resolve(0);
    };

    // Fallback timeout in case metadata event doesn't fire
    setTimeout(() => {
      cleanup();
      resolve(0);
    }, 4000);
  });
}

/**
 * Generate a procedural audio sample (WAV blob) for demo excerpts
 * so interactive sandbox and demo mode has authentic, immediately playable jazz/bossa/synth sample loops.
 */
export function generateDemoSampleWav(
  typeOrId?: string,
  name?: string,
  customDuration?: number
): Blob {
  const sampleRate = 44100;
  const str = `${typeOrId || ''} ${name || ''}`.toLowerCase();
  
  let motif: 'jazz_trumpet' | 'bossa_organ' | 'ambient_synth' = 'jazz_trumpet';
  if (str.includes('bossa') || str.includes('organ') || str.includes('valle') || str.includes('samba')) {
    motif = 'bossa_organ';
  } else if (str.includes('synth') || str.includes('ambient') || str.includes('electronic') || str.includes('drone')) {
    motif = 'ambient_synth';
  } else if (str.includes('trumpet') || str.includes('miles') || str.includes('jazz') || str.includes('horn')) {
    motif = 'jazz_trumpet';
  } else if (typeOrId === 'bossa_organ' || typeOrId === 'ambient_synth' || typeOrId === 'jazz_trumpet') {
    motif = typeOrId;
  }

  const duration = customDuration && customDuration > 0 && customDuration <= 15
    ? customDuration
    : (motif === 'ambient_synth' ? 6 : motif === 'bossa_organ' ? 4 : 5);
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new Float32Array(numSamples);

  // Synthesize musical motif based on type
  if (motif === 'jazz_trumpet') {
    // Modal D Dorian jazz lick (D4, F4, G4, A4, C5, D5) with rich trumpet harmonic overtones and vibrato
    const notes = [
      { freq: 293.66, dur: 0.6, start: 0.0 }, // D4
      { freq: 349.23, dur: 0.5, start: 0.6 }, // F4
      { freq: 392.00, dur: 0.5, start: 1.1 }, // G4
      { freq: 440.00, dur: 0.9, start: 1.6 }, // A4
      { freq: 523.25, dur: 0.7, start: 2.5 }, // C5
      { freq: 587.33, dur: 1.6, start: 3.2 }, // D5
    ];
    for (const note of notes) {
      const startIdx = Math.floor(note.start * sampleRate);
      const len = Math.floor(note.dur * sampleRate);
      for (let i = 0; i < len && startIdx + i < numSamples; i++) {
        const t = i / sampleRate;
        const env = Math.sin((Math.PI * i) / len);
        const vibrato = Math.sin(2 * Math.PI * 5.5 * t) * 4;
        const f = note.freq + vibrato;
        // Brass harmonics (1st, 2nd, 3rd, 4th harmonics)
        const val =
          0.5 * Math.sin(2 * Math.PI * f * t) +
          0.3 * Math.sin(2 * Math.PI * 2 * f * t) +
          0.15 * Math.sin(2 * Math.PI * 3 * f * t) +
          0.05 * Math.sin(2 * Math.PI * 4 * f * t);
        buffer[startIdx + i] += val * env * 0.45;
      }
    }
  } else if (motif === 'bossa_organ') {
    // Syncopated Marcos Valle style Bossa Hammond organ chords (Fmaj7 -> G9 -> Cmaj7)
    const chords = [
      { freqs: [349.23, 440.0, 523.25, 659.25], start: 0.0, dur: 0.8 }, // Fmaj7
      { freqs: [349.23, 440.0, 523.25, 659.25], start: 0.9, dur: 0.7 },
      { freqs: [392.0, 493.88, 587.33, 698.46], start: 1.7, dur: 0.9 }, // G9
      { freqs: [261.63, 329.63, 392.0, 493.88], start: 2.7, dur: 1.2 }, // Cmaj7
    ];
    for (const chord of chords) {
      const startIdx = Math.floor(chord.start * sampleRate);
      const len = Math.floor(chord.dur * sampleRate);
      for (let i = 0; i < len && startIdx + i < numSamples; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 1.5) * (1 - Math.exp(-t * 20));
        let chordVal = 0;
        for (const f of chord.freqs) {
          // Drawbar organ sound (sine + octave + 5th)
          chordVal +=
            Math.sin(2 * Math.PI * f * t) +
            0.5 * Math.sin(2 * Math.PI * 2 * f * t) +
            0.25 * Math.sin(2 * Math.PI * 3 * f * t);
        }
        buffer[startIdx + i] += (chordVal / chord.freqs.length) * env * 0.4;
      }
    }
  } else {
    // Ambient generative pad (A minor 9 drone with slow filter sweep)
    const freqs = [220.0, 261.63, 329.63, 392.0, 493.88];
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t);
      const env = Math.sin((Math.PI * i) / numSamples);
      let val = 0;
      for (let j = 0; j < freqs.length; j++) {
        const f = freqs[j];
        const detune = Math.sin(2 * Math.PI * (0.1 + j * 0.05) * t) * 1.5;
        val += Math.sin(2 * Math.PI * (f + detune) * t);
      }
      buffer[i] = (val / freqs.length) * env * lfo * 0.4;
    }
  }

  // Convert float buffer to 16-bit PCM WAV
  const wavBuffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(wavBuffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Format duration helper: seconds -> "m:ss" (or "m:ss.s" optionally)
 */
export function formatAudioDuration(seconds?: number): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Parse time string (e.g. "0:14", "1:38", "38", "00:14.5") into seconds number
 */
export function parseTimeToSeconds(input: string | number | undefined | null, fallback = 0): number {
  if (input === undefined || input === null) return fallback;
  if (typeof input === 'number') return isNaN(input) ? fallback : Math.max(0, input);
  
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    if (parts.length === 2) {
      const mins = parseFloat(parts[0]) || 0;
      const secs = parseFloat(parts[1]) || 0;
      return Math.max(0, mins * 60 + secs);
    } else if (parts.length === 3) {
      const hours = parseFloat(parts[0]) || 0;
      const mins = parseFloat(parts[1]) || 0;
      const secs = parseFloat(parts[2]) || 0;
      return Math.max(0, hours * 3600 + mins * 60 + secs);
    }
  }
  
  const num = parseFloat(trimmed);
  return isNaN(num) ? fallback : Math.max(0, num);
}

export const getAudioBlob = getAudioBlobUrl;
export const saveAudioBlob = saveAudioFile;
export const deleteAudioBlob = deleteAudioFile;
export const synthesizeDemoAudio = generateDemoSampleWav;
