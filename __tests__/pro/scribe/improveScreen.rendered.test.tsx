/**
 * The Improve screen, as the person meets it from another app's selection.
 *
 * SPEC: with no text model, Improve says rewrites need one; when I come back with a model picked,
 * the version fills in without another tap. A model that only thinks shows no reasoning; the
 * screen says it spent its answer thinking and offers another model on the phone, and using that
 * model fills in the version. A model too big for free memory is never loaded; the screen says so
 * and offers a smaller model. A large model shows one quiet line with a quicker model to use. With the phone's model, one version
 * streams in; Another version adds a second; I pick one and Copy puts exactly that text on the
 * clipboard and says it was copied. When
 * the Android selection menu opened Improve (a native entry injected how to give text back), Replace
 * hands exactly the picked text back to the app it came from.
 *
 * The real screen in a real navigator over the real rewrite service, engines and stores. Models are
 * imported and picked the way a person does it. Device boundaries only: llama.rn, the disk, the RAM
 * sensor, the OS clipboard, and the native Improve entry's finisher (the seam core's PROCESS_TEXT
 * activity injects).
 */
jest.unmock('@react-navigation/native');

import type React from 'react';
import { installNativeBoundary, GB, requireRTL, type NativeBoundary } from '../../harness/nativeBoundary';
import { importAndPickTextModel, importTextModel } from '../../harness/phoneTextModel';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type ScreenModule = typeof import('../../../pro/scribe/ui/ImproveScreen');
type EntryModule = typeof import('../../../pro/scribe/scribeEntry');

const describePro = proIsPresent() ? describe : describe.skip;

const DRAFT = 'Please send me the report today.';
const VERSIONS = 'Could you send the report today?';
const ANOTHER = 'Send me the report today, please.';

function installPhone(): NativeBoundary {
  return installNativeBoundary({
    llama: true,
    fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
}

/** The phone's text model, imported and picked. */
function getTextModel(boundary: NativeBoundary, fileName = 'small.gguf', sizeBytes = 500 * 1024 * 1024) {
  return importAndPickTextModel(boundary.fs!, { fileName, sizeBytes });
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

    const { view } = openImprove({ text: DRAFT, apply: 'copy' });

    expect(await view.findByTestId('improve-no-model')).toBeTruthy();
    expect(view.queryByTestId('improve-copied')).toBeNull();
  });

  it('coming back with a model picked fills in the versions', async () => {
    const boundary = installPhone();

    const { rtl, view, navigation } = openImprove({ text: DRAFT, apply: 'copy' });
    expect(await view.findByTestId('improve-no-model')).toBeTruthy();

    rtl.act(() => navigation.navigate('Elsewhere'));
    await getTextModel(boundary);
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
    const thinker = await getTextModel(boundary, 'Thinker 8B.gguf');
    const small = await importTextModel(boundary.fs!, { fileName: 'Qwen 3.5 0.8B.gguf', sizeBytes: 300 * 1024 * 1024 });
    const { useAppStore } = require('../../../src/stores');
    boundary.llama!.scriptCompletions([
      { text: `<think>${'I weigh one more word. '.repeat(800)}`, charsPerToken: 4 },
      { text: VERSIONS },
    ]);

    const { rtl, view } = openImprove({ text: DRAFT, apply: 'copy' });

    expect(await view.findByTestId('improve-thinking-only')).toHaveTextContent(thinker.name, { exact: false });
    expect(view.queryByText(/I weigh one more word/)).toBeNull();
    expect(view.getByTestId('improve-use-model')).toHaveTextContent(small.name, { exact: false });
    rtl.fireEvent.press(view.getByTestId('improve-use-model'));

    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-0').props.accessibilityState?.busy).toBe(false),
    );
    expect(view.getByTestId('improve-option-0')).toHaveTextContent('Could you send the report today?');
    expect(useAppStore.getState().activeModelId).toBe(small.id);
  });

  it('a model that only thinks, with no other model on the phone, leads to Get a model', async () => {
    const boundary = installPhone();
    await getTextModel(boundary);
    boundary.llama!.scriptCompletion({ text: `<think>${'I weigh one more word. '.repeat(800)}`, charsPerToken: 4 });

    const { view } = openImprove({ text: DRAFT, apply: 'copy' });

    expect(await view.findByTestId('improve-thinking-only')).toBeTruthy();
    expect(view.getByTestId('improve-get-model')).toBeTruthy();
    expect(view.queryByTestId('improve-use-model')).toBeNull();
  });

  it('a model too big for free memory is never loaded; Improve says so and offers a smaller one', async () => {
    const boundary = installNativeBoundary({
      llama: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 6 * GB, availBytes: 1.5 * GB },
    });
    const big = await getTextModel(boundary, 'Big 8B.gguf', 5 * GB);

    const { view } = openImprove({ text: DRAFT, apply: 'copy' });

    expect(await view.findByTestId('improve-no-memory')).toHaveTextContent(big.name, { exact: false });
    expect(view.getByTestId('improve-get-model')).toBeTruthy();
    expect(view.queryByTestId('improve-use-model')).toBeNull();
    expect(boundary.llama!.calls.initLlama).toHaveLength(0);
  });

  it('Another version adds a second one; Copy puts the one I picked on the clipboard', async () => {
    const boundary = installPhone();
    await getTextModel(boundary);
    boundary.llama!.scriptCompletions([{ text: VERSIONS }, { text: ANOTHER }]);
    const { Clipboard } = require('react-native');

    const { rtl, view } = openImprove({ text: DRAFT, apply: 'copy' });
    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-0').props.accessibilityState?.busy).toBe(false),
    );
    rtl.fireEvent.press(view.getByTestId('improve-another'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-1').props.accessibilityState?.busy).toBe(false),
    );
    expect(view.getByTestId('improve-option-0')).toHaveTextContent(VERSIONS);
    rtl.fireEvent.press(view.getByTestId('improve-option-1'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-1').props.accessibilityState?.selected).toBe(true),
    );
    rtl.fireEvent.press(view.getByTestId('improve-apply'));

    expect(await view.findByTestId('improve-copied')).toBeTruthy();
    expect(Clipboard.setString).toHaveBeenCalledTimes(1);
    expect(Clipboard.setString).toHaveBeenCalledWith(ANOTHER);
  });

  it('a large model shows one quiet line offering a quicker model on the phone; Use it fills in a version', async () => {
    const boundary = installPhone();
    await getTextModel(boundary, 'Big 8B.gguf', 5 * GB);
    const small = await importTextModel(boundary.fs!, { fileName: 'Small 0.8B.gguf', sizeBytes: 300 * 1024 * 1024 });
    const { useAppStore } = require('../../../src/stores');
    boundary.llama!.scriptCompletions([{ text: VERSIONS }, { text: ANOTHER }]);

    const { rtl, view } = openImprove({ text: DRAFT, apply: 'copy' });

    expect(await view.findByTestId('improve-quick-model')).toHaveTextContent(small.name, { exact: false });
    rtl.fireEvent.press(view.getByTestId('improve-quick-use'));
    await rtl.waitFor(() => expect(view.getByTestId('improve-option-0')).toHaveTextContent(ANOTHER));
    expect(useAppStore.getState().activeModelId).toBe(small.id);
    expect(view.queryByTestId('improve-quick-model')).toBeNull();
  });

  it('Replace from the selection menu gives the picked version back to the calling app', async () => {
    const boundary = installPhone();
    await getTextModel(boundary);
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
