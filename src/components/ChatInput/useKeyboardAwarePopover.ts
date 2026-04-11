import { useRef, useEffect, useState, useCallback } from 'react';
import { Keyboard, Dimensions, Platform, StatusBar, TouchableOpacity } from 'react-native';

/**
 * Hook that manages keyboard-aware popover positioning.
 * When the keyboard is visible, dismisses it and waits for `keyboardDidHide`
 * before measuring position to ensure correct coordinates.
 *
 * anchorY → distance from screen bottom to trigger top (popover sits above trigger)
 * anchorX → distance from screen right to trigger right edge (popover right-aligns with trigger)
 */
export function useKeyboardAwarePopover() {
    const [anchor, setAnchor] = useState({ y: 0, x: 0 });
    const [visible, setVisible] = useState(false);
    const triggerRef = useRef<React.ElementRef<typeof TouchableOpacity>>(null);
    const keyboardVisibleRef = useRef(false);
    const isWaitingForKeyboard = useRef(false);
    const pendingSubRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        const showSub = Keyboard.addListener('keyboardDidShow', () => { keyboardVisibleRef.current = true; });
        const hideSub = Keyboard.addListener('keyboardDidHide', () => { keyboardVisibleRef.current = false; });
        return () => {
            showSub.remove();
            hideSub.remove();
            pendingSubRef.current?.();
        };
    }, []);

    const show = useCallback(() => {
        const measureAndShow = () => {
            triggerRef.current?.measureInWindow?.((btnX: number, btnY: number, btnW: number) => {
                const { height: screenH, width: screenW } = Dimensions.get('window');
                // On Android, measureInWindow Y includes the status bar height.
                const statusBarOffset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;
                // bottom: how far the popover bottom sits above the screen bottom (= above the trigger)
                const y = screenH - (btnY ?? 0) - statusBarOffset;
                // right: align popover's right edge with the trigger button's right edge
                const x = screenW - ((btnX ?? 0) + (btnW ?? 0));
                setAnchor({ y, x });
            });
            setVisible(true);
        };

        if (keyboardVisibleRef.current) {
            if (isWaitingForKeyboard.current) return;
            isWaitingForKeyboard.current = true;
            Keyboard.dismiss();

            let cancelled = false;
            const sub = Keyboard.addListener('keyboardDidHide', () => {
                sub.remove();
                isWaitingForKeyboard.current = false;
                if (!cancelled) requestAnimationFrame(measureAndShow);
            });

            pendingSubRef.current = () => { cancelled = true; sub.remove(); };
        } else {
            measureAndShow();
        }
    }, []);

    const hide = useCallback(() => setVisible(false), []);

    return { anchor, visible, triggerRef, show, hide };
}
