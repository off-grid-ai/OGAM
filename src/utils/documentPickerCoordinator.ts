import { useEffect, useState } from 'react';
import { pick } from '@react-native-documents/picker';
import logger from './logger';

type PickerOptions = Parameters<typeof pick>[0];
type PickerResult = Awaited<ReturnType<typeof pick>>;
type ActivePickerRequest = { id: number; source: string; startedAt: number };

const PICKER_WATCHDOG_MS = 10000;
const PICKER_STALE_RESET_MS = 15000;

let pickerRequestSeq = 0;
let globalPickerRequest: ActivePickerRequest | null = null;
let globalPickerWatchdog: ReturnType<typeof setTimeout> | null = null;
const pickerStateListeners = new Set<(request: ActivePickerRequest | null) => void>();

const notifyPickerState = () => {
  pickerStateListeners.forEach(listener => listener(globalPickerRequest));
};

const subscribePickerState = (listener: (request: ActivePickerRequest | null) => void) => {
  pickerStateListeners.add(listener);
  listener(globalPickerRequest);
  return () => {
    pickerStateListeners.delete(listener);
  };
};

const clearPickerWatchdog = () => {
  if (globalPickerWatchdog) {
    clearTimeout(globalPickerWatchdog);
    globalPickerWatchdog = null;
  }
};

const resetGlobalPickerRequest = (reason: string) => {
  const staleRequest = globalPickerRequest;
  clearPickerWatchdog();
  globalPickerRequest = null;
  notifyPickerState();
  logger.warn('[DocumentPicker]', 'picker-lock-reset', {
    reason,
    requestId: staleRequest?.id ?? null,
    source: staleRequest?.source ?? null,
    durationMs: staleRequest ? Date.now() - staleRequest.startedAt : null,
  });
};

const startPickerWatchdog = (request: ActivePickerRequest) => {
  if (globalPickerWatchdog) clearTimeout(globalPickerWatchdog);
  globalPickerWatchdog = setTimeout(() => {
    if (!globalPickerRequest || globalPickerRequest.id !== request.id) return;
    logger.warn('[DocumentPicker]', 'picker-watchdog-timeout', {
      requestId: request.id,
      source: request.source,
      durationMs: Date.now() - request.startedAt,
    });
    resetGlobalPickerRequest('watchdog-timeout');
  }, PICKER_WATCHDOG_MS);
};

const maybeResetStalePicker = (reason: string) => {
  if (!globalPickerRequest) return;
  const durationMs = Date.now() - globalPickerRequest.startedAt;
  if (durationMs >= PICKER_STALE_RESET_MS) {
    resetGlobalPickerRequest(reason);
  }
};

export const pickDocumentWithCoordinator = async (
  source: string,
  options: PickerOptions,
): Promise<PickerResult | null> => {
  maybeResetStalePicker('stale-before-new-request');

  if (globalPickerRequest) {
    logger.warn('[DocumentPicker]', 'picker-blocked-busy', {
      source,
      activeRequest: `${globalPickerRequest.source}#${globalPickerRequest.id}`,
      durationMs: Date.now() - globalPickerRequest.startedAt,
    });
    return null;
  }

  const requestId = ++pickerRequestSeq;
  const request = { id: requestId, source, startedAt: Date.now() };
  globalPickerRequest = request;
  notifyPickerState();
  startPickerWatchdog(request);

  try {
    return await pick(options);
  } finally {
    clearPickerWatchdog();
    if (globalPickerRequest?.id === requestId) {
      globalPickerRequest = null;
      notifyPickerState();
    }
  }
};

export const useDocumentPickerActive = () => {
  const [isDocumentPickerActive, setIsDocumentPickerActive] = useState(Boolean(globalPickerRequest));

  useEffect(() => subscribePickerState((request) => {
    setIsDocumentPickerActive(Boolean(request));
  }), []);

  return isDocumentPickerActive;
};

export const __resetDocumentPickerCoordinatorForTests = () => {
  clearPickerWatchdog();
  globalPickerRequest = null;
  notifyPickerState();
};
