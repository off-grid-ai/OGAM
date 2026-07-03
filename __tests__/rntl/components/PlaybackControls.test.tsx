/**
 * PlayButton (audio message bubble) tests.
 *
 * Regression: a message whose TTS is paused/playing must ALWAYS be controllable,
 * even while the bubble's message is still flagged `isLoading`. Before the fix the
 * loading state rendered a non-touchable View, so a paused message could never be
 * resumed ("play not clickable") — the tap reached nothing.
 */
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/Feather', () => 'Icon');

import { PlayButton } from '../../../pro/audio/ui/AudioMessageBubble/PlaybackControls';

const colors = { primary: '#0f0' } as any;
const styles = { playButton: {}, playButtonDisabled: {} } as any;

function renderButton(props: Partial<React.ComponentProps<typeof PlayButton>>) {
  const onPlayPause = jest.fn();
  const utils = render(
    <PlayButton
      isLoading={false}
      isThisLoading={false}
      isThisPlaying={false}
      isThisPaused={false}
      onPlayPause={onPlayPause}
      colors={colors}
      styles={styles}
      {...props}
    />,
  );
  return { onPlayPause, ...utils };
}

describe('PlayButton', () => {
  it('is touchable and resumes when paused, even while the message is loading', () => {
    const { onPlayPause, UNSAFE_getAllByType } = renderButton({ isThisPaused: true, isLoading: true });
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    expect(touchables).toHaveLength(1);
    fireEvent.press(touchables[0]);
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it('is touchable while actively playing (shows pause)', () => {
    const { onPlayPause, UNSAFE_getAllByType } = renderButton({ isThisPlaying: true, isLoading: true });
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    expect(touchables).toHaveLength(1);
    fireEvent.press(touchables[0]);
    expect(onPlayPause).toHaveBeenCalled();
  });

  it('renders a non-touchable placeholder while loading when NOT the active target', () => {
    const { UNSAFE_queryAllByType } = renderButton({ isLoading: true });
    expect(UNSAFE_queryAllByType(TouchableOpacity)).toHaveLength(0);
  });

  it('is touchable in the normal idle state', () => {
    const { onPlayPause, UNSAFE_getAllByType } = renderButton({});
    fireEvent.press(UNSAFE_getAllByType(TouchableOpacity)[0]);
    expect(onPlayPause).toHaveBeenCalled();
  });
});
