// Model category types
export type ModelCategory = 'text-generation' | 'image-generation' | 'vision' | 'code';
// Model source and credibility types
export type ModelSource = 'lmstudio' | 'official' | 'verified-quantizer' | 'community';

export interface ModelCredibility {
  source: ModelSource;
  isOfficial: boolean;        // From the original model creator (Meta, Microsoft, etc.)
  isVerifiedQuantizer: boolean; // From trusted quantization providers (LM Studio, TheBloke, etc.)
  verifiedBy?: string;        // Who verified this (e.g., "LM Studio", "Original Author")
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
  // Companion mmproj for vision models
  mmProjFile?: {
    name: string;
    size: number;
    downloadUrl: string;
  };
}

export interface DownloadedModel {
  id: string;
  name: string;
  author: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  quantization: string;
  downloadedAt: string;
  credibility?: ModelCredibility;
  // Vision model support
  isVisionModel?: boolean;
  mmProjPath?: string;
  mmProjFileName?: string;
  mmProjFileSize?: number;
}

export interface PersistedDownloadInfo {
  modelId: string;
  fileName: string;
  quantization: string;
  author: string;
  totalBytes: number;
  mainFileSize?: number;
  mmProjFileName?: string;
  mmProjFileSize?: number;
  mmProjLocalPath?: string | null;
  mmProjDownloadId?: number;
  // Image model metadata (for restoring downloads after app kill)
  imageModelName?: string;
  imageModelDescription?: string;
  imageModelSize?: number;
  imageModelStyle?: string;
  imageModelBackend?: string;
  imageModelRepo?: string;
  imageDownloadType?: 'zip' | 'multifile';
}

export interface DownloadProgress {
  modelId: string;
  fileName: string;
  bytesDownloaded: number;
  totalBytes: number;
  progress: number;
}

// SoC detection types
export type SoCVendor = 'qualcomm' | 'mediatek' | 'exynos' | 'tensor' | 'apple' | 'unknown';
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
}

// Generation metadata - details about how a message was generated
export interface GenerationMeta {
  /** Whether GPU was used for inference */
  gpu: boolean;
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
  /** Time to first token in seconds (text generation only) */
  timeToFirstToken?: number;
  /** Token count (text generation only) */
  tokenCount?: number;
  /** Image generation steps */
  steps?: number;
  /** Image guidance scale */
  guidanceScale?: number;
  /** Image resolution */
  resolution?: string;
  cacheType?: string; // KV cache quantization type
}

// Chat-related types
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** Reasoning/thinking content parsed by llama.rn (separate from response content) */
  reasoningContent?: string;
  timestamp: number;
  isStreaming?: boolean;
  isThinking?: boolean;
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
  /** Tool name (for tool result messages) */
  toolName?: string;
  /** True when this assistant message was generated while interfaceMode === 'audio' */
  isAudioModeMessage?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  compactionSummary?: string;
  compactionCutoffMessageId?: string;
}

// Onboarding-related types
export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  image?: string;
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

export interface HFModelFile {
  rfilename: string;
  size?: number;
  blobId?: string;
  lfs?: {
    size: number;
    sha256: string;
    pointerSize: number;
  };
}

// Image generation types
export interface ImageGenerationModel {
  id: string;
  name: string;
  author: string;
  description: string;
  downloads: number;
  likes: number;
  modelPath: string;
  downloadedAt: string;
  size: number;
  variant?: string; // e.g., 'gpu', 'npu', 'cpu'
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

// Image generation state for UI
export interface ImageGenerationState {
  isGenerating: boolean;
  currentStep: number;
  totalSteps: number;
  progress: number;
  prompt?: string;
}

export type ImageGenerationMode = 'auto' | 'manual';
export type AutoDetectMethod = 'pattern' | 'llm';
export type ModelLoadingStrategy = 'performance' | 'memory';
export type CacheType = 'f16' | 'q8_0' | 'q4_0';
/** 'auto' = smart detect, 'force' = always generate image, 'disabled' = never */
export type ImageModeState = 'auto' | 'force' | 'disabled';

export interface GeneratedImage {
  id: string;
  prompt: string;
  negativePrompt?: string;
  imagePath: string;
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
  name: string;
  description: string;
  systemPrompt: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
}
export type BackgroundDownloadStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'unknown';
export interface BackgroundDownloadInfo {
  downloadId: number;
  fileName: string;
  title?: string;
  modelId: string;
  status: BackgroundDownloadStatus;
  bytesDownloaded: number;
  totalBytes: number;
  localUri?: string;
  startedAt: number;
  completedAt?: number;
  failureReason?: string;
}
export interface DebugInfo {
  systemPrompt: string;
  originalMessageCount: number;
  managedMessageCount: number;
  truncatedCount: number;
  formattedPrompt: string; estimatedTokens: number;
  maxContextLength: number; contextUsagePercent: number;
}
export type AppScreen = 'onboarding' | 'home' | 'models' | 'chat' | 'settings' | 'generate' | 'model-download';
// Remote server types
export type { RemoteProviderType, RemoteServer, RemoteModel, RemoteModelCapabilities, ServerTestResult, ServerInfo, RemoteGenerationSettings, SelectableModel } from './remoteServer';
export { DEFAULT_REMOTE_GENERATION_SETTINGS } from './remoteServer';
