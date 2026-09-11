/**
 * Streaming token shape emitted by the llama engine. Lives in its own module so consumers
 * Native generation adapters import it without importing llm.ts, which keeps
 * the engine boundary free of circular dependencies.
 */
type StreamToken = { content?: string; reasoningContent?: string };
export type StreamCallback = (data: StreamToken) => void;
type NativeToolCall = {
  id?: string;
  name: string;
  arguments: string;
};
export type CompleteCallback = (result: {
  content: string;
  reasoningContent: string;
  toolCalls?: NativeToolCall[];
}) => void;
