/** Shared prompt-window guard for llama.rn (CPU/OpenCL/HTP) and llama.kt (Vulkan).
 * The complete chat stays in storage. Only the inference prompt is windowed.
 * Never assume native KV-cache shifting is safe on Android OpenCL.
 */

/** Messages dropped at a time when the history no longer fits (keeps the prompt start stable between drops). */
const DROP_CHUNK = 8;
export type ContextMessage = { role: string; content: string };
export type ContextWindowResult<T> = {
  messages: T[];
  droppedMessages: number;
  latestTruncated: boolean;
  promptTokens: number;
  budgetTokens: number;
  /** How long the newest message was in tokens, when it had to be cut to fit. */
  latestTokens?: number;
};

/** Smallest and largest reply the automatic length will choose. */
export const AUTO_MIN_REPLY_TOKENS = 1024;
export const AUTO_MAX_REPLY_TOKENS = 8192;

/**
 * How long a reply may be when the length is automatic: as much of the memory window as the prompt guard will keep
 * free for the answer (40% of it), within sensible limits. A fixed 1K cap made long writing (files, code, reports)
 * stop mid-way and need "continue" again and again, which was far slower than writing it in one go.
 */
export function autoReplyTokens(contextTokens: number): number {
  const context = Math.max(256, Math.floor(contextTokens));
  return Math.min(AUTO_MAX_REPLY_TOKENS, Math.max(AUTO_MIN_REPLY_TOKENS, Math.floor(context * 0.4)));
}

/** The reply limit in use: the chosen number when manual, else the automatic one for this context size. */
export function resolveReplyTokens(
  settings: { maxTokens?: number; maxTokensMode?: 'auto' | 'manual' },
  contextTokens?: number,
): number {
  if (settings.maxTokensMode === 'manual' || !contextTokens) return settings.maxTokens || 512;
  return autoReplyTokens(contextTokens);
}

export function contextOutputReserve(contextTokens: number, requestedOutput: number): number {
  const context = Math.max(256, Math.floor(contextTokens));
  return Math.min(Math.max(64, requestedOutput || 512), Math.floor(context * 0.4));
}

export async function fitMessagesToContext<T extends ContextMessage>(options: {
  messages: T[];
  contextTokens: number;
  outputTokens: number;
  format: (messages: T[]) => string | Promise<string>;
  countTokens: (text: string) => Promise<number>;
}): Promise<ContextWindowResult<T>> {
  const { messages, format, countTokens } = options;
  const context = Math.max(256, Math.floor(options.contextTokens));
  // Include room for chat-template separators, BOS/EOS and native bookkeeping.
  const budget = Math.max(64, context - contextOutputReserve(context, options.outputTokens)
    - Math.max(32, Math.ceil(context * 0.05)));
  const count = async (selection: T[]): Promise<number> => {
    const formatted = await format(selection);
    try {
      const result = await countTokens(formatted);
      if (Number.isFinite(result) && result >= 0) return Math.ceil(result);
    } catch { /* Some runtimes lack a tokenizer before the first completion. */ }
    // Conservative fallback for non-English text.
    return Math.ceil(formatted.length / 2);
  };
  const total = await count(messages);
  if (total <= budget) return {
    messages, droppedMessages: 0, latestTruncated: false,
    promptTokens: total, budgetTokens: budget,
  };

  const systems = messages.filter(m => m.role === 'system');
  const history = messages.filter(m => m.role !== 'system');
  if (!history.length) {
    throw new Error('The system instructions exceed the active context window. Increase context size or shorten the instructions.');
  }
  const newest = history[history.length - 1];
  const minimum = [...systems, newest];
  const minimumTokens = await count(minimum);
  if (minimumTokens > budget) {
    if (await count(systems) >= budget - 32) {
      throw new Error('The system instructions leave no space for a message. Shorten the system prompt or increase context.');
    }
    const messageWithLength = (n: number): T => ({
      ...newest,
      content: n >= newest.content.length ? newest.content :
        '[Earlier message content omitted to fit active context]\n' + newest.content.slice(-n),
    });
    let low = 0, high = newest.content.length;
    // Retain the latest user request and its ending instructions.
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (await count([...systems, messageWithLength(mid)]) <= budget) low = mid;
      else high = mid - 1;
    }
    const trimmed = [...systems, messageWithLength(low)];
    const tokens = await count(trimmed);
    if (tokens > budget) {
      throw new Error('The active context is too small for the latest message.');
    }
    return {
      messages: trimmed, droppedMessages: Math.max(0, history.length - 1),
      latestTruncated: low < newest.content.length,
      promptTokens: tokens, budgetTokens: budget, latestTokens: minimumTokens,
    };
  }

  let low = 1, high = history.length;
  // Binary search for the longest recent suffix that fits.
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (await count([...systems, ...history.slice(-mid)]) <= budget) low = mid;
    else high = mid - 1;
  }
  // Drop older messages in chunks (a quarter of the history at a time), not one
  // by one. The prompt start then stays identical for several turns, so the
  // native KV cache can be reused instead of re-reading the whole prompt each send.
  const needed = history.length - low;
  // A fixed chunk (DROP_CHUNK): one that grows with the history moved the start of the prompt on most turns.
  const chunk = DROP_CHUNK;
  const dropped = Math.min(history.length - 1, Math.ceil(needed / chunk) * chunk);
  const kept = [...systems, ...history.slice(dropped)];
  return {
    messages: kept, droppedMessages: dropped,
    latestTruncated: false,
    promptTokens: await count(kept), budgetTokens: budget,
  };
}
