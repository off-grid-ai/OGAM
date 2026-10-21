/**
 * An expired Pro credential sends the person to the "Off Grid AI Pro" screen. Its Back button must
 * leave that screen and show the app's home. Before the fix the redirect replaced the whole stack
 * with only the Pro screen, so Back had nothing to pop and the person was trapped on the paywall.
 *
 * Mounted the way App.tsx mounts it: the real AppNavigator inside a NavigationContainer that uses the
 * real appNavigationRef and the real useProExpiryRedirect callback as onReady. Every screen, route and
 * store is real. The expired state is set with the store's own action, which is what the Pro provider
 * calls when it finds a locally expired credential at cold start (the keychain itself is the boundary).
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
// jest.setup stubs navigation; this test needs the real navigator so the stack and Back are real.
jest.unmock('@react-navigation/native');
import { NavigationContainer } from '@react-navigation/native';

// Safe-area infra (jsdom has no native safe-area). Presentation-only shim, not app logic — the same
// shim the other real-AppNavigator render tests use.
jest.mock('react-native-safe-area-context', () => {
  const mockReact = require('react');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaInsetsContext: mockReact.createContext(insets),
    SafeAreaFrameContext: mockReact.createContext({ x: 0, y: 0, width: 390, height: 844 }),
    useSafeAreaInsets: () => insets,
    initialWindowMetrics: { frame: { x: 0, y: 0, width: 390, height: 844 }, insets },
  };
});
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import {
  appNavigationRef,
  useProExpiryRedirect,
} from '../../../src/navigation/useProExpiryRedirect';
import { useAppStore } from '../../../src/stores/appStore';
import { createDeviceInfo, createDownloadedModel } from '../../utils/factories';

/** The same container wiring App.tsx uses, without App's native startup work. */
function AppShell(): React.JSX.Element {
  const applyPendingProRedirect = useProExpiryRedirect();
  return (
    <NavigationContainer ref={appNavigationRef} onReady={applyPendingProRedirect}>
      <AppNavigator />
    </NavigationContainer>
  );
}

describe('expired Pro credential → Pro screen → Back', () => {
  beforeEach(() => {
    const model = createDownloadedModel();
    const app = useAppStore.getState();
    // A returning user who finished onboarding and has a model, so home is the app's start.
    app.setOnboardingComplete(true);
    app.setDeviceInfo(createDeviceInfo());
    app.setDownloadedModels([model]);
    app.setActiveModelId(model.id);
    // Cold start found a credential that has expired: no Pro access, expired flag set.
    useAppStore.setState({
      hasRegisteredPro: false,
      isProActive: false,
      proDeviceAdmission: 'unknown',
    });
    app.setHasExpiredProCredential(true);
  });

  afterEach(() => {
    const app = useAppStore.getState();
    app.setHasExpiredProCredential(false);
    app.setActiveModelId(null);
    app.setDownloadedModels([]);
    app.setOnboardingComplete(false);
  });

  it('leaves the Pro screen and shows home when Back is pressed', async () => {
    const ui = render(<AppShell />);

    // Before: the redirect put the person on the Pro screen.
    await waitFor(() => expect(ui.getByText('Off Grid AI Pro')).toBeTruthy());

    fireEvent.press(ui.getByLabelText('Back'));

    // After: the Pro screen is gone and the app's home is on screen.
    await waitFor(() => expect(ui.queryByText('Off Grid AI Pro')).toBeNull());
    expect(ui.getByTestId('home-screen')).toBeTruthy();
    expect(ui.getByTestId('home-tab')).toBeTruthy();

    ui.unmount();
  });
});
