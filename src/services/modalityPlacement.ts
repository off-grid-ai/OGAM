import { Platform } from 'react-native';
import { useAppStore } from '../stores/appStore';
import { useWhisperStore } from '../stores/whisperStore';
import type { MobileBackend } from '@offgrid/models';
import logger from '../utils/logger';
import { hardwareService } from './hardware';
import { embeddingService } from './rag/embedding';
import type { ModalityPlacement, ProcessorPlace } from './modalityBackends';

/**
 * Fastest settings beyond text: where each other installed modality runs on this phone. Search
 * models are measured (GPU against CPU, with a correctness check); the rest follow what their
 * engine can run here, with the video exception written down.
 */

const LLM_PLACE: Record<MobileBackend, ProcessorPlace> = { cpu: 'cpu', opencl: 'gpu', metal: 'gpu', htp: 'npu' };

export function llmPlacement(backend: MobileBackend): ModalityPlacement {
  return { modality: 'llm', place: LLM_PLACE[backend], engine: 'llama.cpp' };
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** The GPU only when it gives the same vectors as the CPU (cosine >= 0.99) and is faster. */
async function placeEmbeddings(signal?: AbortSignal): Promise<ModalityPlacement> {
  const gpuPossible = Platform.OS === 'ios' || (await hardwareService.getOpenCLCapability()).supported;
  if (!gpuPossible || signal?.aborted) return { modality: 'embeddings', place: 'cpu', engine: 'llama.cpp' };
  const cpu = await embeddingService.measure('cpu');
  if (!cpu || signal?.aborted) return { modality: 'embeddings', place: 'cpu', engine: 'llama.cpp' };
  const gpu = await embeddingService.measure('gpu');
  const agrees = !!gpu && cosine(gpu.vector, cpu.vector) >= 0.99;
  logger.log(`[SPEED] embeddings cpu=${cpu.ms}ms gpu=${gpu?.ms ?? 'failed'}ms agrees=${agrees}`);
  if (!gpu) return { modality: 'embeddings', place: 'cpu', engine: 'llama.cpp' };
  if (!agrees) return { modality: 'embeddings', place: 'cpu', engine: 'llama.cpp', reason: 'The GPU gave different results here.' };
  return { modality: 'embeddings', place: gpu.ms < cpu.ms ? 'gpu' : 'cpu', engine: 'llama.cpp' };
}

/**
 * Video (sd.cpp). iOS runs it on the GPU (Metal). On Android the documented exception holds: the
 * Hexagon NPU returns a constant Wan output and the Adreno GPU crashes in the same graph, so Wan
 * runs on the CPU there; other Android GPUs use Vulkan.
 */
async function placeVideo(): Promise<ModalityPlacement> {
  if (Platform.OS === 'ios') return { modality: 'video', place: 'gpu', engine: 'sd.cpp' };
  const adreno = (await hardwareService.getOpenCLCapability()).supported;
  return adreno
    ? { modality: 'video', place: 'cpu', engine: 'sd.cpp', reason: 'This phone’s NPU and GPU give wrong video output, so video runs on the CPU.' }
    : { modality: 'video', place: 'gpu', engine: 'sd.cpp' };
}

/** Image runs where its installed variant was built for: Core ML or QNN on the NPU, MNN on the CPU. */
function placeImage(): ModalityPlacement | null {
  const app = useAppStore.getState();
  const model = app.downloadedImageModels.find(item => item.id === app.activeImageModelId);
  if (!model) return null;
  if (model.backend === 'qnn') return { modality: 'image', place: 'npu', engine: 'QNN' };
  if (model.backend === 'coreml') return { modality: 'image', place: 'npu', engine: 'Core ML' };
  if (model.backend === 'sd') return { modality: 'image', place: Platform.OS === 'ios' ? 'gpu' : 'cpu', engine: 'sd.cpp' };
  return Platform.OS === 'ios'
    ? { modality: 'image', place: 'npu', engine: 'Core ML' }
    : { modality: 'image', place: 'cpu', engine: 'MNN' };
}

/**
 * Measure or decide every installed modality other than text, and return where each runs.
 * Skips a modality with nothing installed.
 */
export async function placeOtherModalities(signal?: AbortSignal): Promise<ModalityPlacement[]> {
  const app = useAppStore.getState();
  const placements: ModalityPlacement[] = [];
  placements.push(await placeEmbeddings(signal).catch(() => ({ modality: 'embeddings' as const, place: 'cpu' as const, engine: 'llama.cpp' })));
  if (app.downloadedVideoModels.length) placements.push(await placeVideo());
  const image = placeImage();
  if (image) placements.push(image);
  if (useWhisperStore.getState().presentModelIds.length)
    placements.push({ modality: 'stt', place: Platform.OS === 'ios' ? 'gpu' : 'cpu', engine: 'whisper.cpp' });
  // On-device voices (Kokoro) run on the CPU through ExecuTorch on both platforms.
  placements.push({ modality: 'tts', place: 'cpu', engine: 'ExecuTorch' });
  return placements;
}
