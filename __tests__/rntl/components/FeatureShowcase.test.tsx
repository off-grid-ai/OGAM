/**
 * FeatureShowcase: the top of Home. Everything Off Grid AI does, free and Pro side by side, what you
 * have not tried first, in a row of cards that moves on by itself and has pips to jump.
 *
 * showcaseFeatures is pure: its openers are plain functions, so the test reads which one each card
 * opens (identity), not whether a mock was called. The carousel renders for real with the real theme.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  FeatureShowcase,
  showcaseFeatures,
  type FeatureOpeners,
  type FeatureUse,
  type ShowcaseFeature,
} from '../../../src/screens/HomeScreen/components/FeatureShowcase';

const opener = () => () => undefined;
const openers = (): FeatureOpeners => ({
  image: opener(),
  video: opener(),
  voice: opener(),
  speech: opener(),
  documents: opener(),
  sync: opener(),
  tools: opener(),
  pro: opener(),
  desktop: opener(),
});
const fresh: FeatureUse = { imagesMade: 0, videosMade: 0, hasVoice: false, hasSpeech: false };
const keys = (features: ShowcaseFeature[]) => features.map(f => f.key);
const MAC_KEYS = ['mac-clipboard', 'mac-dictation', 'mac-meetings', 'mac-models', 'mac-recall'];
/** Pro features on this phone: without Pro their cards open Pro. */
const PHONE_PRO_KEYS = ['sync', 'tools', 'video', 'voice'];
const FREE_PHONE_KEYS = ['documents', 'image', 'speech'];
const sorted = (list: string[]) => [...list].sort();

describe('showcaseFeatures', () => {
  it('lists all twelve, free phone features first, when nothing has been tried', () => {
    const features = showcaseFeatures(fresh, openers(), true);
    expect(sorted(keys(features))).toEqual(sorted([...FREE_PHONE_KEYS, ...PHONE_PRO_KEYS, ...MAC_KEYS]));
    expect(sorted(features.filter(f => f.mac).map(f => f.key))).toEqual(MAC_KEYS);
    expect(sorted(features.filter(f => f.pro && !f.mac).map(f => f.key))).toEqual(PHONE_PRO_KEYS);
    expect(sorted(keys(features).slice(0, FREE_PHONE_KEYS.length))).toEqual(FREE_PHONE_KEYS);
    // Every card says what you get and the first step.
    for (const feature of features) {
      expect(feature.title.length).toBeGreaterThan(0);
      expect(feature.line.length).toBeGreaterThan(0);
    }
  });

  it('puts what you have tried last, keeping the order within each group', () => {
    const order = keys(showcaseFeatures(fresh, openers(), true));
    const features = showcaseFeatures(
      { imagesMade: 2, videosMade: 1, hasVoice: true, hasSpeech: true },
      openers(),
      true,
    );
    const tried = ['image', 'video', 'voice', 'speech'];
    const free = (key: string) => FREE_PHONE_KEYS.includes(key);
    const inOrder = (test: (key: string) => boolean) => order.filter(test);
    // Free phone features lead, then Pro and Mac; inside each group, what has not been tried first.
    expect(keys(features)).toEqual([
      ...inOrder(key => free(key) && !tried.includes(key)),
      ...inOrder(key => free(key) && tried.includes(key)),
      ...inOrder(key => !free(key) && !tried.includes(key)),
      ...inOrder(key => !free(key) && tried.includes(key)),
    ]);
  });

  it('with Pro: a phone card opens its own feature, a Mac card opens the Desktop page', () => {
    const open = openers();
    const features = showcaseFeatures(fresh, open, true);
    for (const feature of features) {
      const expected = feature.mac ? open.desktop : open[feature.key as keyof FeatureOpeners];
      expect(feature.onPress).toBe(expected);
    }
    expect(features.filter(f => f.onPress === open.pro)).toHaveLength(0);
  });

  it('without Pro: phone Pro cards open Pro; Mac cards, Pro or not, still open the Desktop page', () => {
    const open = openers();
    const features = showcaseFeatures(fresh, open, false);
    expect(sorted(features.filter(f => f.onPress === open.pro).map(f => f.key))).toEqual(PHONE_PRO_KEYS);
    expect(sorted(features.filter(f => f.onPress === open.desktop).map(f => f.key))).toEqual(MAC_KEYS);
    for (const key of ['image', 'speech', 'documents'] as const) {
      expect(features.find(f => f.key === key)!.onPress).toBe(open[key]);
    }
  });

  it('returns cards without the internal tried flag', () => {
    for (const feature of showcaseFeatures(fresh, openers(), false)) {
      expect(feature).not.toHaveProperty('tried');
    }
  });
});

describe('FeatureShowcase', () => {
  /** Which pip reads as selected, from what a screen reader is told. */
  const selectedPip = (view: ReturnType<typeof render>) =>
    view.getAllByRole('tab').findIndex(tab => tab.findAll(n => n.props.accessibilityState?.selected === true).length > 0);

  const sample = (): ShowcaseFeature[] => showcaseFeatures(fresh, openers(), true).slice(0, 4);

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing when there is nothing to show', () => {
    const view = render(<FeatureShowcase features={[]} active />);
    expect(view.queryByTestId('feature-showcase')).toBeNull();
  });

  it('shows the kicker, a card per feature with its words and tag, and a pip per card', () => {
    const features = showcaseFeatures(fresh, openers(), true);
    const view = render(<FeatureShowcase features={features} active={false} />);
    expect(view.getByText('What you can do')).toBeTruthy();
    const card = (key: string) => view.getByTestId(`feature-showcase-${key}`);
    const of = (key: string) => features.find(f => f.key === key)!;
    // A free phone card: its words, no tag.
    expect(card('image')).toHaveTextContent(`${of('image').title}${of('image').line}`);
    expect(card('image').props.accessibilityLabel).toBe(`${of('image').title} ${of('image').line}`);
    // A phone Pro card says Pro; a desktop card says On your computer; a desktop Pro card says both.
    const tagOf = (key: string) => view.getAllByText(/^(Pro|On your computer|On your computer · Pro)$/).find(tag => card(key).findAll(n => n === tag).length > 0);
    expect(tagOf('image')).toBeUndefined();
    expect(tagOf('video')).toHaveTextContent('Pro');
    expect(card('video').props.accessibilityLabel).toBe(`${of('video').title} ${of('video').line} Pro.`);
    expect(tagOf('mac-models')).toHaveTextContent('On your computer');
    expect(card('mac-models').props.accessibilityLabel).toBe(`${of('mac-models').title} ${of('mac-models').line} On your computer.`);
    expect(tagOf('mac-recall')).toHaveTextContent('On your computer · Pro');
    expect(card('mac-recall').props.accessibilityLabel).toMatch(/ On your computer\. Pro\.$/);
    // A title may run to two lines, not be cut at one.
    expect(view.getByText(of('mac-dictation').title).props.numberOfLines).toBe(2);
    expect(view.getAllByRole('tab')).toHaveLength(12);
    expect(selectedPip(view)).toBe(0);
  });

  it('runs the card\'s opener when you press it', () => {
    const opened: string[] = [];
    const features = showcaseFeatures(fresh, { ...openers(), documents: () => opened.push('documents') }, true);
    const view = render(<FeatureShowcase features={features} active={false} />);
    fireEvent.press(view.getByTestId('feature-showcase-documents'));
    expect(opened).toEqual(['documents']);
  });

  it('one card: no pips', () => {
    const view = render(<FeatureShowcase features={sample().slice(0, 1)} active />);
    expect(view.getByTestId('feature-showcase-image')).toBeTruthy();
    expect(view.queryAllByRole('tab')).toHaveLength(0);
  });

  // The pip follows the scroll position, as on the device: a jump asks the row to scroll, and the
  // platform then reports where it landed. Jest's ScrollView never scrolls, so the test reports the
  // landing the way the device does, at the offset the row was asked to reach.
  const scroller = (view: ReturnType<typeof render>) => view.UNSAFE_getByProps({ horizontal: true });
  const land = (view: ReturnType<typeof render>, index: number) => {
    const row = scroller(view);
    const x = (row.props.snapToInterval as number) * index;
    act(() => { fireEvent.scroll(row, { nativeEvent: { contentOffset: { x, y: 0 } } }); });
  };

  it('a pip jumps to its card', () => {
    const view = render(<FeatureShowcase features={sample()} active={false} />);
    fireEvent.press(view.getAllByRole('tab')[2]);
    land(view, 2);
    expect(selectedPip(view)).toBe(2);
  });

  it('moves on by itself while Home is in view, wrapping after the last card', () => {
    jest.useFakeTimers();
    const view = render(<FeatureShowcase features={sample()} active />);
    expect(selectedPip(view)).toBe(0);
    act(() => { jest.advanceTimersToNextTimer(); });
    land(view, 1);
    expect(selectedPip(view)).toBe(1);
    act(() => { jest.advanceTimersToNextTimer(); });
    act(() => { jest.advanceTimersToNextTimer(); });
    act(() => { jest.advanceTimersToNextTimer(); });
    land(view, 0);
    expect(selectedPip(view)).toBe(0);
  });

  it('stays put while Home is not in view', () => {
    jest.useFakeTimers();
    const view = render(<FeatureShowcase features={sample()} active={false} />);
    act(() => { jest.advanceTimersToNextTimer(2); });
    expect(selectedPip(view)).toBe(0);
  });

  it('stops while you swipe, settles on the card you land on, then moves on again', () => {
    jest.useFakeTimers();
    const view = render(<FeatureShowcase features={sample()} active />);
    const row = scroller(view);
    act(() => { fireEvent(row, 'scrollBeginDrag', { nativeEvent: { contentOffset: { x: 0, y: 0 } } }); });
    act(() => { jest.advanceTimersToNextTimer(2); });
    expect(selectedPip(view)).toBe(0);

    // Land on the third card: its offset is two steps of the snap interval.
    const step = row.props.snapToInterval as number;
    act(() => { fireEvent(row, 'scrollEndDrag', { nativeEvent: { contentOffset: { x: step * 2, y: 0 } } }); });
    act(() => { fireEvent(row, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: step * 2, y: 0 } } }); });
    expect(selectedPip(view)).toBe(2);
    act(() => { jest.advanceTimersToNextTimer(); });
    land(view, 3);
    expect(selectedPip(view)).toBe(3);
  });
});
