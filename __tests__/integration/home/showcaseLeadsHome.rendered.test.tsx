/**
 * Home's order: "What you can do" (the carousel) always leads Home, and "Your picks" comes right
 * under it (Mac, 2026-11-18). The real App on Home with picks made in onboarding.
 */
import { launchApp, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';

jest.unmock('@react-navigation/native');

let app: AnalyticsApp | null = null;
afterEach(async () => {
  app?.view.unmount();
  app?.endpoint.restore();
  app = null;
  restoreBuildFlavor();
});

it('the carousel leads Home, with your picks right under it', async () => {
  app = await launchApp({
    release: false,
    returningUser: true,
    // What onboarding left on disk: done, with Chat picked.
    beforeApp: () => {
      const storage = require('@react-native-async-storage/async-storage');
      storage.setItem(
        'local-llm-app-storage',
        JSON.stringify({
          state: { hasCompletedOnboarding: true, checklistDismissed: true, onboardingPicks: { groups: ['chat'], parts: ['chat'] } },
          version: 0,
        }),
      );
    },
  });
  const { view } = app;
  await view.findByTestId('home-screen');
  await view.findByTestId('home-picks');
  const order = view.UNSAFE_root
    .findAll(
      node =>
        typeof node.type === 'string' &&
        (node.props.testID === 'feature-showcase' || node.props.testID === 'home-picks'),
    )
    .map(node => node.props.testID);
  expect(order).toEqual(['feature-showcase', 'home-picks']);
});
