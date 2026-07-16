/**
 * The parsed shape of a model message: reasoning split from the visible response.
 * Owned HERE (the util that produces it via parseThinkingContent) so store/service/pro layers
 * import it without a backwards dependency on the ChatMessage component; ChatMessage/types
 * re-exports it for the UI. (Was imported FROM the component — the wrong direction.)
 */
export interface ParsedContent {
  thinking: string | null;
  response: string;
  isThinkingComplete: boolean;
  thinkingLabel?: string;
}

/**
 * THE single source of truth for the Gemma-native tool-call delimiter grammar. Both the
 * live streaming suppressor (ToolCallTokenFilter in llmToolGeneration) and the stored-content
 * stripper (below) derive from THIS set, so a format the parser accepts cannot be one the
 * stripper/filter miss. DR7 was exactly that drift: the parser accepted `<tool_call:` but the
 * filter/stripper only knew `<|tool_call>`, so the colon form leaked as visible text. A block
 * runs from any opener to the NEAREST closer (either closer can end any opener).
 */
export const TOOL_CALL_OPENERS: string[] = ['<|tool_call>', '<tool_call:', '<tool_call>'];
export const TOOL_CALL_CLOSERS: string[] = ['<tool_call|>', '</tool_call>'];

/**
 * THE single source of truth for the XML-style tool-call markup grammar
 * (`<function=NAME>…<parameter=NAME>…</function>`) some models emit. Both the tool-loop
 * EXTRACTOR (parseXmlStyleToolCall in generationToolLoop) and the display stripper (below)
 * derive their patterns from THESE sources so a form the extractor accepts cannot be one the
 * stripper misses — the DR7 promise applied to this second grammar. `\w+` after the `=` is the
 * tool/param name; the block closes with `</function>`.
 */
export const XML_TOOL_CALL_FUNCTION_MARKER = String.raw`<function=(\w+)>`;
export const XML_TOOL_CALL_PARAMETER_MARKER = String.raw`<parameter=(\w+)>`;
const XML_TOOL_CALL_FUNCTION_CLOSER = '</function>';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const CLOSERS_ALT = TOOL_CALL_CLOSERS.map(escapeRegExp).join('|');
// One closed-block pattern per opener, built from the grammar so parser and stripper cannot drift.
const TOOL_CALL_BLOCK_PATTERNS: RegExp[] = TOOL_CALL_OPENERS.map(
  (open) => new RegExp(String.raw`${escapeRegExp(open)}[\s\S]*?(?:${CLOSERS_ALT})\s*`, 'g'),
);
// Unclosed opener at end of text (model hit EOS mid tool-call) — strip to end for stored content.
const TOOL_CALL_UNCLOSED_PATTERNS: RegExp[] = TOOL_CALL_OPENERS.map(
  (open) => new RegExp(String.raw`${escapeRegExp(open)}[\s\S]*$`),
);

// XML-style tool-call block (`<function=…>…</function>`) and its unclosed-at-EOS tail, built from
// the shared XML_TOOL_CALL_* markers so the stripper and the extractor cannot drift on this form.
const XML_TOOL_CALL_BLOCK_PATTERN = new RegExp(
  String.raw`${XML_TOOL_CALL_FUNCTION_MARKER}[\s\S]*?${escapeRegExp(XML_TOOL_CALL_FUNCTION_CLOSER)}\s*`,
  'gi',
);
const XML_TOOL_CALL_UNCLOSED_PATTERN = new RegExp(String.raw`${XML_TOOL_CALL_FUNCTION_MARKER}[\s\S]*$`, 'i');

/**
 * Length of the longest suffix of `text` that is a PREFIX of `tag` — i.e. how much of a possibly-
 * incomplete tag is dangling at the end of a stream chunk, so the incremental parsers can hold it
 * back until the next chunk. Single source shared by ThinkTagParser and ToolCallTokenFilter (both
 * had a verbatim copy).
 */
export function partialTagSuffix(text: string, tag: string): number {
  for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}
/** Longest suffix of `text` that is a prefix of ANY tag — hold back a partial opener/closer of any form. */
export function maxPartialTagSuffix(text: string, tags: string[]): number {
  return tags.reduce((max, tag) => Math.max(max, partialTagSuffix(text, tag)), 0);
}

const CONTROL_TOKEN_PATTERNS: RegExp[] = [
  /<\|im_start\|>\s*(?:system|assistant|user|tool)?\s*\n?/gi,
  /<\|im_end\|>\s*\n?/gi,
  /<\|end\|>/gi,
  /<\|eot_id\|>/gi,
  /<\/s>/gi,
  // Gemma-native tool-call blocks (all openers × all closers), from the shared grammar above.
  // The streaming filter suppresses these live; this catches any that reach stored content.
  ...TOOL_CALL_BLOCK_PATTERNS,
  // XML-style `<function=…>…</function>` tool-call blocks (the extractor's second grammar).
  XML_TOOL_CALL_BLOCK_PATTERN,
  // Gemma 4 string-delimiter token that may appear outside a tool block
  /<\|">/g,
];

// Patterns for channel-based thinking format (used by some models like Qwen)
const CHANNEL_ANALYSIS_START = /<\|channel\|>analysis<\|message\|>/gi;
const CHANNEL_FINAL_START = /<\|channel\|>final<\|message\|>/gi;

/**
 * THE single source of truth for the reasoning delimiter grammar (open/close per format).
 * Both the complete-string parser (parseThinkingContent, below) and the incremental streaming
 * parser (ThinkTagParser in providers/openAICompatibleStream) derive the reasoning-vs-answer
 * split from THIS set — so they cannot disagree on which formats count as reasoning. The DR1
 * bug was the streaming parser hardcoding only `<think>`, leaking Gemma/Qwen channel reasoning
 * into the visible answer on remote providers. Ordered longest-open-first so a more specific
 * opener wins when prefixes overlap (`<|channel|>analysis` before `<|channel>thought`).
 * A contract test asserts parseThinkingContent splits every entry here correctly.
 */
export interface ReasoningDelimiter {
  open: string;
  close: string;
}
export const REASONING_DELIMITERS: ReasoningDelimiter[] = [
  { open: '<|channel|>analysis<|message|>', close: '<|channel|>final<|message|>' },
  // Gemma opener is the BARE `<|channel>thought` — the trailing newline it usually (but not always)
  // emits is OPTIONAL whitespace, NOT part of the delimiter. Encoding the `\n` here made the streaming
  // parser leak the bare opener when the model went straight to a tool call with an empty thought
  // (`<|channel>thought<tool_call>…`, device 2026-07-14). With the bare opener, streaming captures a
  // leading `\n` into reasoning (trimmed for display); the complete parser strips it via `\n?`.
  { open: '<|channel>thought', close: '<channel|>' },
  { open: '<think>', close: '</think>' },
];

// Gemma 4 thinking tags: `<|channel>thought`[optional `\n`]…`<channel|>`. The trailing newline MUST
// be optional — the model omits it when the thought is empty and it jumps straight to a tool call
// (`<|channel>thought<tool_call>…`), and a hardcoded `\n` then leaves the bare opener leaking into the
// visible answer (device 2026-07-14). Single source for the grammar: both the module regex consts and
// parseGemmaThinking derive from these strings so they cannot disagree on the delimiter shape.
const GEMMA4_THINK_OPEN_SRC = '<\\|channel>thought\\n?';
const GEMMA4_THINK_CLOSE_SRC = '<channel\\|>';
const GEMMA4_THINK_OPEN = new RegExp(GEMMA4_THINK_OPEN_SRC, 'gi');
const GEMMA4_THINK_CLOSE = new RegExp(GEMMA4_THINK_CLOSE_SRC, 'gi');

// Reasoning-capability markers a chat_template can carry. Two kinds, both meaning
// "this model reasons":
//   OUTPUT delimiters - the model emits these around its reasoning, and
//   parseThinkingContent extracts them from the model's OUTPUT:
//     1. <think> ...            DeepSeek/Qwen-style (the OD7 Qwythos case)
//     2. <|channel>thought      Gemma 4
//     3. <|channel|>analysis    Qwen channel format
//   KWARG switch - a template referencing `enable_thinking` honors the
//     chat_template_kwargs toggle, so the model reasons on demand even without a
//     literal <think> in the template (verified: Qwen3.5 on the Gateway).
//
// This does NOT own parseThinkingContent's positional parsing (that stays in
// ChatMessage/utils.ts and matches the same OUTPUT delimiters to slice content). It
// IS the single predicate for "does a chat_template indicate reasoning capability",
// shared by BOTH local model load (llmHelpers.detectThinkingSupport) and remote
// capability probing (remoteModelCapabilities) so on-device and gateway detection
// cannot diverge - the OD7 divergence was this list omitting enable_thinking.
const REASONING_TEMPLATE_MARKERS: RegExp[] = [
  /<think>/i,
  /<\|channel>thought/i,
  /<\|channel\|>analysis/i,
  /enable_thinking/i,
];

/**
 * Whether a chat_template indicates the model can produce reasoning - either it
 * embeds a reasoning output delimiter or exposes the enable_thinking kwarg switch.
 * Derived from the model's own template, not its name. The single source for
 * template-based reasoning detection, local and remote alike.
 */
export function templateEmitsReasoning(template: string | null | undefined): boolean {
  if (!template) return false;
  return REASONING_TEMPLATE_MARKERS.some((pattern) => pattern.test(template));
}

/**
 * Strip all control tokens including thinking delimiters.
 * Use this only on finalised/stored content where thinking has already been
 * extracted into reasoningContent by finalizeStreamingMessage.
 */
export function stripControlTokens(content: string): string {
  let result = CONTROL_TOKEN_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, ''), content);
  // Remove channel markers but preserve the content after them
  result = result.replace(CHANNEL_ANALYSIS_START, '');
  result = result.replace(CHANNEL_FINAL_START, '');
  result = result.replace(GEMMA4_THINK_OPEN, '');
  result = result.replace(GEMMA4_THINK_CLOSE, '');

  // ── Generic XML/structured block stripping ──────────────────────────────
  // Catches tool calls from any provider (minimax, anthropic, gemma, generic)
  // by matching any XML-like block whose tag name contains tool/invoke/function/parameter keywords.
  // This is intentionally broad — these blocks never contain natural language the user should see.
  result = result.replace(/<\/?(?:[\w:-]*(?:tool_call|invoke|function_call|parameters?)[\w:-]*)(?:\s[^>]*)?>[\s\S]*?(?=<\/?(?:[\w:-]*(?:tool_call|invoke|function_call|parameters?)[\w:-]*)(?:\s[^>]*)?>|$)/gi, '');
  // Safety net: strip any remaining paired XML blocks with tool/invoke in the tag name
  result = result.replace(/<([\w:-]*(?:tool_call|invoke|function_call)[\w:-]*)[\s\S]*?<\/\1>/gi, '');
  // Strip bare lines that are just a namespace:tag_name pattern (e.g. "minimax:tool_call")
  result = result.replace(/^[\w]+:[\w_]+\s*$/gm, '');
  // Unclosed Gemma-native tool-call opener at end (EOS mid-call) — the closed forms above are
  // handled by CONTROL_TOKEN_PATTERNS; this catches the truncated tail in stored content.
  result = TOOL_CALL_UNCLOSED_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, ''), result);
  // Unclosed XML-style `<function=…>` opener at end (EOS mid-call).
  result = result.replace(XML_TOOL_CALL_UNCLOSED_PATTERN, '');

  // ── Thinking blocks ─────────────────────────────────────────────────────
  // Complete <think>...</think> blocks (Qwen 3.5, DeepSeek, etc.)
  result = result.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Orphaned thinking: streaming parser may consume <think> but leave content + </think>
  result = result.replace(/^[\s\S]*?<\/think>\s*/i, '');
  // Bare <think> or </think> tags
  result = result.replace(/<\/?think>/gi, '');

  return result.trim();
}

/**
 * Strip control tokens during live streaming — removes noise tokens but
 * deliberately preserves thinking delimiters so finalizeStreamingMessage
 * can extract them into reasoningContent.
 */
export function stripStreamingControlTokens(content: string): string {
  return CONTROL_TOKEN_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, ''), content);
}

/**
 * Strip markdown formatting for TTS speech. Preserves the readable text
 * but removes syntax that Kokoro would read aloud as literal characters.
 */
function stripMarkdownForSpeech(content: string): string {
  let result = content;
  // Headers: ### Title → Title
  result = result.replace(/^#{1,6}\s+/gm, '');
  // Bold/italic: **text** or *text* or __text__ or _text_ → text
  result = result.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  result = result.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');
  // Links: [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Images: ![alt](url) → alt
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  // Inline code: `code` → code
  result = result.replace(/`([^`]+)`/g, '$1');
  // Code blocks: ```...``` → (removed)
  result = result.replace(/```[\s\S]*?```/g, '');
  // Tables: | cell | cell | → cell, cell (keep cell content, drop pipes/dashes)
  result = result.replace(/^\|[-:|\s]+\|$/gm, ''); // separator rows
  result = result.replace(/\|/g, ','); // pipes → commas
  // Bullet markers: * item or - item → item
  result = result.replace(/^[\s]*[*\-+]\s+/gm, '');
  // Numbered lists: 1. item → item
  result = result.replace(/^[\s]*\d+\.\s+/gm, '');
  // Horizontal rules
  result = result.replace(/^[-*_]{3,}$/gm, '');
  // Blockquotes: > text → text
  result = result.replace(/^>\s+/gm, '');
  // Clean up excessive whitespace/newlines
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

/**
 * The SINGLE source of truth for turning a stored assistant message into text
 * fit to speak: strip our control/reasoning tokens, then strip markdown syntax
 * TTS would otherwise voice as literal "star star" / "hash" / backticks / pipes.
 * Every speech caller (the chat-bubble Speak button, voice-mode turn speech, the
 * streaming-segment speaker) MUST route through this so they can never diverge —
 * previously the chat Speak button applied only stripControlTokens and read raw
 * markdown aloud (Q19).
 */
export function prepareMessageForSpeech(content: string): string {
  return stripMarkdownForSpeech(stripControlTokens(content));
}

// ── Model-output parsing (moved from ChatMessage/utils so store/service/pro layers
//    can import the ONE parser without a backwards component dependency) ──────────
/**
 * Parse content that may contain thinking/reasoning sections.
 * Handles three formats:
 * 1. <think>...</think> tags (DeepSeek-style, used by llama models with thinking enabled)
 * 2. <|channel>thought\n...<channel|> (Gemma 4)
 * 3. <|channel|>analysis<|message|>...<|channel|>final<|message|> (Qwen and similar models)
 */
/** Gemma 4: `<|channel>thought\n[thinking]<channel|>[response]` (asymmetric tags). null if absent. */
function parseGemmaThinking(content: string): ParsedContent | null {
  const open = new RegExp(GEMMA4_THINK_OPEN_SRC, 'i').exec(content);
  if (!open) return null;
  const thinkStart = open.index! + open[0].length;
  const close = new RegExp(GEMMA4_THINK_CLOSE_SRC, 'i').exec(content);
  if (close && close.index! >= thinkStart) {
    const thinkEnd = close.index!;
    return {
      thinking: content.slice(thinkStart, thinkEnd).trim(),
      response: content.slice(thinkEnd + close[0].length).trim(),
      isThinkingComplete: true,
    };
  }
  // Still streaming — thinking not yet closed.
  return { thinking: content.slice(thinkStart).trim(), response: '', isThinkingComplete: false };
}

/** Qwen-style channel: `<|channel|>analysis<|message|>[thinking]<|channel|>final<|message|>[response]`. */
function parseChannelThinking(content: string): ParsedContent | null {
  const analysis = /<\|channel\|>analysis<\|message\|>/i.exec(content);
  if (!analysis) return null;
  const analysisStart = analysis.index! + analysis[0].length;
  const final = /<\|channel\|>final<\|message\|>/i.exec(content);
  // No final marker, or markers out of order → thinking still in progress.
  if (!final || final.index! < analysisStart) {
    return { thinking: content.slice(analysisStart).trim(), response: '', isThinkingComplete: false };
  }
  const finalStart = final.index!;
  return {
    thinking: content.slice(analysisStart, finalStart).trim(),
    response: content.slice(finalStart + final[0].length).trim(),
    isThinkingComplete: true,
  };
}

/** `<think>...</think>` fallback — also handles a missing opening tag (llama.rn Jinja can consume it)
 *  and a leading `__LABEL:` prefix. Always returns (the terminal format). */
function parseThinkTags(content: string): ParsedContent {
  const startM = /<think>/i.exec(content);
  const endM = /<\/think>/i.exec(content);
  if (!startM) {
    // Opening tag consumed by the template, but thinking text + closing tag survive as tokens.
    if (endM) {
      const thinkEnd = endM.index!;
      const thinking = content.slice(0, thinkEnd).trim();
      if (thinking) {
        return { thinking, response: content.slice(thinkEnd + endM[0].length).trim(), isThinkingComplete: true };
      }
    }
    return { thinking: null, response: content, isThinkingComplete: true };
  }
  const thinkStart = startM.index! + startM[0].length;
  if (!endM) {
    return { thinking: content.slice(thinkStart), response: '', isThinkingComplete: false };
  }
  const thinkEnd = endM.index!;
  let thinking = content.slice(thinkStart, thinkEnd).trim();
  const response = content.slice(thinkEnd + endM[0].length).trim();
  let thinkingLabel: string | undefined;
  const labelMatch = /^__LABEL:(.+?)__\n*/.exec(thinking);
  if (labelMatch) {
    thinkingLabel = labelMatch[1];
    thinking = thinking.slice(labelMatch[0].length).trim();
  }
  return { thinking, response, isThinkingComplete: true, thinkingLabel };
}

export function parseThinkingContent(content: string): ParsedContent {
  // Try each format in precedence order; the <think> fallback always returns.
  return parseGemmaThinking(content) ?? parseChannelThinking(content) ?? parseThinkTags(content);
}

export interface ParsedModelOutput {
  /** Unified reasoning text across all formats (separate channel, <think>, Gemma/Qwen channel), or null. */
  reasoning: string | null;
  /** The visible answer — GUARANTEED free of reasoning, control tokens, and tool-call markup
   *  (<tool_call>/<function=…>/<parameter=…>/<|tool_call>) BY CONSTRUCTION. No renderer that reads
   *  this can leak raw model markup, because markup never survives this parse. */
  answer: string;
  isReasoningComplete: boolean;
  reasoningLabel?: string;
}

/**
 * THE single display parse for raw model output (SoC §A / DRY §C): split a raw assistant string
 * (or a separate reasoning channel + content) into reasoning + a clean answer, ONCE. Every renderer
 * consumes this instead of re-parsing message.content with its own logic. The `answer` invariant
 * (no control/tool-call markup) is the contract that makes the tool-call-leak class structurally
 * impossible — see the contract test in ChatMessageToolCallLeak / utils.test.
 */
export function parseModelOutput(content: string, reasoningContent?: string | null): ParsedModelOutput {
  if (reasoningContent) {
    // Separate reasoning channel: content is the answer; strip any stray control/tool markup + think tags.
    const answer = stripControlTokens(content).replaceAll(/<\/?think>/gi, '').trim();
    // Reasoning is "complete" only once the ANSWER has begun — while reasoning is still
    // streaming and no answer content has arrived, the header must read "Thinking..." not
    // the DONE "Thought process" label (Q6). The arriving answer is the completion signal.
    return { reasoning: reasoningContent, answer, isReasoningComplete: answer.length > 0 };
  }
  const p = parseThinkingContent(content);
  // Strip the RESPONSE SLICE only (an empty slice stays empty — never fall back to the whole
  // message, or a reasoning-only message duplicates its reasoning into the answer).
  const answer = p.response ? stripControlTokens(p.response) : '';
  return { reasoning: p.thinking, answer, isReasoningComplete: p.isThinkingComplete, reasoningLabel: p.thinkingLabel };
}
