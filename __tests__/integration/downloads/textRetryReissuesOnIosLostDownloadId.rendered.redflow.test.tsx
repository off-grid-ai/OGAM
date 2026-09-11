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
 * The single owner is the Shared application facade's download coordinator. This test drives the REAL Models screen
 * → arrives at the model detail via a real search+tap → the failed card renders → tap Retry → assert the
 * REAL native download layer received a fresh start (the status leaves 'failed'; a new native row exists).
 *
 * Integration boundary: fakes ONLY at the device boundary — the native DownloadManagerModule + fs + RAM
 * (installNativeBoundary), and the HuggingFace NETWORK transport (searchModels/getModelFiles). Everything
 * we own runs REAL: ModelsScreen, TextModelsTab, ModelCard, useTextModels, the Shared application
 * facade, model library, and native download adapter. Platform pinned to iOS.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'meta/llama-lost';
const FILE_NAME = 'llama-q4.gguf';

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

    // The model-control catalog reads Hugging Face's repository facts directly at its network port.
    // Keep the complete application path real and fake only that external response.
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        siblings: [{ rfilename: FILE_NAME, lfs: { size: 3 * GB } }],
      }),
    } as Response);

     
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { getMobileApplication } = require('../../../src/services/composition/application');
    const { startModelDownload } = require('../../../src/services/startModelDownload');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const application = getMobileApplication();

    // Reach the failed state through the real public admission path. The device then reports failure
    // and loses its native row, which is the app-kill residue this journey must recover from.
    const admissionErrors: Error[] = [];
    await startModelDownload(MODEL_ID, file, {
      onError: (error: Error) => admissionErrors.push(error),
    });
    expect(admissionErrors).toEqual([]);
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));
    const originalTransferId = boundary.download!.active()[0]!.downloadId;
    boundary.download!.events.emit('DownloadError', {
      downloadId: originalTransferId,
      reason: 'Download failed',
    });
    await waitFor(() => {
      expect(application.models.snapshot().control.downloads.find(
        (entry: { repositoryId?: string; fileName: string }) =>
          entry.repositoryId === MODEL_ID && entry.fileName === FILE_NAME,
      )?.status).toBe('failed');
    });
    boundary.download!.simulateRelaunch();

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
      expect(application.models.snapshot().control.downloads.find(
        (entry: { repositoryId?: string; fileName: string }) =>
          entry.repositoryId === MODEL_ID && entry.fileName === FILE_NAME,
      )?.status).not.toBe('failed');
    }, { timeout: 4000 });
    await waitFor(() => {
      expect(boundary.download!.active().length).toBeGreaterThanOrEqual(1);
    }, { timeout: 4000 });
    expect(queryByText('Retry')).toBeNull();
  }, 30000);
});
