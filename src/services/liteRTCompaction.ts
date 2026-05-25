import { contextCompactionService } from './contextCompaction';

type Turn = { role: 'user' | 'assistant'; content: string };
type SamplerConfigOpts = { temperature?: number; topK?: number; topP?: number };
type ResetFn = (
  prompt: string,
  opts?: { samplerConfig?: SamplerConfigOpts; tools?: any[]; history?: Turn[] },
) => Promise<void>;
export type SendMessageFn = (
  text: string,
  callbacks: {
    onToken: (token: string) => void;
    onReasoning: (token: string) => void;
    onComplete: (content: string, reasoning: string, stats?: any) => void;
    onError: (err: Error) => void;
  },
) => void;

type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<string>;
export type InstallToolHandlerFn = (h: ToolHandler) => () => void;

const NEUTRAL_TOOL_HANDLER: ToolHandler = async () =>
  'No tool needed. Reply in plain text with the summary requested.';

// eslint-disable-next-line max-params
export async function summarizeSession(
  sendMessage: SendMessageFn,
  isReady: boolean,
  installToolHandler?: InstallToolHandlerFn,
  stopGeneration?: () => Promise<void>,
): Promise<string | null> {
  // Active conversation has tools registered with autoToolCalling=true. If the
  // model emits a tool_call mid-summary and the handler is null, sendMessage's
  // fallback ("Tool unavailable…") often makes the model emit 0-1 tokens and quit.
  // Install a neutral handler that nudges the model back to plain text.
  const restoreHandler = installToolHandler?.(NEUTRAL_TOOL_HANDLER);
  return new Promise<string | null>((resolve) => {
    if (!isReady) { restoreHandler?.(); resolve(null); return; }
    let summary = '';
    let finished = false;
    const finish = (value: string | null) => {
      if (finished) return;
      finished = true;
      restoreHandler?.();
      resolve(value);
    };
    const timeout = setTimeout(() => {
      // Stop native generation before resetConversation is called to avoid race condition
      stopGeneration?.().catch(() => {}).finally(() => finish(null));
    }, 20_000);
    sendMessage(
      'Briefly summarize our conversation so far — key topics, decisions, and context. 3 to 5 sentences maximum. Do not call any tools, just answer in plain text.',
      {
        onToken: (token) => { summary += token; },
        onReasoning: () => {},
        onComplete: () => {
          clearTimeout(timeout);
          const trimmed = summary.trim();
          finish(trimmed.length >= 30 ? trimmed : null);
        },
        onError: (_err) => {
          clearTimeout(timeout);
          finish(null);
        },
      },
    );
  });
}

export async function runCompaction(params: {
  history: Turn[];
  systemPrompt: string;
  maxTokens: number;
  cumulativeTokens: number;
  conversationId: string;
  activeConversationId: string | null;
  opts: { samplerConfig?: SamplerConfigOpts; tools?: any[] };
  summarize: (fullHistory: Turn[]) => Promise<string | null>;
  resetFn: ResetFn;
}): Promise<void> {
  const { history, systemPrompt, maxTokens, conversationId, activeConversationId, opts, summarize, resetFn } = params;
  contextCompactionService.signalCompacting(true);
  try {
    const POST_COMPACT_TARGET = 0.45;
    const hasActiveSession = activeConversationId === conversationId;
    const SUMMARY_RESERVE_TOKENS = hasActiveSession ? 200 : 0;
    const systemAndToolsChars = systemPrompt.length + (opts.tools && opts.tools.length > 0 ? JSON.stringify(opts.tools).length : 0);
    const systemAndToolsTokens = Math.ceil(systemAndToolsChars / 4);
    const historyBudgetTokens = Math.max(
      Math.floor(maxTokens * POST_COMPACT_TARGET) - systemAndToolsTokens - SUMMARY_RESERVE_TOKENS,
      50,
    );
    const recentBudgetChars = historyBudgetTokens * 4;

    let charCount = 0;
    let recentStart = history.length;
    for (let i = history.length - 1; i >= 0; i--) {
      charCount += history[i].content.length;
      if (charCount > recentBudgetChars) break;
      recentStart = i;
    }
    recentStart = Math.min(recentStart, Math.max(0, history.length - 2));
    const recentHistory = history.slice(recentStart);

    let summary: string | null = null;
    if (hasActiveSession) {
      summary = await summarize(history);
    }

    const compactedHistory: Turn[] = summary
      ? [
          { role: 'user', content: `[Context from earlier in our conversation]: ${summary}` },
          { role: 'assistant', content: 'Understood.' },
          ...recentHistory,
        ]
      : recentHistory;

    await resetFn(systemPrompt, { samplerConfig: opts.samplerConfig, tools: opts.tools, history: compactedHistory });
  } finally {
    contextCompactionService.signalCompacting(false);
  }
}
