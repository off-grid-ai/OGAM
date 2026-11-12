/**
 * Improve's choices: what to change and the tone, combined in one request.
 *
 * SPEC: every choice is on screen, no dropdown. Improve is chosen when Improve opens and a version
 * starts at once. I can add a tone (Formal) on top of it: both stay chosen together and the next
 * version is written for both. There is no layout switch: the rewrite keeps my layout and lays out a
 * wall of text by itself. Tapping a chosen change or tone again clears it; with nothing chosen the
 * screen says what to do instead of writing.
 *
 * The real screen in a real navigator over the real rewrite service, writing engine, engines and
 * stores. Device boundaries only: llama.rn, the disk, the RAM sensor.
 */
jest.unmock('@react-navigation/native');

import type React from 'react';
import { installNativeBoundary, GB, requireRTL, type NativeBoundary } from '../../harness/nativeBoundary';
import { importAndPickTextModel } from '../../harness/phoneTextModel';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type ScreenModule = typeof import('../../../pro/scribe/ui/ImproveScreen');

const describePro = proIsPresent() ? describe : describe.skip;


function installPhone(): NativeBoundary {
  return installNativeBoundary({
    llama: true,
    fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
}

/** The phone's text model, imported and picked the way a person does it. */
async function loadTextModel(boundary: NativeBoundary): Promise<void> {
  await importAndPickTextModel(boundary.fs!, { fileName: 'small.gguf', sizeBytes: 500 * 1024 * 1024 });
}

function openImprove(text: string) {
  const rtl = requireRTL();
  const ReactRuntime = require('react') as typeof React;
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { ImproveScreen } = requirePro<ScreenModule>('@offgrid/pro/scribe/ui/ImproveScreen')!;
  const Stack = createNativeStackNavigator();
  const view = rtl.render(
    ReactRuntime.createElement(
      NavigationContainer,
      null,
      ReactRuntime.createElement(
        Stack.Navigator,
        { screenOptions: { headerShown: false } },
        ReactRuntime.createElement(Stack.Screen, {
          name: 'ScribeImprove',
          component: ImproveScreen,
          initialParams: { text, apply: 'copy' },
        }),
      ),
    ),
  );
  return { rtl, view };
}

const chosen = (view: ReturnType<typeof openImprove>['view'], id: string): boolean | undefined =>
  view.getByTestId(id).props.accessibilityState?.selected;

describePro('Improve choices', () => {
  it('Improve and Formal stay chosen together, the version is written for both, and no layout switch shows', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    boundary.llama!.scriptCompletion({ text: 'Could you send the report today?' });
    const { rtl, view } = openImprove('pls send me the report today');

    expect(chosen(view, 'improve-action-improve')).toBe(true);
    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-0').props.accessibilityState?.busy).toBe(false),
    );

    boundary.llama!.scriptCompletion({ text: 'Kindly send the report today.' });
    rtl.fireEvent.press(view.getByTestId('improve-tone-formal'));
    await rtl.waitFor(() => expect(view.getByTestId('improve-option-0')).toHaveTextContent('Kindly send the report today.'));

    expect(chosen(view, 'improve-action-improve')).toBe(true);
    expect(chosen(view, 'improve-tone-formal')).toBe(true);
    const sent = JSON.stringify(boundary.llama!.calls.completion.at(-1));
    expect(sent).toMatch(/formal/i);
    expect(view.queryByTestId('improve-layout')).toBeNull();
    expect(view.root).not.toHaveTextContent(/Lay out/);
  });

  it('with nothing chosen, the screen says what to choose and writes nothing', async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    boundary.llama!.scriptCompletion({ text: 'Could you send the report today?' });
    const { rtl, view } = openImprove('pls send me the report today');
    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-0').props.accessibilityState?.busy).toBe(false),
    );
    const calls = boundary.llama!.calls.completion.length;

    rtl.fireEvent.press(view.getByTestId('improve-action-improve'));

    expect(await view.findByTestId('improve-nothing-chosen')).toBeTruthy();
    expect(chosen(view, 'improve-action-improve')).toBe(false);
    expect(view.queryByTestId('improve-option-0')).toBeNull();
    expect(boundary.llama!.calls.completion.length).toBe(calls);
  });
});
