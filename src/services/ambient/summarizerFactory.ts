/**
 * Wires the ambient summariser to release's shared text-generation seam: executeMobileText routes to
 * whatever engine is active - local llama/LiteRT or the user's remote server - so summaries run
 * wherever chat does. Readiness mirrors the app's own rule via mobileTextEngineControl. onDeviceOnly
 * forces local (ignores a remote model), so a transcript is never sent to a server for its summary.
 *
 * ONE extra rule for the recorder: when it is offloading transcription to a reachable Mac, the SUMMARY
 * runs on that same Mac's LLM too — reusing the offload gateway + token — WITHOUT the Mac having to be
 * separately picked as the active chat model. Offloading to the Mac means offloading everything to it,
 * which is what a user expects (and matches how transcription already behaves). onDeviceOnly still wins.
 */

import { executeMobileText } from '../mobileSidecarGeneration'
import { mobileTextEngineControl } from '../modelServices/textEngineControl'
import { summarizeTranscript, type SummarizeDeps, type SummarizeResult } from './summarizer'
import { macTextReady, generateAmbientText } from './macTextOffload'
import type { GenerationMessage } from '@offgrid/models'
import logger from '../../utils/logger'

export function createDefaultSummarizeDeps(onDeviceOnly = false): SummarizeDeps {
  const localReady = (): boolean => mobileTextEngineControl.isReady()
  // The recorder offloads the summary to the Mac whenever it offloads transcription there (unless the
  // user forced on-device) — so a transcript that whisper ran on the Mac is summarised on the Mac too.
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
