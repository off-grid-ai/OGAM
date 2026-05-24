/**
 * Test Data Factories
 *
 * Creates test data for Off Grid entities.
 * Use these factories to create consistent test data across all test files.
 */

import type { ImageDownloadDeps } from '../../src/screens/ModelsScreen/imageDownloadActions';
import {
  Message,
  Conversation,
  DownloadedModel,
  ModelInfo,
  ModelFile,
  DeviceInfo,
  ModelRecommendation,
  ONNXImageModel,
  GeneratedImage,
  MediaAttachment,
  GenerationMeta,
  Project,
  ModelCredibility,
} from '../../src/types';

// ============================================================================
// ID Generation
// ============================================================================

let idCounter = 0;

export const generateId = (prefix = 'test'): string => {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
};

export const resetIdCounter = (): void => {
  idCounter = 0;
};

// ============================================================================
// Message Factory
// ============================================================================

export interface MessageFactoryOptions {
  id?: string;
  role?: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  timestamp?: number;
  isStreaming?: boolean;
  isThinking?: boolean;
  isSystemInfo?: boolean;
  attachments?: MediaAttachment[];
  generationTimeMs?: number;
  generationMeta?: GenerationMeta;
  toolCallId?: string;
  toolCalls?: Array<{ id?: string; name: string; arguments: string }>;
  toolName?: string;
}

export const createMessage = (options: MessageFactoryOptions = {}): Message => ({
  id: options.id ?? generateId('msg'),
  role: options.role ?? 'user',
  content: options.content ?? 'Test message content',
  timestamp: options.timestamp ?? Date.now(),
  isStreaming: options.isStreaming,
  isThinking: options.isThinking,
  isSystemInfo: options.isSystemInfo,
  attachments: options.attachments,
  generationTimeMs: options.generationTimeMs,
  generationMeta: options.generationMeta,
  toolCallId: options.toolCallId,
  toolCalls: options.toolCalls,
  toolName: options.toolName,
});

export const createUserMessage = (content: string, options: Omit<MessageFactoryOptions, 'role' | 'content'> = {}): Message =>
  createMessage({ ...options, role: 'user', content });

export const createAssistantMessage = (content: string, options: Omit<MessageFactoryOptions, 'role' | 'content'> = {}): Message =>
  createMessage({ ...options, role: 'assistant', content });

export const createSystemMessage = (content: string, options: Omit<MessageFactoryOptions, 'role' | 'content'> = {}): Message =>
  createMessage({ ...options, role: 'system', content });

export const createToolResultMessage = (toolName: string, content: string, options: Omit<MessageFactoryOptions, 'role' | 'content' | 'toolName'> = {}): Message =>
  createMessage({ ...options, role: 'tool', content, toolName });

// ============================================================================
// Conversation Factory
// ============================================================================

export interface ConversationFactoryOptions {
  id?: string;
  title?: string;
  modelId?: string;
  messages?: Message[];
  createdAt?: string;
  updatedAt?: string;
  projectId?: string;
}

export const createConversation = (options: ConversationFactoryOptions = {}): Conversation => ({
  id: options.id ?? generateId('conv'),
  title: options.title ?? 'Test Conversation',
  modelId: options.modelId ?? 'test-model-id',
  messages: options.messages ?? [],
  createdAt: options.createdAt ?? new Date().toISOString(),
  updatedAt: options.updatedAt ?? new Date().toISOString(),
  projectId: options.projectId,
});

export const createConversationWithMessages = (
  messageCount: number,
  options: ConversationFactoryOptions = {}
): Conversation => {
  const messages: Message[] = [];
  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    messages.push(createMessage({
      role,
      content: `${role === 'user' ? 'User' : 'Assistant'} message ${i + 1}`,
    }));
  }
  return createConversation({ ...options, messages });
};

// ============================================================================
// Model Factory
// ============================================================================

export interface DownloadedModelFactoryOptions {
  id?: string;
  name?: string;
  author?: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  quantization?: string;
  downloadedAt?: string;
  credibility?: ModelCredibility;
  isVisionModel?: boolean;
  mmProjPath?: string;
  mmProjFileName?: string;
  mmProjFileSize?: number;
  engine?: 'llama' | 'litert';
  liteRTVision?: boolean;
}

export const createDownloadedModel = (options: DownloadedModelFactoryOptions = {}): DownloadedModel => ({
  id: options.id ?? generateId('model'),
  name: options.name ?? 'Test Model',
  author: options.author ?? 'test-author',
  filePath: options.filePath ?? '/mock/models/test-model.gguf',
  fileName: options.fileName ?? 'test-model.gguf',
  fileSize: options.fileSize ?? 4 * 1024 * 1024 * 1024, // 4GB
  quantization: options.quantization ?? 'Q4_K_M',
  downloadedAt: options.downloadedAt ?? new Date().toISOString(),
  credibility: options.credibility,
  engine: options.engine ?? 'llama',
  isVisionModel: options.isVisionModel,
  mmProjPath: options.mmProjPath,
  mmProjFileName: options.mmProjFileName,
  mmProjFileSize: options.mmProjFileSize,
} as DownloadedModel);

export const createVisionModel = (options: DownloadedModelFactoryOptions = {}): DownloadedModel =>
  createDownloadedModel({
    ...options,
    name: options.name ?? 'Test Vision Model',
    isVisionModel: true,
    mmProjPath: options.mmProjPath ?? '/mock/models/test-mmproj.gguf',
    mmProjFileName: options.mmProjFileName ?? 'test-mmproj.gguf',
    mmProjFileSize: options.mmProjFileSize ?? 500 * 1024 * 1024, // 500MB
  });

// ============================================================================
// Model Info Factory (for API responses)
// ============================================================================

export interface ModelFileFactoryOptions {
  name?: string;
  size?: number;
  quantization?: string;
  downloadUrl?: string;
}

export const createModelFile = (options: ModelFileFactoryOptions = {}): ModelFile => ({
  name: options.name ?? 'model-q4_k_m.gguf',
  size: options.size ?? 4 * 1024 * 1024 * 1024,
  quantization: options.quantization ?? 'Q4_K_M',
  downloadUrl: options.downloadUrl ?? 'https://huggingface.co/test/model/resolve/main/model-q4_k_m.gguf',
});

export interface ModelInfoFactoryOptions {
  id?: string;
  name?: string;
  author?: string;
  description?: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  lastModified?: string;
  files?: ModelFile[];
  credibility?: ModelCredibility;
}

export const createModelInfo = (options: ModelInfoFactoryOptions = {}): ModelInfo => ({
  id: options.id ?? generateId('model-info'),
  name: options.name ?? 'Test Model Info',
  author: options.author ?? 'test-author',
  description: options.description ?? 'A test model for unit testing',
  downloads: options.downloads ?? 1000,
  likes: options.likes ?? 100,
  tags: options.tags ?? ['llama', 'gguf', 'text-generation'],
  lastModified: options.lastModified ?? new Date().toISOString(),
  files: options.files ?? [createModelFile()],
  credibility: options.credibility,
});

// ============================================================================
// Device Info Factory
// ============================================================================

export interface DeviceInfoFactoryOptions {
  totalMemory?: number;
  usedMemory?: number;
  availableMemory?: number;
  deviceModel?: string;
  systemName?: string;
  systemVersion?: string;
  isEmulator?: boolean;
}

export const createDeviceInfo = (options: DeviceInfoFactoryOptions = {}): DeviceInfo => ({
  totalMemory: options.totalMemory ?? 8 * 1024 * 1024 * 1024, // 8GB
  usedMemory: options.usedMemory ?? 4 * 1024 * 1024 * 1024, // 4GB
  availableMemory: options.availableMemory ?? 4 * 1024 * 1024 * 1024, // 4GB
  deviceModel: options.deviceModel ?? 'Test Device',
  systemName: options.systemName ?? 'Android',
  systemVersion: options.systemVersion ?? '13',
  isEmulator: options.isEmulator ?? false,
});

export const createLowMemoryDevice = (): DeviceInfo =>
  createDeviceInfo({
    totalMemory: 4 * 1024 * 1024 * 1024, // 4GB
    usedMemory: 3 * 1024 * 1024 * 1024, // 3GB
    availableMemory: 1 * 1024 * 1024 * 1024, // 1GB
  });

export const createHighMemoryDevice = (): DeviceInfo =>
  createDeviceInfo({
    totalMemory: 16 * 1024 * 1024 * 1024, // 16GB
    usedMemory: 4 * 1024 * 1024 * 1024, // 4GB
    availableMemory: 12 * 1024 * 1024 * 1024, // 12GB
  });

// ============================================================================
// Model Recommendation Factory
// ============================================================================

export interface ModelRecommendationFactoryOptions {
  maxParameters?: number;
  recommendedQuantization?: string;
  recommendedModels?: string[];
  warning?: string;
}

export const createModelRecommendation = (options: ModelRecommendationFactoryOptions = {}): ModelRecommendation => ({
  maxParameters: options.maxParameters ?? 7000000000, // 7B
  recommendedQuantization: options.recommendedQuantization ?? 'Q4_K_M',
  recommendedModels: options.recommendedModels ?? ['llama-3.2-3b', 'phi-3-mini'],
  warning: options.warning,
});

// ============================================================================
// Image Model Factory
// ============================================================================

export interface ONNXImageModelFactoryOptions {
  id?: string;
  name?: string;
  description?: string;
  modelPath?: string;
  downloadedAt?: string;
  size?: number;
  style?: string;
  backend?: 'mnn' | 'qnn' | 'coreml';
  attentionVariant?: 'split_einsum' | 'original';
}

export const createONNXImageModel = (options: ONNXImageModelFactoryOptions = {}): ONNXImageModel => ({
  id: options.id ?? generateId('img-model'),
  name: options.name ?? 'Test Image Model',
  description: options.description ?? 'A test image generation model',
  modelPath: options.modelPath ?? '/mock/image-models/test-sd',
  downloadedAt: options.downloadedAt ?? new Date().toISOString(),
  size: options.size ?? 2 * 1024 * 1024 * 1024, // 2GB
  style: options.style ?? 'creative',
  backend: options.backend ?? 'mnn',
  attentionVariant: options.attentionVariant,
});

// ============================================================================
// Generated Image Factory
// ============================================================================

export interface GeneratedImageFactoryOptions {
  id?: string;
  prompt?: string;
  negativePrompt?: string;
  imagePath?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  modelId?: string;
  createdAt?: string;
  conversationId?: string;
}

export const createGeneratedImage = (options: GeneratedImageFactoryOptions = {}): GeneratedImage => ({
  id: options.id ?? generateId('gen-img'),
  prompt: options.prompt ?? 'A beautiful sunset over mountains',
  negativePrompt: options.negativePrompt,
  imagePath: options.imagePath ?? '/mock/generated/image.png',
  width: options.width ?? 512,
  height: options.height ?? 512,
  steps: options.steps ?? 20,
  seed: options.seed ?? Math.floor(Math.random() * 1000000),
  modelId: options.modelId ?? 'test-img-model',
  createdAt: options.createdAt ?? new Date().toISOString(),
  conversationId: options.conversationId,
});

// ============================================================================
// Media Attachment Factory
// ============================================================================

export interface MediaAttachmentFactoryOptions {
  id?: string;
  type?: 'image' | 'document';
  uri?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  fileName?: string;
  textContent?: string;
  fileSize?: number;
}

export const createMediaAttachment = (options: MediaAttachmentFactoryOptions = {}): MediaAttachment => ({
  id: options.id ?? generateId('attach'),
  type: options.type ?? 'image',
  uri: options.uri ?? 'file:///mock/attachment.jpg',
  mimeType: options.mimeType ?? 'image/jpeg',
  width: options.width ?? 1024,
  height: options.height ?? 768,
  fileName: options.fileName,
  textContent: options.textContent,
  fileSize: options.fileSize,
});

export const createImageAttachment = (options: Omit<MediaAttachmentFactoryOptions, 'type'> = {}): MediaAttachment =>
  createMediaAttachment({ ...options, type: 'image' });

export const createDocumentAttachment = (options: Omit<MediaAttachmentFactoryOptions, 'type'> = {}): MediaAttachment =>
  createMediaAttachment({
    ...options,
    type: 'document',
    mimeType: options.mimeType ?? 'application/pdf',
    fileName: options.fileName ?? 'document.pdf',
    textContent: options.textContent ?? 'Extracted document text content',
    fileSize: options.fileSize ?? 1024 * 1024, // 1MB
  });

// ============================================================================
// Generation Meta Factory
// ============================================================================

export interface GenerationMetaFactoryOptions {
  gpu?: boolean;
  gpuBackend?: string;
  gpuLayers?: number;
  modelName?: string;
  tokensPerSecond?: number;
  decodeTokensPerSecond?: number;
  timeToFirstToken?: number;
  tokenCount?: number;
  steps?: number;
  guidanceScale?: number;
  resolution?: string;
}

export const createGenerationMeta = (options: GenerationMetaFactoryOptions = {}): GenerationMeta => ({
  gpu: options.gpu ?? false,
  gpuBackend: options.gpuBackend ?? 'CPU',
  gpuLayers: options.gpuLayers ?? 0,
  modelName: options.modelName ?? 'Test Model',
  tokensPerSecond: options.tokensPerSecond ?? 15.5,
  decodeTokensPerSecond: options.decodeTokensPerSecond ?? 18.2,
  timeToFirstToken: options.timeToFirstToken ?? 0.5,
  tokenCount: options.tokenCount ?? 50,
  steps: options.steps,
  guidanceScale: options.guidanceScale,
  resolution: options.resolution,
});

// ============================================================================
// Project Factory
// ============================================================================

export interface ProjectFactoryOptions {
  id?: string;
  name?: string;
  description?: string;
  systemPrompt?: string;
  icon?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// Model File with MmProj Factory
// ============================================================================

export const createModelFileWithMmProj = (options: ModelFileFactoryOptions & {
  mmProjName?: string;
  mmProjSize?: number;
  mmProjDownloadUrl?: string;
} = {}): ModelFile => ({
  ...createModelFile(options),
  mmProjFile: {
    name: options.mmProjName ?? 'mmproj-model-f16.gguf',
    size: options.mmProjSize ?? 500 * 1024 * 1024,
    downloadUrl: options.mmProjDownloadUrl ?? 'https://huggingface.co/test/model/resolve/main/mmproj-model-f16.gguf',
  },
});

// ============================================================================
// Project Factory
// ============================================================================

export const createProject = (options: ProjectFactoryOptions = {}): Project => ({
  id: options.id ?? generateId('project'),
  name: options.name ?? 'Test Project',
  description: options.description ?? 'A test project for testing',
  systemPrompt: options.systemPrompt ?? 'You are a helpful assistant for this project.',
  icon: options.icon ?? '📁',
  createdAt: options.createdAt ?? new Date().toISOString(),
  updatedAt: options.updatedAt ?? new Date().toISOString(),
});

// ============================================================================
// Image Download Factories
// ============================================================================

export const makeImageDownloadDeps = (overrides: Partial<ImageDownloadDeps> = {}): ImageDownloadDeps => ({
  addDownloadedImageModel: jest.fn(),
  activeImageModelId: null,
  setActiveImageModelId: jest.fn(),
  setAlertState: jest.fn(),
  triedImageGen: false,
  ...overrides,
});
