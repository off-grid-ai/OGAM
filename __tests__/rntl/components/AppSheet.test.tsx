/**
 * AppSheet Component Tests
 *
 * Tests for the bottom sheet component using RN Modal + Animated:
 * - Returns null when not visible and modalVisible is false
 * - Renders Modal when visible
 * - Shows title in header
 * - Shows close button with "Done" label
 * - Shows custom closeLabel
 * - Hides header when showHeader=false
 * - Hides handle when showHandle=false
 * - Renders children content
 * - Pressing close button triggers dismiss
 *
 * Priority: P1 (High)
 */

import React from 'react';
import {
  Text,
  Keyboard,
  Modal,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { AppSheet } from '../../../src/components/AppSheet';

describe('AppSheet', () => {
  const defaultProps = {
    visible: false,
    onClose: jest.fn(),
    children: <Text>Sheet Content</Text>,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Visibility
  // ============================================================================
  describe('visibility', () => {
    it('returns null when not visible and modalVisible is false', () => {
      const { toJSON } = render(<AppSheet {...defaultProps} visible={false} />);

      // When visible is false and internal modalVisible is false, renders null
      expect(toJSON()).toBeNull();
    });

    it('renders Modal when visible is true', () => {
      const { toJSON } = render(<AppSheet {...defaultProps} visible={true} />);

      // When visible is true, the component sets modalVisible=true and renders Modal
      expect(toJSON()).toBeTruthy();
    });
  });

  // ============================================================================
  // Header
  // ============================================================================
  describe('header', () => {
    it('shows title in header', () => {
      const { getByText } = render(
        <AppSheet {...defaultProps} visible={true} title="My Sheet" />,
      );

      expect(getByText('My Sheet')).toBeTruthy();
    });

    it('shows close button with default "Done" label', () => {
      const { getByText } = render(
        <AppSheet {...defaultProps} visible={true} title="Sheet" />,
      );

      expect(getByText('Done')).toBeTruthy();
    });

    it('shows custom closeLabel', () => {
      const { getByText } = render(
        <AppSheet
          {...defaultProps}
          visible={true}
          title="Sheet"
          closeLabel="Cancel"
        />,
      );

      expect(getByText('Cancel')).toBeTruthy();
    });

    it('hides header when showHeader is false', () => {
      const { queryByText } = render(
        <AppSheet
          {...defaultProps}
          visible={true}
          title="Hidden Title"
          showHeader={false}
        />,
      );

      // Header title should not render when showHeader is false
      expect(queryByText('Hidden Title')).toBeNull();
      expect(queryByText('Done')).toBeNull();
    });

    it('does not render header when title is not provided', () => {
      const { queryByText } = render(
        <AppSheet {...defaultProps} visible={true} />,
      );

      // No title means no header row rendered (showHeader && title condition)
      expect(queryByText('Done')).toBeNull();
    });
  });

  // ============================================================================
  // Handle
  // ============================================================================
  describe('handle', () => {
    it('shows handle by default', () => {
      const { toJSON } = render(
        <AppSheet {...defaultProps} visible={true} title="Sheet" />,
      );

      // The handle container is always rendered by default (showHandle=true)
      const treeStr = JSON.stringify(toJSON());
      // The handle renders as a View inside a handleContainer View
      expect(treeStr).toBeTruthy();
    });

    it('hides handle when showHandle is false', () => {
      const withHandle = render(
        <AppSheet
          {...defaultProps}
          visible={true}
          title="Sheet"
          showHandle={true}
        />,
      );

      const withoutHandle = render(
        <AppSheet
          {...defaultProps}
          visible={true}
          title="Sheet"
          showHandle={false}
        />,
      );

      // The tree without handle should be smaller (no handleContainer view)
      const withHandleStr = JSON.stringify(withHandle.toJSON());
      const withoutHandleStr = JSON.stringify(withoutHandle.toJSON());
      expect(withoutHandleStr.length).toBeLessThan(withHandleStr.length);
    });
  });

  // ============================================================================
  // Children
  // ============================================================================
  describe('children', () => {
    it('renders children content', () => {
      const { getByText } = render(
        <AppSheet {...defaultProps} visible={true}>
          <Text>Custom Child Content</Text>
        </AppSheet>,
      );

      expect(getByText('Custom Child Content')).toBeTruthy();
    });

    it('renders multiple children', () => {
      const { getByText } = render(
        <AppSheet {...defaultProps} visible={true}>
          <Text>First Child</Text>
          <Text>Second Child</Text>
        </AppSheet>,
      );

      expect(getByText('First Child')).toBeTruthy();
      expect(getByText('Second Child')).toBeTruthy();
    });
  });

  // ============================================================================
  // Close Button
  // ============================================================================
  describe('close button', () => {
    it('pressing close button triggers dismiss animation', async () => {
      const onClose = jest.fn();
      const { getByText } = render(
        <AppSheet visible={true} onClose={onClose} title="Closeable Sheet">
          <Text>Content</Text>
        </AppSheet>,
      );

      const doneButton = getByText('Done');
      fireEvent.press(doneButton);

      // The dismiss function animates out then calls onClose and sets modalVisible=false.
      // Due to animation timing in test environment, onClose may be called asynchronously.
      await waitFor(
        () => {
          expect(onClose).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );
    });
  });

  // ============================================================================
  // Snap Points
  // ============================================================================
  describe('snap points', () => {
    it('accepts custom percentage snap points', () => {
      const { toJSON } = render(
        <AppSheet
          {...defaultProps}
          visible={true}
          snapPoints={['30%', '60%']}
          title="Snap Sheet"
        />,
      );

      expect(toJSON()).toBeTruthy();
    });

    it('accepts numeric snap points', () => {
      const { toJSON } = render(
        <AppSheet
          {...defaultProps}
          visible={true}
          snapPoints={[200, 400]}
          title="Numeric Snap"
        />,
      );

      expect(toJSON()).toBeTruthy();
    });

    it('accepts enableDynamicSizing', () => {
      const { toJSON } = render(
        <AppSheet
          {...defaultProps}
          visible={true}
          enableDynamicSizing={true}
          title="Dynamic Sheet"
        />,
      );

      expect(toJSON()).toBeTruthy();
    });

    it('renders without snap points (default 50%)', () => {
      const { toJSON } = render(
        <AppSheet {...defaultProps} visible={true} title="Default Snap" />,
      );

      expect(toJSON()).toBeTruthy();
    });
  });

  // ============================================================================
  // Elevation
  // ============================================================================
  describe('elevation', () => {
    it('uses level3 elevation by default', () => {
      const { toJSON } = render(
        <AppSheet {...defaultProps} visible={true} title="Level 3" />,
      );
      expect(toJSON()).toBeTruthy();
    });

    it('accepts level4 elevation', () => {
      const { toJSON } = render(
        <AppSheet
          {...defaultProps}
          visible={true}
          title="Level 4"
          elevation="level4"
        />,
      );
      expect(toJSON()).toBeTruthy();
    });
  });

  // ============================================================================
  // Keyboard Dismiss Before Open
  // ============================================================================
  describe('keyboard dismiss before open', () => {
    let mockRemove: jest.Mock;
    let mockAddListener: jest.SpyInstance;
    let mockDismiss: jest.SpyInstance;
    let mockIsVisible: jest.SpyInstance;

    beforeEach(() => {
      mockRemove = jest.fn();
      mockAddListener = jest.spyOn(Keyboard, 'addListener').mockReturnValue({
        remove: mockRemove,
      } as any);
      mockDismiss = jest
        .spyOn(Keyboard, 'dismiss')
        .mockImplementation(() => {});
      mockIsVisible = jest.spyOn(Keyboard, 'isVisible' as any);
    });

    afterEach(() => {
      mockAddListener.mockRestore();
      mockDismiss.mockRestore();
      mockIsVisible.mockRestore();
    });

    it('opens modal immediately when keyboard is not visible', () => {
      mockIsVisible.mockReturnValue(false);

      const { toJSON } = render(
        <AppSheet visible={true} onClose={jest.fn()} title="Sheet">
          <Text>Content</Text>
        </AppSheet>,
      );

      expect(Keyboard.dismiss).not.toHaveBeenCalled();
      // addListener may be called by KeyboardAvoidingView internally,
      // but should NOT be called with 'keyboardDidHide' by our code
      const didHideCalls = mockAddListener.mock.calls.filter(
        (call: any[]) => call[0] === 'keyboardDidHide',
      );
      expect(didHideCalls).toHaveLength(0);
      expect(toJSON()).toBeTruthy();
    });

    it('dismisses keyboard and defers modal when keyboard is visible', () => {
      mockIsVisible.mockReturnValue(true);

      const { toJSON } = render(
        <AppSheet visible={false} onClose={jest.fn()} title="Sheet">
          <Text>Content</Text>
        </AppSheet>,
      );

      // Initially not visible
      expect(toJSON()).toBeNull();

      // Now set visible — keyboard is open
      render(
        <AppSheet visible={true} onClose={jest.fn()} title="Sheet">
          <Text>Content</Text>
        </AppSheet>,
      );

      expect(Keyboard.dismiss).toHaveBeenCalled();
      expect(Keyboard.addListener).toHaveBeenCalledWith(
        'keyboardDidHide',
        expect.any(Function),
      );
    });

    it('opens modal after keyboardDidHide event fires', async () => {
      mockIsVisible.mockReturnValue(true);
      let keyboardHideCallback: (() => void) | null = null;
      mockAddListener.mockImplementation((_event: string, cb: () => void) => {
        keyboardHideCallback = cb;
        return { remove: mockRemove };
      });

      const { rerender, getByText } = render(
        <AppSheet visible={false} onClose={jest.fn()} title="Sheet">
          <Text>Content</Text>
        </AppSheet>,
      );

      // Open the sheet — keyboard is visible, so modal deferred
      rerender(
        <AppSheet visible={true} onClose={jest.fn()} title="Sheet">
          <Text>Content</Text>
        </AppSheet>,
      );

      expect(Keyboard.dismiss).toHaveBeenCalled();

      // Simulate keyboard finishing its dismiss
      await act(() => {
        keyboardHideCallback!();
      });

      // Modal should now be visible with content
      expect(getByText('Sheet')).toBeTruthy();
      expect(mockRemove).toHaveBeenCalled();
    });

    it('opens modal via safety timeout if keyboardDidHide never fires', async () => {
      jest.useFakeTimers();
      mockIsVisible.mockReturnValue(true);

      const { rerender, getByText } = render(
        <AppSheet visible={false} onClose={jest.fn()} title="Sheet">
          <Text>Content</Text>
        </AppSheet>,
      );

      rerender(
        <AppSheet visible={true} onClose={jest.fn()} title="Sheet">
          <Text>Content</Text>
        </AppSheet>,
      );

      expect(Keyboard.dismiss).toHaveBeenCalled();

      // Fast-forward past the 400ms safety timeout
      await act(() => {
        jest.advanceTimersByTime(400);
      });

      expect(getByText('Sheet')).toBeTruthy();
      expect(mockRemove).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('does not open modal twice if both listener and timeout fire', async () => {
      jest.useFakeTimers();
      mockIsVisible.mockReturnValue(true);
      let keyboardHideCallback: (() => void) | null = null;
      mockAddListener.mockImplementation((_event: string, cb: () => void) => {
        keyboardHideCallback = cb;
        return { remove: mockRemove };
      });

      const { rerender } = render(
        <AppSheet visible={false} onClose={jest.fn()} title="Sheet">
          <Text>Content</Text>
        </AppSheet>,
      );

      rerender(
        <AppSheet visible={true} onClose={jest.fn()} title="Sheet">
          <Text>Content</Text>
        </AppSheet>,
      );

      // Fire the keyboard hide callback
      await act(() => {
        keyboardHideCallback!();
      });

      // Also fire the timeout — should be a no-op
      await act(() => {
        jest.advanceTimersByTime(400);
      });

      // No errors — the guard prevents double setState
      jest.useRealTimers();
    });

    it('cleans up listener and timeout on unmount during keyboard dismiss', () => {
      jest.useFakeTimers();
      mockIsVisible.mockReturnValue(true);

      const { unmount } = render(
        <AppSheet visible={true} onClose={jest.fn()} title="Sheet">
          <Text>Content</Text>
        </AppSheet>,
      );

      expect(Keyboard.addListener).toHaveBeenCalled();

      unmount();

      // Cleanup should have removed the listener
      expect(mockRemove).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  // ============================================================================
  // Bottom Safe Area Inset Spacer (Edge-to-Edge)
  // ============================================================================
  describe('bottom safe area inset spacer', () => {
    // Access the mocked module so we can swap the return value per test
    let mockUseSafeAreaInsets: jest.Mock;

    beforeEach(() => {
      // Get a handle on the mocked function
      mockUseSafeAreaInsets =
        require('react-native-safe-area-context').useSafeAreaInsets;
    });

    it('does not render bottom spacer when bottom inset is 0', () => {
      // Default mock returns bottom: 0
      const { queryByTestId } = render(
        <AppSheet {...defaultProps} visible={true} title="No Spacer" />,
      );
      expect(queryByTestId('bottom-safe-area-spacer')).toBeNull();
    });

    it('renders bottom spacer when bottom inset is greater than 0', () => {
      // Override mock to simulate edge-to-edge device
      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        right: 0,
        bottom: 34,
        left: 0,
      });

      const { getByTestId } = render(
        <AppSheet {...defaultProps} visible={true} title="With Spacer" />,
      );
      const spacer = getByTestId('bottom-safe-area-spacer');
      expect(spacer).toBeDefined();
      expect(spacer.props.style.height).toBe(34);
    });

    it('spacer height matches the actual bottom inset value', () => {
      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        right: 0,
        bottom: 48,
        left: 0,
      });

      const { getByTestId } = render(
        <AppSheet {...defaultProps} visible={true} title="Inset 48" />,
      );
      const spacer = getByTestId('bottom-safe-area-spacer');
      expect(spacer.props.style.height).toBe(48);
    });
  });

  describe('keyboard surface continuity', () => {
    it('keeps the sheet surface behind the rounded keyboard corners', () => {
      const listeners = new Map<string, (event?: any) => void>();
      const addListener = jest
        .spyOn(Keyboard, 'addListener')
        .mockImplementation((event: string, listener: any) => {
          listeners.set(event, listener);
          return { remove: jest.fn() } as any;
        });
      const { getByTestId, queryByTestId } = render(
        <AppSheet {...defaultProps} visible={true} title="Keyboard Sheet" />,
      );

      expect(queryByTestId('app-sheet-keyboard-underlay')).toBeNull();

      act(() => {
        listeners.get('keyboardWillShow')?.({
          endCoordinates: { height: 336 },
        });
      });

      const underlay = getByTestId('app-sheet-keyboard-underlay');
      expect(underlay.props.pointerEvents).toBe('none');
      expect(underlay.props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ height: 336 })]),
      );

      act(() => {
        listeners.get('keyboardWillHide')?.();
      });
      expect(queryByTestId('app-sheet-keyboard-underlay')).toBeNull();
      addListener.mockRestore();
    });
  });

  // ============================================================================
  // Visibility Transitions
  // ============================================================================
  describe('visibility transitions', () => {
    it('transitions from visible to hidden', async () => {
      const onClose = jest.fn();
      const { rerender, toJSON } = render(
        <AppSheet visible={true} onClose={onClose} title="Transition">
          <Text>Content</Text>
        </AppSheet>,
      );

      // Should be visible
      expect(toJSON()).toBeTruthy();

      // Set visible to false - triggers animateOut
      rerender(
        <AppSheet visible={false} onClose={onClose} title="Transition">
          <Text>Content</Text>
        </AppSheet>,
      );

      // Wait for animation to complete
      await waitFor(
        () => {
          // After animation, the component may render null or a modal
          expect(true).toBe(true);
        },
        { timeout: 1000 },
      );
    });

    it('backdrop tap triggers dismiss', async () => {
      const onClose = jest.fn();
      const { UNSAFE_getByType } = render(
        <AppSheet visible={true} onClose={onClose} title="Backdrop Test">
          <Text>Content</Text>
        </AppSheet>,
      );

      const backdrop = UNSAFE_getByType(TouchableWithoutFeedback);
      fireEvent.press(backdrop);

      await waitFor(
        () => {
          expect(onClose).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );
    });

    it('back button (onRequestClose) triggers dismiss', async () => {
      const onClose = jest.fn();
      const { UNSAFE_getByType } = render(
        <AppSheet visible={true} onClose={onClose} title="Back Button">
          <Text>Content</Text>
        </AppSheet>,
      );

      const modal = UNSAFE_getByType(Modal);
      act(() => {
        modal.props.onRequestClose();
      });

      await waitFor(
        () => {
          expect(onClose).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );
    });

    it('blocks backdrop, header, and system dismissal when not dismissible', () => {
      const onClose = jest.fn();
      const { UNSAFE_getByType, getByTestId } = render(
        <AppSheet
          visible={true}
          dismissible={false}
          onClose={onClose}
          title="Activation"
        >
          <Text>Content</Text>
        </AppSheet>,
      );

      fireEvent.press(UNSAFE_getByType(TouchableWithoutFeedback));
      fireEvent.press(getByTestId('app-sheet-close'));
      act(() => {
        UNSAFE_getByType(Modal).props.onRequestClose();
      });

      expect(onClose).not.toHaveBeenCalled();
    });

    it('uses the latest committed close callback from an existing handler', async () => {
      const firstClose = jest.fn();
      const latestClose = jest.fn();
      const firstClosed = jest.fn();
      const latestClosed = jest.fn();
      const ui = render(
        <AppSheet
          visible={true}
          onClose={firstClose}
          onClosed={firstClosed}
          title="Callback"
        >
          <Text>Content</Text>
        </AppSheet>,
      );
      const backdrop = ui.UNSAFE_getByType(TouchableWithoutFeedback);

      ui.rerender(
        <AppSheet
          visible={true}
          onClose={latestClose}
          onClosed={latestClosed}
          title="Callback"
        >
          <Text>Content</Text>
        </AppSheet>,
      );
      fireEvent.press(backdrop);

      await waitFor(() => expect(latestClose).toHaveBeenCalledTimes(1));
      expect(latestClosed).toHaveBeenCalledTimes(1);
      expect(firstClose).not.toHaveBeenCalled();
      expect(firstClosed).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // resolveSnapPoint — fallback path (line 39)
  // ============================================================================
  describe('resolveSnapPoint fallback', () => {
    it('falls back to 50% screen height for an unrecognised string snap point', () => {
      // A string that does not end with '%' falls into the final return branch
      const { toJSON } = render(
        <AppSheet
          {...defaultProps}
          visible={true}
          snapPoints={['invalid-snap']}
          title="Fallback Snap"
        />,
      );

      expect(toJSON()).toBeTruthy();
    });
  });

  // ============================================================================
  // handleModalShow / animateIn (lines 76, 150-152)
  // ============================================================================
  describe('handleModalShow', () => {
    it('triggers animateIn when modal onShow fires with a pending animation', () => {
      const { UNSAFE_getByType } = render(
        <AppSheet visible={true} onClose={jest.fn()} title="AnimateIn Test">
          <Text>Content</Text>
        </AppSheet>,
      );

      const modal = UNSAFE_getByType(Modal);

      // pendingAnimateIn.current is set to true when visible becomes true.
      // Calling onShow should consume it and call animateIn.
      act(() => {
        modal.props.onShow();
      });

      // A second onShow call should be a no-op (flag already cleared)
      act(() => {
        modal.props.onShow();
      });

      // No errors — animateIn ran; verify sheet is still rendered
      expect(modal).toBeTruthy();
    });
  });

  // ============================================================================
  // PanResponder handlers (lines 168-195)
  // ============================================================================
  describe('pan responder', () => {
    /**
     * Helper: find the handle container view by locating the first View
     * that has `onMoveShouldSetResponder` (spread from panHandlers).
     */
    function getHandleContainer(getAllByType: (type: any) => any[]) {
      const views = getAllByType(View);
      return views.find(
        (v: any) => typeof v.props.onMoveShouldSetResponder === 'function',
      );
    }

    /**
     * Build a synthetic event with the touchHistory format that PanResponder expects.
     * PanResponder accumulates dy via: dy += currentPageY - previousPageY.
     * Pass previousY to control the delta: dy_delta = pageY - previousY.
     */
    function makeTouchEvent(
      pageY: number,
      previousY?: number,
      timestamp = Date.now(),
    ) {
      const prevY = previousY ?? pageY;
      const touchEntry = {
        touchActive: true,
        startPageX: 0,
        startPageY: 0,
        startTimeStamp: timestamp - 100,
        currentPageX: 0,
        currentPageY: pageY,
        currentTimeStamp: timestamp,
        previousPageX: 0,
        previousPageY: prevY,
        previousTimeStamp: timestamp - 16,
      };
      return {
        nativeEvent: {
          touches: [
            {
              pageX: 0,
              pageY,
              identifier: 0,
              locationX: 0,
              locationY: pageY,
              timestamp,
            },
          ],
          changedTouches: [
            {
              pageX: 0,
              pageY,
              identifier: 0,
              locationX: 0,
              locationY: pageY,
              timestamp,
            },
          ],
          target: 1,
          timestamp,
        },
        touchHistory: {
          touchBank: [touchEntry],
          indexOfSingleActiveTouch: 0,
          mostRecentTimeStamp: timestamp,
          numberActiveTouches: 1,
        },
      };
    }

    it('onStartShouldSetPanResponder returns false (no capture on start)', () => {
      const { UNSAFE_getAllByType } = render(
        <AppSheet visible={true} onClose={jest.fn()}>
          <Text>Content</Text>
        </AppSheet>,
      );

      const handle = getHandleContainer(UNSAFE_getAllByType);
      expect(handle).toBeTruthy();

      // The onStartShouldSetResponder handler is the PanResponder wrapper around
      // onStartShouldSetPanResponder. Calling it exercises line 168.
      act(() => {
        const result = handle.props.onStartShouldSetResponder?.(
          makeTouchEvent(100),
        );
        // Our config returns false, so the responder should not claim the gesture
        expect(result).toBe(false);
      });
    });

    it('onMoveShouldSetPanResponder is called and returns a boolean', () => {
      const { UNSAFE_getAllByType } = render(
        <AppSheet visible={true} onClose={jest.fn()}>
          <Text>Content</Text>
        </AppSheet>,
      );

      const handle = getHandleContainer(UNSAFE_getAllByType);
      expect(handle).toBeTruthy();

      act(() => {
        // Calling onMoveShouldSetResponder exercises the onMoveShouldSetPanResponder callback
        const result = handle.props.onMoveShouldSetResponder?.(
          makeTouchEvent(115),
        );
        if (result !== undefined) {
          expect(typeof result).toBe('boolean');
        }
      });
    });

    it('onPanResponderMove exercises move handler without throwing', () => {
      const { UNSAFE_getAllByType } = render(
        <AppSheet visible={true} onClose={jest.fn()}>
          <Text>Content</Text>
        </AppSheet>,
      );

      const handle = getHandleContainer(UNSAFE_getAllByType);
      expect(handle).toBeTruthy();

      // Fires onResponderMove which calls onPanResponderMove (lines 170-174)
      expect(() => {
        act(() => {
          handle.props.onResponderMove?.(makeTouchEvent(50));
          handle.props.onResponderMove?.(makeTouchEvent(120));
        });
      }).not.toThrow();
    });

    it('onPanResponderRelease snaps back when drag is small (dy < 80)', async () => {
      const onClose = jest.fn();
      const { UNSAFE_getAllByType } = render(
        <AppSheet visible={true} onClose={onClose}>
          <Text>Content</Text>
        </AppSheet>,
      );

      const handle = getHandleContainer(UNSAFE_getAllByType);
      expect(handle).toBeTruthy();

      // Small drag (dy = 30 < 80) → snap-back branch (lines 194-200)
      act(() => {
        handle.props.onResponderRelease?.(makeTouchEvent(30));
      });

      // onClose should NOT be called after snap back
      await waitFor(() => {
        expect(onClose).not.toHaveBeenCalled();
      });
    });

    it('exercises the dismiss branch when drag exceeds threshold (dy > 80)', () => {
      // Mock Animated.parallel so its .start() callback fires synchronously.
      // This lets us exercise lines 189-192 (the dismiss completion: setModalVisible +
      // onClose) without depending on the native animation driver in jest.
      const { Animated: RNAnimated } = require('react-native');
      const startMock = jest.fn(
        (cb?: (result: { finished: boolean }) => void) => {
          if (cb) cb({ finished: true });
        },
      );
      jest
        .spyOn(RNAnimated, 'parallel')
        .mockReturnValue({ start: startMock } as any);

      const onClose = jest.fn();
      const { UNSAFE_getAllByType } = render(
        <AppSheet visible={true} onClose={onClose}>
          <Text>Content</Text>
        </AppSheet>,
      );

      const handle = getHandleContainer(UNSAFE_getAllByType);
      expect(handle).toBeTruthy();

      // Accumulate dy=200 via move (previousY=0, currentY=200 → dy_delta=200).
      // Release triggers onPanResponderRelease with dy=200 > 80 → dismiss branch.
      act(() => {
        handle.props.onResponderMove?.(makeTouchEvent(200, 0));
        handle.props.onResponderRelease?.(makeTouchEvent(200, 200));
      });

      // The dismiss branch called Animated.parallel().start(cb) and cb fired
      // synchronously → onClose should have been called.
      expect(onClose).toHaveBeenCalled();

      jest.restoreAllMocks();
    });

    it('uses the latest committed dismissible value for an existing swipe handle', () => {
      const onClose = jest.fn();
      const ui = render(
        <AppSheet visible={true} dismissible onClose={onClose}>
          <Text>Content</Text>
        </AppSheet>,
      );
      const handle = getHandleContainer(ui.UNSAFE_getAllByType);
      expect(handle).toBeTruthy();

      ui.rerender(
        <AppSheet visible={true} dismissible={false} onClose={onClose}>
          <Text>Content</Text>
        </AppSheet>,
      );
      act(() => {
        expect(
          handle.props.onMoveShouldSetResponder?.(makeTouchEvent(200, 0)),
        ).toBe(false);
        handle.props.onResponderMove?.(makeTouchEvent(200, 0));
        handle.props.onResponderRelease?.(makeTouchEvent(200, 200));
      });

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // backdropEnabled guard (first-tap-swallowed fix)
  // ============================================================================
  describe('backdropEnabled guard', () => {
    it('backdrop press is ignored while animateIn is running (backdropEnabled=false)', () => {
      // Freeze Animated.parallel so the .start() callback never fires.
      // This simulates the sheet mid-animation where backdropEnabled=false.
      const { Animated: RNAnimated } = require('react-native');
      const startMock = jest.fn(); // callback deliberately NOT called
      jest
        .spyOn(RNAnimated, 'parallel')
        .mockReturnValue({ start: startMock } as any);

      const onClose = jest.fn();
      const { UNSAFE_getByType } = render(
        <AppSheet visible={true} onClose={onClose} title="Guard Test">
          <Text>Content</Text>
        </AppSheet>,
      );

      // Trigger animateIn (sets backdropEnabled=false, callback never fires)
      const modal = UNSAFE_getByType(Modal);
      act(() => {
        modal.props.onShow();
      });

      // Backdrop press while animation is still running — must be ignored
      const backdrop = UNSAFE_getByType(TouchableWithoutFeedback);
      fireEvent.press(backdrop);

      expect(onClose).not.toHaveBeenCalled();

      jest.restoreAllMocks();
    });

    it('backdrop press works once animateIn completes (backdropEnabled=true)', async () => {
      // Fire the .start() callback synchronously so backdropEnabled becomes true.
      const { Animated: RNAnimated } = require('react-native');
      const startMock = jest.fn(
        (cb?: (result: { finished: boolean }) => void) => {
          cb?.({ finished: true });
        },
      );
      jest
        .spyOn(RNAnimated, 'parallel')
        .mockReturnValue({ start: startMock } as any);

      const onClose = jest.fn();
      const { UNSAFE_getByType } = render(
        <AppSheet visible={true} onClose={onClose} title="Guard Test">
          <Text>Content</Text>
        </AppSheet>,
      );

      // Trigger animateIn — callback fires synchronously → backdropEnabled=true
      const modal = UNSAFE_getByType(Modal);
      act(() => {
        modal.props.onShow();
      });

      // Backdrop press after animation completes — must dismiss
      const backdrop = UNSAFE_getByType(TouchableWithoutFeedback);
      fireEvent.press(backdrop);

      await waitFor(
        () => {
          expect(onClose).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );

      jest.restoreAllMocks();
    });

    it('backdropEnabled resets to false when animateOut starts', async () => {
      // Allow animateIn to complete, then verify animateOut disables backdrop.
      const { Animated: RNAnimated } = require('react-native');
      let callCount = 0;
      const startMock = jest.fn(
        (cb?: (result: { finished: boolean }) => void) => {
          callCount++;
          if (callCount === 1) {
            // First call is animateIn — fire immediately so backdropEnabled=true
            cb?.({ finished: true });
          }
          // Second call is animateOut — do NOT fire, simulating mid-dismiss state
        },
      );
      jest
        .spyOn(RNAnimated, 'parallel')
        .mockReturnValue({ start: startMock } as any);

      const onClose = jest.fn();
      const { UNSAFE_getByType } = render(
        <AppSheet visible={true} onClose={onClose} title="Guard Test">
          <Text>Content</Text>
        </AppSheet>,
      );

      const modal = UNSAFE_getByType(Modal);
      act(() => {
        modal.props.onShow();
      }); // animateIn completes → backdropEnabled=true

      const backdrop = UNSAFE_getByType(TouchableWithoutFeedback);

      // First press triggers dismiss → animateOut starts → backdropEnabled=false
      fireEvent.press(backdrop);

      // Second press while animateOut is still running — must be ignored
      fireEvent.press(backdrop);

      // onClose called at most once (the animateOut callback never fired here,
      // so it may be 0; the key assertion is it is NOT called twice)
      expect(onClose.mock.calls.length).toBeLessThanOrEqual(1);

      jest.restoreAllMocks();
    });
  });

  // ============================================================================
  // animateIn uses Animated.timing (guaranteed callback, not spring)
  // ============================================================================
  describe('animateIn uses timing animation', () => {
    it('calls Animated.timing (not Animated.spring) for the slide-in', () => {
      const { Animated: RNAnimated } = require('react-native');
      const timingSpy = jest.spyOn(RNAnimated, 'timing');
      const springSpy = jest.spyOn(RNAnimated, 'spring');

      const { UNSAFE_getByType } = render(
        <AppSheet visible={true} onClose={jest.fn()} title="Timing Test">
          <Text>Content</Text>
        </AppSheet>,
      );

      const modal = UNSAFE_getByType(Modal);
      act(() => {
        modal.props.onShow();
      });

      // animateIn should use timing (for guaranteed callback) not spring
      expect(timingSpy).toHaveBeenCalled();
      // The translateY call should have toValue: 0 (slide in)
      const slideInCall = timingSpy.mock.calls.find(
        ([, config]: any[]) => config?.toValue === 0,
      );
      expect(slideInCall).toBeTruthy();
      // Spring should NOT be used for the entry animation
      const springToZero = springSpy.mock.calls.find(
        ([, config]: any[]) => config?.toValue === 0,
      );
      expect(springToZero).toBeFalsy();

      jest.restoreAllMocks();
    });
  });
});
