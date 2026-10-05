/**
 * Offload the ambient TEXT passes — the per-conversation summary, the day journal, and the day
 * to-dos — to the paired Mac's LLM over the SAME gateway + token the recorder already uses for
 * transcription and diarization.
 *
 * The rule the user expects: offloading to the Mac means offloading EVERYTHING to it, so a transcript
 * whisper ran on the Mac is also summarised / journalled / turned into to-dos on the Mac, WITHOUT the
 * Mac having to be separately picked as the active chat model. `onDeviceOnly` always wins — when the
 * user has forced local, a transcript is never sent to a server for any of these passes.
 */
import { currentMacOffloadTarget, chatCompletionsEndpoint } from './macTranscriptionTarget'

/** The Mac is ready to take a text pass when offload is on and the user hasn't forced on-device. */
export function macTextReady(onDeviceOnly: boolean): boolean {
  return !onDeviceOnly && currentMacOffloadTarget() !== null
}

/** Run one chat completion on the Mac's text model (OpenAI-compatible /v1/chat/completions). Throws
 *  so callers can fall back to the on-device / active engine when the Mac can't answer. */
export async function generateOnMacText(
  messages: ReadonlyArray<{ role: string; content: string }>,
  maxTokens: number,
): Promise<string> {
  const target = currentMacOffloadTarget()
  if (!target) throw new Error('ambient: no Mac available for text offload')
  const response = await fetch(chatCompletionsEndpoint(target.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.token}` },
    body: JSON.stringify({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      stream: false,
    }),
  })
  if (!response.ok) throw new Error(`ambient: Mac text generation failed (HTTP ${response.status})`)
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('ambient: Mac returned no text content')
  return content
}

/**
 * Append Qwen3's `/no_think` soft-switch to the last user turn. On-device thinking models (Qwen3) else
 * spend the whole token budget "reasoning" and return an EMPTY answer for a structured JSON task like
 * the summary — producing a blank card with no headline/to-dos. `/no_think` makes the model answer
 * directly; it's harmless (ignored) on non-thinking models. Applied ONLY to the on-device path — the
 * Mac's model gets the clean prompt.
 */
function withNoThink(
  messages: ReadonlyArray<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const out = messages.map(m => ({ role: m.role, content: m.content }))
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i].role === 'user') {
      out[i] = { role: 'user', content: `${out[i].content}\n/no_think` }
      return out
    }
  }
  return out
}

/**
 * One-shot text generation for an ambient pass: the Mac's LLM when offloading there, else the active
 * on-device / remote engine. A Mac failure falls back to the local engine rather than losing the pass.
 */
export async function generateAmbientText(
  messages: ReadonlyArray<{ role: string; content: string }>,
  maxTokens: number,
  onDeviceOnly: boolean,
  localGenerate: (messages: ReadonlyArray<{ role: string; content: string }>, maxTokens: number) => Promise<string>,
): Promise<string> {
  if (macTextReady(onDeviceOnly)) {
    try {
      return await generateOnMacText(messages, maxTokens)
    } catch {
      // Mac couldn't answer — fall through to whatever local/active engine is available.
    }
  }
  // On-device: strip thinking so a Qwen3-class model emits the answer instead of burning the budget.
  return localGenerate(withNoThink(messages), maxTokens)
}
