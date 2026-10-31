/**
 * useImageModels.branches.test.ts
 *
 * The Image tab's list logic, on the real stack. Only the device boundary is faked: the phone
 * (platform, RAM, SoC through react-native-device-info and the LocalDream module), the file system,
 * the native download module, async-storage and the Hugging Face catalog at fetch. The hook, the
 * stores, hardwareService, huggingFaceModelBrowser, coreMLModelBrowser, imageDownloadActions and
 * backgroundDownloadService all run for real.
 *
 * - loadHFModels: iOS (Core ML) vs Android (sd-mnn / sd-qnn), the NPU gate, the cache, the error text
 * - the recommendation picks the backend filter on Android, never on iOS, and fills the banner
 * - isRecommendedModel: no recommendation yet, backend mismatch, QNN variant, named picks, default
 * - filteredHFModels: recommended-only, backend, style, SD version and search filters; a downloaded
 *   model stays listed
 * - handleCancelImageDownload: no entry, no download id, synthetic multi-file id, native id, a failing
 *   native cancel
 * - loadDownloadedImageModels, clearImageFilters
 */
import {
  installNativeBoundary,
  requireRTL,
  GB,
  type NativeBoundary,
  type RamProfile,
} from '../../../harness/nativeBoundary';
import {
  serveHfImageCatalog,
  lfsFile,
  folder,
  type HfImageCatalog,
  type HfImageCatalogServer,
} from '../../../harness/hfImageCatalogServer';
import { SD_MNN_PACKAGE_FILES } from '../../../harness/imageModelPackage';

jest.unmock('@react-navigation/native');

const ANDROID: RamProfile = { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB };
const IPHONE: RamProfile = { platform: 'ios', totalBytes: 8 * GB, availBytes: 5 * GB };
/** A Snapdragon 8 Gen 3: Qualcomm hardware whose SoC carries a Hexagon NPU (QNN 8gen2 packs). */
const SNAPDRAGON_8_GEN_3 = { deviceHardware: 'qcom', socModel: 'SM8650' };

const ANDROID_CATALOG: HfImageCatalog = {
  mnn: [lfsFile('AnythingV5.zip', 1.2 * GB), lfsFile('AbsoluteReality.zip', 1.1 * GB)],
  qnn: [lfsFile('AnythingV5_qnn2.28_8gen2.zip', 1.0 * GB), lfsFile('AnythingV5_qnn2.28_min.zip', 1.0 * GB)],
};
const MNN_ANYTHING = 'anythingv5_cpu';
const MNN_ABSOLUTE = 'absolutereality_cpu';
const QNN_8GEN2 = 'anythingv5_npu_8gen2';
const QNN_MIN = 'anythingv5_npu_min';

const PALETTIZED = 'apple/coreml-stable-diffusion-v1-5-palettized';
const FULL = 'apple/coreml-stable-diffusion-v1-5';
const IOS_CATALOG: HfImageCatalog = {
  coreml: {
    [PALETTIZED]: [
      lfsFile('coreml-stable-diffusion-v1-5-palettized_split_einsum_v2_compiled.zip', 1.0 * GB),
      lfsFile('coreml-stable-diffusion-v1-5-palettized_original_compiled.zip', 1.0 * GB),
    ],
    [FULL]: [folder('split_einsum')],
    [`${FULL}/split_einsum`]: [folder('split_einsum/compiled')],
    [`${FULL}/split_einsum/compiled`]: [
      lfsFile('split_einsum/compiled/merges.txt', 500),
      folder('split_einsum/compiled/Unet.mlmodelc'),
    ],
    [`${FULL}/split_einsum/compiled/Unet.mlmodelc`]: [
      lfsFile('split_einsum/compiled/Unet.mlmodelc/weights.bin', 2 * GB),
    ],
  },
};

let server: HfImageCatalogServer | undefined;
afterEach(() => {
  server?.restore();
  server = undefined;
});

interface MountOpts {
  ram?: RamProfile;
  deviceHardware?: string;
  socModel?: string;
  catalog?: HfImageCatalog;
  /** Runs on the fresh boundary before the hook mounts (seed disk, storage, hold a native read). */
  before?: (ctx: { boundary: NativeBoundary; services: any }) => void | Promise<void>;
}

async function mount(opts: MountOpts = {}) {
  const boundary = installNativeBoundary({
    ram: opts.ram ?? ANDROID,
    fs: true,
    download: true,
    deviceHardware: opts.deviceHardware,
    socModel: opts.socModel,
  });
  server = serveHfImageCatalog(opts.catalog ?? {});
  const rtl = requireRTL();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await (AsyncStorage.default ?? AsyncStorage).clear();
  const services = require('../../../../src/services');
  // The app reads the device once at boot; the RAM-dependent lists read that cache.
  await services.hardwareService.getDeviceInfo();
  await opts.before?.({ boundary, services });
  const { useImageModels } = require('../../../../src/screens/ModelsScreen/useImageModels');
  const { useDownloadStore } = require('../../../../src/stores/downloadStore');
  const { useAppStore } = require('../../../../src/stores');
  const alerts: Array<{ title: string }> = [];
  const view = rtl.renderHook(() => useImageModels((s: { title: string }) => { alerts.push(s); }));
  return { boundary, rtl, result: view.result, services, useDownloadStore, useAppStore, alerts };
}

type Mounted = Awaited<ReturnType<typeof mount>>;

async function settleRecommendation(m: Mounted) {
  await m.rtl.waitFor(() => expect(m.result.current.imageRec).not.toBeNull());
}

async function loadCatalog(m: Mounted, forceRefresh?: boolean) {
  await m.rtl.act(async () => { await m.result.current.loadHFModels(forceRefresh); });
}

/** The fetched engine packs (the sd.cpp catalog entries are listed beside them on every phone). */
const packIds = (models: Array<{ id: string; backend: string }>) =>
  models.filter(model => model.backend !== 'sd').map(model => model.id);

const byId = (m: Mounted, id: string) => m.result.current.availableHFModels.find((model: { id: string }) => model.id === id)!;

/** Hold the SoC read (react-native-device-info getHardware) so the recommendation stays pending. */
function holdSoCRead() {
  let release!: (hardware: string) => void;
  const DeviceInfo = require('react-native-device-info');
  DeviceInfo.getHardware.mockReturnValue(new Promise<string>(resolve => { release = resolve; }));
  return (hardware: string) => release(hardware);
}

// ── loadHFModels ──────────────────────────────────────────────────────

describe('loadHFModels', () => {
  it('lists the Core ML packs on iOS: zips by attention variant, and a multi-file pack with its files', async () => {
    const m = await mount({ ram: IPHONE, catalog: IOS_CATALOG });
    await loadCatalog(m);

    expect(byId(m, 'coreml_apple_coreml-stable-diffusion-v1-5-palettized')).toMatchObject({
      backend: 'coreml', _coreml: true, _coremlAttentionVariant: 'split_einsum', repo: PALETTIZED,
      fileName: 'coreml-stable-diffusion-v1-5-palettized_split_einsum_v2_compiled.zip',
    });
    expect(byId(m, 'coreml_apple_coreml-stable-diffusion-v1-5-palettized_original')).toMatchObject({
      backend: 'coreml', _coremlAttentionVariant: 'original',
    });
    const full = byId(m, 'coreml_apple_coreml-stable-diffusion-v1-5');
    expect(full).toMatchObject({ backend: 'coreml', _coreml: true, size: 2 * GB + 500 });
    expect(full._coremlFiles.map((f: { relativePath: string }) => f.relativePath))
      .toEqual(['merges.txt', 'Unet.mlmodelc/weights.bin']);
    // iOS never asks for the Android packs.
    expect(server!.requests.some(url => url.includes('xororz/'))).toBe(false);
    expect(m.result.current.hfModelsLoading).toBe(false);
    expect(m.result.current.hfModelsError).toBeNull();
  });

  it('leaves the NPU packs out on an Android phone without an NPU', async () => {
    const m = await mount({ catalog: ANDROID_CATALOG });
    await loadCatalog(m, true);

    expect(packIds(m.result.current.availableHFModels).sort()).toEqual([MNN_ABSOLUTE, MNN_ANYTHING]);
    expect(server!.requests.some(url => url.includes('xororz/sd-qnn'))).toBe(false);
    expect(m.result.current.hfModelsError).toBeNull();
  });

  it('lists the NPU packs on a Snapdragon with an NPU', async () => {
    const m = await mount({ ...SNAPDRAGON_8_GEN_3, catalog: ANDROID_CATALOG });
    await loadCatalog(m);

    expect(packIds(m.result.current.availableHFModels).sort())
      .toEqual([MNN_ABSOLUTE, MNN_ANYTHING, QNN_8GEN2, QNN_MIN]);
  });

  it('keeps the fetched list until a forced refresh asks Hugging Face again', async () => {
    const m = await mount({ catalog: ANDROID_CATALOG });
    await loadCatalog(m);
    server!.serve({ mnn: [lfsFile('ChilloutMix.zip', GB)] });

    await loadCatalog(m);
    expect(packIds(m.result.current.availableHFModels)).not.toContain('chilloutmix_cpu');

    await loadCatalog(m, true);
    expect(packIds(m.result.current.availableHFModels)).toEqual(['chilloutmix_cpu']);
  });

  it('lists the SD catalog ahead of the fetched packs', async () => {
    const m = await mount({ catalog: ANDROID_CATALOG });
    await loadCatalog(m);

    const backends = m.result.current.availableHFModels.map((model: { backend: string }) => model.backend);
    const firstPack = backends.findIndex((backend: string) => backend !== 'sd');
    expect(backends.slice(0, firstPack).length).toBeGreaterThan(0);
    expect(backends.slice(0, firstPack).every((backend: string) => backend === 'sd')).toBe(true);
    expect(backends.slice(firstPack).every((backend: string) => backend !== 'sd')).toBe(true);
  });

  it('shows the failure Hugging Face gave', async () => {
    const m = await mount({ catalog: { status: 500 } });
    await loadCatalog(m);
    expect(m.result.current.hfModelsError).toBe('Failed to fetch xororz/sd-mnn: HTTP 500');
    expect(m.result.current.hfModelsLoading).toBe(false);
  });

  it('falls back to a plain message when the failure has no text', async () => {
    const m = await mount({ catalog: { transportError: new TypeError('') } });
    await loadCatalog(m);
    expect(m.result.current.hfModelsError).toBe('Failed to fetch models');
  });
});

// ── hardware recommendation effect ────────────────────────────────────

describe('recommendation → backendFilter', () => {
  it('picks the NPU (qnn) filter on a Snapdragon with an NPU', async () => {
    const m = await mount(SNAPDRAGON_8_GEN_3);
    await m.rtl.waitFor(() => expect(m.result.current.backendFilter).toBe('qnn'));
  });

  it('picks the GPU (mnn) filter on a phone without an NPU', async () => {
    const m = await mount();
    await m.rtl.waitFor(() => expect(m.result.current.backendFilter).toBe('mnn'));
  });

  it('does not pick a backend filter on iOS', async () => {
    const m = await mount({ ram: IPHONE });
    await settleRecommendation(m);
    expect(m.result.current.imageRec.recommendedBackend).toBe('coreml');
    expect(m.result.current.backendFilter).toBe('all');
  });

  it('shows a loading banner until the phone is read, then the recommendation', async () => {
    let release!: (hardware: string) => void;
    const m = await mount({ before: () => { release = holdSoCRead(); } });
    expect(m.result.current.imageRecommendation).toBe('Loading recommendation...');

    await m.rtl.act(async () => { release('unknown'); });
    await m.rtl.waitFor(() =>
      expect(m.result.current.imageRecommendation).toBe('GPU models recommended — NPU requires Snapdragon 888+'));
  });
});

// ── isRecommendedModel ────────────────────────────────────────────────

describe('isRecommendedModel', () => {
  it('recommends nothing before the phone is read', async () => {
    const m = await mount({ before: () => { holdSoCRead(); } });
    const pack = { id: MNN_ANYTHING, name: 'AnythingV5', displayName: 'Anything V5 (GPU)', backend: 'mnn', repo: 'xororz/sd-mnn' };
    expect(m.result.current.isRecommendedModel(pack)).toBe(false);
  });

  it('on a QNN phone: a GPU pack is not recommended, and only the NPU pack for this chip is', async () => {
    const m = await mount({ ...SNAPDRAGON_8_GEN_3, catalog: ANDROID_CATALOG });
    await settleRecommendation(m);
    await loadCatalog(m);

    expect(m.result.current.isRecommendedModel(byId(m, MNN_ANYTHING))).toBe(false);
    expect(m.result.current.isRecommendedModel(byId(m, QNN_8GEN2))).toBe(true);
    expect(m.result.current.isRecommendedModel(byId(m, QNN_MIN))).toBe(false);
  });

  it('on iOS: recommends the Core ML packs the recommendation names', async () => {
    const m = await mount({ ram: IPHONE, catalog: IOS_CATALOG });
    await settleRecommendation(m);
    await loadCatalog(m);

    expect(m.result.current.isRecommendedModel(byId(m, 'coreml_apple_coreml-stable-diffusion-v1-5-palettized'))).toBe(true);
    expect(m.result.current.isRecommendedModel(byId(m, 'coreml_apple_coreml-stable-diffusion-v1-5'))).toBe(false);
  });

  it('on a GPU phone: recommends every GPU pack', async () => {
    const m = await mount({ catalog: ANDROID_CATALOG });
    await settleRecommendation(m);
    await loadCatalog(m);

    expect(m.result.current.isRecommendedModel(byId(m, MNN_ANYTHING))).toBe(true);
    expect(m.result.current.isRecommendedModel(byId(m, MNN_ABSOLUTE))).toBe(true);
  });
});

// ── filteredHFModels ──────────────────────────────────────────────────

describe('filteredHFModels', () => {
  it('shows only the recommended packs while recommended-only is on', async () => {
    const m = await mount({ ...SNAPDRAGON_8_GEN_3, catalog: ANDROID_CATALOG });
    await settleRecommendation(m);
    await loadCatalog(m);

    await m.rtl.waitFor(() => expect(packIds(m.result.current.filteredHFModels)).toEqual([QNN_8GEN2]));
  });

  it('a downloaded image model stays on the Image tab; backend and search filters still apply', async () => {
    const m = await mount({
      catalog: ANDROID_CATALOG,
      before: async ({ boundary, services }) => {
        const modelDir = `${services.modelManager.getImageModelsDirectory()}/${MNN_ANYTHING}`;
        for (const name of SD_MNN_PACKAGE_FILES) boundary.fs!.seedFile(`${modelDir}/${name}`, 1024);
        await services.modelManager.addDownloadedImageModel({
          id: MNN_ANYTHING, name: 'AnythingV5', description: 'GPU', modelPath: modelDir,
          downloadedAt: new Date().toISOString(), size: 1.2 * GB, backend: 'mnn',
        });
      },
    });
    await settleRecommendation(m);
    await m.rtl.waitFor(() =>
      expect(m.result.current.downloadedImageModels.map((model: { id: string }) => model.id)).toEqual([MNN_ANYTHING]));
    await loadCatalog(m);

    m.rtl.act(() => {
      m.result.current.setShowRecommendedOnly(false);
      m.result.current.setBackendFilter('all');
    });
    // The downloaded pack stays listed (its card marks it downloaded); the list is sorted by name.
    expect(packIds(m.result.current.filteredHFModels)).toEqual([MNN_ABSOLUTE, MNN_ANYTHING]);

    // The backend filter, not the downloaded state, is what removes a pack.
    m.rtl.act(() => { m.result.current.setBackendFilter('qnn'); });
    expect(packIds(m.result.current.filteredHFModels)).toEqual([]);
    m.rtl.act(() => { m.result.current.setBackendFilter('mnn'); });
    expect(packIds(m.result.current.filteredHFModels)).toEqual([MNN_ABSOLUTE, MNN_ANYTHING]);

    // A search that names nothing empties the list.
    m.rtl.act(() => { m.result.current.setImageSearchQuery('zzz'); });
    await m.rtl.waitFor(() => expect(m.result.current.hfModelsLoading).toBe(false));
    expect(m.result.current.filteredHFModels).toHaveLength(0);
  });

  it('filters by style and by SD version', async () => {
    const m = await mount({ catalog: ANDROID_CATALOG });
    await settleRecommendation(m);
    await loadCatalog(m);
    m.rtl.act(() => { m.result.current.setShowRecommendedOnly(false); });

    m.rtl.act(() => { m.result.current.setStyleFilter('photorealistic'); });
    expect(packIds(m.result.current.filteredHFModels)).toEqual([MNN_ABSOLUTE]);
    m.rtl.act(() => { m.result.current.setStyleFilter('anime'); });
    expect(packIds(m.result.current.filteredHFModels)).toEqual([MNN_ANYTHING]);

    m.rtl.act(() => {
      m.result.current.setStyleFilter('all');
      m.result.current.setSdVersionFilter('sdxl');
    });
    expect(packIds(m.result.current.filteredHFModels)).toEqual([]);
  });
});

// ── handleCancelImageDownload ─────────────────────────────────────────

describe('handleCancelImageDownload', () => {
  function seedEntry(m: Mounted, downloadId: string) {
    m.rtl.act(() => {
      m.useDownloadStore.getState().add({
        modelKey: 'image:m1', downloadId, modelId: 'image:m1', fileName: 'm1.zip', quantization: '',
        modelType: 'image', status: 'running', bytesDownloaded: 10, totalBytes: 100,
        combinedTotalBytes: 100, progress: 0.1, createdAt: Date.now(),
      });
    });
  }

  it('does nothing when there is no download for the model', async () => {
    const m = await mount();
    m.boundary.download!.seedActive({ downloadId: 'native-7', modelId: 'image:other' });
    await m.rtl.act(async () => { await m.result.current.handleCancelImageDownload('m1'); });
    expect(m.useDownloadStore.getState().downloads).toEqual({});
    expect(m.boundary.download!.active().map(row => row.downloadId)).toEqual(['native-7']);
  });

  it('removes a download that has no native id yet, without touching native downloads', async () => {
    const m = await mount();
    m.boundary.download!.seedActive({ downloadId: 'native-7', modelId: 'image:other' });
    seedEntry(m, '');
    await m.rtl.act(async () => { await m.result.current.handleCancelImageDownload('m1'); });
    expect(m.useDownloadStore.getState().downloads['image:m1']).toBeUndefined();
    expect(m.boundary.download!.active().map(row => row.downloadId)).toEqual(['native-7']);
  });

  it('removes a synthetic multi-file download; no native download carries that id', async () => {
    const m = await mount();
    m.boundary.download!.seedActive({ downloadId: 'native-7', modelId: 'image:other' });
    seedEntry(m, 'image-multi:m1');
    await m.rtl.act(async () => { await m.result.current.handleCancelImageDownload('m1'); });
    expect(m.useDownloadStore.getState().downloads['image:m1']).toBeUndefined();
    expect(m.boundary.download!.active().map(row => row.downloadId)).toEqual(['native-7']);
  });

  it('cancels the native download for a normal download id', async () => {
    const m = await mount();
    m.boundary.download!.seedActive({ downloadId: 'native-7', modelId: 'image:m1' });
    seedEntry(m, 'native-7');
    await m.rtl.act(async () => { await m.result.current.handleCancelImageDownload('m1'); });
    expect(m.useDownloadStore.getState().downloads['image:m1']).toBeUndefined();
    expect(m.boundary.download!.active()).toEqual([]);
  });

  it('still removes the download when the native cancel fails', async () => {
    const m = await mount();
    m.boundary.download!.module.cancelDownload.mockRejectedValueOnce(new Error('boom'));
    seedEntry(m, 'native-7');
    await m.rtl.act(async () => {
      await expect(m.result.current.handleCancelImageDownload('m1')).resolves.toBeUndefined();
    });
    expect(m.useDownloadStore.getState().downloads['image:m1']).toBeUndefined();
  });
});

// ── loadDownloadedImageModels + clearImageFilters ─────────────────────

describe('loadDownloadedImageModels / clearImageFilters', () => {
  it('reloads the downloaded image models into the app store', async () => {
    const m = await mount();
    await settleRecommendation(m);
    expect(m.result.current.downloadedImageModels).toEqual([]);

    const modelDir = `${m.services.modelManager.getImageModelsDirectory()}/x`;
    for (const name of SD_MNN_PACKAGE_FILES) m.boundary.fs!.seedFile(`${modelDir}/${name}`, 1024);
    await m.services.modelManager.addDownloadedImageModel({
      id: 'x', name: 'X', description: 'GPU', modelPath: modelDir,
      downloadedAt: new Date().toISOString(), size: GB, backend: 'mnn',
    });
    await m.rtl.act(async () => { await m.result.current.loadDownloadedImageModels(); });

    expect(m.useAppStore.getState().downloadedImageModels.map((model: { id: string }) => model.id)).toEqual(['x']);
    expect(m.result.current.downloadedImageModels.map((model: { id: string }) => model.id)).toEqual(['x']);
  });

  it('clearImageFilters resets every filter and keeps the recommendation from picking one again', async () => {
    const m = await mount();
    m.rtl.act(() => {
      m.result.current.setBackendFilter('qnn');
      m.result.current.setStyleFilter('anime');
      m.result.current.setSdVersionFilter('sd15');
    });
    expect(m.result.current.hasActiveImageFilters).toBe(true);
    m.rtl.act(() => { m.result.current.clearImageFilters(); });
    // The recommendation resolves after the clear and would pick 'mnn'; the person's clear wins.
    await settleRecommendation(m);
    expect(m.result.current.backendFilter).toBe('all');
    expect(m.result.current.styleFilter).toBe('all');
    expect(m.result.current.sdVersionFilter).toBe('all');
    expect(m.result.current.hasActiveImageFilters).toBe(false);
  });
});
