/**
 * Function-hook seam. Pro features register plain functions against named hooks
 * during activation; core calls them when present and falls back to a no-op /
 * default when absent. Use this for behaviour (not UI — see slotRegistry for UI):
 * reading the audio interface mode, triggering speech after generation, and
 * augmenting the prompt in voice mode.
 *
 * Free builds register nothing, so callHook returns undefined and core keeps
 * its default behaviour.
 */
type HookFn = (...args: any[]) => any;

const hooks: Record<string, HookFn> = {};

export function registerHook(name: string, fn: HookFn): () => void {
  hooks[name] = fn;
  return () => {
    if (hooks[name] === fn) delete hooks[name];
  };
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

/** Known hook names, centralised so core and pro stay in sync. */
export const HOOKS = {
  /** () => readonly OnboardingSlide[] — optional feature-owned onboarding content. Core owns the
   *  renderer and navigation; feature packages contribute data only. */
  onboardingAdditionalSlides: 'onboarding.additionalSlides',
  /** () => boolean — whether a message can be spoken (TTS enabled + ready). */
  audioCanSpeak: 'audio.canSpeak',
  /** (text: string, messageId: string) => void — speak a message aloud. */
  audioSpeak: 'audio.speak',
  /** () => boolean — whether speech is playing or being generated right now. Hands-free asks before
   *  it re-opens the mic, so the assistant is never recorded as if it were the person talking. */
  audioIsSpeaking: 'audio.isSpeaking',
  /** () => void — stop speech that is running or pending, WITHOUT disturbing an idle engine. Fired at
   *  the start of a turn to kill stale playback; must stay cheap because it runs constantly. */
  audioStop: 'audio.stop',
  /** () => void — the person LEFT. Stop and tear down unconditionally: there is no warm engine worth
   *  protecting for a screen nobody is on, and a guard that reasons about flags is exactly how audio
   *  kept playing after the chat was closed. */
  audioStopForExit: 'audio.stopForExit',
  /** () => Promise<void> — Pro stops the active Desktop task started by this chat. */
  taskStopActive: 'task.stopActive',
  /** (content: string) => void — fired as the assistant message streams; pro
   *  uses it to synthesize/play speech sentence-by-sentence while generation is
   *  still in progress (no-op unless voice mode + engine ready). */
  audioOnStreamingToken: 'audio.onStreamingToken',
  /** (conversationId: string) => void — when streaming ends, speak the final
   *  assistant message if voice mode is active (pro checks mode/readiness). */
  audioOnStreamingEnd: 'audio.onStreamingEnd',
  /** () => void — app went to background: pause speech if playing. */
  audioOnAppBackground: 'audio.onAppBackground',
  /** () => void — app returned to foreground: resume paused speech. */
  audioOnAppForeground: 'audio.onAppForeground',
  /** (basePrompt: string) => string — augment the prompt when in voice mode. */
  audioAugmentPrompt: 'audio.augmentPrompt',
  /** (language: string) => void — keep the active speech voice aligned with STT. */
  audioSelectLanguage: 'audio.selectLanguage',
  /** () => Promise<Array<{ engineId: string; name: string; sizeBytes: number }>>
   *  — downloaded TTS (voice) models, surfaced in the Download Manager. */
  downloadsListVoiceModels: 'downloads.listVoiceModels',
  /** (engineId: string) => Promise<void> — delete a downloaded TTS voice model. */
  downloadsDeleteVoiceModel: 'downloads.deleteVoiceModel',
  /** () => Promise<void> — warm the active TTS engine at boot if its model is
   *  downloaded and fits the residency budget (no-op otherwise). */
  audioPreload: 'audio.preload',
  /** (mutation: SyncMutation) => void — a core data owner committed a record
   *  change. Pro records it in the state-sync op-log; free builds do nothing. */
  syncRecordLocalMutation: 'sync.recordLocalMutation',
  /** (conversationId: string) => void — a local resend/regenerate replaced the reply. Pro drops the
   *  live previews it holds for the conversation; the durable tombstone is emitted by the caller. */
  chatStreamDiscardConversation: 'chatStream.discardConversation',

  /** (mutation: KnowledgeDocumentMutation) => void — the RAG owner committed
   *  a document lifecycle change. Pro transfers or reconciles it with peers. */
  syncKnowledgeDocumentMutation: 'sync.knowledgeDocumentMutation',
  /** (text: string, timestamp: number) => void — core copied text locally. Pro records it through
   *  the shared clipboard owner instead of waiting for a delayed native clipboard notification. */
  clipboardRecordLocalText: 'clipboard.recordLocalText',
} as const;
