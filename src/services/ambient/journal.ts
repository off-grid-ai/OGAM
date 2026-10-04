/**
 * Generate the day's journal narrative on-device, behind an injected seam (same shape as the
 * summariser) so it is testable without a loaded model and can run on local or remote engines. Reports
 * WHY it is empty rather than degrading silently: nothing to narrate, no model, or an error.
 */

import { buildJournalMessages, cleanJournal, type JournalSource } from './journalPrompt'
import type { Message } from '../../types'

export type JournalStatus = 'ok' | 'no-speech' | 'no-model' | 'error'

export interface JournalResult {
  text: string
  status: JournalStatus
}

export interface JournalDeps {
  generate: (messages: Message[], maxTokens: number) => Promise<string>
  isReady: () => boolean
}

/** A day's narrative fits in a few sentences; keep the pass short. */
export const JOURNAL_MAX_TOKENS = 220

export async function generateDayJournal(
  sources: JournalSource[],
  deps: JournalDeps,
  maxTokens: number = JOURNAL_MAX_TOKENS
): Promise<JournalResult> {
  const withText = sources.filter(s => s.headline.trim().length > 0)
  if (withText.length === 0) return { text: '', status: 'no-speech' }
  if (!deps.isReady()) return { text: '', status: 'no-model' }
  try {
    const raw = await deps.generate(buildJournalMessages(withText), maxTokens)
    return { text: cleanJournal(raw), status: 'ok' }
  } catch {
    return { text: '', status: 'error' }
  }
}
