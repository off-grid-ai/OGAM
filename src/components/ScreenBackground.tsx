import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useAppStore } from '../stores/appStore';

interface Props { screenKey: string; children?: React.ReactNode; style?: object }

/**
 * Container that renders a per-screen background image behind its children.
 * When no background is configured it falls back to the provided style/colors normally.
 * Use `useHasScreenBg(screenKey)` to decide whether to set backgroundColor to transparent.
 */
export const ScreenBackground: React.FC<Props> = ({ screenKey, children, style }) => {
  const bg = useAppStore((s) => s.settings.screenBackgrounds?.[screenKey]);
  if (!bg?.uri) {
    return <View style={[{ flex: 1 }, style]}>{children}</View>;
  }
  return (
    <View style={[{ flex: 1 }, style]}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: bg.opacity ?? 1 }]}>
        <Image source={{ uri: bg.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={bg.blur ?? 0} />
        {(bg.dim ?? 0) > 0 && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${bg.dim})` }]} />
        )}
      </View>
      {children}
    </View>
  );
};

/** Returns true when a per-screen background is configured for this key — use to set SafeAreaView to transparent. */
export const useHasScreenBg = (screenKey: string): boolean =>
  useAppStore((s) => !!s.settings.screenBackgrounds?.[screenKey]?.uri);
