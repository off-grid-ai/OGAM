/**
 * DownloadManagerScreen Tests
 *
 * The real Download Manager over the real app and download stores, the real download service and its
 * providers, the real modelManager and backgroundDownloadService, inside a real React Navigation stack
 * opened from Settings.
 *
 * Faked: only the device boundary (harness/nativeBoundary): the native background downloader
 * (DownloadManagerModule), react-native-fs over an in-memory disk, the clock and RAM.
 *
 * State enters the way the app writes it:
 * - a downloaded model is a file on disk the app registered (buildDownloadedModel + persistDownloadedModel,
 *   the finalize path), then read back by modelManager and published to the store;
 * - an image model is a folder on disk registered through modelManager.addDownloadedImageModel;
 * - a download in flight is a row on the native downloader, read into the store by hydrateDownloadStore
 *   (the launch path); a queued one is a start the service holds behind its three-at-a-time cap.
 *
 * Tests assert what the person sees, the stores, the disk and what reached the native downloader.
 */
import type { DownloadRow, NativeBoundary } from '../../harness/nativeBoundary';
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { withNavigatorRoutes } from '../../harness/realNavigation';

jest.unmock('@react-navigation/native');

const KB = 1024;
const MB = 1024 * 1024;

interface Ctx {
  boundary: NativeBoundary;
  useAppStore: any;
  useDownloadStore: any;
  modelManager: any;
  backgroundDownloadService: any;
}

interface Manager extends Ctx {
  rtl: ReturnType<typeof requireRTL>;
  view: ReturnType<ReturnType<typeof requireRTL>['render']>;
}

/** A text model the app downloaded: its file in the models folder, registered and published. */
async function placeTextModel(
  ctx: Ctx,
  opts: { repo?: string; fileName: string; quantization?: string; bytes: number },
): Promise<{ id: string; path: string }> {
  const { buildDownloadedModel, persistDownloadedModel } = require('../../../src/services/modelManager/storage');
  const modelsDir = ctx.modelManager.getModelsDirectory();
  const path = `${modelsDir}/${opts.fileName}`;
  ctx.boundary.fs!.seedFile(path, opts.bytes);
  const model = await buildDownloadedModel({
    modelId: opts.repo ?? 'author/model',
    file: { name: opts.fileName, size: opts.bytes, quantization: opts.quantization ?? 'Q4_K_M', downloadUrl: '' },
    resolvedLocalPath: path,
  });
  await persistDownloadedModel(model, modelsDir);
  ctx.useAppStore.getState().setDownloadedModels(await ctx.modelManager.getDownloadedModels());
  return { id: model.id, path };
}

/** An image model the app downloaded: its folder in the image-models folder, registered and published. */
async function placeImageModel(
  ctx: Ctx,
  opts: { id: string; name: string; bytes: number },
): Promise<{ dir: string }> {
  const dir = `${ctx.modelManager.getImageModelsDirectory()}/${opts.id}`;
  ctx.boundary.fs!.seedFile(`${dir}/unet.mnn`, opts.bytes);
  const model = {
    id: opts.id,
    name: opts.name,
    description: 'Image model',
    modelPath: dir,
    downloadedAt: '2026-01-15T00:00:00.000Z',
    size: opts.bytes,
    style: 'creative',
    backend: 'mnn',
  };
  await ctx.modelManager.addDownloadedImageModel(model);
  ctx.useAppStore.getState().addDownloadedImageModel(model);
  return { dir };
}

/** Downloads on the native downloader, read into the store the way the app reads them at launch. */
async function nativeDownloads(ctx: Ctx, rows: DownloadRow[]) {
  for (const row of rows) ctx.boundary.download!.seedActive({ createdAt: Date.now(), ...row });
  const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
  await hydrateDownloadStore();
}

/** The phone, what it holds (`before`), and the Download Manager opened from Settings. */
async function openManager(before?: (ctx: Ctx) => Promise<void>): Promise<Manager> {
  const boundary = installNativeBoundary({
    download: true,
    fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const React = require('react');
  const rtl = requireRTL();
  const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
  registerCoreDownloadProviders();
  const { useAppStore } = require('../../../src/stores');
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  const { modelManager, backgroundDownloadService } = require('../../../src/services');
  const ctx: Ctx = { boundary, useAppStore, useDownloadStore, modelManager, backgroundDownloadService };
  await before?.(ctx);
  const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
  const view = rtl.render(
    withNavigatorRoutes(React.createElement(DownloadManagerScreen), { openedFrom: 'Settings' }),
  );
  await view.findByTestId('downloaded-models-screen');
  return { ...ctx, rtl, view };
}

/** Confirm the open alert with the button of this label. */
async function confirm(m: Manager, label: string) {
  await m.rtl.act(async () => {
    m.rtl.fireEvent.press(m.view.getByLabelText(label));
  });
}

const runningText = (overrides: Partial<DownloadRow> = {}): DownloadRow => ({
  downloadId: 'dl-1',
  modelKey: 'author/model-id/model-file.gguf',
  modelId: 'author/model-id',
  fileName: 'model-file.gguf',
  quantization: 'Q4_K_M',
  modelType: 'text',
  status: 'running',
  bytesDownloaded: 1024,
  totalBytes: 4096,
  combinedTotalBytes: 4096,
  ...overrides,
});

describe('DownloadManagerScreen', () => {
  it('renders screen title', async () => {
    const { view } = await openManager();
    expect(view.getByText('Downloads')).toBeTruthy();
  });

  it('shows empty state when no downloads', async () => {
    const { view } = await openManager();
    // Active Downloads section is hidden when there are no active items
    expect(view.queryByText('Downloading')).toBeNull();
    expect(view.getByText('No models downloaded yet')).toBeTruthy();
  });

  it('Back returns to the screen it was opened from', async () => {
    const { view, rtl } = await openManager();
    rtl.fireEvent.press(view.getByTestId('back-button'));
    expect(await view.findByTestId('route-Settings')).toBeTruthy();
  });

  it('keeps failed downloads visible with their reason', async () => {
    const { view } = await openManager(ctx =>
      nativeDownloads(ctx, [runningText({
        downloadId: 'dl-42', modelKey: 'test/model/model.gguf', modelId: 'test/model', fileName: 'model.gguf',
        status: 'failed', reason: 'http_416',
      })]),
    );
    expect(view.getByText('model')).toBeTruthy();
    expect(view.getByText('The server could not resume this download. Please retry it.')).toBeTruthy();
    expect(view.queryByText('No active downloads')).toBeNull();
    // Nothing is moving: no "0" beside Downloading (hand test 15), the words say why.
    expect(view.queryByTestId('dm-active-downloading-count')).toBeNull();
    expect(view.getByTestId('dm-active-failed-count')).toBeTruthy();
  });

  it('a failed download that received nothing shows no empty bar or byte count; one that got halfway keeps both', async () => {
    const { StyleSheet } = require('react-native');
    const bars = (view: Manager['view']) =>
      view.UNSAFE_root.findAll((node: any) => typeof node.type === 'string' && /%$/.test(String(StyleSheet.flatten(node.props.style)?.width ?? '')))
        .map((node: any) => StyleSheet.flatten(node.props.style).width);

    const none = await openManager(ctx =>
      nativeDownloads(ctx, [runningText({ status: 'failed', reason: 'unknown_error', bytesDownloaded: 0 })]),
    );
    expect(none.view.getByText('model-file')).toBeTruthy();
    expect(bars(none.view)).toEqual([]);
    // Nor an empty "0 B / 4 KB" line: nothing arrived, so there is nothing to count.
    expect(none.view.queryByText(/ \/ 4 KB$/)).toBeNull();
    none.view.unmount();

    const half = await openManager(ctx =>
      nativeDownloads(ctx, [runningText({ status: 'failed', reason: 'unknown_error', bytesDownloaded: 2048, totalBytes: 4096, combinedTotalBytes: 4096 })]),
    );
    expect(bars(half.view)).toEqual(['50%']);
    expect(half.view.getByText(/ \/ 4 KB$/)).toBeTruthy();
  });

  it('surfaces a start held behind the three-download cap as queued (clock icon, no "Queued" word)', async () => {
    const { view, boundary } = await openManager(async ctx => {
      const start = (name: string) =>
        ctx.backgroundDownloadService.startDownload({
          url: `https://huggingface.co/q/resolve/main/${name}`, fileName: name, modelId: 'q/m',
          modelKey: `q/m/${name}`, modelType: 'text', totalBytes: 5000,
        });
      for (const name of ['one.gguf', 'two.gguf', 'three.gguf']) await start(name);
      start('waiting.gguf').catch(() => {}); // resolves only when a slot frees
    });
    expect(boundary.download!.active().map(r => r.fileName)).toEqual(['one.gguf', 'two.gguf', 'three.gguf']);
    expect(view.getByText('waiting')).toBeTruthy();
    // The word "Queued" was dropped in favor of the clock icon (a11y label "Queued").
    expect(view.queryByText('Queued')).toBeNull();
    expect(view.getByLabelText('Queued')).toBeTruthy();
  });

  it('shows section headers for active and completed', async () => {
    const { view } = await openManager();
    expect(view.queryByText('Downloading')).toBeNull();
    expect(view.getByText('On this phone')).toBeTruthy();
  });

  it('renders completed text model with details', async () => {
    const { view, useAppStore } = await openManager(async ctx => {
      await placeTextModel(ctx, { repo: 'test-author/test-model', fileName: 'test-model-q4.gguf', bytes: 4 * GB });
    });
    // The model's own name, as on Models, never its file name.
    expect(view.getByText(useAppStore.getState().downloadedModels[0].name)).toBeTruthy();
    expect(view.queryByText('test-model-q4.gguf')).toBeNull();
    // Cards say only what helps a choice: size and quant, no publisher name, no type label.
    // The download date joins size and quant on the one facts line ("Jan 15"), not a line of its own.
    expect(view.getByText(/^4\.00 GB · Q4_K_M · [A-Z][a-z]{2} \d{1,2}$/)).toBeTruthy();
    expect(view.queryByText(/\d{1,2}\/\d{1,2}\/\d{2,4}/)).toBeNull();
    expect(view.queryByText('test-author')).toBeNull();
    expect(view.queryByText(/· Text/)).toBeNull();
    expect(view.queryByText('No models downloaded yet')).toBeNull();
  });

  it('renders completed image model', async () => {
    const { view } = await openManager(async ctx => {
      await placeImageModel(ctx, { id: 'img-model-1', name: 'SD Turbo', bytes: 2 * GB });
    });
    expect(view.getByText('SD Turbo')).toBeTruthy();
    expect(view.getByText('2.00 GB')).toBeTruthy();
    // No type label repeated on every card.
    expect(view.queryByText('Image Generation')).toBeNull();
  });

  it('filters by the Models tab names: Video holds video models, Voice text to speech, Speech transcription', async () => {
    const { view, rtl } = await openManager(ctx =>
      nativeDownloads(ctx, [
        runningText({ downloadId: 'dl-text' }),
        runningText({ downloadId: 'dl-video', modelKey: 'v/wan/wan-video.bin', modelId: 'v/wan', fileName: 'wan-video.bin', modelType: 'video' as never }),
        runningText({ downloadId: 'dl-tts', modelKey: 't/kokoro/kokoro-voice.pte', modelId: 't/kokoro', fileName: 'kokoro-voice.pte', modelType: 'tts' as never }),
        runningText({ downloadId: 'dl-stt', modelKey: 'w/whisper/ggml-base.en.bin', modelId: 'w/whisper', fileName: 'ggml-base.en.bin', modelType: 'stt' as never }),
      ]),
    );
    const names = { 'dl-text': 'model-file', 'dl-video': 'wan-video', 'dl-tts': 'kokoro-voice.pte', 'dl-stt': 'Whisper Base (English)' };
    const shown = () => Object.entries(names).filter(([, name]) => view.queryByText(name)).map(([id]) => id);
    // The Models tabs, in the Models order; vision models live under Text there, so there is no Vision tab.
    expect(['All', 'Text', 'Documents', 'Image', 'Video', 'Voice', 'Speech'].every(label => view.queryByText(label))).toBe(true);
    expect(view.queryByText('Vision')).toBeNull();
    expect(view.queryByText('Voice Models')).toBeNull();
    expect(view.queryByText('Image Gen')).toBeNull();

    rtl.fireEvent.press(view.getByText('Text'));
    expect(shown()).toEqual(['dl-text']);
    rtl.fireEvent.press(view.getByText('Documents'));
    expect(shown()).toEqual([]);
    rtl.fireEvent.press(view.getByText('Video'));
    expect(shown()).toEqual(['dl-video']);
    rtl.fireEvent.press(view.getByText('Voice'));
    expect(shown()).toEqual(['dl-tts']);
    rtl.fireEvent.press(view.getByText('Speech'));
    expect(shown()).toEqual(['dl-stt']);
    rtl.fireEvent.press(view.getByText('All'));
    expect(shown()).toEqual(['dl-text', 'dl-video', 'dl-tts', 'dl-stt']);
  });

  it('renders active download with progress info', async () => {
    const { view } = await openManager(ctx =>
      nativeDownloads(ctx, [runningText({ bytesDownloaded: 2 * GB, totalBytes: 4 * GB, combinedTotalBytes: 4 * GB })]),
    );
    expect(view.getByText('model-file')).toBeTruthy();
    expect(view.getByText('Downloading')).toBeTruthy();
    expect(view.getByText('50%')).toBeTruthy();
  });

  it('shows storage total when models exist', async () => {
    const { view } = await openManager(async ctx => {
      await placeTextModel(ctx, { fileName: 'model.gguf', bytes: GB });
    });
    expect(view.getByText('1.0 GB used on this phone')).toBeTruthy();
  });

  it('shows count badge for completed section', async () => {
    const { view } = await openManager(async ctx => {
      await placeTextModel(ctx, { fileName: 'model.gguf', bytes: KB });
    });
    // Active section is hidden when empty (no "0" badge); completed shows 1.
    expect(view.queryByText('0')).toBeNull();
    expect(view.getByText('1')).toBeTruthy();
  });

  it('pressing delete on a downloaded model asks first and deletes nothing yet', async () => {
    let path = '';
    const m = await openManager(async ctx => {
      ({ path } = await placeTextModel(ctx, { fileName: 'model.gguf', bytes: KB }));
    });
    m.rtl.fireEvent.press(m.view.getByTestId('delete-model-button'));

    expect(await m.view.findByText('Delete Model')).toBeTruthy();
    expect(m.view.getByText(/"model\.gguf"/)).toBeTruthy();
    expect(await m.boundary.fs!.exists(path)).toBe(true);
    expect(m.useAppStore.getState().downloadedModels).toHaveLength(1);
  });

  it('pressing remove on an active download asks first and leaves it running', async () => {
    const m = await openManager(ctx => nativeDownloads(ctx, [runningText({ downloadId: 'dl-2' })]));
    m.rtl.fireEvent.press(m.view.getByTestId('remove-download-button'));

    expect(await m.view.findByText('Remove Download')).toBeTruthy();
    expect(m.boundary.download!.active().map(r => r.downloadId)).toEqual(['dl-2']);
  });

  it('renders multiple completed models', async () => {
    const { view, useAppStore } = await openManager(async ctx => {
      await placeTextModel(ctx, { repo: 'author-a/a', fileName: 'model-a.gguf', bytes: KB });
      await placeTextModel(ctx, { repo: 'author-b/b', fileName: 'model-b.gguf', quantization: 'Q8_0', bytes: 2 * KB });
    });
    for (const model of useAppStore.getState().downloadedModels) expect(view.getAllByText(model.name).length).toBeGreaterThan(0);
    expect(view.getByText('2')).toBeTruthy();
  });

  it('shows downloading status text for active downloads', async () => {
    const { view } = await openManager(ctx =>
      nativeDownloads(ctx, [runningText({ fileName: 'active-model.gguf', bytesDownloaded: 256, totalBytes: 1024, combinedTotalBytes: 1024 })]),
    );
    expect(view.getByText('256 B / 1 KB')).toBeTruthy();
    expect(view.getByText('25%')).toBeTruthy();
  });

  it('shows the measured rate for an active download', async () => {
    const m = await openManager(ctx =>
      nativeDownloads(ctx, [runningText({
        downloadId: 'dl-rate', fileName: 'active-model.gguf',
        bytesDownloaded: 384 * KB, totalBytes: MB, combinedTotalBytes: MB,
      })]),
    );
    // Two progress reports one second apart on the clock: 128 KB arrived in that second.
    const clock = jest.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(1_000_000);
      await m.rtl.act(async () => { m.useDownloadStore.getState().updateProgress('dl-rate', 384 * KB, MB); });
      clock.mockReturnValue(1_001_000);
      await m.rtl.act(async () => { m.useDownloadStore.getState().updateProgress('dl-rate', 512 * KB, MB); });
    } finally {
      clock.mockRestore();
    }
    expect(m.view.getByText('512 KB / 1 MB · 128.0 KB/s')).toBeTruthy();
    expect(m.view.getByText('50%')).toBeTruthy();
  });

  it('does not show storage section when no completed models', async () => {
    const { view } = await openManager();
    expect(view.queryByText(/Total storage used/)).toBeNull();
  });

  it('pressing delete on an image model asks first, naming it', async () => {
    const m = await openManager(async ctx => {
      await placeImageModel(ctx, { id: 'img-1', name: 'SD Model', bytes: 2048 });
    });
    m.rtl.fireEvent.press(m.view.getByTestId('delete-model-button'));
    expect(await m.view.findByText('Delete Image Model')).toBeTruthy();
    expect(m.view.getByText(/"SD Model"/)).toBeTruthy();
  });

  it('confirming delete removes the model from the screen, the store, the registry and the disk', async () => {
    let path = '';
    const m = await openManager(async ctx => {
      ({ path } = await placeTextModel(ctx, { fileName: 'model.gguf', bytes: KB }));
    });
    m.rtl.fireEvent.press(m.view.getByTestId('delete-model-button'));
    await m.view.findByText('Delete Model');
    await confirm(m, 'Delete');

    await m.rtl.waitFor(() => expect(m.view.getByText('No models downloaded yet')).toBeTruthy());
    expect(m.useAppStore.getState().downloadedModels).toEqual([]);
    expect(await m.modelManager.getDownloadedModels()).toEqual([]);
    expect(await m.boundary.fs!.exists(path)).toBe(false);
  });

  it('when the disk refuses the delete, says so and keeps the model', async () => {
    let path = '';
    const m = await openManager(async ctx => {
      ({ path } = await placeTextModel(ctx, { fileName: 'model.gguf', bytes: KB }));
    });
    m.boundary.fs!.module.unlink.mockImplementationOnce(() => Promise.reject(new Error('EACCES')));
    m.rtl.fireEvent.press(m.view.getByTestId('delete-model-button'));
    await m.view.findByText('Delete Model');
    await confirm(m, 'Delete');

    expect(await m.view.findByText("Couldn't remove the model files. Try again.")).toBeTruthy();
    expect(m.view.getByText('model')).toBeTruthy();
    expect(m.useAppStore.getState().downloadedModels).toHaveLength(1);
    expect(await m.boundary.fs!.exists(path)).toBe(true);

    // Retry: the disk lets go this time, and the model is gone, from the screen and from the disk.
    await confirm(m, 'Retry');
    await m.rtl.waitFor(() => expect(m.view.getByText('No models downloaded yet')).toBeTruthy());
    expect(await m.boundary.fs!.exists(path)).toBe(false);
    // What the next launch reads: the saved list and a scan of the models folder.
    const { textModels } = await m.modelManager.refreshModelLists();
    expect(textModels).toEqual([]);
  });

  it('confirming delete of an image model removes it from the screen, the store, the registry and the disk', async () => {
    let dir = '';
    const m = await openManager(async ctx => {
      ({ dir } = await placeImageModel(ctx, { id: 'img-1', name: 'SD Model', bytes: 2048 }));
    });
    m.rtl.fireEvent.press(m.view.getByTestId('delete-model-button'));
    await m.view.findByText('Delete Image Model');
    await confirm(m, 'Delete');

    await m.rtl.waitFor(() => expect(m.view.getByText('No models downloaded yet')).toBeTruthy());
    expect(m.useAppStore.getState().downloadedImageModels).toEqual([]);
    expect(await m.modelManager.getDownloadedImageModels()).toEqual([]);
    expect(await m.boundary.fs!.exists(dir)).toBe(false);
  });

  it('when the disk refuses an image model delete, says so, keeps the model, and Retry removes it', async () => {
    let dir = '';
    const m = await openManager(async ctx => {
      ({ dir } = await placeImageModel(ctx, { id: 'img-1', name: 'SD Model', bytes: 2048 }));
    });
    m.boundary.fs!.module.unlink.mockImplementationOnce(() => Promise.reject(new Error('EACCES')));
    m.rtl.fireEvent.press(m.view.getByTestId('delete-model-button'));
    await m.view.findByText('Delete Image Model');
    await confirm(m, 'Delete');

    expect(await m.view.findByText("Couldn't remove the model files. Try again.")).toBeTruthy();
    expect(m.view.getByText('SD Model')).toBeTruthy();
    expect(m.useAppStore.getState().downloadedImageModels).toHaveLength(1);
    expect(await m.boundary.fs!.exists(dir)).toBe(true);

    // Retry: the disk lets go this time, and the model is gone, from the screen and from the disk.
    await confirm(m, 'Retry');
    await m.rtl.waitFor(() => expect(m.view.getByText('No models downloaded yet')).toBeTruthy());
    expect(m.useAppStore.getState().downloadedImageModels).toEqual([]);
    expect(await m.boundary.fs!.exists(dir)).toBe(false);
    // What the next launch reads: the saved list and a scan of the image models folder.
    const { imageModels } = await m.modelManager.refreshModelLists();
    expect(imageModels).toEqual([]);
  });

  it('confirming remove on an active download cancels it on the native downloader', async () => {
    const m = await openManager(ctx => nativeDownloads(ctx, [runningText({ downloadId: 'dl-remove-1' })]));
    m.rtl.fireEvent.press(m.view.getByTestId('remove-download-button'));
    await m.view.findByText('Remove Download');
    await confirm(m, 'Yes');

    await m.rtl.waitFor(() => expect(m.view.queryByText('model-file')).toBeNull());
    expect(m.boundary.download!.active()).toEqual([]);
    expect(m.useDownloadStore.getState().downloads).toEqual({});
  });

  it('confirming remove on an image download cancels it on the native downloader', async () => {
    const m = await openManager(ctx =>
      nativeDownloads(ctx, [{
        downloadId: 'dl-img-1', modelKey: 'image:sd-turbo', modelId: 'image:sd-turbo', fileName: 'sd-turbo.zip',
        modelType: 'image', status: 'running', bytesDownloaded: 500, totalBytes: 1000, combinedTotalBytes: 1000,
      }]),
    );
    m.rtl.fireEvent.press(m.view.getByTestId('remove-download-button'));
    await m.view.findByText('Remove Download');
    await confirm(m, 'Yes');

    await m.rtl.waitFor(() => expect(m.view.queryByText('sd-turbo.zip')).toBeNull());
    expect(m.boundary.download!.active()).toEqual([]);
    expect(m.useDownloadStore.getState().downloads).toEqual({});
  });

  it('renders an active download with its quantization and type, not its publisher', async () => {
    const { view } = await openManager(ctx =>
      nativeDownloads(ctx, [runningText({
        downloadId: 'dl-bg-101', modelKey: 'author/bg-model/bg-model.gguf', modelId: 'author/bg-model',
        fileName: 'bg-model.gguf', bytesDownloaded: 500, totalBytes: 2000, combinedTotalBytes: 2000,
      })]),
    );
    expect(view.getByText('bg-model')).toBeTruthy();
    expect(view.getByText(/Q4_K_M · Text/)).toBeTruthy();
    // The publisher name is not repeated on the card.
    expect(view.queryByText('author')).toBeNull();
  });

  it('cancelling the delete alert closes it and keeps the model', async () => {
    let path = '';
    const m = await openManager(async ctx => {
      ({ path } = await placeTextModel(ctx, { fileName: 'model.gguf', bytes: KB }));
    });
    m.rtl.fireEvent.press(m.view.getByTestId('delete-model-button'));
    await m.view.findByText('Delete Model');
    await confirm(m, 'Cancel');

    await m.rtl.waitFor(() => expect(m.view.queryByText('Delete Model')).toBeNull());
    expect(m.view.getByText('model')).toBeTruthy();
    expect(m.useAppStore.getState().downloadedModels).toHaveLength(1);
    expect(await m.boundary.fs!.exists(path)).toBe(true);
  });

  it('retrying a failed text download restarts it on the native downloader', async () => {
    const m = await openManager(ctx =>
      nativeDownloads(ctx, [runningText({
        downloadId: 'dl-main', modelKey: 'author/vision/vision.gguf', modelId: 'author/vision', fileName: 'vision.gguf',
        status: 'failed', reason: 'http_416',
      })]),
    );
    await m.rtl.act(async () => {
      m.rtl.fireEvent.press(m.view.getByTestId('failed-retry-button'));
    });

    // Android resumes the same WorkManager job in place: the row is no longer failed.
    await m.rtl.waitFor(() => expect(m.view.queryByTestId('failed-retry-button')).toBeNull());
    expect(m.boundary.download!.module.retryDownload).toHaveBeenCalledWith('dl-main');
    expect(m.useDownloadStore.getState().downloads['author/vision/vision.gguf'].status).not.toBe('failed');
  });

  it('does not invent a file size when the completed model size is unknown', async () => {
    const { view, useAppStore } = await openManager(async ctx => {
      await placeTextModel(ctx, { fileName: 'zero-model.gguf', bytes: 0 });
    });
    expect(view.getByText(useAppStore.getState().downloadedModels[0].name)).toBeTruthy();
    expect(view.queryByText(/0 B · Q4_K_M/)).toBeNull();
  });

  it('a completed image model shows its size without a quantization badge', async () => {
    const { view } = await openManager(async ctx => {
      await placeImageModel(ctx, { id: 'img-no-quant', name: 'No Quant Image', bytes: 1024 });
    });
    expect(view.getByText('No Quant Image')).toBeTruthy();
    expect(view.getByText('1.00 KB')).toBeTruthy();
    expect(view.queryByText('Unknown')).toBeNull();
  });
});
