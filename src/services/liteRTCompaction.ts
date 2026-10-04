import {
  compactLiteRTSession,
  summarizeLiteRTSession,
  type InstallLiteRTToolHandler,
  type LiteRTSamplerConfig,
  type LiteRTSummarySender,
  type LiteRTTurn,
} from '@offgrid/models';
import { contextCompactionService } from './contextCompaction';

type ResetFn = (
  prompt: string,
  opts?: {
    samplerConfig?: LiteRTSamplerConfig;
    tools?: unknown[];
    history?: LiteRTTurn[];
  },
) => Promise<void>;

export type SendMessageFn = LiteRTSummarySender;
export type InstallToolHandlerFn = InstallLiteRTToolHandler;

/** Native generation adapter for the Shared bounded-summary workflow. */
export function summarizeSession(...args: [
  sendMessage: SendMessageFn,
  isReady: boolean,
  installToolHandler?: InstallToolHandlerFn,
  stopGeneration?: () => Promise<void>,
]): Promise<string | null> {
  const [sendMessage, isReady, installToolHandler, stopGeneration] = args;
  return summarizeLiteRTSession({
    send: sendMessage,
    ready: isReady,
    installToolHandler,
    stopGeneration,
  });
}

/** Mobile projects compaction activity. Shared owns the workflow and history decision. */
export function runCompaction(params: {
  history: LiteRTTurn[];
  systemPrompt: string;
  maxTokens: number;
  cumulativeTokens: number;
  conversationId: string;
  activeConversationId: string | null;
  opts: { samplerConfig?: LiteRTSamplerConfig; tools?: unknown[] };
  summarize: (fullHistory: LiteRTTurn[]) => Promise<string | null>;
  resetFn: ResetFn;
}): Promise<void> {
  return compactLiteRTSession({
    history: params.history,
    systemPrompt: params.systemPrompt,
    maxTokens: params.maxTokens,
    conversationId: params.conversationId,
    activeConversationId: params.activeConversationId,
    samplerConfig: params.opts.samplerConfig,
    tools: params.opts.tools,
    summarize: params.summarize,
    reset: (prompt, options) => params.resetFn(prompt, options),
    onCompacting: active => contextCompactionService.signalCompacting(active),
  });
}
