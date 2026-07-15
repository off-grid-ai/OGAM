/**
 * Streaming token shape emitted by the llama engine. Lives in its own module so consumers
 * (llmToolGeneration, generationToolLoop) import it WITHOUT importing llm.ts — llm.ts imports
 * llmToolGeneration back, forming a cycle. llm.ts re-exports it for existing importers.
 */
export type StreamToken = { content?: string; reasoningContent?: string };
