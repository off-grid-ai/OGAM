/**
 * Function-hook seam. Features register plain functions against named hooks
 * at startup; core calls them when present and falls back to a no-op /
 * default when absent. Use this for behaviour (not UI — see slotRegistry for UI):
 * reading the audio interface mode, triggering speech after generation, and
 * augmenting the prompt in voice mode.
 *
 * With nothing registered, callHook returns undefined and core keeps
 * its default behaviour.
 */
type HookFn = (...args: any[]) => any;

const hooks: Record<string, HookFn> = {};

export function registerHook(name: string, fn: HookFn): void {
  hooks[name] = fn;
}

/** Call a hook if registered; returns its result, or undefined when absent. */
export function callHook<R = any>(name: string, ...args: any[]): R | undefined {
  const fn = hooks[name];
  return fn ? (fn(...args) as R) : undefined;
}

export function _clearHooksForTesting(): void {
  for (const key of Object.keys(hooks)) {
    delete hooks[key];
  }
}

/** Known hook names, centralised so core and features stay in sync. */
export const HOOKS = {
  /** (latestTokens: number, budgetTokens: number) => void — the person's latest message was too long for the model and its start was cut; tell them in the chat. */
  messageCut: 'chat.messageCut',
  /** (modelId: string | null) => Promise<void> — make sure a text model is loaded (null: the one in use, else the first downloaded). */
  ensureTextModel: 'models.ensureText',
  /** (modelId: string) => void — an agent that has its own model was made active; the app loads that model in the background. */
  agentModelChosen: 'agent.modelChosen',
  /** () => boolean — whether a message can be spoken (TTS enabled + ready). */
  audioCanSpeak: 'audio.canSpeak',
  /** (text: string, messageId: string) => void — speak a message aloud. */
  audioSpeak: 'audio.speak',
  /** () => void — stop any in-progress speech. */
  audioStop: 'audio.stop',
  /** (content: string) => void — fired as the assistant message streams; the voice feature
   *  uses it to synthesize/play speech sentence-by-sentence while generation is
   *  still in progress (no-op unless voice mode + engine ready). */
  audioOnStreamingToken: 'audio.onStreamingToken',
  /** (conversationId: string) => void — when streaming ends, speak the final
   *  assistant message if voice mode is active (it checks mode/readiness). */
  audioOnStreamingEnd: 'audio.onStreamingEnd',
  /** () => void — app went to background: pause speech if playing. */
  audioOnAppBackground: 'audio.onAppBackground',
  /** () => void — app returned to foreground: resume paused speech. */
  audioOnAppForeground: 'audio.onAppForeground',
  /** (basePrompt: string) => string — augment the prompt when in voice mode. */
  audioAugmentPrompt: 'audio.augmentPrompt',
  /** () => Promise<Array<{ engineId: string; name: string; sizeBytes: number }>>
   *  — downloaded TTS (voice) models, surfaced in the Download Manager. */
  downloadsListVoiceModels: 'downloads.listVoiceModels',
  /** (engineId: string) => Promise<void> — delete a downloaded TTS voice model. */
  downloadsDeleteVoiceModel: 'downloads.deleteVoiceModel',
  /** () => Promise<void> — warm the active TTS engine at boot if its model is
   *  downloaded and fits the residency budget (no-op otherwise). */
  audioPreload: 'audio.preload',
} as const;
