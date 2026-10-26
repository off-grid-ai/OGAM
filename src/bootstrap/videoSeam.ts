import { callHook, hasHook, HOOKS } from './hookRegistry';

/**
 * Core's only way to reach video. Video is Pro: Pro registers the hooks, and free builds (or Pro
 * that ended) get the quiet defaults here - nothing is busy, nothing is pending, nothing to stop.
 */
export const videoSeam = {
  available: (): boolean => hasHook(HOOKS.videoGenerate),
  isBusy: (): boolean => callHook<boolean>(HOOKS.videoIsBusy) === true,
  hasPending: (): boolean => callHook<boolean>(HOOKS.videoHasPending) === true,
  cancel: (): Promise<void> =>
    callHook<Promise<void>>(HOOKS.videoCancel) ?? Promise.resolve(),
  generate: (input: {
    prompt: string;
    conversationId: string;
    initImagePath?: string;
  }): Promise<unknown> =>
    callHook<Promise<unknown>>(HOOKS.videoGenerate, input) ??
    Promise.reject(new Error('Video needs Off Grid AI Pro.')),
  defer: (conversationId: string, input: { prompt: string }): void => {
    if (!hasHook(HOOKS.videoDefer))
      throw new Error('Video needs Off Grid AI Pro.');
    callHook(HOOKS.videoDefer, conversationId, input);
  },
  finishDeferred: (conversationId: string, stopped: boolean): Promise<void> =>
    callHook<Promise<void>>(HOOKS.videoFinishDeferred, conversationId, stopped) ??
    Promise.resolve(),
  discardDeferred: (conversationId: string): void => {
    callHook(HOOKS.videoDiscardDeferred, conversationId);
  },
};
