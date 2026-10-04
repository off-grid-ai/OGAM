/**
 * Wires day-actions proposal to release's shared text seam (executeMobileText) + readiness
 * (mobileTextEngineControl). onDeviceOnly forces local so the day never leaves the device for its
 * proposals.
 */

import { executeMobileText } from '../mobileSidecarGeneration'
import { mobileTextEngineControl } from '../modelServices/textEngineControl'
import { proposeDayActions, type DayActionsContext, type DayActionsResult } from './actionsProposer'
import type { GenerationMessage } from '@offgrid/models'

export function proposeActionsForDay(
  ctx: DayActionsContext,
  onDeviceOnly = false
): Promise<DayActionsResult> {
  const localReady = (): boolean => mobileTextEngineControl.isReady()
  return proposeDayActions(ctx, {
    isReady: () => (onDeviceOnly ? localReady() : mobileTextEngineControl.isRemoteActive() || localReady()),
    generate: (prompt, maxTokens) =>
      executeMobileText([{ role: 'user', content: prompt }] as GenerationMessage[], { maxTokens })
  })
}
