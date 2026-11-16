/**
 * The rating ask and the GitHub star report what happened to PostHog, through the real sheet, the
 * real Settings rows and the real SDK. Faked, because they are the phone: PostHog at `fetch`,
 * device-info, the store review dialog and Linking. See docs/ANALYTICS.md.
 */
import React from 'react';
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { installPostHogEndpoint, type PostHogEndpoint } from '../../harness/postHogEndpoint';
import { restoreBuildFlavor } from '../../harness/analyticsApp';

let stop: (() => void) | undefined;
let endpoint: PostHogEndpoint | undefined;

afterEach(async () => {
  stop?.();
  await new Promise(resolve => setTimeout(resolve, 50));
  endpoint?.restore();
  stop = undefined;
  endpoint = undefined;
  restoreBuildFlavor();
});

async function setup() {
  (global as unknown as { __DEV__: boolean }).__DEV__ = false;
  const boundary = installNativeBoundary({
    fs: true,
    ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 4 * GB },
  });
  endpoint = installPostHogEndpoint();
  await require('../../../src/stores/appStore').useAppStore.persist.rehydrate();
  const analytics = require('../../../src/services/analytics/analytics');
  const { featureSnapshot } = require('../../../src/services/analytics/featureSnapshot');
  stop = analytics.startAnalytics(featureSnapshot);
  await analytics.setAnalyticsConsent({ usage: true }, 'settings');
  const { Linking } = require('react-native');
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  const flush = async () => {
    boundary.emitAppStateChange('background');
    await new Promise(resolve => setTimeout(resolve, 30));
  };
  return { endpoint, flush, rtl: requireRTL() };
}

function sheetHost(trigger: 'text' | 'image') {
  const { SharePromptSheet } = require('../../../src/components/SharePromptSheet');
  // The React the post-reset module graph renders with (installNativeBoundary resets modules).
  const { useState } = require('react') as typeof React;
  return function Host() {
    const [visible, setVisible] = useState(true);
    return <SharePromptSheet visible={visible} trigger={trigger} onClose={() => setVisible(false)} />;
  };
}

it('reports shown, then rate tapped with the route the dialog took', async () => {
  const { endpoint: ep, flush, rtl } = await setup();
  const Host = sheetHost('image');
  const view = rtl.render(<Host />);
  rtl.fireEvent.press(view.getByText('Rate Off Grid AI'));
  await rtl.waitFor(() => expect(require('react-native-in-app-review').default.RequestInAppReview).toHaveBeenCalled());
  await flush();
  await rtl.waitFor(() => expect(ep.named('rating_prompt_rate_tapped')).toHaveLength(1));
  expect(ep.named('rating_prompt_shown')[0].properties).toMatchObject({ trigger: 'image', platform: 'ios' });
  expect(ep.named('rating_prompt_rate_tapped')[0].properties).toMatchObject({ trigger: 'image', route: 'native', platform: 'ios' });
  expect(ep.named('rating_prompt_dismissed')).toEqual([]);
});

it("reports a dismissal with the choice: Don't ask again", async () => {
  const { endpoint: ep, flush, rtl } = await setup();
  const Host = sheetHost('text');
  const view = rtl.render(<Host />);
  rtl.fireEvent.press(view.getByText("Don't ask again"));
  await flush();
  await rtl.waitFor(() => expect(ep.named('rating_prompt_dismissed')).toHaveLength(1));
  expect(ep.named('rating_prompt_dismissed')[0].properties).toMatchObject({ trigger: 'text', choice: 'never' });
  expect(ep.named('rating_prompt_rate_tapped')).toEqual([]);
});

it('reports the GitHub star from Settings, and it leaves the rating ask untouched', async () => {
  const { endpoint: ep, flush, rtl } = await setup();
  const { SettingsCommunitySections } = require('../../../src/screens/SettingsCommunitySections');
  const { createStyles } = require('../../../src/screens/SettingsScreen.styles');
  const { useTheme, useThemedStyles } = require('../../../src/theme');
  function Rows() {
    const { colors } = useTheme();
    const styles = useThemedStyles(createStyles);
    return <SettingsCommunitySections focusTrigger={0} styles={styles} colors={colors} onSendFeedback={() => {}} />;
  }
  const view = rtl.render(<Rows />);
  rtl.fireEvent.press(view.getByText('Star on GitHub'));
  await flush();
  await rtl.waitFor(() => expect(ep.named('github_star_tapped')).toHaveLength(1));
  expect(ep.named('github_star_tapped')[0].properties).toMatchObject({ source: 'settings' });
  expect(require('../../../src/stores/appStore').useAppStore.getState().hasEngagedSharePrompt).toBe(false);
});
