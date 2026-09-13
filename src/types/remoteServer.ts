/**
 * Remote LLM Server Types
 *
 * Types for managing remote LLM servers (Ollama, LM Studio, etc.)
 * that expose OpenAI-compatible or Anthropic-compatible APIs.
 */

/** Provider types supported by the system */
type RemoteProviderType = 'openai-compatible' | 'anthropic';

/** Optional OpenAI-compatible media models served by this endpoint. */
export interface RemoteMediaModelIds {
  text?: string;
  image?: string;
  transcription?: string;
  voice?: string;
}

export type RemoteModelCategory = keyof RemoteMediaModelIds;

/** One user-selectable model reported by the remote server. */
export interface RemoteModelOption {
  id: string;
  name: string;
  /** Alternate active values returned by the Off Grid Desktop gateway, such as a primary filename. */
  activeAliases?: string[];
}

/** Models grouped by the OpenAI-compatible work they can perform. */
export type RemoteModelCatalog = Partial<
  Record<RemoteModelCategory, RemoteModelOption[]>
>;

export interface RemoteServerCapabilities {
  imageGeneration: boolean;
  transcription: boolean;
  voice: boolean;
}

/** Remote server configuration */
export interface RemoteServer {
  /** Unique identifier for this server */
  id: string;
  /** User-friendly name (e.g., "Ollama Desktop", "LM Studio Server") */
  name: string;
  /** Base endpoint URL (e.g., "http://192.168.1.50:11434") */
  endpoint: string;
  /** API key for authentication (optional, stored securely) */
  apiKey?: string;
  /** Provider type for message format handling */
  providerType: RemoteProviderType;
  /** When this server was added */
  createdAt: string;
  /** Last successful health check */
  lastHealthCheck?: string;
  /** Whether the server is currently reachable */
  isHealthy?: boolean;
  /** User-defined notes or description */
  notes?: string;
  /** Selected model IDs for each OpenAI-compatible endpoint. */
  mediaModels?: RemoteMediaModelIds;
  /** Available models reported by servers that declare a model kind. */
  modelCatalog?: RemoteModelCatalog;
  /** A detected model-management contract. Generic OpenAI-compatible servers leave this unset. */
  modelManagement?: 'offgrid-desktop-v1';
}

/** Model presence is the one source of truth for available remote media work. */
export function remoteServerCapabilities(
  server: Pick<RemoteServer, 'mediaModels'>,
): RemoteServerCapabilities {
  return {
    imageGeneration: !!server.mediaModels?.image?.trim(),
    transcription: !!server.mediaModels?.transcription?.trim(),
    voice: !!server.mediaModels?.voice?.trim(),
  };
}

/** Model discovered from a remote server */
export interface RemoteModel {
  /** Model identifier (provider-specific) */
  id: string;
  /** Display name */
  name: string;
  /** Server this model is available on */
  serverId: string;
  /** Model capabilities */
  capabilities: RemoteModelCapabilities;
  /** Model details from provider */
  details?: Record<string, unknown>;
  /** When this model info was last refreshed */
  lastUpdated: string;
}

/** Capabilities advertised by a remote model */
interface RemoteModelCapabilities {
  /** Supports vision/image input */
  supportsVision: boolean;
  /** Supports function/tool calling */
  supportsToolCalling: boolean;
  /** Supports extended thinking (reasoning tokens) */
  supportsThinking: boolean;
  /**
   * Whether the server honors `chat_template_kwargs.enable_thinking` to toggle
   * reasoning per request (discovered from the server, e.g. llama.cpp /props).
   */
  acceptsThinkingKwarg?: boolean;
  /** Maximum context window length */
  maxContextLength?: number;
  /** Model family or type hint */
  family?: string;
}

/** Result of testing a server connection */
export interface ServerTestResult {
  /** Whether the connection was successful */
  success: boolean;
  /** Error message if connection failed */
  error?: string;
  /** Time taken to connect in milliseconds */
  latency?: number;
  /** Available models discovered (if connection succeeded) */
  models?: RemoteModel[];
  /** Active media models declared by an Off Grid Desktop gateway */
  mediaModels?: RemoteMediaModelIds;
  /** Selectable models declared by an Off Grid Desktop gateway. */
  modelCatalog?: RemoteModelCatalog;
  /** Model-management contract detected during discovery. */
  modelManagement?: 'offgrid-desktop-v1';
  /** Server info (version, type, etc.) */
  serverInfo?: ServerInfo;
}

/** Server information returned from health check */
interface ServerInfo {
  /** Server software name (e.g., "ollama", "lmstudio") */
  name?: string;
  /** Server version */
  version?: string;
  /** Server type identifier */
  type?: string;
}
