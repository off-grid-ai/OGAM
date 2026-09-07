/**
 * Wires the ambient summariser to release's shared text-generation seam: executeMobileText routes to
 * whatever engine is active - local llama/LiteRT or the user's remote server - so summaries run
 * wherever chat does. Readiness mirrors the app's own rule via mobileTextEngineControl. onDeviceOnly
 * forces local (ignores a remote model), so a transcript is never sent to a server for its summary.
 */

import { executeMobileText } from '../mobileSidecarGeneration'
import { mobileTextEngineControl } from '../modelServices/textEngineControl'
import { summarizeTranscript, type SummarizeDeps, type SummarizeResult } from './summarizer'
import type { GenerationMessage } from '@offgrid/models'

export function createDefaultSummarizeDeps(onDeviceOnly = false): SummarizeDeps {
  const localReady = (): boolean => mobileTextEngineControl.isReady()
  return {
    isReady: () => (onDeviceOnly ? localReady() : mobileTextEngineControl.isRemoteActive() || localReady()),
    generate: (messages, maxTokens) =>
      executeMobileText(messages.map(m => ({ role: m.role, content: m.content })) as GenerationMessage[], {
        maxTokens
      })
  }
}

export function summarizeWithDeviceLLM(
  transcript: string,
  flaggedSnippets: string[] = [],
  onDeviceOnly = false
): Promise<SummarizeResult> {
  return summarizeTranscript(transcript, createDefaultSummarizeDeps(onDeviceOnly), flaggedSnippets)
}
