/**
 * Wires ask-your-day to release's shared text-generation seam (executeMobileText), so an answer runs
 * on whatever text engine is active - local or the user's remote server. onDeviceOnly forces local.
 */

import { executeMobileText } from '../mobileSidecarGeneration'
import { mobileTextEngineControl } from '../modelServices/textEngineControl'
import { askDay, type AskResult } from './askDay'
import type { TimelineSession } from './timelineModel'
import type { GenerationMessage } from '@offgrid/models'

export function askDayWithDeviceLLM(
  question: string,
  sessions: TimelineSession[],
  clockOf: (epochMs: number) => string,
  onDeviceOnly = false
): Promise<AskResult> {
  const localReady = (): boolean => mobileTextEngineControl.isReady()
  return askDay(
    question,
    sessions,
    {
      generate: messages =>
        executeMobileText(messages.map(m => ({ role: m.role, content: m.content })) as GenerationMessage[]),
      isReady: () => (onDeviceOnly ? localReady() : mobileTextEngineControl.isRemoteActive() || localReady())
    },
    clockOf
  )
}
