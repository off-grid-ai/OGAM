/**
 * Video on the phone, below the UI: the real video services, stores and Pro activation, with only
 * the device boundary faked (nativeBoundary + nativeVideoEngine: the native video engine and film
 * composer, the disk, the RAM sensor, the native background downloads).
 *
 * Nothing renders. A test drives what a screen would call: core's video seam (`videoSeam`, the one
 * door core has into video), the film renderer, the download provider, and the failure card's own
 * Retry / Run anyway actions. So these contracts hold whatever the screens look like.
 *
 * `relaunch: true` starts the JS again over the same storage (AsyncStorage persists in jest.setup),
 * as a quit app does. The disk is a new one per launch; files the device kept are put back with
 * `keptFiles`, and `carryOver` keeps the native video worker running across the restart (Android's
 * foreground service). Native downloads that outlived the JS are put back with `nativeRows`.
 */
import { GB, installNativeBoundary, type DownloadRow, type NativeBoundary, type RamProfile } from './nativeBoundary';
import { installNativeVideoEngine, phoneDownloads, type NativeVideoEngine } from './nativeVideoEngine';
import type { GeneratedVideo } from '../../src/types';

/** Wan 2.1 (1.3B), FP16: the catalog pack both phones run whose files carry no published checksum. */
export const WAN = 'Comfy-Org/Wan_2.1_ComfyUI_repackaged';

export interface PhoneVideo {
  boundary: NativeBoundary;
  engine: NativeVideoEngine;
  seam: typeof import('../../src/bootstrap/videoSeam').videoSeam;
  service: typeof import('../../pro/video/videoGenerationService').videoGenerationService;
  films: typeof import('../../pro/video/studio/filmRenderer');
  provider: typeof import('../../pro/video/videoProvider').videoProvider;
  app: () => ReturnType<typeof import('../../src/stores').useAppStore.getState>;
  chat: () => ReturnType<typeof import('../../src/stores').useChatStore.getState>;
  studio: () => ReturnType<typeof import('../../pro/video/studio/studioStore').useStudioStore.getState>;
  /** The failure card on screen for video, if any (title, message, and its Retry / Run anyway actions). */
  failure: () => ReturnType<typeof import('../../src/stores/modelFailureStore').useModelFailureStore.getState>['failures'][number] | undefined;
  /** Whether a file is on the phone's disk now. */
  onDisk: (path: string) => Promise<boolean>;
  /** Download a catalog video pack the way Models › Video › Download does, every file to the end, and pick it. */
  installPack: (id?: string) => Promise<void>;
  /** A new chat, as the new-chat button makes one. Returns its id. */
  newChat: () => string;
  /** The chat's messages now. */
  messages: (conversationId: string) => Array<{ id: string; uuid?: string; content: string; attachments?: Array<{ id: string; type: string; uri: string }>; videoStoryId?: string }>;
  /** The saved clip or film with this id. */
  video: (id: string) => GeneratedVideo | undefined;
  /** What the app does as it closes: download polling stops. */
  shutdown: () => void;
}

/** Every launch in this test, so the closing test stops the ones a relaunch left behind too. */
const launches: PhoneVideo[] = [];

type DevGlobal = { __DEV__?: boolean };

/** Poll until `check` holds (real timers), or fail with what it last saw. */
export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

export async function bootPhoneVideo(options: {
  ram?: RamProfile;
  relaunch?: boolean;
  carryOver?: NativeVideoEngine;
  keptFiles?: Array<{ path: string; size: number }>;
  nativeRows?: DownloadRow[];
  /** The pack a finished download left on the disk, which a relaunch keeps (its files at their real size). */
  keptPack?: string;
} = {}): Promise<PhoneVideo> {
  (global as DevGlobal).__DEV__ = true;
  const boundary = installNativeBoundary({
    llama: true,
    fs: true,
    download: true,
    ram: options.ram ?? { platform: 'android', totalBytes: 24 * GB, availBytes: 20 * GB },
  });
  const storage = require('@react-native-async-storage/async-storage');
  if (!options.relaunch) await storage.clear();
  const { CATALOG } = require('@offgrid/models');
  if (options.keptPack) {
    const { videoModelDirectory } = require('../../src/services/videoModelFiles');
    const entry = CATALOG.find((model: { id: string }) => model.id === options.keptPack);
    for (const file of entry.files) boundary.fs!.seedFile(`${videoModelDirectory(entry.id)}/${file.name}`, file.sizeBytes);
  }
  for (const file of options.keptFiles ?? []) boundary.fs!.seedFile(file.path, file.size);
  for (const row of options.nativeRows ?? []) boundary.download!.seedActive(row);
  const engine = installNativeVideoEngine(boundary, options.carryOver);
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  if (!g.window) g.window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };

  const { useAppStore, useChatStore } = require('../../src/stores');
  const { useStudioStore } = require('../../pro/video/studio/studioStore');
  const { useModelFailureStore } = require('../../src/stores/modelFailureStore');
  // What the app's launch does before Pro starts: the saved stores are read back.
  await useAppStore.persist.rehydrate();
  await useChatStore.persist.rehydrate();
  await useStudioStore.persist.rehydrate();
  await require('./proHarness').installPro();

  const RNFS = require('react-native-fs');
  const act = async (work: () => Promise<void>) => {
    await work();
  };
  const provider = require('../../pro/video/videoProvider').videoProvider;
  const { backgroundDownloadService } = require('../../src/services/backgroundDownloadService');
  const phone: PhoneVideo = {
    boundary,
    engine,
    seam: require('../../src/bootstrap/videoSeam').videoSeam,
    service: require('../../pro/video/videoGenerationService').videoGenerationService,
    films: require('../../pro/video/studio/filmRenderer'),
    provider,
    app: () => useAppStore.getState(),
    chat: () => useChatStore.getState(),
    studio: () => useStudioStore.getState(),
    failure: () => useModelFailureStore.getState().failures.find((item: { modelType: string }) => item.modelType === 'video'),
    onDisk: path => RNFS.exists(path),
    installPack: async (id = WAN) => {
      const model = CATALOG.find((entry: { id: string }) => entry.id === id);
      const downloads = phoneDownloads(boundary, act);
      const started = provider.start({ modelType: 'video', model });
      let finished = 0;
      await until(async () => {
        finished += await downloads.finishRunning();
        return finished === model.files.length;
      }, 15_000, `every file of ${id} to download`);
      await started;
      await until(() => useAppStore.getState().downloadedVideoModels.some((item: { id: string }) => item.id === id), 10_000, `${id} to install`);
      useAppStore.getState().setActiveVideoModelId(id);
    },
    newChat: () => useChatStore.getState().createConversation('m'),
    messages: conversationId =>
      useChatStore.getState().conversations.find((item: { id: string }) => item.id === conversationId)?.messages ?? [],
    video: id => useAppStore.getState().generatedVideos.find((item: GeneratedVideo) => item.id === id),
    shutdown: () => backgroundDownloadService.cleanup(),
  };
  launches.push(phone);
  return phone;
}

/**
 * afterEach: stop every render, clip and download poll, so nothing outlives the test. Only the last
 * launch is still the app: an earlier one's JS is gone (a clip it was waiting for never answers it),
 * so it is only stopped, not waited for.
 */
export async function closePhoneVideo(): Promise<void> {
  const all = launches.splice(0);
  const current = all[all.length - 1];
  for (const phone of all) phone.films.stopAllRenders();
  if (current) {
    current.engine.release();
    current.engine.releaseImages();
    await current.service.cancelGeneration().catch(() => undefined);
    await current.service.whenIdle();
  }
  for (const phone of all) phone.shutdown();
}
