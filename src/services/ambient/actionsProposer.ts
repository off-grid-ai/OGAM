/**
 * Propose the day's actions using the lead's shared proactive-action policy - we build the prompt and
 * parse the reply through the shared contract, so our proposals match the rest of the app instead of
 * a parallel format. The model call + readiness are injected (testable, engine-agnostic).
 *
 * Reports why it is empty (nothing to act on / no model / error) rather than degrading silently.
 */

import {
  buildProactiveActionPrompt,
  parseProactiveActions,
  PROACTIVE_ACTION_PROFILE,
  type ProactiveActionProposal
} from '@offgrid/models'

export type ActionsStatus = 'ok' | 'no-speech' | 'no-model' | 'error'

export interface DayActionsResult {
  proposals: ProactiveActionProposal[]
  status: ActionsStatus
}

export interface DayActionsContext {
  todos: string
  calls: string
}

export interface ActionsDeps {
  generate: (prompt: string, maxTokens: number) => Promise<string>
  isReady: () => boolean
}

export async function proposeDayActions(
  ctx: DayActionsContext,
  deps: ActionsDeps
): Promise<DayActionsResult> {
  if (ctx.todos.trim().length === 0 && ctx.calls.trim().length === 0) {
    return { proposals: [], status: 'no-speech' }
  }
  if (!deps.isReady()) return { proposals: [], status: 'no-model' }
  const prompt = buildProactiveActionPrompt({
    identityName: '',
    identityAliases: '',
    identityEmails: '',
    learnedPreferences: '',
    tools: '',
    meetings: '',
    todos: ctx.todos,
    calls: ctx.calls,
    toolActivity: '',
    emails: ''
  })
  try {
    const raw = await deps.generate(prompt, PROACTIVE_ACTION_PROFILE.maxTokens)
    return { proposals: parseProactiveActions(raw), status: 'ok' }
  } catch {
    return { proposals: [], status: 'error' }
  }
}
