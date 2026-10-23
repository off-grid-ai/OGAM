/**
 * Auto Setup never offers the same chat model in two plans; a phone without room for a bigger model
 * sees fewer plans (v0.0.116-beta.1, commit d39d58b43).
 *
 * Product-correct outcome (the person's view): on first launch with no model on the phone, Auto Setup
 * lists its plans (Lean / Balanced / Extreme). Each plan the person opens names a different chat model
 * under "TEXT + VISION". When the phone has no room for a bigger chat model, the plan that would only
 * repeat a smaller plan's model is not shown at all, so a small phone sees fewer plans than a big one.
 *
 * Entry point: the REAL AppNavigator inside a REAL NavigationContainer. Onboarding is done and no model
 * is on the phone, so the first screen is Auto Setup with its production session (no sessionFactory).
 * Gestures: tap each plan card the screen shows and read the chat model it expands to.
 *
 * Fakes (device boundary only): the RAM sensor (installNativeBoundary's DeviceMemoryModule +
 * react-native-device-info) and the Hugging Face HTTP API (fetch). The fetch fake answers by path and
 * sizes each GGUF from the parameter count in the repo name (0.6 GB per billion, plus a 0.8 GB F16
 * projector), the same shape as the unit test in __tests__/services/autoSetupCatalog.test.ts. It
 * decides nothing about plans. Everything we own (the catalog, the device-fit budget, the plan
 * selector, the session, the screen) runs for real.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });

const RENDER_WAIT = { timeout: 8000 };
const TIERS = ['lean', 'balanced', 'extreme'] as const;

const parameterCount = (repoId: string): number => {
  const match = repoId.split('/').pop()!.match(/(\d+(?:\.\d+)?)B(?![a-z])/i);
  return match ? Number(match[1]) : 1;
};

/** Hugging Face as the phone sees it: every chat repo has one Q4_K_M weight and an F16 projector;
 *  every Core ML image repo has one compiled split_einsum zip. */
function installHuggingFace(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => body }) as Response;
    if (url.hostname !== 'huggingface.co') return json({}, 404);
    const tree = url.pathname.match(/^\/api\/models\/(.+)\/tree\/main$/);
    if (tree) {
      const size = 1.2 * GB;
      return json([
        {
          type: 'file',
          path: 'coreml-split_einsum-compiled.zip',
          size,
          lfs: { oid: 'x', size, pointerSize: 1 },
        },
      ]);
    }
    if (url.pathname.startsWith('/api/models/') && url.searchParams.get('blobs') === 'true') {
      const id = decodeURIComponent(url.pathname.slice('/api/models/'.length));
      const params = parameterCount(id);
      const weight = `${id.split('/').pop()}-Q4_K_M.gguf`;
      const weightSize = Math.round(params * 0.6 * GB);
      const projectorSize = Math.round(0.8 * GB);
      return json({
        id,
        siblings: [
          { rfilename: weight, size: weightSize, lfs: { size: weightSize } },
          { rfilename: 'mmproj-F16.gguf', size: projectorSize, lfs: { size: projectorSize } },
        ],
      });
    }
    return json({}, 404);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

/** Open Auto Setup on a phone with `totalGB` of RAM and read, plan by plan, the chat model each
 *  visible plan names. Returns the plan titles the person sees, in order, with their chat model. */
async function plansSeenOnPhone(totalGB: number) {
  installNativeBoundary({
    fs: true,
    ram: { platform: 'ios', totalBytes: totalGB * GB, availBytes: totalGB * 0.5 * GB },
  });
  const restoreFetch = installHuggingFace();
  const React = require('react');
  const { render, fireEvent, waitFor, within } = requireRTL();
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  // What the phone holds at launch: onboarding slides done, no model downloaded. Storage the app
  // reads at boot, not the state under test.
  await AsyncStorage.setItem(
    'local-llm-app-storage',
    JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
  );

  const App = require('../../../App').default;
  const ui = render(React.createElement(App));
  try {
    // Before: the app is still opening, so no plan is offered yet.
    expect(ui.getByTestId('app-loading')).toBeTruthy();
    expect(ui.queryByTestId('auto-setup-plan-lean')).toBeNull();

    await waitFor(() => expect(ui.getByTestId('auto-setup-plan-lean')).toBeTruthy(), RENDER_WAIT);
    const seen: { tier: string; chatModel: string }[] = [];
    for (const tier of TIERS) {
      const card = ui.queryByTestId(`auto-setup-plan-${tier}`);
      if (!card) continue;
      fireEvent.press(card);
      const expanded = within(ui.getByTestId(`auto-setup-plan-${tier}`)).getByTestId(
        'auto-setup-selected-plan',
      );
      // The chat model is the name printed under the "TEXT + VISION" label.
      const labels = within(expanded).getAllByText(/.+/).map(node => {
        const children = (node.props as { children?: unknown }).children;
        return typeof children === 'string' ? children : null;
      });
      const at = labels.indexOf('TEXT + VISION');
      expect(at).toBeGreaterThanOrEqual(0);
      seen.push({ tier, chatModel: labels[at + 1] as string });
    }
    return seen;
  } finally {
    ui.unmount();
    restoreFetch();
  }
}

const chatModels = (plans: { chatModel: string }[]) => plans.map(plan => plan.chatModel);

describe('Auto Setup plans by phone memory', () => {
  it('a 16 GB phone sees Lean, Balanced and Extreme, each with its own chat model', async () => {
    const plans = await plansSeenOnPhone(16);
    expect(plans.map(plan => plan.tier)).toEqual(['lean', 'balanced', 'extreme']);
    expect(new Set(chatModels(plans)).size).toBe(3);
  });

  // A 12 GB iPhone maps its weights, so the 9B with its projector loads there (measured on an iPhone
  // 17 Pro Max): Extreme offers it, and no plan repeats another's chat model.
  it('a 12 GB iPhone sees three plans, Extreme with the 9B, never the same chat model twice', async () => {
    const plans = await plansSeenOnPhone(12);
    expect(plans.map(plan => plan.tier)).toEqual(['lean', 'balanced', 'extreme']);
    expect(chatModels(plans)).toEqual(['Qwen 3.5 2B', 'Qwen 3.5 4B', 'Qwen 3.5 9B']);
  });

  it('a 6 GB phone sees fewer plans than a 16 GB phone, and no chat model twice', async () => {
    const big = await plansSeenOnPhone(16);
    const small = await plansSeenOnPhone(6);
    expect(small.length).toBeGreaterThanOrEqual(1);
    expect(small.length).toBeLessThan(big.length);
    expect(new Set(chatModels(small)).size).toBe(small.length);
    // The chat models the small phone sees are the smaller ones the big phone also offers.
    expect(chatModels(small).every(name => chatModels(big).includes(name))).toBe(true);
  });
});
