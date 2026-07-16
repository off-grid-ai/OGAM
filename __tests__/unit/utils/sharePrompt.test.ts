import { Linking } from 'react-native';
import {
  maybeScheduleSharePrompt,
  resetSharePromptSession,
  subscribeSharePrompt,
  emitSharePrompt,
  shareOnX,
} from '../../../src/utils/sharePrompt';

describe('maybeScheduleSharePrompt — at most once per session', () => {
  beforeEach(() => { jest.useFakeTimers(); resetSharePromptSession(); });
  afterEach(() => { jest.useRealTimers(); });

  // Count the emitted prompts (what drives the sheet to show) across a session.
  function withListener(fn: (emits: string[]) => void): void {
    const emits: string[] = [];
    const unsub = subscribeSharePrompt(v => emits.push(v));
    try { fn(emits); } finally { unsub(); }
  }

  it('emits ONCE per session even when triggered many times (no 2/10/20 re-show)', () => {
    withListener(emits => {
      for (const count of [2, 3, 10, 20, 50]) {
        maybeScheduleSharePrompt({ variant: 'text', count, hasEngaged: false, delayMs: 0 });
      }
      jest.runOnlyPendingTimers();
      expect(emits).toEqual(['text']); // exactly one, not one per milestone
    });
  });

  it('does not emit on the very first generation (count < 2), avoids first-run stacking', () => {
    withListener(emits => {
      maybeScheduleSharePrompt({ variant: 'text', count: 1, hasEngaged: false, delayMs: 0 });
      jest.runOnlyPendingTimers();
      expect(emits).toEqual([]);
    });
  });

  it('never emits once the user has already engaged (persisted)', () => {
    withListener(emits => {
      maybeScheduleSharePrompt({ variant: 'text', count: 2, hasEngaged: true, delayMs: 0 });
      jest.runOnlyPendingTimers();
      expect(emits).toEqual([]);
    });
  });

  it('emits again in a NEW session (after resetSharePromptSession)', () => {
    withListener(emits => {
      maybeScheduleSharePrompt({ variant: 'image', count: 2, hasEngaged: false, delayMs: 0 });
      jest.runOnlyPendingTimers();
      resetSharePromptSession(); // relaunch = new session
      maybeScheduleSharePrompt({ variant: 'image', count: 2, hasEngaged: false, delayMs: 0 });
      jest.runOnlyPendingTimers();
      expect(emits).toEqual(['image', 'image']); // once each session
    });
  });
});

describe('shareOnX', () => {
  const openURL = Linking.openURL as jest.Mock;

  beforeEach(() => {
    openURL.mockReset().mockResolvedValue(undefined);
  });

  it('opens the X web intent prefilled with the share text, ready to post', async () => {
    await shareOnX();
    expect(openURL).toHaveBeenCalledTimes(1);
    const url = openURL.mock.calls[0][0];
    expect(url).toMatch(/^https:\/\/x\.com\/intent\/post\?text=/);
    expect(decodeURIComponent(url)).toContain('Off Grid AI is background intelligence');
    expect(decodeURIComponent(url)).toContain('getoffgridai.co/early-access');
  });
});

describe('sharePrompt pub/sub', () => {
  it('notifies listeners when emitSharePrompt is called', () => {
    const listener = jest.fn();
    subscribeSharePrompt(listener);
    emitSharePrompt('text');
    expect(listener).toHaveBeenCalledWith('text');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes correctly', () => {
    const listener = jest.fn();
    const unsub = subscribeSharePrompt(listener);
    unsub();
    emitSharePrompt('image');
    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple listeners', () => {
    const listener1 = jest.fn();
    const listener2 = jest.fn();
    subscribeSharePrompt(listener1);
    subscribeSharePrompt(listener2);
    emitSharePrompt('image');
    expect(listener1).toHaveBeenCalledWith('image');
    expect(listener2).toHaveBeenCalledWith('image');
  });
});
