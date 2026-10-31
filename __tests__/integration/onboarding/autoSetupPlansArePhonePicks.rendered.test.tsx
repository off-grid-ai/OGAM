/**
 * Auto Setup's Lean, Balanced and Extreme plans take this phone's Fast, Balanced and Best chat picks
 * (commit 37759c684).
 *
 * Product-correct outcome (the person's view): on first launch Auto Setup offers Lean, Balanced and
 * Extreme. The chat model each plan names is the one the Models screen shows for this phone as Fast,
 * Balanced and Best respectively, so a person never meets two different "right" models for one phone.
 *
 * Entry point: the REAL App (onboarding done, no model on the phone, so Auto Setup opens with its
 * production session), then the REAL ModelsScreen on the same device. Gestures: tap each plan heading
 * and read the chat model it expands to; read the three pick cards on Models.
 *
 * Fakes (device boundary only): the RAM sensor (installNativeBoundary) and the Hugging Face HTTP API
 * (fetch) that image candidates are sized from. Everything we own runs for real.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });

const RENDER_WAIT = { timeout: 8000 };
const PLAN_TO_PICK = { lean: 'fast', balanced: 'balanced', extreme: 'best' } as const;

/** Hugging Face as the phone sees it: every Core ML image repo has one compiled zip; anything else
 *  is empty. */
function installHuggingFace(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => body }) as Response;
    if (url.hostname !== 'huggingface.co') return json({}, 404);
    if (/^\/api\/models\/.+\/tree\/main$/.test(url.pathname)) {
      const size = 1.2 * GB;
      return json([{ type: 'file', path: 'coreml-split_einsum-compiled.zip', size, lfs: { oid: 'x', size, pointerSize: 1 } }]);
    }
    return json([]);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

/** The strings a rendered subtree shows, in order. */
function texts(scope: { getAllByText: (m: RegExp) => Array<{ props: { children?: unknown } }> }): string[] {
  return scope
    .getAllByText(/.+/)
    .map(text => text.props.children)
    .filter((child): child is string => typeof child === 'string');
}

describe('Auto Setup plans are the phone picks', () => {
  it.each([
    ['android', 12],
    ['ios', 8],
  ] as const)('on a %s phone with %i GB, Lean, Balanced and Extreme name Fast, Balanced and Best', async (platform, totalGB) => {
    installNativeBoundary({ fs: true, ram: { platform, totalBytes: totalGB * GB, availBytes: totalGB * 0.5 * GB } });
    const restoreFetch = installHuggingFace();
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    try {
      await AsyncStorage.clear();
      await AsyncStorage.setItem(
        'local-llm-app-storage',
        JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
      );

      // Auto Setup, as the person meets it at launch.
      const App = require('../../../App').default;
      const app = render(React.createElement(App));
      expect(app.queryByTestId('auto-setup-plan-lean')).toBeNull();
      await waitFor(() => expect(app.getByTestId('auto-setup-plan-lean')).toBeTruthy(), RENDER_WAIT);
      const planModels: Partial<Record<keyof typeof PLAN_TO_PICK, string>> = {};
      for (const tier of Object.keys(PLAN_TO_PICK) as Array<keyof typeof PLAN_TO_PICK>) {
        const card = app.queryByTestId(`auto-setup-plan-${tier}`);
        if (!card) continue;
        if (!within(card).queryByTestId('auto-setup-selected-plan')) {
          fireEvent.press(within(card).getByTestId(`auto-setup-plan-heading-${tier}`));
        }
        const expanded = within(app.getByTestId(`auto-setup-plan-${tier}`)).getByTestId('auto-setup-selected-plan');
        const labels = texts(within(expanded));
        const at = labels.indexOf('TEXT');
        expect(at).toBeGreaterThan(0);
        planModels[tier] = labels[at - 1];
      }
      app.unmount();

      // The Models screen's picks for the same phone.
      const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
      const { NavigationContainer } = require('@react-navigation/native');
      const { createNativeStackNavigator } = require('@react-navigation/native-stack');
      const Stack = createNativeStackNavigator();
      const models = render(
        React.createElement(
          NavigationContainer,
          null,
          React.createElement(
            Stack.Navigator,
            { screenOptions: { headerShown: false, animation: 'none' } },
            React.createElement(Stack.Screen, { name: 'Models', component: ModelsScreen }),
          ),
        ),
      );
      await waitFor(() => expect(models.getByTestId('device-picks')).toBeTruthy(), RENDER_WAIT);
      const pickModels: Record<string, string | undefined> = {};
      for (const slot of Object.values(PLAN_TO_PICK)) {
        const card = models.queryByTestId(`pick-${slot}`);
        // A pick card shows its slot label, then the model name.
        pickModels[slot] = card ? texts(within(card))[1] : undefined;
      }
      models.unmount();

      // Every plan shown names its pick, and every pick has its plan.
      const shownPlans = Object.keys(planModels) as Array<keyof typeof PLAN_TO_PICK>;
      expect(shownPlans.length).toBeGreaterThan(0);
      for (const tier of shownPlans) expect(planModels[tier]).toBe(pickModels[PLAN_TO_PICK[tier]]);
      for (const [tier, slot] of Object.entries(PLAN_TO_PICK)) {
        if (pickModels[slot]) expect(planModels[tier as keyof typeof PLAN_TO_PICK]).toBe(pickModels[slot]);
      }
      expect(new Set(Object.values(planModels)).size).toBe(shownPlans.length);
    } finally {
      restoreFetch();
    }
  }, 30000);
});
