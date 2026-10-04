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
import logger from '../../utils/logger'

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

export async function summarizeWithDeviceLLM(
  transcript: string,
  flaggedSnippets: string[] = [],
  onDeviceOnly = false
): Promise<SummarizeResult> {
  const deps = createDefaultSummarizeDeps(onDeviceOnly);
  logger.log(
    `[ambient] summarize start len=${transcript.trim().length} ready=${deps.isReady()} onDeviceOnly=${onDeviceOnly}`
  );
  try {
    const res = await summarizeTranscript(transcript, deps, flaggedSnippets);
    logger.log(`[ambient] summarize done status=${res.status} title="${res.summary.title}"`);
    return res;
  } catch (e) {
    logger.warn('[ambient] summarize threw', e);
    throw e;
  }
}
