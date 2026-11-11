/**
 * A short, plain-text summary of this phone and how Atlas is running on it, to copy and paste when something is slow or
 * broken: no chats, no file names, no keys, nothing personal. The text builder is pure (tested); the gatherer reads the app.
 */
export interface DiagnosticsInput {
  app: string;
  device: { model: string; os: string; ramGB: number; freeGB: number; soc: string; cores: number; fastThreads: number };
  gpus: string[];
  settings: { backend: string; threads: number | 'auto'; context: number; gpuLayers: number; flashAttn: boolean; cache: string; warmUp: boolean };
  model: { name: string; engine: string; sizeMB: number; quant?: string; loadSeconds?: number } | null;
  running: { gpu: boolean; backend: string; layers: string; threads?: number } | null;
  speed: { decode: number; prefill: number; replies: number } | null;
  tuned: boolean;
  lastCall: string | null;
  /** The llama.rn version and what the first-reply check found for each GPU setting tried (see services/outputHealth.ts). */
  llamaRn?: string;
  gpuChecks?: string[];
}

const num = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '?');

export function formatDiagnostics(d: DiagnosticsInput): string {
  const lines = [
    `Atlas ${d.app}`,
    `Device: ${d.device.model}, ${d.device.os}, ${num(d.device.ramGB)} GB RAM (${num(d.device.freeGB)} GB free), ${d.device.soc}`,
    `CPU: ${d.device.cores} cores, ${d.device.fastThreads} fast`,
    `GPU: ${d.gpus.length ? d.gpus.join('; ') : 'none found'}`,
    `Settings: backend ${d.settings.backend}, threads ${d.settings.threads}, context ${d.settings.context}, GPU layers ${d.settings.gpuLayers}, flash attention ${d.settings.flashAttn ? 'on' : 'off'}, KV cache ${d.settings.cache}, warm-up ${d.settings.warmUp ? 'on' : 'off'}`,
  ];
  if (d.model) {
    lines.push(`Model: ${d.model.name} (${d.model.engine}${d.model.quant ? `, ${d.model.quant}` : ''}, ${Math.round(d.model.sizeMB)} MB)${d.model.loadSeconds != null ? `, loaded in ${num(d.model.loadSeconds)} s` : ''}`);
    lines.push(d.running
      ? `Running on: ${d.running.backend}${d.running.gpu ? ` (GPU layers ${d.running.layers})` : ''}${d.running.threads ? `, ${d.running.threads} threads` : ''}`
      : 'Running on: model not loaded');
    lines.push(d.speed ? `Speed: writes ${num(d.speed.decode)} tok/s, reads ${d.speed.prefill ? `${Math.round(d.speed.prefill)} tok/s` : 'not measured'} (${d.speed.replies} replies)${d.tuned ? ', settings tuned' : ''}` : 'Speed: not measured yet');
  } else {
    lines.push('Model: none selected');
  }
  if (d.llamaRn) lines.push(`llama.rn: ${d.llamaRn}`);
  if (d.gpuChecks?.length) lines.push('GPU output checks:', ...d.gpuChecks.map((c) => `  ${c}`));
  lines.push(`Last call: ${d.lastCall ?? 'none yet'}`);
  return lines.join('\n');
}

/** Reads everything from the running app; any piece that cannot be read is left out rather than failing the copy. */
export async function gatherDiagnostics(): Promise<string> {
  const { Platform } = require('react-native');
  const { appVersionLabel } = require('../utils/appVersion');
  const { hardwareService } = require('../services/hardware');
  const { useAppStore } = require('../stores/appStore');
  const { llmService } = require('../services/llm');
  const { vulkanEngine } = require('../services/vulkanEngine');
  const { useSpeedStats, useTuned } = require('./speed');
  const { lastCallTiming } = require('../atlasVoice/turnTiming');
  const safe = async <T,>(fn: () => Promise<T> | T, fallback: T): Promise<T> => { try { return await fn(); } catch { return fallback; } };

  const st = useAppStore.getState();
  const [info, soc, cores, fast, vk] = await Promise.all([
    safe(() => hardwareService.getDeviceInfo(), null as any),
    safe(() => hardwareService.getSoCInfo(), null as any),
    safe(() => hardwareService.getCpuCoreCount(), 0),
    safe(() => hardwareService.getRecommendedThreadCount(), 0),
    safe(() => vulkanEngine.runtimeStatus(), { devices: [] } as any),
  ]);
  const s = st.settings;
  const active = st.downloadedModels.find((m: any) => m.id === st.activeModelId);
  const gpuInfo = safe(() => llmService.getGpuInfo(), null as any);
  const perf = await safe(() => llmService.getPerformanceSettings(), null as any);
  const speed = active ? useSpeedStats.getState().byModel[active.id] : undefined;
  let loadSeconds: number | undefined;
  try { const ms = require('../services/activeModelService/runtimeInfo').getTextRuntimeInfo(active?.id ?? null, false)?.loadDurationMs; if (ms) loadSeconds = ms / 1000; } catch { /* not loaded yet */ }
  const g = await gpuInfo;

  return formatDiagnostics({
    app: appVersionLabel(),
    device: {
      model: info?.deviceModel ?? 'unknown', os: `${info?.systemName ?? Platform.OS} ${info?.systemVersion ?? ''}`.trim(),
      ramGB: (info?.totalMemory ?? 0) / 1024 ** 3, freeGB: (info?.availableMemory ?? 0) / 1024 ** 3,
      soc: soc ? `${soc.vendor}${soc.hasNPU ? ', NPU' : ''}` : 'unknown', cores, fastThreads: fast,
    },
    gpus: (vk?.devices ?? []).map((d: any) => [d.name, d.description].filter(Boolean).join(' ')),
    settings: { backend: s.inferenceBackend, threads: s.nThreads ? s.nThreads : 'auto', context: s.contextLength, gpuLayers: s.gpuLayers, flashAttn: !!s.flashAttn, cache: s.cacheType, warmUp: !!s.warmUpAfterLoad },
    model: active ? { name: active.name, engine: active.engine ?? 'llama', sizeMB: (active.fileSize ?? 0) / 1024 ** 2, quant: active.quantization, loadSeconds } : null,
    running: active && llmService.isModelLoaded?.() && g ? { gpu: g.gpu, backend: g.gpuBackend || (g.gpu ? 'GPU' : 'CPU'), layers: `${g.gpuLayers}/${g.totalLayers ?? '?'}`, threads: perf?.nThreads } : null,
    speed: speed ? { decode: speed.decode, prefill: speed.prefill, replies: speed.samples } : null,
    tuned: !!(active && useTuned.getState().at[active.id]),
    lastCall: lastCallTiming(),
    llamaRn: await safe(() => require('llama.rn/package.json').version as string, undefined),
    gpuChecks: await safe(() => require('../services/outputHealth').describeVerdicts() as Promise<string[]>, []),
  });
}
