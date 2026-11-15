/**
 * The chat composer after Improve puts a version back.
 *
 * SPEC: In chat I select some words and Improve them. Replace puts the version in their place and
 * the caret after it. The old selection is gone: Improve is not offered again on a range measured
 * on the text before the change (it opened on half a word, "tomorro", on the iPhone).
 *
 * The real chat composer with the real Scribe bar in its slot, and the real Improve screen in a
 * real navigator over the real rewrite service, engines and stores. Device boundaries only:
 * llama.rn, the disk, the RAM sensor.
 */
jest.unmock('@react-navigation/native');

import type React from 'react';
import { installNativeBoundary, GB, requireRTL, type NativeBoundary } from '../../harness/nativeBoundary';
import { importAndPickTextModel } from '../../harness/phoneTextModel';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type ScreenModule = typeof import('../../../pro/scribe/ui/ImproveScreen');
type BarModule = typeof import('../../../pro/scribe/ui/ScribeInputBar');

const describePro = proIsPresent() ? describe : describe.skip;

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

/** The chat composer with Scribe's bar in its slot, and Improve one route away. */
function openChatComposer() {
  const rtl = requireRTL();
  const ReactRuntime = require('react') as typeof React;
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { registerSlot, SLOTS } = require('../../../src/bootstrap/slotRegistry');
  const { ChatInput } = require('../../../src/components/ChatInput');
  const { ImproveScreen } = requirePro<ScreenModule>('@offgrid/pro/scribe/ui/ImproveScreen')!;
  const { ScribeInputBar } = requirePro<BarModule>('@offgrid/pro/scribe/ui/ScribeInputBar')!;
  const unregister = registerSlot(SLOTS.scribeInputBar, ScribeInputBar);
  const Stack = createNativeStackNavigator();
  const Composer: React.FC = () => ReactRuntime.createElement(ChatInput, { onSend: jest.fn() });
  const view = rtl.render(
    ReactRuntime.createElement(
      NavigationContainer,
      null,
      ReactRuntime.createElement(
        Stack.Navigator,
        { screenOptions: { headerShown: false } },
        ReactRuntime.createElement(Stack.Screen, { name: 'Chat', component: Composer }),
        ReactRuntime.createElement(Stack.Screen, { name: 'ScribeImprove', component: ImproveScreen }),
      ),
    ),
  );
  return { rtl, view, unregister };
}

describePro('the chat composer after Improve', () => {
  it('Replace leaves the caret after the version, with no stale selection to Improve', async () => {
    const boundary = installPhone();
    await importAndPickTextModel(boundary.fs!, { fileName: 'small.gguf', sizeBytes: 500 * 1024 * 1024 });
    boundary.llama!.scriptCompletion({ text: VERSION });
    const { rtl, view, unregister } = openChatComposer();
    try {
      const input = view.getByTestId('chat-input');
      rtl.fireEvent.changeText(input, BEFORE + SELECTED + AFTER);
      rtl.fireEvent(input, 'selectionChange', {
        nativeEvent: { selection: { start: BEFORE.length, end: BEFORE.length + SELECTED.length } },
      });

      rtl.fireEvent.press(await view.findByTestId('scribe-improve-selection'));
      expect(await view.findByTestId('improve-original')).toHaveTextContent(SELECTED);
      await rtl.waitFor(() =>
        expect(view.getByTestId('improve-option-0').props.accessibilityState?.busy).toBe(false),
      );
      rtl.fireEvent.press(view.getByTestId('improve-apply'));

      await rtl.waitFor(() =>
        expect(view.getByTestId('chat-input').props.value).toBe(BEFORE + VERSION + AFTER),
      );
      // The field reports no selection for text set in code: the old range must not survive.
      expect(view.queryByTestId('scribe-improve-selection')).toBeNull();
    } finally {
      unregister();
      view.unmount();
    }
  });
});
