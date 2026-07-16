export { hardwareService } from './hardware';
export { huggingFaceService } from './huggingface';
export { modelManager } from './modelManager';
export { llmService } from './llm';
export { localDreamGeneratorService as onnxImageGeneratorService } from './localDreamGenerator';
export { intentClassifier } from './intentClassifier';
;
;
export { authService } from './authService';
export { whisperService, WHISPER_MODELS, WhisperBusyError } from './whisperService';
// ttsService deprecated — logic absorbed into OuteTTSEngine (src/engine/tts/engines/outetts/).
;
export { backgroundDownloadService } from './backgroundDownloadService';
export { activeModelService } from './activeModelService';
export type { ResourceUsage } from './activeModelService/types';
export { generationService } from './generationService';
export type { QueuedMessage } from './generationService';
export { imageGenerationService } from './imageGenerationService';
export type { ImageGenerationState } from './imageGenerationService';
;
;
export { documentService } from './documentService';
export { buildToolSystemPromptHint } from './tools';
;
export { contextCompactionService } from './contextCompaction';
export { transcriptSummarizer, NO_PREAMBLE_WITH_HEADINGS } from './transcriptSummarizer';
export type { SummarizeProgress } from './transcriptSummarizer';
export { setPendingChatAttachments, takePendingChatAttachments } from './chatAttachmentInbox';
export { ragService, retrievalService } from './rag';
;
// Providers
;
;
// HTTP Client
;
// Remote Server Manager
export { remoteServerManager } from './remoteServerManager';
// Text-model auto-load selection (memory-aware pick when none is resident)
export { selectTextModelToLoad, fitsBudget } from './selectTextModel';
// Residency manager - the single owner of the RAM budget + load gate. Callers
// that pick a model to auto-load must budget against getBudgetMB() so the pick
// and the load gate can never disagree (any memory-aware auto-load path).
export { modelResidencyManager } from './modelResidency';
