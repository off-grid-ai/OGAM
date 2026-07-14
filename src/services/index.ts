export { hardwareService } from './hardware';
export { huggingFaceService } from './huggingface';
export { modelManager } from './modelManager';
export { llmService } from './llm';
export { localDreamGeneratorService as onnxImageGeneratorService } from './localDreamGenerator';
export { intentClassifier, classifyToolsNeeded } from './intentClassifier';
export type { Intent } from './intentClassifier';
export { voiceService } from './voiceService';
export { authService } from './authService';
export { whisperService, WHISPER_MODELS, WhisperBusyError } from './whisperService';
// ttsService deprecated — logic absorbed into OuteTTSEngine (src/engine/tts/engines/outetts/).
export type { TranscriptionResult, TranscriptionCallback } from './whisperService';
export { backgroundDownloadService } from './backgroundDownloadService';
export { activeModelService } from './activeModelService';
export type { ActiveModelInfo, ResourceUsage, ModelType, MemoryCheckResult, MemoryCheckSeverity } from './activeModelService/types';
export { generationService } from './generationService';
export type { GenerationState, QueuedMessage } from './generationService';
export { imageGenerationService } from './imageGenerationService';
export type { ImageGenerationState } from './imageGenerationService';
export { fetchAvailableModels, getVariantLabel, guessStyle } from './huggingFaceModelBrowser';
export type { HFImageModel } from './huggingFaceModelBrowser';
export { documentService } from './documentService';
export { AVAILABLE_TOOLS, getToolsAsOpenAISchema, buildToolSystemPromptHint, executeToolCall } from './tools';
export type { ToolDefinition, ToolCall, ToolResult } from './tools';
export { contextCompactionService } from './contextCompaction';
export { transcriptSummarizer, NO_PREAMBLE_WITH_HEADINGS } from './transcriptSummarizer';
export type { SummarizeProgress } from './transcriptSummarizer';
export { setPendingChatAttachments, takePendingChatAttachments } from './chatAttachmentInbox';
export { ragService, retrievalService } from './rag';
export type { RagDocument, RagSearchResult, SearchResult, IndexProgress } from './rag';
// Providers
export { providerRegistry, getProviderForServer, localProvider } from './providers';
export type { LLMProvider, ProviderType, ProviderCapabilities, GenerationOptions, StreamCallbacks, CompletionResult } from './providers';
// HTTP Client
export { fetchWithTimeout, createStreamingRequest, imageToBase64DataUrl, testEndpoint, isPrivateNetworkEndpoint } from './httpClient';
// Remote Server Manager
export { remoteServerManager } from './remoteServerManager';
// Text-model auto-load selection (memory-aware pick when none is resident)
export { selectTextModelToLoad, fitsBudget } from './selectTextModel';
// Residency manager - the single owner of the RAM budget + load gate. Callers
// that pick a model to auto-load must budget against getBudgetMB() so the pick
// and the load gate can never disagree (any memory-aware auto-load path).
export { modelResidencyManager } from './modelResidency';
