/**
 * RED-FLOW (UI, rendered) — a rehydrated FAILED text download on iOS whose store row LOST its
 * downloadId (device 2026-07-15: an app-kill mid-download cleared the store's downloadId) must be
 * RETRIABLE from the Models screen's file card: tapping Retry re-issues a fresh download.
 *
 * The bug: the Models-screen file card picks the retry MECHANISM by Platform.OS in the presentation
 * layer (Android → backgroundDownloadService.retryDownload; iOS → a fresh proceedDownload()), and it
 * only renders the failed section (with the Retry button) when `storeEntry?.downloadId` is truthy. On
 * iOS a rehydrated failed entry that lost its downloadId therefore has NO Retry affordance at all — the
 * exact lost-downloadId case textProvider.retry() was already fixed for, bypassed because this caller
 * never routes through the provider. So retry is a silent no-op.
 *
 * The single owner is modelDownloadService.retry(uniformDownloadId('text', modelKey)) → textProvider.retry
 * (iOS re-issues from the entry's metadata; needs NO downloadId). This test drives the REAL Models screen
 * → arrives at the model detail via a real search+tap → the failed card renders → tap Retry → assert the
 * REAL native download layer received a fresh start (the status leaves 'failed'; a new native row exists).
 *
 * Integration boundary: fakes ONLY at the device boundary — the native DownloadManagerModule + fs + RAM
 * (installNativeBoundary), and the HuggingFace NETWORK transport (searchModels/getModelFiles). Everything
 * we own runs REAL: ModelsScreen, TextModelsTab, ModelCard, useTextModels, modelDownloadService,
 * textProvider, modelManager, backgroundDownloadService, the download store. Platform pinned to iOS.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'meta/llama-lost';
const FILE_NAME = 'llama-q4.gguf';
const MODEL_KEY = `${MODEL_ID}/${FILE_NAME}`;

describe('iOS text retry re-issues a rehydrated failed download that lost its downloadId (red-flow)', () => {
  it('tapping Retry on a lost-downloadId failed card re-issues a fresh download (not a silent no-op)', async () => {
    // Device boundary: an iOS phone with plenty of RAM (12GB) so the file is compatible/offered.
    const boundary = installNativeBoundary({ download: true, fs: true, ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });

    // HuggingFace NETWORK transport is outside our system — fake it. getDownloadUrl is a PURE string
    // builder (the retry re-issue path calls it), so implement it faithfully so a real URL is built.
    const file = { name: FILE_NAME, size: 3 * GB, quantization: 'Q4_K_M', downloadUrl: `https://huggingface.co/${MODEL_ID}/resolve/main/${FILE_NAME}` };
    const modelInfo = { id: MODEL_ID, name: 'Llama Lost', author: 'meta', description: 'test', downloads: 100, likes: 1, tags: [], lastModified: '', files: [file] };
    jest.doMock('../../../src/services/huggingface', () => ({
      huggingFaceService: {
        searchModels: jest.fn(async () => [modelInfo]),
        getModelFiles: jest.fn(async () => [file]),
        getModelDetails: jest.fn(async () => modelInfo),
        getDownloadUrl: (modelId: string, fileName: string, revision = 'main') =>
          `https://huggingface.co/${modelId}/resolve/${revision}/${fileName}`,
        formatModelSize: jest.fn(() => '3.0 GB'),
        formatFileSize: jest.fn((b: number) => `${(b / GB).toFixed(1)} GB`),
      },
    }));

    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // Providers must be registered so modelDownloadService can route text retries to textProvider.
    registerCoreDownloadProviders();

    // Device-boundary residue of the app-kill: a hydrated FAILED text entry whose downloadId was LOST
    // (empty string — the store's downloadId cleared while the native row was gone). This is the exact
    // rehydrated state the bug occurs on; it is an outside-our-system leaf (persisted/rehydrated row).
    useDownloadStore.getState().hydrate([{
      modelKey: MODEL_KEY,
      downloadId: '', // LOST on the app-kill
      modelId: MODEL_ID,
      fileName: FILE_NAME,
      quantization: 'Q4_K_M',
      modelType: 'text',
      status: 'failed',
      bytesDownloaded: 1 * GB,
      totalBytes: 3 * GB,
      combinedTotalBytes: 3 * GB,
      progress: 0.33,
      errorMessage: 'Download failed',
      createdAt: Date.now(),
    }]);

    // Prime the synchronous RAM read (getTotalMemoryGB) from the seeded device-info boundary — the same
    // step Home does before handing the picker its memory numbers. Without it ramGB reads a stale default.
    const { hardwareService } = require('../../../src/services/hardware');
    await hardwareService.refreshMemoryInfo();

    const utils = render(React.createElement(ModelsScreen, {}));
    const { getByTestId, getByText, queryByText } = utils;

    // Arrive at the model detail via REAL gestures: type a search, then submit it (submit runs the
    // search immediately, past the 500ms debounce), tap the model card.
    await act(async () => { fireEvent.changeText(getByTestId('search-input'), 'llama'); });
    await act(async () => {
      fireEvent(getByTestId('search-input'), 'submitEditing');
      await new Promise((r) => setTimeout(r, 600)); // let the debounced + submitted search resolve
    });
    await waitFor(() => expect(getByText('Llama Lost')).toBeTruthy(), { timeout: 6000 });
    await act(async () => { fireEvent.press(getByText('Llama Lost')); });
    await waitFor(() => expect(getByTestId('model-detail-screen')).toBeTruthy(), { timeout: 4000 });

    // The failed file card must expose a Retry control (a failed rehydrated entry the user must recover).
    await waitFor(() => expect(getByText('Retry')).toBeTruthy(), { timeout: 4000 });

    // No native download exists yet (the row was lost on the kill).
    expect(boundary.download!.active().length).toBe(0);

    // Tap Retry.
    await act(async () => { fireEvent.press(getByText('Retry')); });

    // TERMINAL artifact: the retry re-issued a fresh download. The status leaves 'failed' (the failed
    // section + its Retry button disappear) AND a real native download row now exists.
    await waitFor(() => {
      expect(useDownloadStore.getState().downloads[MODEL_KEY]?.status).not.toBe('failed');
    }, { timeout: 4000 });
    await waitFor(() => {
      expect(boundary.download!.active().length).toBeGreaterThanOrEqual(1);
    }, { timeout: 4000 });
    expect(queryByText('Retry')).toBeNull();
  }, 30000);
});
