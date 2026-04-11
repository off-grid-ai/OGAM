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

// Gemma 4 thinking tags: <|channel>thought\n...<channel|>
const GEMMA4_THINK_OPEN = /<\|channel>thought\n/gi;
const GEMMA4_THINK_CLOSE = /<channel\|>/gi;

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