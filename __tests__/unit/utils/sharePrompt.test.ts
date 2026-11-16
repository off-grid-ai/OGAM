import { Linking, Platform } from 'react-native';
import {
  maybeScheduleSharePrompt,
  resetSharePromptSession,
  subscribeSharePrompt,
  emitSharePrompt,
  rateOnStore,
  requestStoreReview,
} from '../../../src/utils/sharePrompt';
import InAppReview from 'react-native-in-app-review';
import { getInstallerPackageName } from 'react-native-device-info';

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

describe('rateOnStore', () => {
  const openURL = Linking.openURL as jest.Mock;
  const canOpenURL = Linking.canOpenURL as jest.Mock;
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    openURL.mockReset().mockResolvedValue(undefined);
    canOpenURL.mockReset().mockResolvedValue(false);
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  it('opens the App Store review page on iOS', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    await rateOnStore();
    expect(openURL).toHaveBeenCalledWith(
      'https://apps.apple.com/app/id6759299882?action=write-review',
    );
    expect(canOpenURL).not.toHaveBeenCalled();
  });

  it('opens the Play Store app on Android when it is available', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    canOpenURL.mockResolvedValue(true);
    await rateOnStore();
    expect(openURL).toHaveBeenCalledWith('market://details?id=ai.offgridmobile');
  });

  it('opens the Play Store web page when the Android app is unavailable', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    await rateOnStore();
    expect(openURL).toHaveBeenCalledWith(
      'https://play.google.com/store/apps/details?id=ai.offgridmobile',
    );
  });
});

describe('requestStoreReview - the store\'s own dialog, else the store page', () => {
  const openURL = Linking.openURL as jest.Mock;
  const isAvailable = InAppReview.isAvailable as jest.Mock;
  const request = InAppReview.RequestInAppReview as jest.Mock;
  const installer = getInstallerPackageName as jest.Mock;
  const originalPlatform = Platform.OS;
  const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, value: os });

  beforeEach(() => {
    openURL.mockReset().mockResolvedValue(undefined);
    (Linking.canOpenURL as jest.Mock).mockReset().mockResolvedValue(false);
    isAvailable.mockReset().mockReturnValue(true);
    request.mockReset().mockResolvedValue(true);
    installer.mockReset().mockResolvedValue('com.android.vending');
  });

  afterAll(() => setOS(originalPlatform));

  it('opens SKStoreReviewController on iOS and never leaves the app', async () => {
    setOS('ios');
    await expect(requestStoreReview()).resolves.toBe('native');
    expect(request).toHaveBeenCalledTimes(1);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('opens the Play in-app review on a Play-installed Android build', async () => {
    setOS('android');
    await expect(requestStoreReview()).resolves.toBe('native');
    expect(request).toHaveBeenCalledTimes(1);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('falls back to the Play page for a sideloaded APK (no Play install source)', async () => {
    setOS('android');
    installer.mockResolvedValue('');
    await expect(requestStoreReview()).resolves.toBe('store_link');
    expect(request).not.toHaveBeenCalled();
    expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/apps/details?id=ai.offgridmobile');
  });

  it('falls back to the store page when the native dialog is unavailable', async () => {
    setOS('ios');
    isAvailable.mockReturnValue(false);
    await expect(requestStoreReview()).resolves.toBe('store_link');
    expect(request).not.toHaveBeenCalled();
    expect(openURL).toHaveBeenCalledWith('https://apps.apple.com/app/id6759299882?action=write-review');
  });

  it('falls back to the store page when the native request fails', async () => {
    setOS('android');
    request.mockRejectedValue(new Error('GOOGLE_SERVICES_NOT_AVAILABLE'));
    await expect(requestStoreReview()).resolves.toBe('store_link');
    expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/apps/details?id=ai.offgridmobile');
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
