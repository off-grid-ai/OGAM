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
import { describeFileVerdict, judgeFile } from './knownModelFiles';
import { describeAgainstExpected, resolveExpected, type Expected } from './expectedChecksum';
import logger from '../utils/logger';

export interface SweepSetting { label: string; backend: 'cpu' | 'opencl'; gpuLayers: number; flashAttn: boolean; cpuRepack?: boolean; nBatch?: number; mtp?: boolean }
export interface SweepStep { setting: SweepSetting; ok: boolean; loadSeconds: number; error?: string; check?: OutputCheck; note?: string; scan?: string[] }
export interface SweepResult { steps: SweepStep[]; files: string[]; vision?: { ok: boolean; reply: string; error?: string }; report: string; best?: SweepSetting }

export const DEFAULT_SWEEP_LAYERS = [24, 16, 8];

/**
 * The settings tried. The CPU first, three ways: the app's own settings, with the ARM-optimized weight kernels off, and with the
 * larger batch a computer run uses (a computer decodes this file correctly, so a CPU failure that only some of these show
 * points at the phone's kernels; one that all show points at the file). Then each GPU layer count. OpenCL always runs with
 * flash attention off in Atlas, so there is no on/off pair.
 */
export function sweepSettings(layers: number[] = DEFAULT_SWEEP_LAYERS, opts: { mtp?: boolean } = {}): SweepSetting[] {
  const settings: SweepSetting[] = [
    { label: 'CPU only, the app\'s usual settings', backend: 'cpu', gpuLayers: 0, flashAttn: false },
    { label: 'CPU only, optimized ARM kernels off', backend: 'cpu', gpuLayers: 0, flashAttn: false, cpuRepack: false },
    { label: 'CPU only, batch 512 (as on the computer)', backend: 'cpu', gpuLayers: 0, flashAttn: false, nBatch: 512 },
  ];
  for (const n of layers) settings.push({ label: `OpenCL GPU, ${n} layers`, backend: 'opencl', gpuLayers: n, flashAttn: false });
  // Phone reports showed only the FIRST word wrong on the GPU (every later word right). The first word is the only one computed
  // from a whole prompt at once; feeding the prompt one token at a time avoids that path, so a pass here points straight at it.
  if (layers.length) settings.push({ label: `OpenCL GPU, ${layers[0]} layers, prompt fed one token at a time (batch 1)`, backend: 'opencl', gpuLayers: layers[0], flashAttn: false, nBatch: 1 });
  if (opts.mtp) settings.push({ label: 'CPU only, with the MTP file', backend: 'cpu', gpuLayers: 0, flashAttn: false, mtp: true });
  return settings;
}

/** A solid red 224x224 picture, for asking a vision model what colour it sees. */
const RED_SQUARE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAOAAAADgCAIAAACVT/22AAABr0lEQVR42u3SAQkAAAzDsImYf2UXcxs/BKKgNNPCWZEAg4JBMSgYFAyKQcGgGBQMCgbFoGBQDAoGBYNiUDAoBgWDgkExKBgUg6qAQcGgGBQMCgbFoGBQDAoGBYNiUDAoBgWDgkExKBgUg4JBwaAYFAyKQVXAoGBQDAoGBYNiUDAoBgWDgkExKBgUg4JBwaAYFAyKQcGgYFAMCgbFoGBQMCgGBYOCQTEoGBSDgkHBoBgUDIpBwaBgUAwKBsWgYFAwKAYFg2JQMCgYFIOCQcGgGBQMikHBoGBQDAoGxaBgUDAoBgWDYlAwKBgUg4JBMSgYFAyKQcGgYFAMCgbFoGBQMCgGBYNiUDAoGBSDgkExKBgUDIpBwaAYFAwKBsWgYFAwKAYFg2JQMCgYFIOCQTEoGBQMikHBoBgUDAoGxaBgUAwKBgWDYlAwKBgUg4JBMSgYFAyKQcGgGBQMCgbFoGBQDAoGBYNiUDAoBgWDgkExKBgUDIpBwaAYFAwKBsWgYFAMCgYFg2JQMCgGBYOCQTEoGBSDgkHBoBgUDAoGxaBgUAwKBgWDYlAwKAYFg4JB+WgBgzMbqihZzw0AAAAASUVORK5CYII=';

async function checkPicture(): Promise<SweepResult['vision']> {
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

/** The settings a step runs with: the diagnostic's fixed shape (small context and batch, f16 cache, no MTP) plus what is being tried. */
function applySetting(setting: SweepSetting): void {
  useAppStore.getState().updateSettings({
    inferenceBackend: setting.backend === 'cpu' ? INFERENCE_BACKENDS.CPU : INFERENCE_BACKENDS.OPENCL,
    gpuLayers: setting.gpuLayers, flashAttn: setting.flashAttn, cacheType: 'f16', contextLength: 2048, nBatch: setting.nBatch ?? 128, useMtp: !!setting.mtp,
    cpuRepack: setting.cpuRepack !== false,
  } as any);
}

const seconds = (since: number) => Number(((Date.now() - since) / 1000).toFixed(1));

/** One step: load with the setting, judge the first reply. Never throws; the loader's own refusal (noise, memory) is the step's error. */
async function runStep(model: LlamaDownloadedModel, setting: SweepSetting, scan: boolean): Promise<SweepStep> {
  applySetting(setting);
  const started = Date.now();
  const step: SweepStep = { setting, ok: false, loadSeconds: 0 };
  try {
    await llmService.loadModel(model.filePath, undefined, { override: true, ...(setting.mtp && model.draftPath ? { draftPath: model.draftPath } : {}) });
    step.loadSeconds = seconds(started);
    if (setting.mtp) step.note = llmService.isMtpActive() ? 'MTP drafting was active' : 'the MTP file did not start, so it loaded without it';
    step.check = llmService.getLastOutputCheck() ?? await llmService.runOutputCheck() ?? undefined;
    step.ok = !!step.check?.ok;
    if (!step.ok) step.error = step.check?.reason;
    if (setting.backend === 'opencl' && step.ok) {
      const status = llmService.getShortPromptStatus();
      if (status !== 'ok') step.note = [step.note, status === 'workaround' ? 'very short prompts need the first-word workaround' : 'very short prompts may still start with a wrong word'].filter(Boolean).join('; ');
      if (scan) step.scan = await llmService.scanPromptLengths();
    }
  } catch (e: any) {
    step.loadSeconds = seconds(started);
    step.error = String(e?.message || e);
    step.check = llmService.getLastOutputCheck() ?? undefined;
  }
  return step;
}

const describeStep = (step: SweepStep): string => (step.ok
  ? `  works: "${step.check?.text.trim().slice(0, 60)}" at ${step.check?.tokensPerSecond} tok/s, first word after ${step.check?.firstTokenMs} ms${step.note ? ` (${step.note})` : ''}`
  : `  FAILED: ${step.error}`);

/** Size and SHA-256 of a file against the checksum the person gave, else the published values Atlas knows. A minute or two on a 7 GB model. */
async function checkFile(path: string, label: string, expected?: Expected): Promise<string> {
  try {
    const bytes = Number((await RNFS.stat(path)).size);
    const sha256 = await RNFS.hash(path, 'sha256');
    return `${label}: ${expected ? describeAgainstExpected({ bytes, sha256 }, expected) : describeFileVerdict(judgeFile(bytes, sha256))}`;
  } catch (e: any) {
    return `${label}: could not be read (${String(e?.message || e)})`;
  }
}

/** The picture check: load with the projector on the given setting, ask for the colour, unload. */
async function runPictureStep(model: LlamaDownloadedModel, projector: string, setting: SweepSetting): Promise<SweepResult['vision']> {
  applySetting(setting);
  try {
    await llmService.loadModel(model.filePath, projector, { override: true });
    return await checkPicture();
  } catch (e: any) {
    return { ok: false, reply: '', error: String(e?.message || e) };
  }
}

/**
 * Runs the sweep. `shouldStop` is polled between steps (the person pressed Stop). `onProgress` gets a line per event for the screen.
 * The model that was loaded before is not reloaded: the person's own load happens when they next use it.
 */
export async function runModelSweep(model: LlamaDownloadedModel, opts: { layers?: number[]; expected?: string; onProgress?: (line: string) => void; shouldStop?: () => boolean } = {}): Promise<SweepResult> {
  const say = (line: string) => { logger.log(`[GPU-TEST] ${line}`); opts.onProgress?.(line); };
  const saved = { ...useAppStore.getState().settings };
  const steps: SweepStep[] = [];
  const files: string[] = [];
  let scanned = false;
  let vision: SweepResult['vision'];
  try {
    await forgetVerdicts(model.filePath);
    await llmService.unloadModel();
    // The checksum or Hugging Face link the person gave (read from the page's small pointer; needs the internet only for a link).
    const given = opts.expected ? await resolveExpected(opts.expected) : null;
    if (given && 'error' in given) files.push(`Checksum you gave: ${given.error}`);
    say('Checking the model file against its published checksum (a minute or two)...');
    files.push(await checkFile(model.filePath, 'Model file', given && !('error' in given) ? given : undefined));
    say(`  ${files[0]}`);
    if (model.mmProjPath && await RNFS.exists(model.mmProjPath)) files.push(await checkFile(model.mmProjPath, 'Picture file'));
    if (model.draftPath && await RNFS.exists(model.draftPath)) files.push(await checkFile(model.draftPath, 'MTP file'));
    for (const setting of sweepSettings(opts.layers, { mtp: !!model.draftPath })) {
      if (opts.shouldStop?.()) { say('Stopped.'); break; }
      say(`Trying: ${setting.label}`);
      const step = await runStep(model, setting, !scanned);
      if (step.scan) scanned = true;
      steps.push(step);
      say(describeStep(step));
      await llmService.unloadModel();
    }
    const best = steps.find((s) => s.ok && s.setting.backend === 'opencl')?.setting;
    const target = best ?? steps.find((s) => s.ok)?.setting;
    const projector = model.mmProjPath && await RNFS.exists(model.mmProjPath) ? model.mmProjPath : undefined;
    if (projector && target && !opts.shouldStop?.()) {
      say(`Picture check with the projector, on: ${target.label}`);
      vision = await runPictureStep(model, projector, target);
      say(vision?.ok ? `  works: "${vision.reply}"` : `  FAILED: ${vision?.error}`);
      await llmService.unloadModel();
    }
    return { steps, files, vision, best, report: formatSweepReport(model, { steps, vision, files }) };
  } finally {
    useAppStore.getState().updateSettings({ ...saved, cpuRepack: saved.cpuRepack } as any);
  }
}

export function formatSweepReport(model: Pick<LlamaDownloadedModel, 'fileName'>, parts: { steps: SweepStep[]; vision?: SweepResult['vision']; files?: string[] }): string {
  const { steps, vision, files = [] } = parts;
  const lines = [`Test for ${model.fileName}`, ...files.map((f) => `- ${f}`), 'Each step: 2,048-token context, batch 128 unless stated, f16 KV cache, MTP off.'];
  for (const s of steps) {
    lines.push(`- ${s.setting.label}: ${s.ok ? 'OK' : 'FAILED'} (load ${s.loadSeconds}s)${s.note ? ` [${s.note}]` : ''}${s.error ? ` - ${s.error}` : ''}`);
    if (s.check) lines.push(formatOutputReport(s.check, {}).split('\n').map((l) => `    ${l}`).join('\n'));
    if (s.scan) lines.push('    Prompt length scan (how long a prompt must be before the first word is right):', ...s.scan.map((l) => `      ${l}`));
  }
  if (vision) lines.push(`- Picture check: ${vision.ok ? 'OK' : 'FAILED'}${vision.error ? ` - ${vision.error}` : ''}${vision.reply ? ` (reply: ${JSON.stringify(vision.reply)})` : ''}`);
  const working = steps.filter((s) => s.ok && s.setting.backend === 'opencl');
  const cpuWorking = steps.filter((s) => s.ok && s.setting.backend === 'cpu');
  lines.push(cpuWorking.length ? `Working CPU settings: ${cpuWorking.map((s) => s.setting.label).join('; ')}` : 'No CPU setting produced correct text either.');
  lines.push(working.length ? `Working GPU settings: ${working.map((s) => s.setting.label).join('; ')}` : 'No GPU setting produced correct text on this phone for this model.');
  return lines.join('\n');
}
