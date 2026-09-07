/**
 * Turning a conversation transcript into a structured summary the timeline can render.
 *
 * The timeline card is not a wall of transcript - it is a title, a one-line headline, and the few
 * things that matter: decisions, action items, who was there. That shape is the product. This module
 * owns the PURE halves of producing it: the prompt that asks the on-device model for exactly those
 * fields, and a tolerant parser that turns the model's reply into the typed shape. The model call
 * itself (I/O) is injected by the summariser service.
 *
 * The parser is deliberately forgiving: a small on-device model wraps JSON in prose, leaks a <think>
 * block, emits a single string where a list belongs, or omits a field. None of that should sink a
 * card, so we extract the first JSON object, coerce every field, and fall back to safe defaults - a
 * summary that is thin is fine; a crash on the timeline is not.
 */

import type { Message } from '../../types'

export interface AmbientSummary {
  /** Short human label for the conversation (a few words). */
  title: string
  /** One-sentence gist. */
  headline: string
  decisions: string[]
  actionItems: string[]
  people: string[]
}

export const EMPTY_SUMMARY: AmbientSummary = {
  title: 'Conversation',
  headline: '',
  decisions: [],
  actionItems: [],
  people: []
}

const SYSTEM_PROMPT = [
  'You summarise a transcript of a real conversation for a review timeline.',
  'Reply with ONLY a JSON object, no prose before or after, in this exact shape:',
  '{"title": string, "headline": string, "decisions": string[], "actionItems": string[], "people": string[]}',
  'Rules:',
  '- title: at most 6 words naming what the conversation was about.',
  '- headline: one plain sentence saying what happened. No hype, no exclamation marks.',
  '- decisions: things that were decided. Empty array if none.',
  '- actionItems: concrete things someone agreed to do, phrased as short imperatives. Empty if none.',
  '- people: names of participants you can identify from the text. Empty if none.',
  '- Never invent facts that are not in the transcript.'
].join('\n')

export function buildSummaryMessages(transcript: string, flaggedSnippets: string[] = []): Message[] {
  // Note-first: the moments the user flagged live are the ones they care about, so name them and tell
  // the model to prioritise them. This is what makes the summary "sound like you took the note".
  const flaggedBlock =
    flaggedSnippets.length > 0
      ? `\n\nThe user flagged these moments as important; make sure the summary reflects them:\n${flaggedSnippets
          .map(s => `- ${s}`)
          .join('\n')}`
      : ''
  return [
    { id: 'ambient-sum-sys', role: 'system', content: SYSTEM_PROMPT, timestamp: 0 },
    {
      id: 'ambient-sum-user',
      role: 'user',
      content: `Transcript:\n${transcript}${flaggedBlock}`,
      timestamp: 0
    }
  ]
}

const asStringArray = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value]
  return raw
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(item => item.length > 0)
}

const asString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback

/** Pull the first balanced {...} object out of arbitrary model output. */
function extractJsonObject(raw: string): string | null {
  const withoutThinking = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const start = withoutThinking.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < withoutThinking.length; i += 1) {
    const ch = withoutThinking[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return withoutThinking.slice(start, i + 1)
    }
  }
  return null
}

export function parseAmbientSummary(raw: string): AmbientSummary {
  const json = extractJsonObject(raw)
  if (!json) return { ...EMPTY_SUMMARY }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(json) as Record<string, unknown>
  } catch {
    return { ...EMPTY_SUMMARY }
  }
  return {
    title: asString(parsed.title, EMPTY_SUMMARY.title),
    headline: asString(parsed.headline, EMPTY_SUMMARY.headline),
    decisions: asStringArray(parsed.decisions),
    actionItems: asStringArray(parsed.actionItems),
    people: asStringArray(parsed.people)
  }
}
