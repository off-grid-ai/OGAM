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
 * Shared live streaming suppressor and the stored-content
 * stripper (below) derive from THIS set, so a format the parser accepts cannot be one the
 * stripper/filter miss. DR7 was exactly that drift: the parser accepted `<tool_call:` but the
 * filter/stripper only knew `<|tool_call>`, so the colon form leaked as visible text. A block
 * runs from any opener to the NEAREST closer (either closer can end any opener).
 */
export const TOOL_CALL_OPENERS: string[] = [...SHARED_TOOL_CALL_OPENERS];
export const TOOL_CALL_CLOSERS: string[] = [...SHARED_TOOL_CALL_CLOSERS];

/**
 * THE single source of truth for the XML-style tool-call markup grammar
 * (`<function=NAME>…<parameter=NAME>…</function>`) some models emit. Both the tool-loop
 * EXTRACTOR (parseXmlStyleToolCall in generationToolLoop) and the display stripper (below)
 * derive their patterns from THESE sources so a form the extractor accepts cannot be one the
 * stripper misses — the DR7 promise applied to this second grammar. `\w+` after the `=` is the
 * tool/param name; the block closes with `</function>`.
 */
const XML_TOOL_CALL_FUNCTION_MARKER =
  SHARED_XML_TOOL_CALL_FUNCTION_MARKER;
const XML_TOOL_CALL_FUNCTION_CLOSER = '</function>';

const CLOSERS_ALT = TOOL_CALL_CLOSERS.map(closer => escapeRegExp(closer)).join(
  '|',
);
// One closed-block pattern per opener, built from the grammar so parser and stripper cannot drift.
const TOOL_CALL_BLOCK_PATTERNS: RegExp[] = TOOL_CALL_OPENERS.map(
  open =>
    new RegExp(
      String.raw`${escapeRegExp(open)}[\s\S]*?(?:${CLOSERS_ALT})\s*`,
      'g',
    ),
);
// XML-style tool-call block (`<function=…>…</function>`) and its unclosed-at-EOS tail, built from
// the shared XML_TOOL_CALL_* markers so the stripper and the extractor cannot drift on this form.
const XML_TOOL_CALL_BLOCK_PATTERN = new RegExp(
  String.raw`${XML_TOOL_CALL_FUNCTION_MARKER}[\s\S]*?${escapeRegExp(
    XML_TOOL_CALL_FUNCTION_CLOSER,
  )}\s*`,
  'gi',
);

/**
 * Length of the longest suffix of `text` that is a PREFIX of `tag` — i.e. how much of a possibly-
 * incomplete tag is dangling at the end of a stream chunk, so the incremental parsers can hold it
 * back until the next chunk. Single source shared by ThinkTagParser and ToolCallTokenFilter (both
 * had a verbatim copy).
 */
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
export type ReasoningDelimiter = SharedReasoningDelimiter;
export const REASONING_DELIMITERS: ReasoningDelimiter[] =
  SHARED_REASONING_DELIMITERS.map(delimiter => ({ ...delimiter }));

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
/**
 * Whether a chat_template indicates the model can produce reasoning - either it
 * embeds a reasoning output delimiter or exposes the enable_thinking kwarg switch.
 * Derived from the model's own template, not its name. The single source for
 * template-based reasoning detection, local and remote alike.
 */
export function templateEmitsReasoning(
  template: string | null | undefined,
): boolean {
  return chatTemplateSupportsReasoning(template);
}

/**
 * Strip all control tokens including thinking delimiters.
 * Use this only on finalised/stored content where thinking has already been
 * extracted into reasoningContent by finalizeStreamingMessage.
 */
export function stripControlTokens(content: string): string {
  return stripChatControlTokens(content);
}

/**
 * Strip control tokens during live streaming — removes noise tokens but
 * deliberately preserves thinking delimiters so finalizeStreamingMessage
 * can extract them into reasoningContent.
 */
export function stripStreamingControlTokens(content: string): string {
  return CONTROL_TOKEN_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, ''),
    content,
  );
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
export function parseThinkingContent(content: string): ParsedContent {
  return parseChatThinkingContent(content);
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
export function parseModelOutput(
  content: string,
  reasoningContent?: string | null,
): ParsedModelOutput {
  return parseChatModelOutput(content, reasoningContent);
}
import {
  REASONING_DELIMITERS as SHARED_REASONING_DELIMITERS,
  TOOL_CALL_CLOSERS as SHARED_TOOL_CALL_CLOSERS,
  TOOL_CALL_OPENERS as SHARED_TOOL_CALL_OPENERS,
  XML_TOOL_CALL_FUNCTION_MARKER as SHARED_XML_TOOL_CALL_FUNCTION_MARKER,
  escapeRegExp,
  parseChatModelOutput,
  parseChatThinkingContent,
  stripChatControlTokens,
  type ReasoningDelimiter as SharedReasoningDelimiter,
} from '@offgrid/sync';
import { chatTemplateSupportsReasoning } from '@offgrid/models';
