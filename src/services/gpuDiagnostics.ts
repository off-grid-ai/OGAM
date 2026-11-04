/**
 * "Test GPU on this model": loads one model the way the app would and checks that it writes language, once per setting
 * that could matter on a phone GPU, and says which ones work. It exists because a model can load and report success while
 * the GPU computes noise (Gemma 4 12B on OpenCL answered "hi" with <unusedN> tokens), and which layer count or setting
 * avoids it can only be found on the phone itself.
 *
 * Every step: 2,048-token context, a small batch, an f16 KV cache, MTP off, the model loaded by the real loader (so the
 * same memory checks, backend selection and output check apply), then one deterministic reply judged by outputHealth.
 * Settings are restored afterwards. The picture check runs last, on the best working step, with the model's own projector.
 */
import RNFS from 'react-native-fs';
import { useAppStore } from '../stores/appStore';
import { INFERENCE_BACKENDS, type Message } from '../types';
import type { LlamaDownloadedModel } from '../types';
import { llmService } from './llm';
import { forgetVerdicts, formatOutputReport, judgeText, type OutputCheck } from './outputHealth';
import logger from '../utils/logger';

export interface SweepSetting { label: string; backend: 'cpu' | 'opencl'; gpuLayers: number; flashAttn: boolean }
export interface SweepStep { setting: SweepSetting; ok: boolean; loadSeconds: number; error?: string; check?: OutputCheck }
export interface SweepResult { steps: SweepStep[]; vision?: { ok: boolean; reply: string; error?: string }; report: string; best?: SweepSetting }

export const DEFAULT_SWEEP_LAYERS = [24, 16, 8];

/** The settings tried: the CPU as the reference, then each GPU layer count with flash attention on (the app's default) and off. */
export function sweepSettings(layers: number[] = DEFAULT_SWEEP_LAYERS): SweepSetting[] {
  const settings: SweepSetting[] = [{ label: 'CPU only (0 GPU layers)', backend: 'cpu', gpuLayers: 0, flashAttn: false }];
  for (const n of layers) {
    settings.push({ label: `OpenCL GPU, ${n} layers, flash attention on`, backend: 'opencl', gpuLayers: n, flashAttn: true });
    settings.push({ label: `OpenCL GPU, ${n} layers, flash attention off`, backend: 'opencl', gpuLayers: n, flashAttn: false });
  }
  return settings;
}

/** A solid red 224x224 picture, for asking a vision model what colour it sees. */
const RED_SQUARE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAOAAAADgCAIAAACVT/22AAABr0lEQVR42u3SAQkAAAzDsImYf2UXcxs/BKKgNNPCWZEAg4JBMSgYFAyKQcGgGBQMCgbFoGBQDAoGBYNiUDAoBgWDgkExKBgUg6qAQcGgGBQMCgbFoGBQDAoGBYNiUDAoBgWDgkExKBgUg4JBwaAYFAyKQVXAoGBQDAoGBYNiUDAoBgWDgkExKBgUg4JBwaAYFAyKQcGgYFAMCgbFoGBQMCgGBYOCQTEoGBSDgkHBoBgUDIpBwaBgUAwKBsWgYFAwKAYFg2JQMCgYFIOCQcGgGBQMikHBoGBQDAoGxaBgUDAoBgWDYlAwKBgUg4JBMSgYFAyKQcGgYFAMCgbFoGBQMCgGBYNiUDAoGBSDgkExKBgUDIpBwaAYFAwKBsWgYFAwKAYFg2JQMCgYFIOCQTEoGBQMikHBoBgUDAoGxaBgUAwKBgWDYlAwKBgUg4JBMSgYFAyKQcGgGBQMCgbFoGBQDAoGBYNiUDAoBgWDgkExKBgUDIpBwaAYFAwKBsWgYFAMCgYFg2JQMCgGBYOCQTEoGBSDgkHBoBgUDAoGxaBgUAwKBgWDYlAwKAYFg4JB+WgBgzMbqihZzw0AAAAASUVORK5CYII=';

async function checkPicture(model: LlamaDownloadedModel): Promise<SweepResult['vision']> {
  const path = `${RNFS.CachesDirectoryPath}/atlas-vision-test.png`;
  try {
    await RNFS.writeFile(path, RED_SQUARE_PNG, 'base64');
    if (!llmService.supportsVision()) return { ok: false, reply: '', error: 'the picture file did not load with this model, so it cannot see pictures' };
    const message: Message = {
      id: 'vision-test', role: 'user', content: 'What colour is this picture? Answer with one word.', timestamp: Date.now(),
      attachments: [{ id: 'vision-test-image', type: 'image', uri: `file://${path}` }],
    } as Message;
    const reply = await llmService.generateResponse([message]);
    const bad = judgeText(reply);
    return { ok: !bad && /red/i.test(reply), reply: reply.slice(0, 120), error: bad || (/red/i.test(reply) ? undefined : 'it did not name the colour (red)') };
  } catch (e: any) {
    return { ok: false, reply: '', error: String(e?.message || e) };
  } finally {
    RNFS.unlink(path).catch(() => undefined);
  }
}

/**
 * Runs the sweep. `shouldStop` is polled between steps (the person pressed Stop). `onProgress` gets a line per event for the screen.
 * The model that was loaded before is not reloaded: the person's own load happens when they next use it.
 */
export async function runModelSweep(model: LlamaDownloadedModel, opts: { layers?: number[]; onProgress?: (line: string) => void; shouldStop?: () => boolean } = {}): Promise<SweepResult> {
  const say = (line: string) => { logger.log(`[GPU-TEST] ${line}`); opts.onProgress?.(line); };
  const store = useAppStore.getState();
  const saved = { ...store.settings };
  const steps: SweepStep[] = [];
  const projector = model.mmProjPath && await RNFS.exists(model.mmProjPath) ? model.mmProjPath : undefined;
  let best: SweepSetting | undefined;
  try {
    await forgetVerdicts(model.filePath);
    await llmService.unloadModel();
    for (const setting of sweepSettings(opts.layers)) {
      if (opts.shouldStop?.()) { say('Stopped.'); break; }
      say(`Trying: ${setting.label}`);
      useAppStore.getState().updateSettings({
        inferenceBackend: setting.backend === 'cpu' ? INFERENCE_BACKENDS.CPU : INFERENCE_BACKENDS.OPENCL,
        gpuLayers: setting.gpuLayers, flashAttn: setting.flashAttn, cacheType: 'f16', contextLength: 2048, nBatch: 128, useMtp: false,
      } as any);
      const started = Date.now();
      const step: SweepStep = { setting, ok: false, loadSeconds: 0 };
      try {
        await llmService.loadModel(model.filePath, undefined, { override: true });
        step.loadSeconds = Number(((Date.now() - started) / 1000).toFixed(1));
        step.check = llmService.getLastOutputCheck() ?? await llmService.runOutputCheck() ?? undefined;
        step.ok = !!step.check?.ok;
        if (!step.ok) step.error = step.check?.reason;
      } catch (e: any) {
        step.loadSeconds = Number(((Date.now() - started) / 1000).toFixed(1));
        step.error = String(e?.message || e);
        step.check = llmService.getLastOutputCheck() ?? undefined;
      }
      steps.push(step);
      say(`  ${step.ok ? 'works' : 'FAILED'}: ${step.ok ? `"${step.check?.text.trim().slice(0, 60)}" at ${step.check?.tokensPerSecond} tok/s, first word after ${step.check?.firstTokenMs} ms` : step.error}`);
      if (step.ok && !best && setting.backend === 'opencl') best = setting;
      await llmService.unloadModel();
    }
    let vision: SweepResult['vision'];
    if (projector && !opts.shouldStop?.()) {
      const target = best ?? steps.find((s) => s.ok)?.setting;
      if (target) {
        say(`Picture check with the projector, on: ${target.label}`);
        useAppStore.getState().updateSettings({
          inferenceBackend: target.backend === 'cpu' ? INFERENCE_BACKENDS.CPU : INFERENCE_BACKENDS.OPENCL,
          gpuLayers: target.gpuLayers, flashAttn: target.flashAttn, cacheType: 'f16', contextLength: 2048, nBatch: 128, useMtp: false,
        } as any);
        try {
          await llmService.loadModel(model.filePath, projector, { override: true });
          vision = await checkPicture(model);
        } catch (e: any) { vision = { ok: false, reply: '', error: String(e?.message || e) }; }
        say(`  ${vision?.ok ? `works: "${vision.reply}"` : `FAILED: ${vision?.error}`}`);
        await llmService.unloadModel();
      }
    }
    return { steps, vision, best, report: formatSweepReport(model, steps, vision) };
  } finally {
    useAppStore.getState().updateSettings(saved as any);
  }
}

export function formatSweepReport(model: Pick<LlamaDownloadedModel, 'fileName'>, steps: SweepStep[], vision?: SweepResult['vision']): string {
  const lines = [`GPU test for ${model.fileName}`, 'Each step: 2,048-token context, batch 128, f16 KV cache, MTP off.'];
  for (const s of steps) {
    lines.push(`- ${s.setting.label}: ${s.ok ? 'OK' : 'FAILED'} (load ${s.loadSeconds}s)${s.error ? ` - ${s.error}` : ''}`);
    if (s.check) lines.push(formatOutputReport(s.check, {}).split('\n').map((l) => `    ${l}`).join('\n'));
  }
  if (vision) lines.push(`- Picture check: ${vision.ok ? 'OK' : 'FAILED'}${vision.error ? ` - ${vision.error}` : ''}${vision.reply ? ` (reply: ${JSON.stringify(vision.reply)})` : ''}`);
  const working = steps.filter((s) => s.ok && s.setting.backend === 'opencl');
  lines.push(working.length ? `Working GPU settings: ${working.map((s) => s.setting.label).join('; ')}` : 'No GPU setting produced correct text on this phone for this model. Use the CPU.');
  return lines.join('\n');
}
