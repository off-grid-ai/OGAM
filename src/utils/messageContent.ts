import type { ParsedContent } from '../components/ChatMessage/types';

const CONTROL_TOKEN_PATTERNS: RegExp[] = [
  /<\|im_start\|>\s*(?:system|assistant|user|tool)?\s*\n?/gi,
  /<\|im_end\|>\s*\n?/gi,
  /<\|end\|>/gi,
  /<\|eot_id\|>/gi,
  /<\/s>/gi,
  /<tool_call>[\s\S]*?<\/tool_call>\s*/g,
  // Gemma 4 native tool call format: <|tool_call>...<tool_call|>
  // The streaming filter in llmToolGeneration suppresses these live;
  // this catches any that slip through into stored message content.
  /<\|tool_call>[\s\S]*?<tool_call\|>\s*/g,
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
  { open: '<|channel>thought\n', close: '<channel|>' },
  { open: '<think>', close: '</think>' },
];

// Gemma 4 thinking tags: <|channel>thought\n...<channel|>
const GEMMA4_THINK_OPEN = /<\|channel>thought\n/gi;
const GEMMA4_THINK_CLOSE = /<channel\|>/gi;

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
export function stripMarkdownForSpeech(content: string): string {
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
  // Gemma 4 thinking format: <|channel>thought\n[thinking]<channel|>[response]
  // Note asymmetric tags: <|channel> opens (with channel name 'thought'), <channel|> closes.
  const gemmaOpenMatch = content.match(/<\|channel>thought\n/i);
  const gemmaCloseMatch = content.match(/<channel\|>/i);

  if (gemmaOpenMatch) {
    const thinkStart = gemmaOpenMatch.index! + gemmaOpenMatch[0].length;
    if (gemmaCloseMatch && gemmaCloseMatch.index! >= thinkStart) {
      const thinkEnd = gemmaCloseMatch.index!;
      return {
        thinking: content.slice(thinkStart, thinkEnd).trim(),
        response: content.slice(thinkEnd + gemmaCloseMatch[0].length).trim(),
        isThinkingComplete: true,
      };
    }
    // Still streaming — thinking not yet closed
    return {
      thinking: content.slice(thinkStart).trim(),
      response: '',
      isThinkingComplete: false,
    };
  }

  // Check for channel-based thinking format
  // Format: <|channel|>analysis<|message|>[thinking content]<|channel|>final<|message|>[response]
  const channelAnalysisMatch = content.match(/<\|channel\|>analysis<\|message\|>/i);
  const channelFinalMatch = content.match(/<\|channel\|>final<\|message\|>/i);

  if (channelAnalysisMatch) {
    const analysisStart = channelAnalysisMatch.index! + channelAnalysisMatch[0].length;

    if (channelFinalMatch) {
      // We have both analysis and final markers
      const finalStart = channelFinalMatch.index!;

      // Guard against out-of-order markers (final before analysis)
      if (finalStart < analysisStart) {
        return {
          thinking: content.slice(analysisStart).trim(),
          response: '',
          isThinkingComplete: false,
        };
      }

      const thinkingContent = content.slice(analysisStart, finalStart).trim();
      const responseContent = content.slice(finalStart + channelFinalMatch[0].length).trim();

      return {
        thinking: thinkingContent,
        response: responseContent,
        isThinkingComplete: true,
      };
    }

    // Only analysis marker - thinking is still in progress
    const thinkingContent = content.slice(analysisStart).trim();
    return {
      thinking: thinkingContent,
      response: '',
      isThinkingComplete: false,
    };
  }

  // Fall back to <think></think> format
  const thinkStartMatch = content.match(/<think>/i);
  const thinkEndMatch = content.match(/<\/think>/i);

  if (!thinkStartMatch) {
    // Handle  HLSL without HLSL — llama.rn Jinja template may consume
    // the opening HLSL tag while leaving thinking text + HLSL as tokens
    if (thinkEndMatch) {
      const thinkEnd = thinkEndMatch.index!;
      const thinkingContent = content.slice(0, thinkEnd).trim();
      const responseContent = content.slice(thinkEnd + thinkEndMatch[0].length).trim();
      if (thinkingContent) {
        return {
          thinking: thinkingContent,
          response: responseContent,
          isThinkingComplete: true,
        };
      }
    }
    return { thinking: null, response: content, isThinkingComplete: true };
  }

  const thinkStart = thinkStartMatch.index! + thinkStartMatch[0].length;

  if (!thinkEndMatch) {
    const thinkingContent = content.slice(thinkStart);
    return {
      thinking: thinkingContent,
      response: '',
      isThinkingComplete: false,
    };
  }

  const thinkEnd = thinkEndMatch.index!;
  let thinkingContent = content.slice(thinkStart, thinkEnd).trim();
  const responseContent = content.slice(thinkEnd + thinkEndMatch[0].length).trim();

  let thinkingLabel: string | undefined;
  const labelMatch = thinkingContent.match(/^__LABEL:(.+?)__\n*/);
  if (labelMatch) {
    thinkingLabel = labelMatch[1];
    thinkingContent = thinkingContent.slice(labelMatch[0].length).trim();
  }

  return {
    thinking: thinkingContent,
    response: responseContent,
    isThinkingComplete: true,
    thinkingLabel,
  };
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
    return { reasoning: reasoningContent, answer, isReasoningComplete: true };
  }
  const p = parseThinkingContent(content);
  // Strip the RESPONSE SLICE only (an empty slice stays empty — never fall back to the whole
  // message, or a reasoning-only message duplicates its reasoning into the answer).
  const answer = p.response ? stripControlTokens(p.response) : '';
  return { reasoning: p.thinking, answer, isReasoningComplete: p.isThinkingComplete, reasoningLabel: p.thinkingLabel };
}
