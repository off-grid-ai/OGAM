/**
 * The bundled chat model on its way: Play's AI packs land it on the phone right after install, so the
 * first chat need not wait for a model chosen and downloaded later (first reply within 7 days: 35%).
 *
 * While the packs download, the model shows as one download row, the same row the regular downloader
 * would publish (same model key). So the chat opens at once with the model on its way
 * (arrivingChatModel), onboarding sees a chat model coming, and the regular downloader's duplicate guard
 * starts no second copy. When the packs arrive, their files come into the models folder (a rename on
 * Android; a copy out of the system's storage on iOS) and the model registers and is chosen exactly as a finished download is
 * (startModelDownload). If the packs stop, Retry runs the regular download: that path stays the fallback
 * everywhere. With no packs at all, a fresh install runs that regular download of the same model at once.
 */
import RNFS from 'react-native-fs';
import { useAppStore } from '../../stores';
import { useDownloadStore } from '../../stores/downloadStore';
import { makeModelKey } from '../../utils/modelKey';
import logger from '../../utils/logger';
import { modelManager } from '../modelManager';
import { mmProjLocalName } from '../modelManager/download';
import { buildDownloadedModel, persistDownloadedModel } from '../modelManager/storage';
import { rememberStart } from '../queuedStarts';
import { selectArrivedChatModel, startModelDownload } from '../startModelDownload';
import type { DownloadedModel } from '../../types';
import { BUNDLED_MODEL, BUNDLED_PACKS, bundledModelFile } from './model';
import { bundledModelPort, type BundledModelPort, type PackState } from './port';
import { asksForPacks, bundledModelState, type BundledModelState } from './rule';


const SIZES = { [BUNDLED_MODEL.weights.pack]: BUNDLED_MODEL.weights.sizeBytes, [BUNDLED_MODEL.mmproj.pack]: BUNDLED_MODEL.mmproj.sizeBytes };
const MODEL_KEY = makeModelKey(BUNDLED_MODEL.modelId, BUNDLED_MODEL.weights.name);
const DOWNLOAD_ID = `bundled-pack:${MODEL_KEY}`;
const REGISTERED_ID = `${BUNDLED_MODEL.modelId}/${BUNDLED_MODEL.weights.name}`;
const LOCAL_MMPROJ = mmProjLocalName(BUNDLED_MODEL.weights.name, BUNDLED_MODEL.mmproj.name);

let running: Promise<void> | null = null;

/** Once per launch, after the download store has hydrated: adopt the packs, or follow them in. */
export function startBundledModel(port: BundledModelPort = bundledModelPort): Promise<void> {
  running ??= follow(port).catch(err => {
    logger.error('[BundledModel] start failed', err);
  });
  return running;
}

/** @public For tests: forget this launch's run. */
export function resetBundledModelForTests(): void {
  running = null;
}

async function follow(port: BundledModelPort): Promise<void> {
  if (useAppStore.getState().downloadedModels.some(model => model.id === REGISTERED_ID)) {
    // Already in the library (an earlier launch moved it, or the regular download fetched it).
    await Promise.all(BUNDLED_PACKS.map(name => port.removePack(name)));
    return;
  }
  // Listen before asking, so a pack that lands while the ask is answered is not missed.
  const early: PackState[] = [];
  let onState: (state: PackState) => void = state => { early.push(state); };
  const stop = port.onPack(state => onState(state));
  try {
    const packs: Record<string, PackState> = { ...(await port.getPacks(BUNDLED_PACKS)) };
    // One ask per launch. A build with no packs refuses it, and stays absent.
    if (asksForPacks(packs, BUNDLED_PACKS)) {
      Object.assign(packs, await port.fetch(BUNDLED_PACKS).catch(err => {
        logger.log('[BundledModel] no packs to fetch; the regular download serves', err);
        return {};
      }));
    }
    for (const state of early.splice(0)) packs[state.name] = state;
    if (await settle(port, bundledModelState(packs, BUNDLED_PACKS, SIZES))) return;
    await new Promise<void>(resolve => {
      onState = state => {
        packs[state.name] = state;
        settle(port, bundledModelState(packs, BUNDLED_PACKS, SIZES)).then(done => {
          if (done) resolve();
        }, err => { logger.error('[BundledModel] pack update failed', err); resolve(); });
      };
      // Anything that came in while the first answer was shown.
      early.splice(0).forEach(onState);
    });
  } finally {
    stop();
  }
}

/** Shows `state` to the person; true once nothing more will happen this launch. */
async function settle(port: BundledModelPort, state: BundledModelState): Promise<boolean> {
  switch (state.kind) {
    case 'absent':
      startWithoutPacks();
      return true;
    case 'arrived':
      await adopt(port, state.paths);
      return true;
    case 'arriving':
      showRow(state.waitsForWifi ? 'waiting_for_network' : 'running', state.bytes, state.total);
      return false;
    case 'stopped':
      showRow('failed', state.bytes, state.total);
      return true;
  }
}

/**
 * No packs come with this install (an APK from GitHub, F-Droid, iOS before 26): a fresh install fetches
 * the same model itself at first open, so the first chat is the one a store install gets. Not for a phone
 * that already finished onboarding or holds a model: an update never starts a download on its own.
 */
function startWithoutPacks(): void {
  const app = useAppStore.getState();
  if (app.hasCompletedOnboarding || app.downloadedModels.length > 0) return;
  if (useDownloadStore.getState().downloads[MODEL_KEY]) return;
  startModelDownload(BUNDLED_MODEL.modelId, bundledModelFile(), { autoSelectIfEmpty: true }).catch(err => {
    logger.error('[BundledModel] download without packs failed to start', err);
  });
}

function showRow(status: 'running' | 'waiting_for_network' | 'failed', bytes: number, total: number): void {
  const downloads = useDownloadStore.getState();
  const existing = downloads.downloads[MODEL_KEY];
  // The regular downloader already fetches this model: that row is the one to follow.
  if (existing && existing.downloadId !== DOWNLOAD_ID) return;
  if (!existing) {
    downloads.add({
      modelKey: MODEL_KEY,
      downloadId: DOWNLOAD_ID,
      modelId: BUNDLED_MODEL.modelId,
      fileName: BUNDLED_MODEL.weights.name,
      quantization: BUNDLED_MODEL.quantization,
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 0,
      totalBytes: BUNDLED_MODEL.weights.sizeBytes,
      combinedTotalBytes: total,
      progress: 0,
      createdAt: Date.now(),
      mmProjFileName: LOCAL_MMPROJ,
      mmProjFileSize: BUNDLED_MODEL.mmproj.sizeBytes,
    });
    // Retry of a stopped pack is the regular download of the same model.
    rememberStart(MODEL_KEY, () => startModelDownload(BUNDLED_MODEL.modelId, bundledModelFile(), { autoSelectIfEmpty: true }));
  }
  useDownloadStore.getState().updateProgress(DOWNLOAD_ID, bytes, total);
  if (status === 'failed') {
    useDownloadStore.getState().setStatus(DOWNLOAD_ID, 'failed', { message: 'The download stopped. Retry downloads it again.', code: 'pack_stopped' });
  } else {
    useDownloadStore.getState().setStatus(DOWNLOAD_ID, status);
  }
}

async function bringInto(port: BundledModelPort, dir: string, from: string, name: string): Promise<string> {
  const to = `${dir}/${name}`;
  if (await RNFS.exists(to)) await RNFS.unlink(to);
  if (port.canMoveFiles) await RNFS.moveFile(from, to);
  else await RNFS.copyFile(from, to);
  return to;
}

async function adopt(port: BundledModelPort, paths: Record<string, string>): Promise<void> {
  await modelManager.initialize();
  const dir = modelManager.getModelsDirectory();
  const { weights, mmproj, modelId } = BUNDLED_MODEL;
  const weightsPath = await bringInto(port, dir, `${paths[weights.pack]}/${weights.name}`, weights.name);
  const mmProjPath = await bringInto(port, dir, `${paths[mmproj.pack]}/${mmproj.name}`, LOCAL_MMPROJ);
  const model: DownloadedModel = await buildDownloadedModel({
    modelId, file: bundledModelFile(), resolvedLocalPath: weightsPath, mmProjPath,
  });
  await persistDownloadedModel(model, dir);
  useAppStore.getState().addDownloadedModel(model);
  selectArrivedChatModel(model);
  const row = useDownloadStore.getState().downloads[MODEL_KEY];
  if (row?.downloadId === DOWNLOAD_ID) useDownloadStore.getState().remove(MODEL_KEY);
  await Promise.all(BUNDLED_PACKS.map(name => port.removePack(name)));
  logger.log(`[BundledModel] ${modelId} arrived with the app`);
}
