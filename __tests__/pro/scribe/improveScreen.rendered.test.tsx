/**
 * The Improve screen, as the person meets it from another app's selection.
 *
 * SPEC: with no text model, Improve says rewrites need one; when I come back with a model picked,
 * the versions fill in without another tap. A model that only thinks shows no reasoning; the
 * screen says it spent its answer thinking and offers another model on the phone, and using that
 * model fills in the versions. A model too big for free memory is never loaded; the screen says so
 * and offers a smaller model. With the phone's model, three versions
 * fill in; I pick one and Copy puts exactly that text on the clipboard and says it was copied. When
 * the Android selection menu opened Improve (a native entry injected how to give text back), Replace
 * hands exactly the picked text back to the app it came from.
 *
 * The real screen in a real navigator over the real rewrite service, engines and stores. Device
 * boundaries only: llama.rn, the disk, the RAM sensor, the OS clipboard, and the native Improve
 * entry's finisher (the seam core's PROCESS_TEXT activity injects).
 */
jest.unmock('@react-navigation/native');

import type React from 'react';
import { installNativeBoundary, GB, requireRTL, type NativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type ScreenModule = typeof import('../../../pro/scribe/ui/ImproveScreen');
type EntryModule = typeof import('../../../pro/scribe/scribeEntry');

const describePro = proIsPresent() ? describe : describe.skip;

const MODEL_PATH = '/models/small.gguf';
const DRAFT = 'Please send me the report today.';
const VERSIONS = 'Could you send the report today?\n---\nPlease send the report today.\n---\nSend me the report today, please.';

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

/** Improve opened on `params`, inside a real stack navigator with one other screen to visit. */
function openImprove(params: { text: string; apply: 'copy' | 'replace' }) {
  const rtl = requireRTL();
  const ReactRuntime = require('react') as typeof React;
  const { NavigationContainer, createNavigationContainerRef } = require('@react-navigation/native');
  const navigation = createNavigationContainerRef();
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { ImproveScreen } = requirePro<ScreenModule>('@offgrid/pro/scribe/ui/ImproveScreen')!;
  const Stack = createNativeStackNavigator();
  const view = rtl.render(
    ReactRuntime.createElement(
      NavigationContainer,
      { ref: navigation },
      ReactRuntime.createElement(
        Stack.Navigator,
        { screenOptions: { headerShown: false } },
        ReactRuntime.createElement(Stack.Screen, {
          name: 'ScribeImprove',
          component: ImproveScreen,
          initialParams: params,
        }),
        ReactRuntime.createElement(Stack.Screen, { name: 'Elsewhere', component: () => null }),
      ),
    ),
  );
  return { rtl, view, navigation };
}

describePro('Improve screen', () => {
  it('with no text model, says rewrites need one', async () => {
    installPhone();
    const { useAppStore } = require('../../../src/stores');
    useAppStore.setState({ downloadedModels: [], activeModelId: null });

    const { view } = openImprove({ text: DRAFT, apply: 'copy' });

    expect(await view.findByTestId('improve-no-model')).toBeTruthy();
    expect(view.queryByTestId('improve-copied')).toBeNull();
  });

  it('coming back with a model picked fills in the versions', async () => {
    const boundary = installPhone();
    const { useAppStore } = require('../../../src/stores');
    useAppStore.setState({ downloadedModels: [], activeModelId: null });

    const { rtl, view, navigation } = openImprove({ text: DRAFT, apply: 'copy' });
    expect(await view.findByTestId('improve-no-model')).toBeTruthy();

    rtl.act(() => navigation.navigate('Elsewhere'));
    await loadTextModel(boundary);
    boundary.llama!.scriptCompletion({ text: VERSIONS });
    rtl.act(() => navigation.goBack());

    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-0').props.accessibilityState?.busy).toBe(false),
    );
    expect(view.queryByTestId('improve-no-model')).toBeNull();
    expect(view.getByTestId('improve-option-0')).toHaveTextContent('Could you send the report today?');
  });

  it('a model that only thinks says so, and using another model on the phone fills in the versions', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    const { useAppStore } = require('../../../src/stores');
    boundary.fs!.seedFile('/models/q.gguf', 300 * 1024 * 1024);
    useAppStore.setState({
      downloadedModels: [
        createDownloadedModel({ id: 'llm', name: 'Thinker 8B', engine: 'llama', filePath: MODEL_PATH }),
        createDownloadedModel({ id: 'small', name: 'Qwen 3.5 0.8B', engine: 'llama', filePath: '/models/q.gguf' }),
      ],
    });
    boundary.llama!.scriptCompletions([
      { text: `<think>${'I weigh one more word. '.repeat(800)}`, charsPerToken: 4 },
      { text: VERSIONS },
    ]);

    const { rtl, view } = openImprove({ text: DRAFT, apply: 'copy' });

    expect(await view.findByText('Thinker 8B spent its answer thinking.')).toBeTruthy();
    expect(view.queryByText(/I weigh one more word/)).toBeNull();
    rtl.fireEvent.press(view.getByText('Use Qwen 3.5 0.8B'));

    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-0').props.accessibilityState?.busy).toBe(false),
    );
    expect(view.getByTestId('improve-option-0')).toHaveTextContent('Could you send the report today?');
    expect(useAppStore.getState().activeModelId).toBe('small');
  });

  it('a model that only thinks, with no other model on the phone, leads to Get a model', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    boundary.llama!.scriptCompletion({ text: `<think>${'I weigh one more word. '.repeat(800)}`, charsPerToken: 4 });

    const { view } = openImprove({ text: DRAFT, apply: 'copy' });

    expect(await view.findByTestId('improve-thinking-only')).toBeTruthy();
    expect(view.getByText('Get a model')).toBeTruthy();
  });

  it('a model too big for free memory is never loaded; Improve says so and offers a smaller one', async () => {
    const boundary = installNativeBoundary({
      llama: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 6 * GB, availBytes: 1.5 * GB },
    });
    const { hardwareService } = require('../../../src/services/hardware');
    const { useAppStore } = require('../../../src/stores');
    boundary.fs!.seedFile('/models/big.gguf', 5 * GB);
    await hardwareService.refreshMemoryInfo();
    useAppStore.setState({
      downloadedModels: [
        createDownloadedModel({ id: 'big', name: 'Big 8B', engine: 'llama', filePath: '/models/big.gguf', fileSize: 5 * GB }),
      ],
      activeModelId: 'big',
    });

    const { view } = openImprove({ text: DRAFT, apply: 'copy' });

    expect(await view.findByText('Big 8B needs more free memory than this phone has now.')).toBeTruthy();
    expect(view.getByText('Get a smaller model')).toBeTruthy();
    expect(boundary.llama!.calls.initLlama).toHaveLength(0);
  });

  it('Copy puts the version I picked on the clipboard and says so', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    boundary.llama!.scriptCompletion({ text: VERSIONS });
    const { Clipboard } = require('react-native');

    const { rtl, view } = openImprove({ text: DRAFT, apply: 'copy' });
    const third = 'Send me the report today, please.';
    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-2').props.accessibilityState?.busy).toBe(false),
    );
    rtl.fireEvent.press(view.getByTestId('improve-option-2'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-2').props.accessibilityState?.selected).toBe(true),
    );
    rtl.fireEvent.press(view.getByTestId('improve-apply'));

    expect(await view.findByTestId('improve-copied')).toBeTruthy();
    expect(Clipboard.setString).toHaveBeenCalledTimes(1);
    expect(Clipboard.setString).toHaveBeenCalledWith(third);
  });

  it('Replace from the selection menu gives the picked version back to the calling app', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    boundary.llama!.scriptCompletion({ text: VERSIONS });
    const { Clipboard } = require('react-native');
    const finishImprove = jest.fn(async (_text: string | null) => undefined);
    const entry = requirePro<EntryModule>('@offgrid/pro/scribe/scribeEntry')!;
    entry.configureScribeEntry({ finishImprove });

    try {
      const { rtl, view } = openImprove({ text: DRAFT, apply: 'replace' });
      await rtl.waitFor(() =>
        expect(view.getByTestId('improve-option-0').props.accessibilityState?.busy).toBe(false),
      );
      rtl.fireEvent.press(view.getByTestId('improve-option-0'));
      await rtl.waitFor(() =>
        expect(view.getByTestId('improve-option-0').props.accessibilityState?.selected).toBe(true),
      );
      rtl.fireEvent.press(view.getByTestId('improve-apply'));

      await rtl.waitFor(() => expect(finishImprove).toHaveBeenCalled());
      expect(finishImprove).toHaveBeenCalledTimes(1);
      expect(finishImprove).toHaveBeenCalledWith('Could you send the report today?');
      expect(Clipboard.setString).not.toHaveBeenCalled();
      view.unmount();
      // Leaving after a pick gives nothing else back.
      expect(finishImprove).toHaveBeenCalledTimes(1);
    } finally {
      entry.configureScribeEntry(null);
    }
  });
});
