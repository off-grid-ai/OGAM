import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TimedText, Utterance } from './transcript';

/** A saved recording: the audio file on this phone and, once processed, its transcript. */
export interface Recording {
  id: string;
  title: string;
  createdAt: string;
  durationSec: number;
  audioPath: string;
  status: 'processing' | 'done' | 'failed';
  error?: string;
  /** Whisper's timed text, kept so speakers can be re-labelled without transcribing again. */
  segments?: TimedText[];
  utterances?: Utterance[];
  /** False when the transcript has no speaker labels (models not downloaded). */
  labelled?: boolean;
  speakerNames?: Record<number, string>;
}

interface RecordingsState {
  recordings: Recording[];
  /** The user confirmed they will tell people they are being recorded. */
  consent: boolean;
}

/**
 * Saved recordings (persisted, a read-only projection for screens). Only recorderService
 * writes here. Recordings stay on this phone and are not part of Atlas backups.
 */
export const useRecordings = create<RecordingsState>()(persist((): RecordingsState => ({ recordings: [], consent: false }), {
  name: 'atlas-recordings',
  storage: createJSONStorage(() => AsyncStorage),
  // A transcript that was being made when Atlas closed did not finish: offer a retry.
  merge: (saved: any, current) => ({
    ...current,
    ...saved,
    recordings: (saved?.recordings ?? []).map((r: Recording) => (r.status === 'processing'
      ? { ...r, status: 'failed', error: 'Atlas closed before the transcript was finished.' } : r)),
  }),
}));

export type RecorderPhase = 'idle' | 'recording' | 'processing';

interface LiveState {
  phase: RecorderPhase;
  startedAt: number;
  /** The recording being processed and what is happening to it. */
  processingId: string | null;
  step: string;
  progress: number;
  speakerDownload: number | null;
}

/** What the recorder is doing right now (not persisted). Written only by recorderService. */
export const useRecorderLive = create<LiveState>(() => ({
  phase: 'idle', startedAt: 0, processingId: null, step: '', progress: 0, speakerDownload: null,
}));
