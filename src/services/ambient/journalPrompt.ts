/**
 * The day's journal: a short prose narrative of what happened, built from the day's conversation
 * summaries. Not a list - the Day view opens with a couple of sentences that read like a diary entry,
 * the names linking back to their conversation.
 *
 * PURE: the prompt that asks the model for that narrative, and a tolerant cleaner for the reply. The
 * model call is injected by the journal service.
 */

import type { Message } from '../../types'

/** The essentials of a conversation the journal narrates. */
export interface JournalSource {
  title: string
  headline: string
  people: string[]
}

const SYSTEM_PROMPT = [
  'You write a short diary-style recap of a person\'s day from summaries of their conversations.',
  'Two to four plain sentences. Say what happened and what mattered, in the order it happened.',
  'Name the people involved. No lists, no headings, no hype, no exclamation marks.',
  'Never invent anything that is not in the summaries. If there is little to say, keep it to one sentence.'
].join('\n')

export function buildJournalMessages(sources: JournalSource[]): Message[] {
  const body = sources
    .map(s => {
      const who = s.people.length > 0 ? ` (with ${s.people.join(', ')})` : ''
      return `- ${s.title}${who}: ${s.headline}`
    })
    .join('\n')
  return [
    { id: 'ambient-journal-sys', role: 'system', content: SYSTEM_PROMPT, timestamp: 0 },
    { id: 'ambient-journal-user', role: 'user', content: `Today's conversations:\n${body}`, timestamp: 0 }
  ]
}

/** Strip any leaked thinking block and surrounding whitespace; the journal is plain prose. */
export function cleanJournal(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}
