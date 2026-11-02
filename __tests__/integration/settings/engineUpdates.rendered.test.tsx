/**
 * Settings → Engine updates, on the real App over the native boundary.
 *
 * Android: a switch, on by default, lets the person stop Off Grid AI downloading newer engines. The
 * screen names the engine running now and where it came from, and Check now looks at once. iOS cannot
 * load downloaded native code: the same screen says engines update with the app and shows no switch.
 * Faked only at the device boundary: the native engine-pack store, llama.rn and the network.
 */
import { NativeModules } from 'react-native';
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });

const BUILD = 12032;
const VERSION = '0.13.0-b12032.1';

function nativeEngineStore(pack: string | null) {
  return {
    getStatus: jest.fn(async () => ({
      bootPackId: pack, trial: false, llamaBuild: pack ? BUILD : null, engineVersion: pack, bundledVersion: VERSION,
      source: pack ? 'pack' : 'bundled', error: null, reactNative: '0.83.1', bridge: 'bridge-1', abis: ['arm64-v8a'], state: '{}',
    })),
    install: jest.fn(), accept: jest.fn(), keepOnTrial: jest.fn(), reject: jest.fn(), relaunch: jest.fn(),
  };
}

async function openEngineUpdates(
  platform: 'android' | 'ios',
  { pack = null, reportsBuild = true, saved = {} }: { pack?: string | null; reportsBuild?: boolean; saved?: Record<string, unknown> } = {},
) {
  const boundary = installNativeBoundary({ llama: true, ram: { platform, totalBytes: 8 * GB, availBytes: 6 * GB } });
  if (reportsBuild) (boundary.llama!.module as Record<string, unknown>).BuildInfo = { number: String(BUILD), commit: 'abc1234' };
  const store = nativeEngineStore(pack);
  if (platform === 'android') NativeModules.EnginePack = store;
  const fetched: string[] = [];
  // The manifest host is down: every check the app makes fails without installing anything.
  global.fetch = jest.fn(async (url: string) => {
    if (url.includes('mobile-runtime.getoffgridai.co')) fetched.push(url); // the engine-pack manifest
    return { ok: false, status: 503, text: async () => '' };
  }) as unknown as typeof fetch;

  const React = require('react');
  const rtl = requireRTL();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  await AsyncStorage.setItem('local-llm-app-storage', JSON.stringify({ state: { hasCompletedOnboarding: true, settings: saved }, version: 0 }));
  const App = require('../../../App').default;
  const view = rtl.render(React.createElement(App));
  await rtl.waitFor(() => expect(view.queryByTestId('app-loading')).toBeNull(), {
    timeout: process.env.CI === 'true' ? 45_000 : 10_000,
  });
  await rtl.waitFor(() => expect(view.getByTestId('auto-setup-skip')).toBeTruthy());
  rtl.fireEvent.press(view.getByTestId('auto-setup-skip'));
  await rtl.waitFor(() => expect(view.getByTestId('settings-tab')).toBeTruthy());
  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  await rtl.waitFor(() => expect(view.getByTestId('open-engine-updates')).toBeTruthy());
  rtl.fireEvent.press(view.getByTestId('open-engine-updates'));
  await rtl.waitFor(() => expect(view.getByTestId('engine-running')).toBeTruthy());
  return { view, rtl, fetched };
}

afterEach(() => {
  delete NativeModules.EnginePack;
});

it('Android: updates are on by default; off stops downloads and says so; Check now reports what it found', async () => {
  const { view, rtl, fetched } = await openEngineUpdates('android');
  const { useAppStore } = require('../../../src/stores');

  expect(view.getByTestId('engine-running').props.children).toBe(`llama.cpp b${BUILD} · v${VERSION}`);
  expect(view.getByTestId('engine-source').props.children).toMatch(/Built into this version/);
  expect(view.getByTestId('engine-updates-switch')).toBeTruthy();
  expect(useAppStore.getState().settings.engineUpdates).toBe(true);
  expect(view.queryByTestId('engine-updates-off')).toBeNull();
  expect(view.queryByTestId('engine-updates-with-app')).toBeNull();

  rtl.fireEvent(view.getByTestId('engine-updates-switch'), 'valueChange', false);
  await rtl.waitFor(() => expect(view.getByTestId('engine-updates-off')).toBeTruthy());
  expect(useAppStore.getState().settings.engineUpdates).toBe(false);

  const before = fetched.length;
  rtl.fireEvent.press(view.getByTestId('engine-check-now'));
  expect(fetched).toHaveLength(before); // off: the check does not run

  rtl.fireEvent(view.getByTestId('engine-updates-switch'), 'valueChange', true);
  await rtl.waitFor(() => expect(view.queryByTestId('engine-updates-off')).toBeNull());
  rtl.fireEvent.press(view.getByTestId('engine-check-now'));
  await rtl.waitFor(() => expect(view.getByTestId('engine-check-result').props.children).toMatch(/Could not check right now/));
  expect(fetched.length).toBeGreaterThan(before);
  expect(view.getByTestId('engine-last-check').props.children).toMatch(/^Last checked /);
});

it('iOS: the engine updates with the app, with no switch and no Check now', async () => {
  const { view, rtl } = await openEngineUpdates('ios');
  expect(view.getByTestId('engine-running').props.children).toBe(`llama.cpp b${BUILD}`);
  expect(view.getByTestId('engine-updates-with-app')).toBeTruthy();
  expect(view.queryByTestId('engine-updates-switch')).toBeNull();
  expect(view.queryByTestId('engine-check-now')).toBeNull();

  // Back returns to Settings, where the screen was opened.
  rtl.fireEvent.press(view.getByLabelText('Back'));
  await rtl.waitFor(() => expect(view.queryByTestId('engine-running')).toBeNull());
  expect(view.getByTestId('open-engine-updates')).toBeTruthy();
});

it('Android, updates already off: the engine update in use stays, and nothing has been checked', async () => {
  const { view, fetched } = await openEngineUpdates('android', {
    pack: '0.13.0-b12032.2', saved: { engineUpdates: false },
  });
  expect(view.getByTestId('engine-running').props.children).toBe(`llama.cpp b${BUILD} · v0.13.0-b12032.2`);
  expect(view.getByTestId('engine-source').props.children).toMatch(/installed without an app update/);
  expect(view.getByTestId('engine-updates-off').props.children).toMatch(/already have stays in use/);
  expect(view.getByTestId('engine-last-check').props.children).toBe('Not checked yet');
  expect(fetched).toEqual([]);
});

it('iOS: an engine that reports no build is still named', async () => {
  const { view } = await openEngineUpdates('ios', { reportsBuild: false });
  expect(view.getByTestId('engine-running').props.children).toBe('llama.cpp');
});
