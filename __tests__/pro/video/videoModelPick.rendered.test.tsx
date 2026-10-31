/**
 * Which video model this phone uses, and how a person picks another.
 *
 * SPEC (OGAM user's view): Home › Video lists the video models on this phone. The one in use shows a
 * check; any other shows an empty circle ("Use this model"). A tap on the row or the circle picks it.
 * (Which one is the default, Turbo first, is the pure rule in engine/phoneVideoPacks.test.ts.)
 *
 * The real App runs, as a phone build with its native video engine. Device boundaries only.
 */
jest.unmock('@react-navigation/native');

import { closeStudioApp, launchStudioApp } from '../../harness/videoStudioApp';

afterEach(() => closeStudioApp(), 90_000);

const LIGHT21 = 'off-grid-ai/Wan2.1-T2V-1.3B-GGUF-Q4';
const TURBO = 'hum-ma/Wan2.2-TI2V-5B-Turbo-GGUF';

function installOnPhone(rtl: typeof import('@testing-library/react-native'), ids: string[], active: string | null) {
  const { CATALOG } = require('@offgrid/models');
  const { useAppStore } = require('../../../src/stores');
  rtl.act(() => {
    useAppStore.setState({
      downloadedVideoModels: ids.map(id => ({ ...CATALOG.find((model: { id: string }) => model.id === id), kind: 'video' })),
      activeVideoModelId: active,
    });
  });
  return useAppStore;
}

it('the model in use shows a check, another an empty circle, and a tap on the row picks it', async () => {
  const app = await launchStudioApp(undefined, { phoneEngine: true });
  const { view, rtl } = app;
  const store = installOnPhone(rtl, [LIGHT21, TURBO], LIGHT21);
  rtl.fireEvent.press(await view.findByTestId('home-tab'));
  rtl.fireEvent.press(await view.findByTestId('model-summary-video-open'));
  expect(await view.findByTestId(`video-model-row-${LIGHT21}-in-use`)).toBeTruthy();
  expect(view.queryByTestId(`video-model-row-${LIGHT21}-select`)).toBeNull();
  expect(view.getByTestId(`video-model-row-${TURBO}-select`).props.accessibilityLabel).toBe('Use this model');
  rtl.fireEvent.press(view.getByTestId(`video-model-row-${TURBO}`));
  expect(store.getState().activeVideoModelId).toBe(TURBO);
}, 60_000);

it('lists the models on this phone first, the one in use on top, with no repeated subtitle', async () => {
  const app = await launchStudioApp(undefined, { phoneEngine: true });
  const { view, rtl } = app;
  installOnPhone(rtl, [LIGHT21, TURBO], TURBO);
  rtl.fireEvent.press(await view.findByTestId('home-tab'));
  rtl.fireEvent.press(await view.findByTestId('model-summary-video-open'));
  await view.findByTestId(`video-model-row-${TURBO}`);
  const rows = view.UNSAFE_root
    .findAll((node: { props: { testID?: unknown } }) => [LIGHT21, TURBO].some(id => node.props.testID === `video-model-row-${id}`))
    .map(node => String(node.props.testID))
    .filter((id: string, index: number, all: string[]) => all.indexOf(id) === index);
  expect(rows).toEqual([`video-model-row-${TURBO}`, `video-model-row-${LIGHT21}`]);
  expect(view.queryByText(/Loads when generation starts/)).toBeNull();
}, 60_000);
