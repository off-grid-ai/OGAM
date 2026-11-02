import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { initLlama, installJsi, type LlamaContext } from 'llama.rn';
import logger from '../../utils/logger';
import { useAppStore } from '../../stores/appStore';
import { isLiteRTModel } from '../../types';
import { modelResidencyManager } from '../modelResidency';
import { choosePack, packId, verifyManifest, type EnginePack } from './manifest';
import { runningLlamaBuild, setLoadedPackBuild } from './running';

/**
 * Android engine packs: a newer llama.cpp reaches the phone without an app update. iOS cannot load
 * downloaded native code, so there the bundled engine is the only one and this does nothing.
 *
 *  1. check: fetch the signed manifest, pick the newest pack for this app build, download it, check
 *     the zip's sha256, unzip, and hand it to the native store, which checks every file's sha256
 *     and puts it on trial for the next launch.
 *  2. next launch: the native boot step loads the pack (llama.rn falls back to the bundled engine
 *     itself when it fails to load). Here a test prompt runs; pass → the pack is the engine; fail
 *     → rejected and the app relaunches on the bundled engine. A pack that crashes the app before
 *     its test is dropped by the native store after two launches.
 */

/** Where the signed manifest lives, and the ed25519 key the fork signs it with (raw 32 bytes, base64). */
export const ENGINE_PACK_SOURCE = {
  manifestUrl: 'https://mobile-runtime.getoffgridai.co/android/manifest.json',
  publicKey: 'c4nGAstb9RSHmeFnP8n+4kEoR85a2V01N34jQKzl/iQ=',
};
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = '@enginePacks/lastCheck';
const TEST_PROMPT = 'The capital of France is';
const TEST_CONTEXT = 256;
const TEST_TOKENS = 8;

/** What the native store says this launch loaded (EnginePackModule.getStatus). */
interface EnginePackStatus {
  bootPackId: string | null;
  trial: boolean;
  llamaBuild: number | null;
  /** The @ogai/llama.rn version of the pack this launch chose, or null. */
  engineVersion: string | null;
  /** The @ogai/llama.rn version this APK bundles. */
  bundledVersion: string;
  /** 'pack' or 'bundled' once llama.rn loaded its libraries. */
  source: 'pack' | 'bundled' | null;
  error: string | null;
  reactNative: string;
  /** The llama.rn Java/JS bridge hash this APK carries ('' when the package does not say). */
  bridge: string;
  abis: string[];
  /** The store's state.json: { active?, trial?, rejected?, packs? }. */
  state: string;
}

interface EnginePackNative {
  getStatus(): Promise<EnginePackStatus>;
  install(stagingDir: string, entryJson: string): Promise<string>;
  accept(id: string): Promise<void>;
  keepOnTrial(id: string): Promise<void>;
  reject(id: string, reason: string): Promise<void>;
  relaunch(): void;
}

function native(): EnginePackNative | null {
  return Platform.OS === 'android' ? ((NativeModules.EnginePack as EnginePackNative | undefined) ?? null) : null;
}

type TestOutcome = { passed: true } | { passed: false; reason: string } | { untested: true };

/** Load the smallest downloaded GGUF on the CPU and ask for a few tokens. */
async function testPrompt(): Promise<TestOutcome> {
  const model = useAppStore
    .getState()
    .downloadedModels.filter(m => !isLiteRTModel(m))
    .sort((a, b) => a.fileSize - b.fileSize)[0];
  if (!model) return { untested: true };
  const sizeMB = Math.ceil(model.fileSize / (1024 * 1024));
  return modelResidencyManager.runExclusive('verify:engine-pack', async () => {
    const room = await modelResidencyManager.makeRoomFor({ key: 'engine-pack-test', type: 'text', modelId: model.id, sizeMB });
    if (!room.fits) return { untested: true };
    let context: LlamaContext | null = null;
    try {
      context = await initLlama({ model: model.filePath, n_ctx: TEST_CONTEXT, n_gpu_layers: 0, use_mlock: false });
      const result = await context.completion({ prompt: TEST_PROMPT, n_predict: TEST_TOKENS, temperature: 0 });
      if (!result.text.trim()) return { passed: false, reason: `the test prompt on ${model.id} returned nothing` };
      return { passed: true };
    } catch (error) {
      return { passed: false, reason: `the test prompt on ${model.id} failed: ${(error as Error).message}` };
    } finally {
      if (context) await context.release();
    }
  });
}

/** Settle a pack on trial: rejected when it did not load or fails the test prompt, else accepted. */
async function settleTrial(engine: EnginePackNative, status: EnginePackStatus): Promise<void> {
  const id = status.trial ? status.bootPackId : null;
  if (!id) return;
  if (status.source !== 'pack') {
    // llama.rn already fell back to the bundled engine in this process.
    logger.warn(`[EnginePack] ${id} did not load: ${status.error ?? 'unknown'}`);
    await engine.reject(id, `did not load: ${status.error ?? 'unknown'}`);
    return;
  }
  const outcome = await testPrompt();
  if ('untested' in outcome) {
    // No model to test with, or no room now: it stays on trial and is tested on a later launch.
    logger.log(`[EnginePack] ${id} stays on trial: nothing to test it with yet`);
    await engine.keepOnTrial(id);
    return;
  }
  if (!outcome.passed) {
    logger.warn(`[EnginePack] ${id} rejected: ${outcome.reason}`);
    await engine.reject(id, outcome.reason);
    engine.relaunch(); // The pack's libraries leave only with the process.
    return;
  }
  logger.log(`[EnginePack] ${id} passed its test prompt`);
  await engine.accept(id);
}

/** Download, check and stage the newest pack; true when one is now on trial for the next launch. */
async function checkForUpdate(engine: EnginePackNative, status: EnginePackStatus, source: ManifestSource): Promise<boolean> {
  if (!source.publicKey) return false;
  const state = JSON.parse(status.state) as { rejected?: Record<string, string>; trial?: { id: string } };
  if (state.trial) return false; // One trial at a time.
  const [body, signature] = await Promise.all(
    [source.manifestUrl, `${source.manifestUrl}.sig`].map(async url => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      return res.text();
    }),
  );
  const pack = choosePack(verifyManifest(body, signature, source.publicKey), {
    reactNative: status.reactNative,
    bridge: status.bridge,
    abis: status.abis,
    currentVersion: status.source === 'pack' && status.engineVersion ? status.engineVersion : status.bundledVersion,
    rejected: new Set(Object.keys(state.rejected ?? {})),
  });
  if (!pack) return false;
  return stage(engine, pack);
}

async function stage(engine: EnginePackNative, pack: EnginePack): Promise<boolean> {
  const id = packId(pack);
  const zip = `${RNFS.CachesDirectoryPath}/engine-pack-${id}.zip`;
  const staging = `${RNFS.DocumentDirectoryPath}/engine-packs-staging/${id}`;
  try {
    const { statusCode } = await RNFS.downloadFile({ fromUrl: pack.url, toFile: zip }).promise;
    if (statusCode !== 200) throw new Error(`pack download answered ${statusCode}`);
    const hash = (await RNFS.hash(zip, 'sha256')).toLowerCase();
    if (hash !== pack.sha256) throw new Error('pack zip does not match its sha256');
    await removeIfPresent(staging); // left by an attempt the app was closed during
    await unzip(zip, staging);
    await engine.install(staging, JSON.stringify(pack));
    logger.log(`[EnginePack] ${id} (llama.cpp ${pack.llamaBuild}) is ready; it loads on the next launch`);
    return true;
  } finally {
    await removeIfPresent(zip);
    await removeIfPresent(staging);
  }
}

async function removeIfPresent(path: string): Promise<void> {
  if (await RNFS.exists(path)) await RNFS.unlink(path);
}

/**
 * How this phone's engine gets newer. The gap is data, not a platform branch in the UI: Android takes
 * signed packs over the air; iOS cannot load downloaded native code, so its engine updates with the app.
 */
export type EngineUpdatePath = 'over-the-air' | 'with-app';

export interface EngineUpdateInfo {
  path: EngineUpdatePath;
  /** The llama.cpp build this process runs. */
  llamaBuild: number | undefined;
  /** The @ogai/llama.rn version running, where the platform reports it. */
  version: string | null;
  source: 'pack' | 'bundled';
  /** When the app last looked for a newer pack (ms), or null if it never has. */
  lastCheck: number | null;
}

/** What Settings → Engine updates shows. Never throws: an unreadable store reads as the bundled engine. */
export async function getEngineUpdateInfo(): Promise<EngineUpdateInfo> {
  const engine = native();
  const llamaBuild = runningLlamaBuild();
  if (!engine) return { path: 'with-app', llamaBuild, version: null, source: 'bundled', lastCheck: null };
  const lastCheck = Number(await AsyncStorage.getItem(LAST_CHECK_KEY)) || null;
  try {
    const status = await engine.getStatus();
    const pack = status.source === 'pack';
    return {
      path: 'over-the-air', llamaBuild, lastCheck,
      version: pack && status.engineVersion ? status.engineVersion : status.bundledVersion,
      source: pack ? 'pack' : 'bundled',
    };
  } catch (error) {
    logger.warn('[EnginePack] status unavailable:', error);
    return { path: 'over-the-air', llamaBuild, version: null, source: 'bundled', lastCheck };
  }
}

/** What a check the person asked for found: a pack ready for the next launch, nothing newer, or a failure. */
export type EngineCheckOutcome = 'staged' | 'current' | 'failed' | 'off' | 'unsupported';

/** Settings → Engine updates → Check now: the daily check, at once. Never throws. */
export async function checkEngineUpdatesNow(
  { now = Date.now(), source = ENGINE_PACK_SOURCE }: { now?: number; source?: ManifestSource } = {},
): Promise<EngineCheckOutcome> {
  const engine = native();
  if (!engine) return 'unsupported';
  if (!useAppStore.getState().settings.engineUpdates) return 'off';
  try {
    await AsyncStorage.setItem(LAST_CHECK_KEY, String(now));
    const status = await engine.getStatus();
    if ((JSON.parse(status.state) as { trial?: unknown }).trial) return 'staged'; // one already waits for the next launch
    return (await checkForUpdate(engine, status, source)) ? 'staged' : 'current';
  } catch (error) {
    logger.warn('[EnginePack] check failed:', error);
    return 'failed';
  }
}

/** Where the signed manifest lives and the key it must verify against. */
export interface ManifestSource {
  manifestUrl: string;
  publicKey: string;
}

/**
 * After boot: settle a pack on trial, then (at most once a day) look for a newer one. Never throws;
 * whatever fails here, the engine that loaded keeps running.
 */
export async function startEnginePacks(
  { now = Date.now(), source = ENGINE_PACK_SOURCE }: { now?: number; source?: ManifestSource } = {},
): Promise<void> {
  const engine = native();
  if (!engine) return;
  try {
    await installJsi(); // llama.rn loads its libraries here, so the status says which ones.
    const status = await engine.getStatus();
    setLoadedPackBuild(status.source === 'pack' ? status.llamaBuild : null);
    // A pack already on trial is in this process: it is still tested, so a broken one never stays.
    await settleTrial(engine, status);
    // Engine updates off (Settings → Engine updates): nothing downloads or installs; an accepted pack stays in use.
    if (!useAppStore.getState().settings.engineUpdates) return;
    const last = Number(await AsyncStorage.getItem(LAST_CHECK_KEY)) || 0;
    if (now - last < CHECK_EVERY_MS) return;
    await AsyncStorage.setItem(LAST_CHECK_KEY, String(now));
    await checkForUpdate(engine, await engine.getStatus(), source);
  } catch (error) {
    logger.warn('[EnginePack] check failed:', error);
  }
}
