/**
 * Wires the timeline builder to release's device seams: on-device/remote transcription via the speech
 * port and text generation via executeMobileText. prepareForSummaries is the residency hand-off -
 * after transcription it ensures the local text model is resident (via mobileResidencyIntents), unless
 * a remote model is active and onDeviceOnly is off (then the summary runs on the user's server).
 */

import { createDefaultCaptureSttExecutor } from './captureSttExecutorFactory'
import { summarizeWithDeviceLLM } from './summarizerFactory'
import { mobileResidencyIntents } from '../modelServices/residencyIntents'
import { selectedTextModelId } from '../modelServices/modelState'
import { mobileTextEngineControl } from '../modelServices/textEngineControl'
import type { TimelineBuildDeps } from './timelineBuilder'

export function createDefaultTimelineBuildDeps(
  onDeviceOnly = false,
  offloadToMac = false
): TimelineBuildDeps {
  return {
    // onDeviceOnly forces everything local; otherwise honour the Mac-offload choice.
    executor: createDefaultCaptureSttExecutor({ offloadToMac: offloadToMac && !onDeviceOnly }),
    summarize: (transcript, flaggedSnippets) =>
      summarizeWithDeviceLLM(transcript, flaggedSnippets, onDeviceOnly),
    prepareForSummaries: async () => {
      if (!onDeviceOnly && mobileTextEngineControl.isRemoteActive()) return
      const id = selectedTextModelId()
      if (!id) return
      if (mobileTextEngineControl.isReady()) return
      await mobileResidencyIntents.ensureText(id)
    }
  }
}
