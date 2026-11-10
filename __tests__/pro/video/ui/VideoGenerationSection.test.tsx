/**
 * VideoGenerationSection: the video settings, in two shapes.
 *
 * - alwaysOpen (the Model settings tab): a quiet "Video" label and the settings card, always shown.
 *   Tabs replaced the accordions there, so nothing folds.
 * - default: the "Video generation" header row with its current size, folded until you press it.
 *
 * The component, the real app store and theme run as they ship; nothing of ours is mocked.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Switch } from 'react-native';
import { useAppStore } from '../../../../src/stores';
import { VideoGenerationSection } from '@offgrid/pro/video/ui/VideoGenerationSection';

describe('VideoGenerationSection', () => {
  it('alwaysOpen: shows the Video label and the settings card, with no fold to press', () => {
    const { getByText, getByTestId, queryByTestId, queryByText } = render(<VideoGenerationSection alwaysOpen />);

    expect(getByText('Video')).toBeTruthy();
    expect(getByTestId('video-settings-recommended')).toHaveTextContent(/^Recommended: \d+×\d+, \d+ frames, \d+ steps\./);
    expect(getByText('Default video settings')).toBeTruthy();
    expect(queryByTestId('video-generation-accordion')).toBeNull();
    expect(queryByText('Video generation')).toBeNull();
  });

  it('default: a folded "Video generation" row with its size, which opens and closes the card', () => {
    const { getByTestId, getByText, queryByTestId, queryByText } = render(<VideoGenerationSection />);

    const header = getByTestId('video-generation-accordion');
    expect(getByText('Video generation')).toBeTruthy();
    expect(header).toHaveTextContent(/\d+×\d+ · \d+ frames/);
    expect(header.props.accessibilityState).toMatchObject({ expanded: false });
    expect(queryByTestId('video-settings-recommended')).toBeNull();
    expect(queryByText('Video')).toBeNull();

    fireEvent.press(header);
    expect(getByTestId('video-settings-recommended')).toBeTruthy();
    expect(getByTestId('video-generation-accordion').props.accessibilityState).toMatchObject({ expanded: true });

    fireEvent.press(getByTestId('video-generation-accordion'));
    expect(queryByTestId('video-settings-recommended')).toBeNull();
  });

  it('"Rewrite video prompts" is the app\'s switch: a white knob once it is on', () => {
    useAppStore.getState().updateSettings({ enhanceVideoPrompts: false });
    const { UNSAFE_getByType } = render(<VideoGenerationSection alwaysOpen />);

    fireEvent(UNSAFE_getByType(Switch), 'valueChange', true);
    expect(useAppStore.getState().settings.enhanceVideoPrompts).toBe(true);
    expect(UNSAFE_getByType(Switch).props.value).toBe(true);
    expect(UNSAFE_getByType(Switch).props.thumbColor).toBe('#FFFFFF');
  });
});
