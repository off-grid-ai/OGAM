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
});
const fresh: FeatureUse = { imagesMade: 0, videosMade: 0, hasVoice: false, hasSpeech: false };
const keys = (features: ShowcaseFeature[]) => features.map(f => f.key);
const PRO_KEYS = ['video', 'voice', 'sync', 'tools'] as const;

describe('showcaseFeatures', () => {
  it('lists every feature, free then Pro, when nothing has been tried', () => {
    const features = showcaseFeatures(fresh, openers(), true);
    expect(keys(features)).toEqual(['image', 'speech', 'documents', 'video', 'voice', 'sync', 'tools']);
    expect(features.filter(f => f.pro).map(f => f.key)).toEqual([...PRO_KEYS]);
  });

  it('puts what you have tried last, keeping the order within each group', () => {
    const features = showcaseFeatures(
      { imagesMade: 2, videosMade: 1, hasVoice: true, hasSpeech: true },
      openers(),
      true,
    );
    expect(keys(features)).toEqual(['documents', 'sync', 'tools', 'image', 'speech', 'video', 'voice']);
  });

  it('with Pro: every card opens its own feature', () => {
    const open = openers();
    const features = showcaseFeatures(fresh, open, true);
    for (const feature of features) {
      expect(feature.onPress).toBe(open[feature.key as keyof FeatureOpeners]);
    }
  });

  it('without Pro: Pro cards open Pro, free cards still open their feature', () => {
    const open = openers();
    const features = showcaseFeatures(fresh, open, false);
    for (const feature of features) {
      const expected = feature.pro ? open.pro : open[feature.key as keyof FeatureOpeners];
      expect(feature.onPress).toBe(expected);
    }
    expect(features.filter(f => f.onPress === open.pro).map(f => f.key)).toEqual([...PRO_KEYS]);
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

  it('shows the kicker, a card per feature with its words, the Pro tag and a pip per card', () => {
    const features = sample();
    const view = render(<FeatureShowcase features={features} active={false} />);
    expect(view.getByText('What you can do')).toBeTruthy();
    expect(view.getByTestId('feature-showcase-image')).toHaveTextContent(/Describe it, and see it\.\s*Make a picture on this phone\./);
    const video = view.getByTestId('feature-showcase-video');
    expect(video).toHaveTextContent(/Pro/);
    expect(video.props.accessibilityLabel).toBe('Turn words into a clip. Make a short video. Pro.');
    expect(view.getByTestId('feature-showcase-image').props.accessibilityLabel).toBe('Describe it, and see it. Make a picture on this phone.');
    expect(view.getAllByRole('tab')).toHaveLength(4);
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

  it('a pip jumps to its card', () => {
    const view = render(<FeatureShowcase features={sample()} active={false} />);
    fireEvent.press(view.getAllByRole('tab')[2]);
    expect(selectedPip(view)).toBe(2);
  });

  it('moves on by itself while Home is in view, wrapping after the last card', () => {
    jest.useFakeTimers();
    const view = render(<FeatureShowcase features={sample()} active />);
    expect(selectedPip(view)).toBe(0);
    act(() => { jest.advanceTimersByTime(4500); });
    expect(selectedPip(view)).toBe(1);
    act(() => { jest.advanceTimersByTime(4500 * 3); });
    expect(selectedPip(view)).toBe(0);
  });

  it('stays put while Home is not in view', () => {
    jest.useFakeTimers();
    const view = render(<FeatureShowcase features={sample()} active={false} />);
    act(() => { jest.advanceTimersByTime(4500 * 2); });
    expect(selectedPip(view)).toBe(0);
  });

  it('stops while you swipe, settles on the card you land on, then moves on again', () => {
    jest.useFakeTimers();
    const view = render(<FeatureShowcase features={sample()} active />);
    const scroller = view.UNSAFE_getByProps({ horizontal: true });
    act(() => { fireEvent(scroller, 'scrollBeginDrag'); });
    act(() => { jest.advanceTimersByTime(4500 * 2); });
    expect(selectedPip(view)).toBe(0);

    // Land on the third card: its offset is two steps of the snap interval.
    const step = scroller.props.snapToInterval as number;
    act(() => { fireEvent(scroller, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: step * 2, y: 0 } } }); });
    expect(selectedPip(view)).toBe(2);
    act(() => { jest.advanceTimersByTime(4500); });
    expect(selectedPip(view)).toBe(3);
  });
});
