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
const APPLICATION_STARTED_HOOK = 'application.started';
const APPLICATION_STOPPING_HOOK = 'application.stopping';
let applicationStarted = false;

export function registerHook(name: string, fn: HookFn): () => void {
  hooks[name] = fn;
  // Readiness is state, not an edge. A paid bundle can activate after the root has already started;
  // replay only this lifecycle fact so its dependent workflows are not stranded until a restart.
  if (name === APPLICATION_STARTED_HOOK && applicationStarted) fn();
  return () => {
    if (hooks[name] === fn) delete hooks[name];
  };
}

/** Call a hook if registered; returns its result, or undefined when absent. */
export function callHook<R = any>(name: string, ...args: any[]): R | undefined {
  if (name === APPLICATION_STARTED_HOOK) applicationStarted = true;
  // Clear readiness before the stop owner runs. A registration made during or after shutdown must
  // not replay the previous lifetime and start work against domains that are already stopping.
  if (name === APPLICATION_STOPPING_HOOK) applicationStarted = false;
  const fn = hooks[name];
  return fn ? (fn(...args) as R) : undefined;
}

export function _clearHooksForTesting(): void {
  for (const key of Object.keys(hooks)) {
    delete hooks[key];
  }
  applicationStarted = false;
}

/** Known hook names, centralised so core and pro stay in sync. */
export const HOOKS = {
  /** () => void | Promise<void> — the application root has started every composed domain. Optional
   *  feature bundles may now start workflows that depend on those domains, but never their lifecycle. */
  applicationStarted: APPLICATION_STARTED_HOOK,
  /** () => void | Promise<void> — stop feature workflows before their application domains stop. */
  applicationStopping: APPLICATION_STOPPING_HOOK,
  /** () => Promise<void> — re-run adoption of paired devices as remote servers (Pro sync). Fired by
   *  the Remote Servers "Scan network" action so one tap covers the LAN scan and the paired roster. */
  remoteServersAdoptPaired: 'remoteServers.adoptPaired',
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
  /** (content: string, messageId: string | null) => void — fired as the assistant message streams; pro
   *  uses it to synthesize/play speech sentence-by-sentence while generation is
   *  still in progress (no-op unless voice mode + engine ready). The durable message ID keeps the
   *  playback control bound to the row that owns the reply. */
  audioOnStreamingToken: 'audio.onStreamingToken',
  /** (conversationId: string) => void — when streaming ends, speak the final
   *  assistant message if voice mode is active (pro checks mode/readiness). */
  audioOnStreamingEnd: 'audio.onStreamingEnd',
  /** () => void — app went to background: pause speech if playing. */
  audioOnAppBackground: 'audio.onAppBackground',
  /** () => void — app returned to foreground: resume paused speech. */
  audioOnAppForeground: 'audio.onAppForeground',
  /** (language: string) => void — keep the active speech voice aligned with STT. */
  audioSelectLanguage: 'audio.selectLanguage',
  /** (mutation: SyncMutation) => void — a core data owner committed a record
   *  change. Pro records it in the state-sync op-log; free builds do nothing. */
  syncRecordLocalMutation: 'sync.recordLocalMutation',
  /** (conversationId: string) => void — a local resend/regenerate replaced the reply. Pro drops the
   *  live previews it holds for the conversation; the durable tombstone is emitted by the caller. */
  chatStreamDiscardConversation: 'chatStream.discardConversation',

  /** (text: string, timestamp: number) => void — core copied text locally. Pro records it through
   *  the shared clipboard owner instead of waiting for a delayed native clipboard notification. */
  clipboardRecordLocalText: 'clipboard.recordLocalText',
} as const;
