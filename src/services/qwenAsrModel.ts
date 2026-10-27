/**
 * Qwen3-ASR on the phone: the shared catalog's phone-sized entry, seen as a transcription model.
 *
 * The catalog (@offgrid/models) is the single source of the model's files, sizes and checksums.
 * This module only maps that entry into the shape the transcription screens list, and says where
 * its two files live on disk and whether this phone may offer it.
 */
import { Platform } from 'react-native';
import {
  CATALOG,
  isTranscriptionEngineAvailableOn,
  transcriptionEngineOf,
  type MobileWhisperCatalogModel,
  type ModelEntry,
} from '@offgrid/models';
import { engineLoadsCatalogModel } from './llamaEngineSupport';
import { loadsOnPhone } from './devicePicks';

/** The phone-sized Qwen3-ASR build. The 1.7B build is Desktop's. */
export const QWEN_ASR_MODEL_ID = 'ggml-org/Qwen3-ASR-0.6B-GGUF';

interface QwenAsrFile {
  name: string;
  url: string;
  sizeBytes: number;
  sha256?: string;
  path: string;
}

export interface QwenAsrFiles {
  primary: QwenAsrFile;
  mmproj: QwenAsrFile;
}

const MIB = 1024 * 1024;

function entryFor(modelId: string | null | undefined): ModelEntry | undefined {
  if (!modelId) return undefined;
  const entry = CATALOG.find(candidate => candidate.id === modelId);
  return entry && transcriptionEngineOf(entry) === 'qwen3-asr' ? entry : undefined;
}

/** True when this transcription model id runs on Qwen3-ASR (llama.rn), not whisper.rn. */
export function isQwenAsrModelId(modelId: string | null | undefined): boolean {
  return !!entryFor(modelId);
}

/** The model's weights and audio projector, placed in the transcription models folder `dir`. */
export function qwenAsrFiles(modelId: string | null | undefined, dir: string): QwenAsrFiles | undefined {
  const entry = entryFor(modelId);
  const primary = entry?.files.find(file => file.role === 'primary');
  const mmproj = entry?.files.find(file => file.role === 'mmproj');
  if (!primary?.sizeBytes || !mmproj?.sizeBytes) return undefined;
  const asFile = (file: typeof primary): QwenAsrFile => ({
    name: file.name,
    url: file.url,
    sizeBytes: file.sizeBytes!,
    ...(file.sha256 ? { sha256: file.sha256 } : {}),
    path: `${dir}/${file.name}`,
  });
  return { primary: asFile(primary), mmproj: asFile(mmproj) };
}

/** The model as a transcription card: size in MB over both files, like the Whisper cards. */
export function qwenAsrCardFor(modelId: string | null | undefined): MobileWhisperCatalogModel | undefined {
  const entry = entryFor(modelId);
  const files = entry ? qwenAsrFiles(entry.id, '') : undefined;
  if (!entry || !files) return undefined;
  return {
    id: entry.id,
    name: entry.name,
    size: Math.round((files.primary.sizeBytes + files.mmproj.sizeBytes) / MIB),
    lang: 'multi',
    url: files.primary.url,
    description: entry.description ?? '',
  };
}

/**
 * Whether this phone offers Qwen3-ASR: its engine runs on this platform, the app's llama.cpp build
 * loads it, and the phone memory guard (the shared fit rule) admits its download.
 */
export function isQwenAsrOffered(ramGB: number): boolean {
  const entry = entryFor(QWEN_ASR_MODEL_ID);
  return !!entry &&
    isTranscriptionEngineAvailableOn('qwen3-asr', Platform.OS) &&
    engineLoadsCatalogModel(entry) &&
    loadsOnPhone(entry.id, ramGB) === true;
}
