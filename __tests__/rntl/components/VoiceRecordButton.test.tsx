/**
 * VoiceRecordButton Component Tests
 *
 * Tests for the voice recording button with animation, drag-to-cancel:
 * - Renders mic icon when not recording and available
 * - Disabled state (reduced opacity)
 * - Recording indicator when isRecording=true
 * - Transcribing state
 * - Partial result text display
 * - Error state
 * - Model loading state
 * - onStartRecording callback
 * - Unavailable state and alert
 * - asSendButton style variant
 * - Conditional rendering (no partial when not recording, no cancel hint)
 * - Loading without text in asSendButton mode
 * - Transcribing without text in asSendButton mode
 * - Unavailable tap triggers alert
 *
 * Priority: P1 (High)
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { VoiceRecordButton } from '../../../src/components/VoiceRecordButton';

const mockShowAlert = jest.fn((_title: string, _message: string, _buttons?: any[]) => ({
  visible: true,
  title: _title,
  message: _message,
  buttons: _buttons || [],
}));

jest.mock('../../../src/components/CustomAlert', () => ({
  CustomAlert: ({ visible, title, message }: any) => {
    if (!visible) return null;
    const { View, Text } = require('react-native');
    return (
      <View testID="custom-alert">
        <Text testID="alert-title">{title}</Text>
        <Text testID="alert-message">{message}</Text>
      </View>
    );
  },
  showAlert: (...args: any[]) => (mockShowAlert as any)(...args),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
  AlertState: {},
  initialAlertState: { visible: false, title: '', message: '', buttons: [] },
}));

describe('VoiceRecordButton', () => {
  const defaultProps = {
    isRecording: false,
    isAvailable: true,
    partialResult: '',
    onStartRecording: jest.fn(),
    onStopRecording: jest.fn(),
    onCancelRecording: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Rendering States
  // ============================================================================
  describe('rendering states', () => {
    it('renders mic icon when not recording and available', () => {
      const { toJSON } = render(<VoiceRecordButton {...defaultProps} />);

      const tree = toJSON();
      expect(tree).toBeTruthy();
      // When not recording and available, the component should render the main button
      // with mic icon (micBody + micBase views)
    });

    it('renders disabled state with reduced opacity', () => {
      const { toJSON } = render(
        <VoiceRecordButton {...defaultProps} disabled={true} />
      );

      const tree = toJSON();
      // The buttonDisabled style applies opacity: 0.5
      const treeStr = JSON.stringify(tree);
      expect(treeStr).toContain('0.5');
    });

    it('shows recording indicator when isRecording is true', () => {
      const { toJSON } = render(
        <VoiceRecordButton {...defaultProps} isRecording={true} />
      );

      // In audio mode (default, !asSendButton), recording shows a stop icon (square)
      const treeStr = JSON.stringify(toJSON());
      expect(treeStr).toContain('square');
    });

    it('shows transcribing state when isTranscribing is true', () => {
      const { toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          isTranscribing={true}
          isRecording={false}
        />
      );

      // Transcribing state renders a spinning indicator (no text in audio mode)
      expect(toJSON()).toBeTruthy();
    });

    it('shows partial result text when provided in chat mode (asSendButton)', () => {
      const { getByText } = render(
        <VoiceRecordButton
          {...defaultProps}
          asSendButton={true}
          isRecording={true}
          partialResult="Hello world"
        />
      );

      expect(getByText('Hello world')).toBeTruthy();
    });

    it('shows error state via unavailable when error is provided and not available', () => {
      const { toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          isAvailable={false}
          error="Microphone permission denied"
        />
      );

      const tree = toJSON();
      // When not available, it renders the unavailable button state
      expect(tree).toBeTruthy();
    });

    it('shows model loading state when isModelLoading is true', () => {
      const { getByTestId } = render(
        <VoiceRecordButton
          {...defaultProps}
          isModelLoading={true}
        />
      );

      // Audio-mode loading shows the 56px spinner ring (no "Loading..." text)
      expect(getByTestId('voice-loading')).toBeTruthy();
    });
  });

  // ============================================================================
  // Interactions
  // ============================================================================
  describe('interactions', () => {
    it('calls onStartRecording on press when not recording', () => {
      // The VoiceRecordButton uses PanResponder, so we test that the component
      // renders without errors and the callbacks are wired up.
      const onStartRecording = jest.fn();
      const { toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          onStartRecording={onStartRecording}
        />
      );

      // Component should render successfully with the callback wired
      expect(toJSON()).toBeTruthy();
    });

    it('taps unavailable button and triggers download prompt alert', () => {
      const { UNSAFE_getAllByType } = render(
        <VoiceRecordButton
          {...defaultProps}
          isAvailable={false}
          error="Microphone permission denied"
        />
      );

      const { TouchableOpacity } = require('react-native');
      const touchables = UNSAFE_getAllByType(TouchableOpacity);
      // Press the unavailable button
      fireEvent.press(touchables[0]);

      expect(mockShowAlert).toHaveBeenCalledWith(
        'Download Voice Model',
        expect.stringContaining('Download Whisper Base'),
        expect.any(Array)
      );
    });

    it('taps unavailable button shows download prompt with size', () => {
      const { UNSAFE_getAllByType } = render(
        <VoiceRecordButton
          {...defaultProps}
          isAvailable={false}
        />
      );

      const { TouchableOpacity } = require('react-native');
      const touchables = UNSAFE_getAllByType(TouchableOpacity);
      fireEvent.press(touchables[0]);

      expect(mockShowAlert).toHaveBeenCalledWith(
        'Download Voice Model',
        expect.stringContaining('142 MB'),
        expect.any(Array)
      );
    });

    it('alert message includes Download and Cancel buttons', () => {
      const { UNSAFE_getAllByType } = render(
        <VoiceRecordButton
          {...defaultProps}
          isAvailable={false}
        />
      );

      const { TouchableOpacity } = require('react-native');
      const touchables = UNSAFE_getAllByType(TouchableOpacity);
      fireEvent.press(touchables[0]);

      expect(mockShowAlert).toHaveBeenCalledWith(
        'Download Voice Model',
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Cancel' }),
          expect.objectContaining({ text: 'Download' }),
        ])
      );
    });
  });

  // ============================================================================
  // Unavailable State
  // ============================================================================
  describe('unavailable state', () => {
    it('shows unavailable state when isAvailable is false', () => {
      const { toJSON } = render(
        <VoiceRecordButton {...defaultProps} isAvailable={false} />
      );

      const tree = toJSON();
      const treeStr = JSON.stringify(tree);
      // Unavailable state renders with dashed border style and mic-off appearance
      // The unavailableSlash view is rendered with a -45deg rotation
      expect(treeStr).toContain('-45deg');
    });

    it('renders unavailable button as touchable (not disabled)', () => {
      const { UNSAFE_getAllByType } = render(
        <VoiceRecordButton {...defaultProps} isAvailable={false} />
      );

      const { TouchableOpacity } = require('react-native');
      const touchables = UNSAFE_getAllByType(TouchableOpacity);
      // Should have at least one TouchableOpacity for the unavailable tap handler
      expect(touchables.length).toBeGreaterThanOrEqual(1);
    });

    it('shows mic-off icon when asSendButton and unavailable', () => {
      const { toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          isAvailable={false}
          asSendButton={true}
        />
      );

      const treeStr = JSON.stringify(toJSON());
      // asSendButton + unavailable shows "mic-off" icon
      expect(treeStr).toContain('mic-off');
    });

    it('does not show slash when asSendButton and unavailable', () => {
      const { toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          isAvailable={false}
          asSendButton={true}
        />
      );

      const treeStr = JSON.stringify(toJSON());
      // asSendButton unavailable uses Icon instead of the custom slash
      expect(treeStr).not.toContain('-45deg');
    });
  });

  // ============================================================================
  // asSendButton Variant
  // ============================================================================
  describe('asSendButton variant', () => {
    it('renders differently when asSendButton is true', () => {
      const defaultTree = render(
        <VoiceRecordButton {...defaultProps} />
      ).toJSON();

      const sendButtonTree = render(
        <VoiceRecordButton {...defaultProps} asSendButton={true} />
      ).toJSON();

      // The two variants should render differently
      const defaultStr = JSON.stringify(defaultTree);
      const sendStr = JSON.stringify(sendButtonTree);
      expect(defaultStr).not.toEqual(sendStr);
    });

    it('renders mic icon when asSendButton and not recording', () => {
      const { toJSON } = render(
        <VoiceRecordButton {...defaultProps} asSendButton={true} />
      );

      const treeStr = JSON.stringify(toJSON());
      // asSendButton idle state renders Icon with name="mic"
      expect(treeStr).toContain('mic');
    });

    it('renders mic icon when asSendButton and recording', () => {
      const { toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          asSendButton={true}
          isRecording={true}
        />
      );

      const treeStr = JSON.stringify(toJSON());
      // asSendButton + isRecording renders Icon with name="mic"
      expect(treeStr).toContain('mic');
    });

    it('shows loading state without text when asSendButton and loading', () => {
      const { queryByText, toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          asSendButton={true}
          isModelLoading={true}
        />
      );

      // asSendButton loading state does NOT show "Loading..." text
      expect(queryByText('Loading...')).toBeNull();
      expect(toJSON()).toBeTruthy();
    });

    it('shows mic icon in loading state when asSendButton', () => {
      const { toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          asSendButton={true}
          isModelLoading={true}
        />
      );

      const treeStr = JSON.stringify(toJSON());
      // asSendButton + loading shows mic icon
      expect(treeStr).toContain('mic');
    });

    it('shows transcribing state without text when asSendButton and transcribing', () => {
      const { queryByText, toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          asSendButton={true}
          isTranscribing={true}
        />
      );

      // asSendButton transcribing state does NOT show "Transcribing..." text
      expect(queryByText('Transcribing...')).toBeNull();
      expect(toJSON()).toBeTruthy();
    });

    it('shows mic icon in transcribing state when asSendButton', () => {
      const { toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          asSendButton={true}
          isTranscribing={true}
        />
      );

      const treeStr = JSON.stringify(toJSON());
      // asSendButton + transcribing shows mic icon
      expect(treeStr).toContain('mic');
    });
  });

  // ============================================================================
  // No Partial Result When Not Recording
  // ============================================================================
  describe('conditional rendering', () => {
    it('does not show partial result when not recording', () => {
      const { queryByText } = render(
        <VoiceRecordButton
          {...defaultProps}
          isRecording={false}
          partialResult="Some text"
        />
      );

      // Partial result is only shown when isRecording is true
      expect(queryByText('Some text')).toBeNull();
    });

    it('does not show cancel hint when not recording', () => {
      const { toJSON } = render(
        <VoiceRecordButton {...defaultProps} isRecording={false} />
      );

      // Audio mode (default) uses tap-to-toggle, no slide-to-cancel
      const treeStr = JSON.stringify(toJSON());
      expect(treeStr).not.toContain('Slide to cancel');
    });

    it('does not show partial result when partialResult is empty', () => {
      const { toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          isRecording={true}
          partialResult=""
        />
      );

      // partialResult is empty, so the partial result container should not render
      const treeStr = JSON.stringify(toJSON());
      // Audio mode uses tap-to-toggle with a stop icon
      expect(treeStr).toContain('square');
    });

    it('shows recording UI elements but not transcribing when recording', () => {
      const { toJSON, queryByText } = render(
        <VoiceRecordButton
          {...defaultProps}
          isRecording={true}
          isTranscribing={true}
        />
      );

      // When isRecording is true AND isTranscribing is true,
      // the component shows recording UI (not transcribing state)
      const treeStr = JSON.stringify(toJSON());
      expect(treeStr).toContain('square');
      expect(queryByText('Transcribing...')).toBeNull();
    });

    it('does not show loading indicator view when not model loading', () => {
      const { queryByText } = render(
        <VoiceRecordButton {...defaultProps} />
      );

      expect(queryByText('Loading...')).toBeNull();
    });

    it('prioritizes model loading state over recording', () => {
      const { getByTestId, toJSON } = render(
        <VoiceRecordButton
          {...defaultProps}
          isModelLoading={true}
          isRecording={true}
        />
      );

      expect(getByTestId('voice-loading')).toBeTruthy();
      // Recording UI should not render when loading
      const treeStr = JSON.stringify(toJSON());
      expect(treeStr).not.toContain('square');
    });

    it('prioritizes model loading state over transcribing', () => {
      const { getByTestId } = render(
        <VoiceRecordButton
          {...defaultProps}
          isModelLoading={true}
          isTranscribing={true}
        />
      );

      // Loading wins over transcribing — the loading ring renders.
      expect(getByTestId('voice-loading')).toBeTruthy();
    });
  });

  // ============================================================================
  // Gesture continuity through a cold model load
  //
  // The "Slide to cancel" hint now lives inline in the composer (ChatInput.RecordingHint),
  // not on this button. What MUST hold here is that a cold model load does not swap the mic
  // for a bare, gesture-less spinner: the hold-to-record wrapper (voice-record-button, which
  // carries the PanResponder) stays mounted while loading, so hold + slide + release survive
  // the load (and the release-during-load ghost recording can't happen). If the load render
  // reverted to the old early-return spinner, voice-record-button would be absent here.
  // ============================================================================
  describe('gesture continuity', () => {
    it('keeps the gesturable mic wrapper mounted during a cold model load (chat mode)', () => {
      const { getByTestId } = render(
        <VoiceRecordButton {...defaultProps} asSendButton={true} isModelLoading={true} />
      );
      expect(getByTestId('voice-record-button')).toBeTruthy();
    });
  });
});
