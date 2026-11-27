import { Linking, Platform } from 'react-native';
import {
  maybeScheduleSharePrompt,
  noteTurnNotGood,
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

  const good = (variant: 'text' | 'image' = 'text', hasEngaged = false) =>
    maybeScheduleSharePrompt({ variant, hasEngaged, delayMs: 0 });

  it('emits ONCE per session even when triggered many times (no 2/10/20 re-show)', () => {
    withListener(emits => {
      for (let i = 0; i < 20; i += 1) good();
      jest.runOnlyPendingTimers();
      expect(emits).toEqual(['text']); // exactly one, not one per milestone
    });
  });

  it('waits for the third good reply in a row', () => {
    withListener(emits => {
      good();
      good();
      jest.runOnlyPendingTimers();
      expect(emits).toEqual([]);
      good();
      jest.runOnlyPendingTimers();
      expect(emits).toEqual(['text']);
    });
  });

  it('never follows a failed, refused or stopped turn: the run of good ones starts again', () => {
    withListener(emits => {
      good();
      good();
      noteTurnNotGood();
      good();
      good();
      jest.runOnlyPendingTimers();
      expect(emits).toEqual([]);
      good();
      jest.runOnlyPendingTimers();
      expect(emits).toEqual(['text']);
    });
  });

  it('never emits once the user has already engaged (persisted)', () => {
    withListener(emits => {
      for (let i = 0; i < 3; i += 1) good('text', true);
      jest.runOnlyPendingTimers();
      expect(emits).toEqual([]);
    });
  });

  it('emits again in a NEW session (after resetSharePromptSession)', () => {
    withListener(emits => {
      for (let i = 0; i < 3; i += 1) good('image');
      jest.runOnlyPendingTimers();
      resetSharePromptSession(); // relaunch = new session, and a new run of good replies
      good('image');
      jest.runOnlyPendingTimers();
      expect(emits).toEqual(['image']);
      good('image');
      good('image');
      jest.runOnlyPendingTimers();
      expect(emits).toEqual(['image', 'image']); // once each session
    });
  });
});

const PLAY_APP = 'market://details?id=ai.offgridmobile';
const PLAY_WEB = 'https://play.google.com/store/apps/details?id=ai.offgridmobile';
const APP_STORE = 'https://apps.apple.com/app/id6759299882?action=write-review';
const GALAXY_APP = 'samsungapps://ProductDetail/ai.offgridmobile';

describe('rateOnStore - the store that installed the app', () => {
  const openURL = Linking.openURL as jest.Mock;
  const installer = getInstallerPackageName as jest.Mock;
  const originalPlatform = Platform.OS;
  const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, value: os });

  beforeEach(() => {
    openURL.mockReset().mockResolvedValue(undefined);
    installer.mockReset().mockResolvedValue('com.android.vending');
  });

  afterAll(() => setOS(originalPlatform));

  it('opens the App Store review page on iOS', async () => {
    setOS('ios');
    await rateOnStore();
    expect(openURL.mock.calls).toEqual([[APP_STORE]]);
  });

  it('opens the Play app for a Play install', async () => {
    setOS('android');
    await rateOnStore();
    expect(openURL.mock.calls).toEqual([[PLAY_APP]]);
  });

  it('opens the Play web page when no app takes the Play link', async () => {
    setOS('android');
    openURL.mockImplementation(async (url: string) => {
      if (url === PLAY_APP) throw new Error('No Activity found');
    });
    await rateOnStore();
    expect(openURL.mock.calls).toEqual([[PLAY_APP], [PLAY_WEB]]);
  });

  it('opens the Galaxy Store for a Galaxy Store install, never Play', async () => {
    setOS('android');
    installer.mockResolvedValue('com.sec.android.app.samsungapps');
    await rateOnStore();
    expect(openURL.mock.calls).toEqual([[GALAXY_APP]]);
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

  it('falls back to the Play page for a sideloaded APK (no install source)', async () => {
    setOS('android');
    installer.mockResolvedValue('');
    await expect(requestStoreReview()).resolves.toBe('store_link');
    expect(request).not.toHaveBeenCalled();
    expect(openURL.mock.calls).toEqual([[PLAY_APP]]);
  });

  it('sends a Galaxy Store install to the Galaxy Store, with no Play dialog', async () => {
    setOS('android');
    installer.mockResolvedValue('com.sec.android.app.samsungapps');
    await expect(requestStoreReview()).resolves.toBe('store_link');
    expect(request).not.toHaveBeenCalled();
    expect(openURL.mock.calls).toEqual([[GALAXY_APP]]);
  });

  it('falls back to the store page when the native dialog is unavailable', async () => {
    setOS('ios');
    isAvailable.mockReturnValue(false);
    await expect(requestStoreReview()).resolves.toBe('store_link');
    expect(request).not.toHaveBeenCalled();
    expect(openURL.mock.calls).toEqual([[APP_STORE]]);
  });

  it('falls back to the store page when the native request fails', async () => {
    setOS('android');
    request.mockRejectedValue(new Error('GOOGLE_SERVICES_NOT_AVAILABLE'));
    await expect(requestStoreReview()).resolves.toBe('store_link');
    expect(openURL.mock.calls).toEqual([[PLAY_APP]]);
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
