/**
 * RENDERED — the Home "Speech" model picker (WhisperPickerSheet) must reflect an STT download that
 * is tracked in the CANONICAL download store, not only the ones it started itself.
 *
 * Device 2026-07-15: with a voice model downloading, opening Home → Models → Speech showed the plain
 * download icon with NO progress, while the Models-screen Transcription tab showed the live bar. Root
 * cause (a DRY/SOLID break): the picker read ONLY whisperStore.downloadProgressById, while the tab read
 * the canonical downloadStore (+ a whisper-store fallback). A download registered in the canonical store
 * (started elsewhere, or rehydrated after a relaunch) was invisible to the picker.
 *
 * Fix under test: both surfaces now read ONE owner (useSttDownloadState). This mounts the real picker and
 * seeds the canonical store the way the native background-download service registers an in-flight entry —
 * the boundary's output — then asserts the matching row renders the transferring % (and a queued entry
 * renders the clock). RED (revert the picker to read whisperStore only): the canonical entry is invisible,
 * the row shows the download icon, and these queries throw.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { WhisperPickerSheet } from '../../../src/components/models/WhisperPickerSheet';
import { useDownloadStore } from '../../../src/stores/downloadStore';
import { useWhisperStore } from '../../../src/stores/whisperStore';
import type { DownloadEntry } from '../../../src/utils/downloadStatus';

const TOTAL = 142 * 1024 * 1024; // ggml-base.en is 142 MB

// A canonical download-store entry as the native background-download service produces it. The whisper
// download id is prefixed `whisper-`; the picker's owner strips it back to the bare model id 'base.en'.
const sttEntry = (over: Partial<DownloadEntry>): DownloadEntry => ({
  modelKey: 'whisper-base.en',
  downloadId: 'dl-whisper-base.en',
  modelId: 'whisper-base.en',
  fileName: 'ggml-base.en.bin',
  quantization: '',
  modelType: 'stt',
  status: 'running',
  bytesDownloaded: Math.round(0.42 * TOTAL),
  totalBytes: TOTAL,
  combinedTotalBytes: TOTAL,
  progress: 0.42,
  createdAt: 0,
  ...over,
});

describe('WhisperPickerSheet reflects a canonical-store STT download (device 2026-07-15)', () => {
  beforeEach(() => {
    useDownloadStore.setState({ downloads: {} });
    useWhisperStore.setState({ downloadProgressById: {}, downloadedModelId: null, presentModelIds: [], isModelLoading: false });
  });

  it('shows the transferring % on the matching row — not the plain download icon', () => {
    // Boundary: the native service registers a running STT download in the canonical store.
    useDownloadStore.getState().add(sttEntry({ status: 'running', progress: 0.42 }));

    const { getByText, getByTestId } = render(<WhisperPickerSheet visible onClose={() => {}} />);

    // TERMINAL artifact: the Base·EN row shows 42%, driven purely by the canonical store the picker
    // used to ignore. (RED without the fix: the picker reads whisperStore only → no % → this throws.)
    expect(getByTestId('whisper-row-progress')).toBeTruthy();
    expect(getByText('42%')).toBeTruthy();
  });

  it('shows the queued clock for a pending canonical STT download', () => {
    useDownloadStore.getState().add(sttEntry({ status: 'pending', progress: 0, bytesDownloaded: 0 }));

    const { getByTestId } = render(<WhisperPickerSheet visible onClose={() => {}} />);

    expect(getByTestId('whisper-row-queued')).toBeTruthy();
  });

  // Fallback path: the whisper store seeds progress before the canonical download-store entry exists
  // (the RNFS URL-import path never gets one). The single owner covers it, so the picker still reflects
  // it. (Replaces the deleted mockist TranscriptionModelsTab fallback tests with a real render.)
  it('shows progress from the whisper-store fallback when there is no canonical entry', () => {
    useWhisperStore.setState({ downloadProgressById: { 'base.en': 0.3 } });

    const { getByText, getByTestId } = render(<WhisperPickerSheet visible onClose={() => {}} />);

    expect(getByTestId('whisper-row-progress')).toBeTruthy();
    expect(getByText('30%')).toBeTruthy();
  });

  it('treats a 0% whisper-store fallback (awaiting a slot) as queued', () => {
    useWhisperStore.setState({ downloadProgressById: { 'base.en': 0 } });

    const { getByTestId } = render(<WhisperPickerSheet visible onClose={() => {}} />);

    expect(getByTestId('whisper-row-queued')).toBeTruthy();
  });
});
