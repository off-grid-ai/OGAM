/**
 * The chat model on its way: the first chat model while it downloads, with no other chat model chosen.
 *
 * Half the people who started their first download left before it finished (PostHog, 2026-11-19):
 * the chat stayed shut until the model was on the phone. The model on its way counts as the chat
 * model, so the chat opens at once. A message sent before it arrives waits in the chat's queue and
 * goes when the model arrives: the download chooses it then (startModelDownload), and the chat drains
 * what waited for it.
 */
import { useMemo } from 'react';
import { modelDisplayName, splitGgufModelName } from '@offgrid/models';
import type { DownloadEntry, DownloadStatus } from '../utils/downloadStatus';
import { useDownloadStore } from '../stores/downloadStore';
import { useAppStore } from '../stores/appStore';
import { activeModelService } from './activeModelService';
import { isClassifierModel } from './classifierModel';
import { modelDownloadService } from './modelDownloadService';
import { uniformDownloadId } from './modelDownloadService/uniformId';

export interface ArrivingChatModel {
  /** The download's model key, which its controls route on. */
  key: string;
  modelId: string;
  /** The name a person knows the model by, never its file name. */
  name: string;
  /** 0..1 */
  progress: number;
  /** The download stopped with an error: it needs Retry before it can arrive. */
  failed: boolean;
}

/** Statuses after which the model will not arrive on its own. A failed download can still be retried. */
const GONE: ReadonlySet<DownloadStatus> = new Set(['completed', 'cancelled']);

function nameOf(entry: DownloadEntry): string {
  const file = entry.fileName.replace(/\.(pte|litertlm|task|zip|tar)$/i, '');
  return modelDisplayName(file) ?? splitGgufModelName(file).replace(/\.(gguf|bin|onnx)$/i, '');
}

/**
 * The rule: with no chat model chosen, the chat model download in flight (the newest one, a running
 * one before a failed one). Null when a chat model is chosen or none is on its way.
 */
export function arrivingChatModel(
  downloads: Readonly<Record<string, DownloadEntry>>,
  activeModelId: string | null,
  classifierModelId?: string | null,
): ArrivingChatModel | null {
  if (activeModelId !== null) return null;
  const candidates = Object.values(downloads)
    .filter(entry => entry.modelType === 'text' && !GONE.has(entry.status)
      && !isClassifierModel(entry.modelId, classifierModelId))
    .sort((a, b) => Number(a.status === 'failed') - Number(b.status === 'failed') || b.createdAt - a.createdAt);
  const entry = candidates[0];
  if (!entry) return null;
  return {
    key: entry.modelKey,
    modelId: entry.modelId,
    name: nameOf(entry),
    progress: Math.min(1, Math.max(0, entry.progress ?? 0)),
    failed: entry.status === 'failed',
  };
}

/** The chat model on its way, now. */
export function currentArrivingChatModel(): ArrivingChatModel | null {
  const app = useAppStore.getState();
  return arrivingChatModel(useDownloadStore.getState().downloads, app.activeModelId, app.settings.classifierModelId);
}

/** The chat model on its way, live. */
export function useArrivingChatModel(): ArrivingChatModel | null {
  const downloads = useDownloadStore(s => s.downloads);
  const activeModelId = useAppStore(s => s.activeModelId);
  const classifierModelId = useAppStore(s => s.settings.classifierModelId);
  return useMemo(
    () => arrivingChatModel(downloads, activeModelId, classifierModelId),
    [downloads, activeModelId, classifierModelId],
  );
}

/**
 * A chat model is already on hand: chosen, on the phone, or on its way (a bundled model pack, or a
 * download started earlier). With none chosen, the one on the phone is chosen: the last pick when it
 * is still here, else the first chat model. Setup's Start chatting then opens the chat for it, rather
 * than download a second model.
 */
export function takeChatModelOnHand(): boolean {
  const app = useAppStore.getState();
  if (app.activeModelId !== null || currentArrivingChatModel()) return true;
  const chatModels = app.downloadedModels.filter(model => !isClassifierModel(model.id, app.settings.classifierModelId));
  const model = chatModels.find(item => item.id === app.lastTextModelId) ?? chatModels[0];
  if (!model) return false;
  activeModelService.selectTextModel(model.id);
  return true;
}

/** Start a stopped download of the chat model on its way again. */
export function retryArrivingChatModel(model: ArrivingChatModel): Promise<void> {
  return modelDownloadService.retry(uniformDownloadId('text', model.key));
}

/**
 * What the chat does with messages that wait for the first chat model:
 *  - 'send' once a chat model is chosen (the download chose it on arrival),
 *  - 'release' when the download is gone with no model (cancelled or removed): they wait for the
 *    model the person picks instead, like any message sent with no model,
 *  - 'wait' while the model is on its way.
 */
export function waitingMessagesStep(
  waiting: boolean,
  hasChatModel: boolean,
  arriving: ArrivingChatModel | null,
): 'send' | 'release' | 'wait' | 'none' {
  if (!waiting) return 'none';
  if (hasChatModel) return 'send';
  return arriving ? 'wait' : 'release';
}
