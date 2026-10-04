/**
 * Summarise one conversation transcript into the timeline's structured card, on-device.
 *
 * Thin glue: build the prompt (pure), run it through the injected LLM call, parse the reply (pure). The
 * generate function AND a readiness check are injected, so this is unit-testable without a loaded model
 * and can later route to the Mac over Tailscale - the summariser does not care which engine answered.
 *
 * Crucially it reports WHY a card has no summary instead of degrading to a silent blank (the same
 * lesson as whisper: a swallowed failure reads as a bug). The status distinguishes nothing-to-summarise
 * from no-model-loaded from a real error, so the card can tell the user what to do (load a chat model)
 * rather than showing "No summary yet".
 */

import {
  buildSummaryMessages,
  parseAmbientSummary,
  EMPTY_SUMMARY,
  type AmbientSummary
} from './summaryPrompt'
import type { Message } from '../../types'

export type SummaryStatus = 'ok' | 'no-speech' | 'no-model' | 'error'

export interface SummarizeResult {
  summary: AmbientSummary
  status: SummaryStatus
}

export interface SummarizeDeps {
  /** One-shot completion capped at maxTokens; returns the raw model text. */
  generate: (messages: Message[], maxTokens: number) => Promise<string>
  /** True when a text model is resident. Injected so the summariser stays engine-agnostic. */
  isReady: () => boolean
}

/** Enough for a title, a sentence, and a few short bullets; keeps the on-device pass quick. */
export const SUMMARY_MAX_TOKENS = 512

export async function summarizeTranscript(
  transcript: string,
  deps: SummarizeDeps,
  flaggedSnippets: string[] = [],
  maxTokens: number = SUMMARY_MAX_TOKENS
): Promise<SummarizeResult> {
  if (transcript.trim().length === 0) {
    return { summary: { ...EMPTY_SUMMARY }, status: 'no-speech' }
  }
  if (!deps.isReady()) {
    // Transcript exists but no text model is loaded - the card should say so, not sit blank.
    return { summary: { ...EMPTY_SUMMARY }, status: 'no-model' }
  }
  try {
    const raw = await deps.generate(buildSummaryMessages(transcript, flaggedSnippets), maxTokens)
    return { summary: parseAmbientSummary(raw), status: 'ok' }
  } catch {
    return { summary: { ...EMPTY_SUMMARY }, status: 'error' }
  }
}

/** What to show in place of a headline when a summary is absent - so an empty card explains itself. */
export function summaryStatusHint(status: SummaryStatus): string {
  switch (status) {
    case 'no-speech':
      return 'No speech was transcribed'
    case 'no-model':
      return 'Load a chat model in Models for summaries'
    case 'error':
      return 'Summary could not be generated'
    case 'ok':
      return 'No summary'
  }
}
