import type { RecordProvenance, SyncedToolArtifact } from '@offgrid/sync';
import type { ModelArtifactOrigin } from '@offgrid/models';
// Model source and credibility types
export type ModelSource =
  | 'lmstudio'
  | 'official'
  | 'verified-quantizer'
  | 'community';

export interface ModelCredibility {
  source: ModelSource;
  isOfficial: boolean; // From the original model creator (Meta, Microsoft, etc.)
  isVerifiedQuantizer: boolean; // From trusted quantization providers (LM Studio, TheBloke, etc.)
  verifiedBy?: string; // Who verified this (e.g., "LM Studio", "Original Author")
}
// Model-related types
export interface ModelInfo {
  id: string;
  name: string;
  author: string;
  description: string;
  downloads: number;
  likes: number;
  tags: string[];
  lastModified: string;
  files: ModelFile[];
  credibility?: ModelCredibility;
  modelType?: 'text' | 'vision' | 'code';
  paramCount?: number;
  minRamGB?: number;
}

export interface ModelFile {
  name: string;
  size: number;
  quantization: string;
  downloadUrl: string;
  sha256?: string;
  // Companion mmproj for vision models
  mmProjFile?: {
    name: string;
    size: number;
    downloadUrl: string;
    sha256?: string;
  };
  // LiteRT-specific: whether this .litertlm file supports vision input. Used by
  // buildDownloadedModel to set liteRTVision on the resulting DownloadedModel.
  // Unset for non-LiteRT files and for LiteRT files imported locally where the
  // capability is unknown.
  liteRTVision?: boolean;
  // LiteRT-specific: whether this .litertlm file accepts audio input directly
  // (e.g. Gemma 4 E2B/E4B). Same plumbing as liteRTVision.
  liteRTAudio?: boolean;
}

export type ModelEngine = 'llama' | 'litert';

/**
 * Where a model's files actually came from, recorded at the moment we fetched them.
 *
 * The `id` on a model record is a DISPLAY key (`repo/file`). It was doing double duty as a remote
 * address - vision repair rebuilt a Hugging Face repo id by splitting it at its last slash - which
 * works only for models whose id happens to be a repo path. A model that arrived by device
 * transfer, or was imported from local storage, produced a repo id Hugging Face has never heard of,
 * and HF answers an unknown repo with 401, so the user was shown a raw auth error for a file that
 * was simply never from HF.
 *
 * Provenance is a fact we are told at download time. Record it then; never re-derive it later.
 */
export type ModelOrigin = ModelArtifactOrigin;

interface DownloadedModelBase {
  id: string;
  /** Shared installation identity for a downloaded external model family. */
  registryFamilyId?: string;
  name: string;
  author: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  quantization: string;
  downloadedAt: string;
  credibility?: ModelCredibility;
  /** Absent for local imports (no upstream) and for records written before this field existed. */
  origin?: ModelOrigin;
}

export interface LlamaDownloadedModel extends DownloadedModelBase {
  engine: 'llama';
  isVisionModel?: boolean;
  mmProjPath?: string;
  mmProjFileName?: string;
  mmProjFileSize?: number;
}

export interface LiteRTDownloadedModel extends DownloadedModelBase {
  engine: 'litert';
  liteRTVision: boolean;
  // Whether this model accepts audio input directly (no Whisper STT needed).
  // Optional: absent for locally-imported models where capability is unknown.
  liteRTAudio?: boolean;
}

export type DownloadedModel = LlamaDownloadedModel | LiteRTDownloadedModel;

export function isLiteRTModel(m: DownloadedModel): m is LiteRTDownloadedModel {
  return m.engine === 'litert';
}

export interface DownloadProgress {
  downloadId?: string;
  modelId: string;
  fileName: string;
  bytesDownloaded: number;
  totalBytes: number;
  progress: number;
}

// SoC detection types
export type SoCVendor =
  | 'qualcomm'
  | 'mediatek'
  | 'exynos'
  | 'tensor'
  | 'apple'
  | 'unknown';
export interface SoCInfo {
  vendor: SoCVendor;
  hasNPU: boolean;
  qnnVariant?: '8gen2' | '8gen1' | 'min';
  appleChip?: 'A14' | 'A15' | 'A16' | 'A17Pro' | 'A18';
}

export interface ImageModelRecommendation {
  recommendedBackend: 'qnn' | 'mnn' | 'coreml' | 'all';
  qnnVariant?: '8gen2' | '8gen1' | 'min';
  /** Substrings matched against model name to identify recommended models */
  recommendedModels?: string[];
  bannerText: string;
  warning?: string;
  compatibleBackends: Array<'mnn' | 'qnn' | 'coreml'>;
}

// Hardware-related types
export interface DeviceInfo {
  totalMemory: number;
  usedMemory: number;
  availableMemory: number;
  deviceModel: string;
  systemName: string;
  systemVersion: string;
  isEmulator: boolean;
}

export interface ModelRecommendation {
  maxParameters: number;
  recommendedQuantization: string;
  recommendedModels: string[];
  warning?: string;
}

// Media attachment types
export interface MediaAttachment {
  id: string;
  type: 'image' | 'document' | 'audio';
  uri: string;
  mimeType?: string;
  width?: number;
  height?: number;
  fileName?: string;
  textContent?: string; // documents: extracted text
  fileSize?: number; // documents: file size in bytes
  audioFormat?: 'wav' | 'mp3'; // audio attachments: format for model input
  audioDurationSeconds?: number; // audio attachments: recorded duration in seconds
  /**
   * The peer has NAMED this file and its bytes have not arrived.
   *
   * A synced file is announced before it is sent, and until now the bubble showed nothing at all in
   * that gap - so a generated image on its way from another device was indistinguishable from one
   * that was never coming. Everything needed to draw it is already in the announcement: the name,
   * the size, the type and the dimensions. Only `uri` is empty, which is why it must not be read
   * while this is true.
   */
  pending?: boolean;
}

// Generation metadata - details about how a message was generated
export interface GenerationMeta {
  /**
   * Whether GPU was used for inference.
   *
   * Optional because a message SYNCED from another device carries the facts that travel (which tools
   * it was offered) and none of the local ones - this device did not run that inference, so claiming
   * gpu:false would be inventing a measurement.
   */
  gpu?: boolean;
  /** GPU backend name (e.g., 'Metal', 'CPU') */
  gpuBackend?: string;
  /** Number of GPU layers offloaded */
  gpuLayers?: number;
  /** Model name used for generation */
  modelName?: string;
  /** Tokens per second — overall including prefill (text generation only) */
  tokensPerSecond?: number;
  /** Tokens per second — decode only, excluding prefill (text generation only) */
  decodeTokensPerSecond?: number;
  /** Tokens per second — prefill/prompt processing speed (LiteRT only) */
  prefillTokensPerSecond?: number;
  /** Time to first token in milliseconds (text generation only) */
  timeToFirstToken?: number;
  /** Token count (text generation only) */
  tokenCount?: number;
  /** Model load/init time in seconds */
  modelLoadTimeSeconds?: number;
  /** Image generation steps */
  steps?: number;
  /** Image guidance scale */
  guidanceScale?: number;
  /** Image resolution */
  resolution?: string;
  cacheType?: string; // KV cache quantization type
  /** Tool names sent to the model for this turn (built-in + routed MCP/ext tools). */
  routedToolNames?: string[];
  /** True when the reply was cut off at the n_predict cap without an EOS token (B15). */
  truncated?: boolean;
}

// Chat-related types
export interface Message {
  id: string;
  /**
   * Stable cross-device identity. Persisted messages always carry this; transient
   * prompt-only messages may omit it because they never enter the sync log.
   */
  uuid?: string;
  /** Immutable device attribution for portable Sync records. */
  provenance?: RecordProvenance;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** Reasoning/thinking content parsed by llama.rn (separate from response content) */
  reasoningContent?: string;
  timestamp: number;
  /**
   * True when this reply ended before it finished, because the app closed while it was arriving.
   *
   * The shared chat rules decide it and write it onto the saved reply when they recover the
   * conversation; the phone only carries it onto the row a person reads. Without it a half-written
   * reply reads as a complete answer.
   */
  stoppedEarly?: boolean;
  isStreaming?: boolean;
  isThinking?: boolean;
  /** USER messages only: the modality this turn was DISPATCHED as, stamped when the router decides.
   *  A resend replays this fact instead of re-deriving the turn's kind from whatever replies survived —
   *  a cancelled image turn leaves only the "Enhanced prompt" reply and no image, and inferring from
   *  that made the retry a TEXT turn (device-confirmed on Android and iOS). Absent on turns recorded
   *  before this field existed; those still fall back to the reply scan. */
  turnKind?: 'text' | 'image';
  /** Indicates this is a system info message (model loaded/unloaded, etc.) */
  isSystemInfo?: boolean;
  attachments?: MediaAttachment[];
  /** Generation duration in milliseconds */
  generationTimeMs?: number;
  /** Metadata about how the message was generated */
  generationMeta?: GenerationMeta;
  /** Tool call ID (for tool result messages) */
  toolCallId?: string;
  /** Tool calls made by the assistant */
  toolCalls?: Array<{ id?: string; name: string; arguments: string }>;
  /** Completed, display-only tool artifacts admitted from synced message context. */
  toolArtifacts?: SyncedToolArtifact[];
  /** Tool name (for tool result messages) */
  toolName?: string;
  /** True when this assistant message was generated while interfaceMode === 'audio' */
  isAudioModeMessage?: boolean;
  /** Audio-mode message payload (saved voice note / synthesized clip): the on-disk audio
   *  file path, a precomputed waveform envelope, and the clip duration. Read by the pro
   *  audio UI (MessageAudioMode / AudioMessageBubble) and set by the TTS save path.
   *  Optional — only audio-mode messages carry them. (Distinct from the same-named field
   *  on MediaAttachment above, which describes an inbound audio attachment.) */
  audioPath?: string;
  waveformData?: number[];
  audioDurationSeconds?: number;
}

export interface Conversation {
  id: string;
  /** Immutable device attribution for portable Sync records. */
  provenance?: RecordProvenance;
  title: string;
  modelId: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  compactionSummary?: string;
  compactionCutoffMessageId?: string;
}

// Hugging Face API types
export interface HFModelSearchResult {
  _id: string;
  id: string;
  modelId: string;
  author: string;
  sha: string;
  lastModified: string;
  private: boolean;
  disabled: boolean;
  gated: boolean | string;
  downloads: number;
  likes: number;
  tags: string[];
  cardData?: {
    license?: string;
    language?: string[];
    pipeline_tag?: string;
  };
  siblings?: HFModelFile[];
}

interface HFModelFile {
  rfilename: string;
  size?: number;
  blobId?: string;
  lfs?: {
    size: number;
    sha256: string;
    pointerSize: number;
  };
}

export interface ONNXImageModel {
  id: string;
  name: string;
  description: string;
  modelPath: string;
  downloadedAt: string;
  size: number;
  style?: string;
  backend?: 'mnn' | 'qnn' | 'coreml';
  attentionVariant?: 'split_einsum' | 'original';
}

// NOTE: the authoritative ImageGenerationState lives in
// services/imageGenerationService.ts (phase-derived) and is re-exported from
// services/index.ts. The duplicate that used to sit here was imported by nobody
// (every consumer takes the service's version) — removed to kill the drift risk.

export type ImageGenerationMode = 'auto' | 'manual';
export type AutoDetectMethod = 'pattern' | 'llm';
export type CacheType = 'f16' | 'q8_0' | 'q4_0';

/**
 * How a voice turn begins and ends. Re-exported from @offgrid/speech, which OWNS it - desktop renders
 * the same modes, so a second definition here is how the two would drift.
 *
 * Voice mode only. Chat dictation is someone typing with their voice - they pause to think, and the
 * recorder must wait for them - so it always behaves as 'tap' regardless of this.
 */
export type { VoiceTurnMode } from '@offgrid/speech';
export type InferenceBackend = 'cpu' | 'opencl' | 'htp' | 'metal';
export type LiteRTBackend = 'cpu' | 'gpu' | 'npu';
export const INFERENCE_BACKENDS = {
  CPU: 'cpu' as InferenceBackend,
  OPENCL: 'opencl' as InferenceBackend,
  HTP: 'htp' as InferenceBackend,
  METAL: 'metal' as InferenceBackend,
} as const;
/** 'auto' = smart detect, 'force' = always generate image, 'disabled' = never */
export type ImageModeState = 'auto' | 'force' | 'disabled';

export interface GeneratedImage {
  id: string;
  /** Immutable device attribution for portable Sync records. */
  provenance?: RecordProvenance;
  prompt: string;
  negativePrompt?: string;
  imagePath: string;
  /**
   * The file's own name, as every device knows it. NEVER derived from `imagePath`.
   *
   * A received file is stored under `<syncId>-<name>` so two files with one name cannot collide, and
   * that is a LOCAL convention. Taking the portable name from the local path let the convention onto
   * the wire, so the name gained another syncId on every hop - `<id>-<id>-img.png` - until it would
   * have passed what a filesystem accepts. Message attachments always carried this; generated images
   * did not, which is why only they grew.
   */
  fileName?: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  modelId: string;
  createdAt: string;
  conversationId?: string;
}

export interface ImageGenerationParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  useOpenCL?: boolean;
}
export interface ImageGenerationProgress {
  step: number;
  totalSteps: number;
  progress: number;
}
export interface Project {
  id: string;
  /** Immutable device attribution for portable Sync records. */
  provenance?: RecordProvenance;
  name: string;
  description: string;
  systemPrompt: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
}
export type BackgroundDownloadReasonCode =
  | 'none'
  | 'network_lost'
  | 'network_timeout'
  | 'server_unavailable'
  | 'download_interrupted'
  | 'disk_full'
  | 'file_corrupted'
  | 'empty_response'
  | 'user_cancelled'
  | 'http_401'
  | 'http_403'
  | 'http_404'
  | 'http_416'
  | 'http_429'
  | 'client_error'
  | 'unknown_error';
export interface DebugInfo {
  systemPrompt: string;
  originalMessageCount: number;
  managedMessageCount: number;
  truncatedCount: number;
  formattedPrompt: string;
  estimatedTokens: number;
  maxContextLength: number;
  contextUsagePercent: number;
}
// Remote server types
export type {
  RemoteServer,
  RemoteModel,
  ServerTestResult,
  RemoteMediaModelIds,
  RemoteModelCategory,
  RemoteModelOption,
  RemoteModelCatalog,
} from './remoteServer';
