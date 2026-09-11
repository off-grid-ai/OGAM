/**
 * Remote LLM Server Types
 *
 * Types for managing remote LLM servers (Ollama, LM Studio, etc.)
 * that expose OpenAI-compatible or Anthropic-compatible APIs.
 */
import {
  type ModelReasoningMetadata,
  type RemoteModelCapabilities as SharedRemoteModelCapabilities,
  type RemoteModelCatalog as SharedRemoteModelCatalog,
  type RemoteModelModality,
  type RemoteModelOption as SharedRemoteModelOption,
  type RemoteModalitySelections,
  type RemoteServerRecord,
} from '@offgrid/models';

/** Optional OpenAI-compatible media models served by this endpoint. */
export type RemoteMediaModelIds = RemoteModalitySelections;

export type RemoteModelCategory = RemoteModelModality;

/** One user-selectable model reported by the remote server. */
export type RemoteModelOption = SharedRemoteModelOption;

/** Models grouped by the OpenAI-compatible work they can perform. */
export type RemoteModelCatalog = SharedRemoteModelCatalog;

/** Remote server configuration */
export interface RemoteServer extends RemoteServerRecord {
  /** API key for authentication (optional, stored securely) */
  apiKey?: string;
  /** When this server was added */
  createdAt: string;
  /** User-defined notes or description */
  notes?: string;
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
interface RemoteModelCapabilities extends SharedRemoteModelCapabilities {
  /** Supports vision/image input */
  supportsVision: boolean;
  /** Supports function/tool calling */
  /** Absent means unknown: nothing has said either way. Unknown is not "no". */
  supportsToolCalling?: boolean;
  /** Supports extended thinking (reasoning tokens). Absent means unknown. */
  supportsThinking?: boolean;
  /** Provider-published reasoning control for this executable route. */
  reasoning?: ModelReasoningMetadata;
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
  selections?: RemoteMediaModelIds;
  /** Selectable models declared by an Off Grid Desktop gateway. */
  catalog?: RemoteModelCatalog;
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
