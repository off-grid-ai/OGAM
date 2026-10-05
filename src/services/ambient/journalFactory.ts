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
import { macTextReady, generateAmbientText } from './macTextOffload'

export function createDefaultJournalDeps(onDeviceOnly = false): JournalDeps {
  const localReady = (): boolean => mobileTextEngineControl.isReady()
  // When the recorder is offloading to a reachable Mac, the journal runs on the Mac's LLM too — so
  // offloading means the WHOLE day (transcript, summary AND journal) is produced on the Mac without
  // separately selecting it as the active chat model. onDeviceOnly still forces local.
  return {
    isReady: () =>
      macTextReady(onDeviceOnly) ||
      (onDeviceOnly ? localReady() : mobileTextEngineControl.isRemoteActive() || localReady()),
    generate: (messages, maxTokens) =>
      generateAmbientText(messages, maxTokens, onDeviceOnly, (m, mt) =>
        executeMobileText(m.map(x => ({ role: x.role, content: x.content })) as GenerationMessage[], {
          maxTokens: mt
        })
      )
  }
}

export function journalForDay(sources: JournalSource[], onDeviceOnly = false): Promise<JournalResult> {
  return generateDayJournal(sources, createDefaultJournalDeps(onDeviceOnly))
}
