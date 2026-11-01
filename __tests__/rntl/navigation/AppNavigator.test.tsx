/**
 * AppNavigator — the app's root stack and its five-tab bar.
 *
 * The real navigator runs inside a real NavigationContainer with the real screens, stores and
 * services. Only the device is faked: the RAM sensor and native modules (nativeBoundary), and the
 * system bars' insets, which the OS hands the app through the safe-area provider's metrics.
 */
jest.unmock('@react-navigation/native');

import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

type Rtl = ReturnType<typeof requireRTL>;

interface Mounted {
  rtl: Rtl;
  view: ReturnType<Rtl['render']>;
  route(): string | undefined;
}

/**
 * Mount the app's navigator on a phone whose system bar takes `bottomInset` points.
 * `onboarded` and `withModel` are reached through the app store's own actions.
 */
function mountNavigator(opts: { bottomInset?: number; onboarded?: boolean; withModel?: boolean } = {}): Mounted {
  installNativeBoundary({ ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 4 * GB } });
  const React = require('react');
  const rtl = requireRTL();
  const nav = require('@react-navigation/native');
  const { SafeAreaProvider } = require('react-native-safe-area-context');
  const { useAppStore } = require('../../../src/stores/appStore');
  const { createDownloadedModel } = require('../../utils/factories');
  const { AppNavigator } = require('../../../src/navigation/AppNavigator');

  const store = useAppStore.getState();
  if (opts.onboarded ?? true) store.setOnboardingComplete(true);
  if (opts.withModel ?? true) store.addDownloadedModel(createDownloadedModel());

  const ref = nav.createNavigationContainerRef();
  const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 0, left: 0, right: 0, bottom: opts.bottomInset ?? 0 },
  };
  const view = rtl.render(
    React.createElement(
      SafeAreaProvider,
      { initialMetrics: metrics },
      React.createElement(nav.NavigationContainer, { ref }, React.createElement(AppNavigator)),
    ),
  );
  return { rtl, view, route: () => ref.getCurrentRoute()?.name };
}

/** The tab bar's own style: the nearest ancestor of the Home tab button that sets a bottom padding. */
function tabBarStyle(view: Mounted['view']): { height?: number; paddingBottom?: number } {
  const { StyleSheet } = require('react-native');
  let node = view.getByTestId('home-tab').parent;
  while (node) {
    const style = StyleSheet.flatten(node.props?.style) ?? {};
    if (style.paddingBottom !== undefined && style.height !== undefined) return style;
    node = node.parent;
  }
  throw new Error('No tab bar style found above the Home tab');
}

const TABS = [
  ['Home', 'home-tab', 'HomeTab'],
  ['Chats', 'chats-tab', 'ChatsTab'],
  ['Projects', 'projects-tab', 'ProjectsTab'],
  ['Models', 'models-tab', 'ModelsTab'],
  ['Settings', 'settings-tab', 'SettingsTab'],
] as const;

describe('AppNavigator', () => {
  describe('where the app opens', () => {
    it('opens onboarding for a person who has not finished it', async () => {
      const { rtl, route } = mountNavigator({ onboarded: false, withModel: false });
      await rtl.waitFor(() => expect(route()).toBe('Onboarding'));
    });

    it('opens model setup for an onboarded person with no model yet', async () => {
      const { rtl, route } = mountNavigator({ onboarded: true, withModel: false });
      await rtl.waitFor(() => expect(route()).toBe('AutoSetup'));
    });

    it('opens the Home tab for an onboarded person with a model', async () => {
      const { rtl, route } = mountNavigator();
      await rtl.waitFor(() => expect(route()).toBe('HomeTab'));
    });
  });

  describe('tab bar', () => {
    it('shows all five tabs, and each one opens its screen', async () => {
      const { rtl, view, route } = mountNavigator();
      await rtl.waitFor(() => expect(route()).toBe('HomeTab'));

      for (const [label, testID] of TABS) {
        expect(view.getByTestId(testID)).toBeTruthy();
        expect(view.getAllByText(label).length).toBeGreaterThanOrEqual(1);
      }
      for (const [, testID, routeName] of [...TABS.slice(1), TABS[0]]) {
        rtl.fireEvent.press(view.getByTestId(testID));
        await rtl.waitFor(() => expect(route()).toBe(routeName));
      }
    });

    it.each([
      // Gesture navigation reports no inset: the bar keeps a minimum 20pt bottom padding.
      ['gesture navigation', 0, 20, 80],
      // An iPhone home indicator.
      ['an iPhone home indicator', 34, 34, 94],
      // Android 3-button navigation: the bar must clear the system buttons, not sit under them.
      ['Android 3-button navigation', 48, 48, 108],
    ])('sits above the system bar with %s', async (_name, bottomInset, padding, height) => {
      const { rtl, view, route } = mountNavigator({ bottomInset });
      await rtl.waitFor(() => expect(route()).toBe('HomeTab'));

      const style = tabBarStyle(view);
      expect(style.paddingBottom).toBe(padding);
      expect(style.height).toBe(height);
      for (const [, testID] of TABS) expect(view.getByTestId(testID)).toBeTruthy();
    });
  });
});
