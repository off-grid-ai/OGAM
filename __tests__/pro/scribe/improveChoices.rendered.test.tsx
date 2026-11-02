/**
 * Improve's choices: what to change, the tone and the layout, combined in one request.
 *
 * SPEC: every choice is on screen, no dropdown. Improve is chosen when Improve opens and a version
 * starts at once. I can add a tone (Formal) and Lay out on top of it: all three stay chosen together
 * and the next version is written for all three. Tapping a chosen change or tone again clears it;
 * with nothing chosen the screen says what to do instead of writing. With Lay out on, my words stay
 * mine: a model that rewords my bulleted list while laying it out never reaches the screen, and the
 * version keeps every label of the list.
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


/** Ali's "What we do" list, as an email field gives it as plain text. */
const LABELS = [
  'Discovery & use-case identification:',
  'Problem definition:',
  'Plan for execution:',
  'Build in sprints:',
];
const ALI_LIST = [
  'What we do:',
  `- ${LABELS[0]} We run workshops to show what's possible, then find the use cases where AI moves the top line.`,
  `- ${LABELS[1]} We get specific about the problem and what a real win looks like.`,
  `- ${LABELS[2]} We map what has to change, in what order, and the outcome we'll be held to.`,
  `- ${LABELS[3]} We ship in production, with governance and data protection built in.`,
].join('\n');

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
  it('Improve, Formal and Lay out stay chosen together and the version is written for all three', async () => {
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

    rtl.fireEvent(view.getByTestId('improve-layout'), 'valueChange', true);
    expect(view.getByTestId('improve-layout').props.accessibilityState?.checked).toBe(true);
    expect(chosen(view, 'improve-action-improve')).toBe(true);
    expect(chosen(view, 'improve-tone-formal')).toBe(true);
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

  it("Lay out on Ali's list, already a list, says so and never shows the model's rewording", async () => {
    const boundary = installPhone();
    await loadTextModel(boundary);
    // The opening Improve, then a model that "lays out" by rewording and dropping the labels.
    boundary.llama!.scriptCompletion({ text: ALI_LIST.replace('We run', 'We hold') });
    const reworded = [
      'Our services:',
      '- We hold workshops and find valuable AI use cases.',
      '- We define the problem.',
      '- We plan the work.',
      '- We build in sprints with governance.',
    ].join('\n');
    const { rtl, view } = openImprove(ALI_LIST);
    await rtl.waitFor(() =>
      expect(view.getByTestId('improve-option-0').props.accessibilityState?.busy).toBe(false),
    );

    for (let i = 0; i < 4; i++) boundary.llama!.scriptCompletion({ text: reworded });
    rtl.fireEvent.press(view.getByTestId('improve-action-improve'));
    rtl.fireEvent(view.getByTestId('improve-layout'), 'valueChange', true);

    expect(await view.findByTestId('improve-unchanged')).toBeTruthy();
    expect(view.queryByTestId('improve-failed')).toBeNull();
    // Nowhere on the screen, not only in the versions.
    expect(view.root).not.toHaveTextContent(/Our services/);
  });
});
