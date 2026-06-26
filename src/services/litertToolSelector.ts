/**
 * Two-pass tool selection for on-device models.
 *
 * When many tools are enabled, a small on-device model can't fit every schema in
 * context, so the first pass is a fast, tools-free routing step: "here is the
 * request and a name:description catalog — which tools are needed?" The selected
 * names then drive a much smaller tool set for the real generation pass.
 *
 * Engine-agnostic via an injected `generate` fn — LiteRT runs it on a throwaway
 * native session; llama (iOS, where Metal makes the extra prefill cheap) via a
 * capped ephemeral completion. Either way routing never enters chat/context.
 */
import { liteRTService } from './litert';

/** Engine-specific routing generation: (systemPrompt, userText) -> raw reply text. */
export type ToolSelectGenerate = (systemPrompt: string, userText: string) => Promise<string>;

const liteRTGenerate: ToolSelectGenerate = (s, u) => liteRTService.generateToolSelection(s, u);

const ROUTER_SYSTEM =
  'You are a tool router. From the tool list, reply with ONLY the exact names of ' +
  'the tools needed to answer the user request, comma-separated. Reply "none" if ' +
  'no tool is needed. Do not call any tools. Do not explain.';

interface OpenAITool {
  function: { name: string; description?: string };
}

function firstLine(desc: string | undefined, max = 100): string {
  const line = (desc ?? '').split('\n')[0].trim();
  return line.length > max ? line.slice(0, max) : line;
}

/**
 * Ask the model which of `tools` are relevant to `userText`. Lenient parse — small
 * models format the list inconsistently, so we keep any known tool name that appears
 * in the reply rather than parsing strict commas. Three-state result so the caller can
 * tell apart "no tool needed" from "couldn't read the reply":
 *   - string[] (non-empty): the selected tool names.
 *   - []:   the router explicitly said "none" — no tool is needed (send no tools).
 *   - null: the reply named no known tool and wasn't "none" (unusable) — fall back to all.
 */
export async function selectRelevantTools(
  userText: string,
  tools: OpenAITool[],
  generate: ToolSelectGenerate = liteRTGenerate,
): Promise<string[] | null> {
  if (tools.length === 0 || !userText.trim()) return null;

  const catalog = tools.map(t => `- ${t.function.name}: ${firstLine(t.function.description)}`).join('\n');
  const prompt = `User request:\n${userText}\n\nTools:\n${catalog}`;

  const raw = (await generate(ROUTER_SYSTEM, prompt)).toLowerCase();
  const selected = tools
    .map(t => t.function.name)
    .filter(name => raw.includes(name.toLowerCase()));

  if (selected.length > 0) {
    return selected;
  }
  if (raw.includes('none')) {
    return [];
  }
  return null;
}
