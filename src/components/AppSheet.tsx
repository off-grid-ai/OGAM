import React, {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  Animated,
  Easing,
  PanResponder,
  Dimensions,
  Platform,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useThemedStyles } from '../theme';
import { createStyles } from './AppSheet.styles';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface AppSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Fired AFTER the sheet has fully closed (close animation done, modal hidden).
   * Use this to safely present another sheet without colliding with this one's
   * dismissal — iOS can't present a modal while another is mid-dismiss.
   */
  onClosed?: () => void;
  onHeaderClosePress?: () => void;
  snapPoints?: (string | number)[];
  enableDynamicSizing?: boolean;
  title?: string;
  closeLabel?: string;
  showHeader?: boolean;
  showHandle?: boolean;
  elevation?: 'level3' | 'level4';
  /** Prevent every user-driven dismissal path while a critical action runs. */
  dismissible?: boolean;
  children: React.ReactNode;
}

function resolveSnapPoint(snap: string | number): number {
  if (typeof snap === 'number') return snap;
  if (typeof snap === 'string' && snap.endsWith('%')) {
    return (Number.parseFloat(snap) / 100) * SCREEN_HEIGHT;
  }
  return SCREEN_HEIGHT * 0.5;
}

function createSheetPanResponder({
  translateY,
  backdropOpacity,
  setModalVisible,
  onCloseRef,
  dismissibleRef,
}: {
  translateY: Animated.Value;
  backdropOpacity: Animated.Value;
  setModalVisible: (v: boolean) => void;
  onCloseRef: React.MutableRefObject<() => void>;
  dismissibleRef: React.MutableRefObject<boolean>;
}) {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, { dy }) =>
      dismissibleRef.current && Math.abs(dy) > 8,
    onPanResponderMove: (_, { dy }) => {
      if (dismissibleRef.current && dy > 0) {
        translateY.setValue(dy);
      }
    },
    onPanResponderRelease: (_, { dy, vy }) => {
      if (!dismissibleRef.current) {
        Animated.spring(translateY, {
          toValue: 0,
          damping: 28,
          stiffness: 300,
          useNativeDriver: true,
        }).start();
        return;
      }
      if (dy > 80 || vy > 0.5) {
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setModalVisible(false);
          onCloseRef.current();
        });
      } else {
        Animated.spring(translateY, {
          toValue: 0,
          damping: 28,
          stiffness: 300,
          useNativeDriver: true,
        }).start();
      }
    },
  });
}

export const AppSheet: React.FC<AppSheetProps> = ({
  visible,
  onClose,
  onClosed,
  onHeaderClosePress,
  snapPoints,
  enableDynamicSizing = false,
  title,
  closeLabel = 'Done',
  showHeader = true,
  showHandle = true,
  elevation = 'level3',
  dismissible = true,
  children,
}) => {
  const { elevation: elevationTokens } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { bottom: bottomInset } = useSafeAreaInsets();

  const [modalVisible, setModalVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Stable dismissal handlers read only committed props. Render-phase writes can
  // leak values from a concurrent render that React later discards.
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const onClosedRef = useRef(onClosed);
  useLayoutEffect(() => {
    dismissibleRef.current = dismissible;
    onCloseRef.current = onClose;
    onClosedRef.current = onClosed;
  }, [dismissible, onClose, onClosed]);

  // Guards backdrop-tap dismiss during animate-in.
  // Using a ref (not state) so there are zero re-renders — a state-based
  // pointerEvents flip on the sheet caused the long-press finger-up event
  // to route to the backdrop and close the sheet before any button was tapped.
  //
  // Starts TRUE: when the modal first renders the sheet is still off-screen
  // (translateY=SCREEN_HEIGHT) so there is nothing to guard against.
  // animateIn() sets it to false, then back to true on completion.
  const backdropEnabled = useRef(true);

  // Calculate sheet max height from largest snap point
  const sheetMaxHeight = enableDynamicSizing
    ? SCREEN_HEIGHT * 0.85
    : resolveSnapPoint(snapPoints?.[snapPoints.length - 1] || '50%');

  const levelTokens = elevationTokens[elevation];

  // Animate in — use timing (not spring) so the .start() callback fires at a
  // guaranteed time. A spring only calls its callback when displacement <
  // restDisplacementThreshold (0.001px); from SCREEN_HEIGHT that can take
  // 1–2 s, leaving backdropEnabled=false the whole time and silently eating
  // every tap that lands even slightly outside a button's hit area.
  const animateIn = useCallback(() => {
    backdropEnabled.current = false;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: Platform.OS === 'ios' ? 0.6 : 0.7,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      backdropEnabled.current = true;
    });
  }, [translateY, backdropOpacity]);

  // Animate out then callback
  const animateOut = useCallback(
    (cb?: () => void) => {
      backdropEnabled.current = false;
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => cb?.());
    },
    [translateY, backdropOpacity],
  );

  // Track whether we should animate on next onShow
  const pendingAnimateIn = useRef(false);

  useEffect(() => {
    if (visible) {
      pendingAnimateIn.current = true;
      // Dismiss keyboard first, then open — prevents animation conflict
      const keyboardVisible = Keyboard.isVisible?.() ?? false;
      if (keyboardVisible) {
        Keyboard.dismiss();
        let opened = false;
        const openOnce = () => {
          if (opened) return;
          opened = true;
          setModalVisible(true);
        };
        const sub = Keyboard.addListener('keyboardDidHide', () => {
          sub.remove();
          openOnce();
        });
        // Safety timeout in case the event never fires
        const timeout = setTimeout(() => {
          sub.remove();
          openOnce();
        }, 400);
        return () => {
          clearTimeout(timeout);
          sub.remove();
        };
      }
      setModalVisible(true);
    } else if (modalVisible) {
      animateOut(() => {
        setModalVisible(false);
        onClosedRef.current?.();
      });
    }
  }, [animateOut, modalVisible, visible]);

  // Track keyboard height so the sheet lifts above the keyboard
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Called by Modal when the Dialog is fully rendered and ready for touch
  const handleModalShow = useCallback(() => {
    if (pendingAnimateIn.current) {
      pendingAnimateIn.current = false;
      animateIn();
    }
  }, [animateIn]);

  // User-initiated dismiss (backdrop tap, Done button, swipe).
  // Backdrop taps are gated by backdropEnabled to prevent the long-press
  // finger-up event from closing the sheet before any action can be taken.
  const dismiss = useCallback(() => {
    if (!dismissibleRef.current) return;
    animateOut(() => {
      setModalVisible(false);
      onCloseRef.current();
      onClosedRef.current?.();
    });
  }, [animateOut]);

  const handleBackdropPress = useCallback(() => {
    if (dismissibleRef.current && backdropEnabled.current) {
      dismiss();
    }
  }, [dismiss]);

  // Swipe-to-dismiss on handle
  const panResponder = useRef(
    createSheetPanResponder({
      translateY,
      backdropOpacity,
      setModalVisible,
      onCloseRef,
      dismissibleRef,
    }),
  ).current;

  if (!modalVisible && !visible) {
    return null;
  }

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      onRequestClose={dismiss}
      onShow={handleModalShow}
      statusBarTranslucent
      hardwareAccelerated
    >
      <View style={styles.container}>
        {/* Backdrop — gated by backdropEnabled ref so the long-press
            finger-up can't close the sheet during animate-in */}
        <TouchableWithoutFeedback onPress={handleBackdropPress}>
          <Animated.View
            style={[styles.backdrop, { opacity: backdropOpacity }]}
          />
        </TouchableWithoutFeedback>

        {/* iOS rounds the keyboard's top corners. Keep the sheet surface behind those corners so
            the modal backdrop cannot show through while the sheet is keyboard-adjusted. */}
        {keyboardHeight > 0 && (
          <View
            testID="app-sheet-keyboard-underlay"
            pointerEvents="none"
            style={[
              styles.keyboardUnderlay,
              {
                height: keyboardHeight,
                backgroundColor: levelTokens.backgroundColor,
              },
            ]}
          />
        )}

        {/* Sheet */}
        <Animated.View
          testID="app-sheet-surface"
          style={[
            styles.sheet,
            {
              ...(enableDynamicSizing
                ? { maxHeight: SCREEN_HEIGHT * 0.85 - keyboardHeight }
                : { height: sheetMaxHeight - keyboardHeight }),
              backgroundColor: levelTokens.backgroundColor,
              borderTopLeftRadius: levelTokens.borderRadius,
              borderTopRightRadius: levelTokens.borderRadius,
              borderTopWidth: levelTokens.borderTopWidth,
              borderColor: levelTokens.borderColor,
              transform: [{ translateY }],
              marginBottom: keyboardHeight,
            },
          ]}
        >
          {/* Handle — swipe target */}
          {showHandle && (
            <View {...panResponder.panHandlers} style={styles.handleContainer}>
              <View
                style={[
                  styles.handle,
                  {
                    width: elevationTokens.handle.width,
                    height: elevationTokens.handle.height,
                    backgroundColor: elevationTokens.handle.backgroundColor,
                    borderRadius: elevationTokens.handle.borderRadius,
                  },
                ]}
              />
            </View>
          )}

          {/* Header */}
          {showHeader && title ? (
            <View style={styles.header}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {title}
              </Text>
              <TouchableOpacity
                testID="app-sheet-close"
                onPress={() => {
                  if (!dismissibleRef.current) return;
                  (onHeaderClosePress || dismiss)();
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.headerClose}>{closeLabel}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Content */}
          {children}

          {/* Bottom safe area spacer — hidden when keyboard is up (keyboard height includes it) */}
          {bottomInset > 0 && keyboardHeight === 0 && (
            <View
              testID="bottom-safe-area-spacer"
              style={{ height: bottomInset }}
            />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
};
