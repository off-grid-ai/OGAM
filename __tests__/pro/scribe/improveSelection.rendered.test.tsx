/**
 * Improve on a selection in the app's own composer.
 *
 * SPEC: I select part of what I typed; Improve shows by the field without a menu. Tapping it opens
 * Improve on exactly the selected words and a version starts at once. Replace takes me back to the
 * field with the pick in place of the selection, and the words around it untouched. Leaving Improve
 * without a pick leaves the field as it was. A selection of only spaces offers nothing.
 *
 * The real Scribe bar and Improve screen in a real navigator over the real rewrite service, engines
 * and stores. Device boundaries only: llama.rn, the disk, the RAM sensor.
 */
jest.unmock('@react-navigation/native');

import type React from 'react';
import { installNativeBoundary, GB, requireRTL, type NativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type ScreenModule = typeof import('../../../pro/scribe/ui/ImproveScreen');
type BarModule = typeof import('../../../pro/scribe/ui/ScribeInputBar');

const describePro = proIsPresent() ? describe : describe.skip;

const MODEL_PATH = '/models/small.gguf';
const BEFORE = 'Hi Sam, ';
const SELECTED = 'pls send me the report today';
const AFTER = '. Thanks!';
const VERSION = 'Could you send the report today?';

function installPhone(): NativeBoundary {
  return installNativeBoundary({
    llama: true,
    fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
}

async function loadTextModel(boundary: NativeBoundary): Promise<void> {
  const { llmService } = require('../../../src/services/llm');
  const { hardwareService } = require('../../../src/services/hardware');
  const { useAppStore } = require('../../../src/stores');
  boundary.fs!.seedFile(MODEL_PATH, 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  await llmService.loadModel(MODEL_PATH);
  useAppStore.setState({
    downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: MODEL_PATH })],
    activeModelId: 'llm',
  });
}

/** A composer: its text, a selection, and the Scribe bar above it, with Improve one route away. */
function openComposer(text: string, selection: { start: number; end: number }) {
  const rtl = requireRTL();
  const ReactRuntime = require('react') as typeof React;
  const { Text } = require('react-native');
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { ImproveScreen } = requirePro<ScreenModule>('@offgrid/pro/scribe/ui/ImproveScreen')!;
  const { ScribeInputBar } = requirePro<BarModule>('@offgrid/pro/scribe/ui/ScribeInputBar')!;
  const Stack = createNativeStackNavigator();
  const Composer: React.FC = () => {
    const [value, setValue] = ReactRuntime.useState(text);
    return ReactRuntime.createElement(
      ReactRuntime.Fragment,
      null,
      ReactRuntime.createElement(ScribeInputBar, { text: value, selection, onChangeText: setValue }),
      ReactRuntime.createElement(Text, { testID: 'composer' }, value),
    );
  };
  const view = rtl.render(
    ReactRuntime.createElement(
      NavigationContainer,
      null,
      ReactRuntime.createElement(
        Stack.Navigator,
        { screenOptions: { headerShown: false } },
        ReactRuntime.createElement(Stack.Screen, { name: 'Composer', component: Composer }),
        ReactRuntime.createElement(Stack.Screen, { name: 'ScribeImprove', component: ImproveScreen }),
      ),
    ),
  );
  return { rtl, view };
}

const DRAFT = BEFORE + SELECTED + AFTER;
const SELECTION = { start: BEFORE.length, end: BEFORE.length + SELECTED.length };

describePro('Improve on a selection in the composer', () => {
  it('Replace puts the version in place of the selection and keeps the words around it', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    boundary.llama!.scriptCompletion({ text: VERSION });
    const { rtl, view } = openComposer(DRAFT, SELECTION);

    rtl.fireEvent.press(view.getByTestId('scribe-improve-selection'));
    expect(await view.findByTestId('improve-original')).toHaveTextContent(SELECTED);
    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-0').props.accessibilityState?.busy).toBe(false),
    );
    expect(view.getByTestId('improve-apply')).toHaveTextContent('Replace');
    rtl.fireEvent.press(view.getByTestId('improve-apply'));

    expect(await view.findByTestId('composer')).toHaveTextContent(BEFORE + VERSION + AFTER);
    expect(view.queryByTestId('improve-original')).toBeNull();
  });

  it('going back without a pick leaves the field as it was', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    boundary.llama!.scriptCompletion({ text: VERSION });
    const { rtl, view } = openComposer(DRAFT, SELECTION);

    rtl.fireEvent.press(view.getByTestId('scribe-improve-selection'));
    await view.findByTestId('improve-original');
    rtl.fireEvent.press(view.getByLabelText('Back'));

    expect(await view.findByTestId('composer')).toHaveTextContent(DRAFT);
  });

  it('a selection of only spaces offers nothing', () => {
    installPhone();
    const { view } = openComposer('Hi   there', { start: 2, end: 5 });
    expect(view.queryByTestId('scribe-improve-selection')).toBeNull();
  });
});
