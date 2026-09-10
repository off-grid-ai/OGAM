import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LoadingDots } from '../components/LoadingDots';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SystemBars } from 'react-native-edge-to-edge';
import { AppNavigator } from '../navigation';
import { appNavigationRef } from '../navigation/navigationRef';
import { LockScreen } from '../screens';
import type { ThemeColors } from '../theme';

interface SurfaceTheme {
  colors: ThemeColors;
  isDark: boolean;
}

export function InitializingSurface({ colors, isDark }: SurfaceTheme) {
  return (
    <GestureHandlerRootView
      style={[styles.flex, { backgroundColor: colors.background }]}
    >
      <SafeAreaProvider>
        <View
          style={[
            styles.loadingContainer,
            { backgroundColor: colors.background },
          ]}
          testID="app-loading"
        >
          <SystemBars style={isDark ? 'light' : 'dark'} />
          <LoadingDots size={10} />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

interface LockedSurfaceProps extends SurfaceTheme {
  onUnlock: () => void;
}

export function LockedSurface({
  colors,
  isDark,
  onUnlock,
}: LockedSurfaceProps) {
  return (
    <GestureHandlerRootView
      style={[styles.flex, { backgroundColor: colors.background }]}
      testID="app-locked"
    >
      <SafeAreaProvider>
        <SystemBars style={isDark ? 'light' : 'dark'} />
        <LockScreen onUnlock={onUnlock} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

interface MainSurfaceProps extends SurfaceTheme {
  AppRoot?: React.ComponentType;
}

export function MainSurface({
  AppRoot,
  colors,
  isDark,
}: MainSurfaceProps) {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <SystemBars style={isDark ? 'light' : 'dark'} />
        {AppRoot ? <AppRoot /> : null}
        <NavigationContainer
          ref={appNavigationRef}
          theme={{
            dark: isDark,
            colors: {
              primary: colors.primary,
              background: colors.background,
              card: colors.surface,
              text: colors.text,
              border: colors.border,
              notification: colors.primary,
            },
            fonts: {
              regular: { fontFamily: 'System', fontWeight: '400' },
              medium: { fontFamily: 'System', fontWeight: '500' },
              bold: { fontFamily: 'System', fontWeight: '700' },
              heavy: { fontFamily: 'System', fontWeight: '900' },
            },
          }}
        >
          <AppNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
