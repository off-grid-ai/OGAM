/**
 * Unit tests for proPrompt.ts
 *
 * The real app store runs: generation counts rise through the store's own increment actions,
 * Pro access is set through its own actions, and the test reads the stored "offered" marker and
 * the prompt the listeners receive.
 */

import {
  shouldShowProAha,
  subscribeProPrompt,
  emitProPrompt,
  checkProPromptForText,
  checkProPromptForImage,
} from '../../../src/services/proPrompt';
import { useAppStore } from '../../../src/stores/appStore';

/** A free install that has completed `text` replies and `image` images, as the app counts them. */
function install({ text = 0, image = 0 } = {}) {
  const app = useAppStore.getState();
  app.setHasRegisteredPro(false);
  app.setHasSavedProCredential(false);
  app.setProActive(false);
  app.setProDeviceAdmission('unknown');
  app.setProAhaTriggeredBy(null);
  useAppStore.setState({ textGenerationCount: 0, imageGenerationCount: 0 });
  for (let i = 0; i < text; i += 1) app.incrementTextGenerationCount();
  for (let i = 0; i < image; i += 1) app.incrementImageGenerationCount();
}

describe('shouldShowProAha', () => {
  it('returns true at threshold (10)', () => {
    expect(shouldShowProAha(10)).toBe(true);
  });

  it('returns false below threshold', () => {
    expect(shouldShowProAha(2)).toBe(false);
    expect(shouldShowProAha(1)).toBe(false);
    expect(shouldShowProAha(9)).toBe(false);
  });

  it('returns false after the one automatic offer', () => {
    expect(shouldShowProAha(4)).toBe(false);
    expect(shouldShowProAha(11)).toBe(false);
    expect(shouldShowProAha(14)).toBe(false);
    expect(shouldShowProAha(15)).toBe(false);
    expect(shouldShowProAha(16)).toBe(false);
    expect(shouldShowProAha(24)).toBe(false);
    expect(shouldShowProAha(25)).toBe(false);
    expect(shouldShowProAha(35)).toBe(false);
  });
});

describe('subscribeProPrompt / emitProPrompt', () => {
  it('calls listener when emitted', () => {
    const listener = jest.fn();
    const unsub = subscribeProPrompt(listener);
    emitProPrompt('text');
    expect(listener).toHaveBeenCalledWith('text');
    unsub();
  });

  it('does not call listener after unsubscribe', () => {
    const listener = jest.fn();
    const unsub = subscribeProPrompt(listener);
    unsub();
    emitProPrompt('image');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('checkProPromptForText', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** Check after a reply; return what was marked and what the user saw. */
  function afterReply() {
    const seen: string[] = [];
    const unsub = subscribeProPrompt(variant => seen.push(variant));
    checkProPromptForText(0);
    jest.runAllTimers();
    unsub();
    return { marked: useAppStore.getState().proAhaTriggeredBy, seen };
  }

  it('skips when hasRegisteredPro=true', () => {
    install({ text: 10 });
    useAppStore.getState().setHasRegisteredPro(true);
    useAppStore.getState().setHasSavedProCredential(true);
    useAppStore.getState().setProActive(true);
    useAppStore.getState().setProDeviceAdmission('active');
    expect(afterReply()).toEqual({ marked: null, seen: [] });
  });

  it('skips when isProActive=true (keychain/dev-unlocked Pro user, never registered)', () => {
    install({ text: 10 });
    useAppStore.getState().setProActive(true);
    useAppStore.getState().setProDeviceAdmission('active');
    expect(afterReply()).toEqual({ marked: null, seen: [] });
  });

  it('skips when the offer was already made', () => {
    install({ text: 10 });
    useAppStore.getState().setProAhaTriggeredBy('image');
    expect(afterReply()).toEqual({ marked: 'image', seen: [] });
  });

  it('skips when count does not meet threshold', () => {
    install({ text: 1 });
    expect(afterReply()).toEqual({ marked: null, seen: [] });
  });

  it('triggers when all conditions met', () => {
    install({ text: 10 });
    expect(afterReply()).toEqual({ marked: 'text', seen: ['text'] });
  });
});

describe('checkProPromptForImage', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function afterImage() {
    const seen: string[] = [];
    const unsub = subscribeProPrompt(variant => seen.push(variant));
    checkProPromptForImage(0);
    jest.runAllTimers();
    unsub();
    return { marked: useAppStore.getState().proAhaTriggeredBy, seen };
  }

  it('triggers for image when count meets threshold', () => {
    install({ image: 10 });
    expect(afterImage()).toEqual({ marked: 'image', seen: ['image'] });
  });

  it('skips when hasRegisteredPro=true', () => {
    install({ image: 10 });
    useAppStore.getState().setHasRegisteredPro(true);
    useAppStore.getState().setHasSavedProCredential(true);
    useAppStore.getState().setProActive(true);
    useAppStore.getState().setProDeviceAdmission('active');
    expect(afterImage()).toEqual({ marked: null, seen: [] });
  });
});
