/**
 * Wires the day journal to release's shared text-generation seam (executeMobileText), so it runs on
 * whatever text engine is active - local llama/LiteRT or the user's remote server. onDeviceOnly forces
 * local so the day's summaries are never sent to a server for the narrative.
 */

import { executeMobileText } from '../mobileSidecarGeneration'
import { mobileTextEngineControl } from '../modelServices/textEngineControl'
import { generateDayJournal, type JournalDeps, type JournalResult } from './journal'
import type { JournalSource } from './journalPrompt'
import type { GenerationMessage } from '@offgrid/models'

export function createDefaultJournalDeps(onDeviceOnly = false): JournalDeps {
  const localReady = (): boolean => mobileTextEngineControl.isReady()
  return {
    isReady: () => (onDeviceOnly ? localReady() : mobileTextEngineControl.isRemoteActive() || localReady()),
    generate: (messages, maxTokens) =>
      executeMobileText(messages.map(m => ({ role: m.role, content: m.content })) as GenerationMessage[], {
        maxTokens
      })
  }
}

export function journalForDay(sources: JournalSource[], onDeviceOnly = false): Promise<JournalResult> {
  return generateDayJournal(sources, createDefaultJournalDeps(onDeviceOnly))
}
