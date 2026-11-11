import type { TextRuntimeInfo } from './activeModelService/types';

export type ModelRuntimeDisplay = {
  compact: string;
  detail: string;
  state: TextRuntimeInfo['state'] | 'remote';
};

function formatContext(n?: number): string | null {
  if (!n || n <= 0) return null;
  if (n >= 1024) {
    const k = n / 1024;
    return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}K context`;
  }
  return `${n} context`;
}

function formatLoadTime(ms?: number | null): string | null {
  if (ms == null || ms < 0) return null;
  if (ms < 1000) return `loaded in ${Math.max(1, Math.round(ms))} ms`;
  return `loaded in ${(ms / 1000).toFixed(1)} s`;
}

export function formatTextRuntimeStatus(info: TextRuntimeInfo): ModelRuntimeDisplay {
  if (info.state === 'none') {
    return { compact: 'Models', detail: 'No local text model selected.', state: 'none' };
  }

  if (info.state === 'loading') {
    return {
      compact: 'Loading AI…',
      detail: `Loading ${info.modelName || 'the selected model'} into memory. The model is not ready yet.`,
      state: 'loading',
    };
  }

  if (info.state === 'evicted') {
    return {
      compact: 'Selected · unloaded',
      detail: `${info.modelName || 'The selected model'} was unloaded to free RAM and will reload on the next message.`,
      state: 'evicted',
    };
  }

  if (info.state === 'selected') {
    return {
      compact: 'Selected · not loaded',
      detail: `${info.modelName || 'The selected model'} is selected but is not resident in RAM yet. It loads when needed.`,
      state: 'selected',
    };
  }

  const backend = info.backend || 'Unknown';
  const compact = `Loaded · ${backend}`;
  const details: string[] = [];
  if (info.backendDetail && info.backendDetail !== backend) details.push(`${backend} (${info.backendDetail})`);
  else details.push(backend);
  if (typeof info.gpuLayers === 'number' && info.gpuLayers > 0) details.push(`${info.gpuLayers} layers offloaded`);
  const ctx = formatContext(info.contextLength);
  if (ctx) details.push(ctx);
  if (info.quantization) details.push(info.quantization);
  const load = formatLoadTime(info.loadDurationMs);
  if (load) details.push(load);
  if (info.fallbackNotice) details.push(info.fallbackNotice);

  return {
    compact,
    detail: details.join(' · '),
    state: 'loaded',
  };
}

export function formatRemoteRuntimeStatus(modelName?: string): ModelRuntimeDisplay {
  return {
    compact: 'Remote · connected',
    detail: `${modelName || 'Remote model'} runs on the connected server, not in this device's local RAM.`,
    state: 'remote',
  };
}
