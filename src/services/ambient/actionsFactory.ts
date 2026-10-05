/**
 * Wires day-actions proposal to release's shared text seam (executeMobileText) + readiness
 * (mobileTextEngineControl). onDeviceOnly forces local so the day never leaves the device for its
 * proposals.
 */

import { executeMobileText } from '../mobileSidecarGeneration'
import { mobileTextEngineControl } from '../modelServices/textEngineControl'
import { proposeDayActions, type DayActionsContext, type DayActionsResult } from './actionsProposer'
import type { GenerationMessage } from '@offgrid/models'
import { macTextReady, generateAmbientText } from './macTextOffload'

export function proposeActionsForDay(
  ctx: DayActionsContext,
  onDeviceOnly = false
): Promise<DayActionsResult> {
  const localReady = (): boolean => mobileTextEngineControl.isReady()
  // The day's to-dos are proposed on the Mac's LLM when offloading there too (like summary + journal),
  // so offloading to the Mac produces the to-do list without picking it as the active chat model.
  return proposeDayActions(ctx, {
    isReady: () =>
      macTextReady(onDeviceOnly) ||
      (onDeviceOnly ? localReady() : mobileTextEngineControl.isRemoteActive() || localReady()),
    generate: (prompt, maxTokens) =>
      generateAmbientText([{ role: 'user', content: prompt }], maxTokens, onDeviceOnly, (m, mt) =>
        executeMobileText(m.map(x => ({ role: x.role, content: x.content })) as GenerationMessage[], {
          maxTokens: mt
        })
      )
  })
}
