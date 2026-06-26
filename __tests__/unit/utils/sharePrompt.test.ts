import { Linking } from 'react-native';
import { shouldShowSharePrompt, subscribeSharePrompt, emitSharePrompt, shareOnX } from '../../../src/utils/sharePrompt';

describe('shouldShowSharePrompt', () => {
  it('returns false for count 1 (first generation is skipped)', () => {
    expect(shouldShowSharePrompt(1)).toBe(false);
  });

  it('returns true for count 2 (second generation)', () => {
    expect(shouldShowSharePrompt(2)).toBe(true);
  });

  it('returns false for counts 3-9', () => {
    for (let i = 3; i <= 9; i++) {
      expect(shouldShowSharePrompt(i)).toBe(false);
    }
  });

  it('returns true for every 10th generation', () => {
    expect(shouldShowSharePrompt(10)).toBe(true);
    expect(shouldShowSharePrompt(20)).toBe(true);
    expect(shouldShowSharePrompt(30)).toBe(true);
    expect(shouldShowSharePrompt(100)).toBe(true);
  });

  it('returns false for non-milestone counts', () => {
    expect(shouldShowSharePrompt(5)).toBe(false);
    expect(shouldShowSharePrompt(11)).toBe(false);
    expect(shouldShowSharePrompt(15)).toBe(false);
    expect(shouldShowSharePrompt(25)).toBe(false);
  });

  it('returns false for count 0', () => {
    expect(shouldShowSharePrompt(0)).toBe(false);
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
