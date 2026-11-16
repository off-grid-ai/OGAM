/**
 * The format bar over the keyboard in a phone note, and Improve this paragraph.
 *
 * SPEC: while the keyboard is up, the note shows its format bar; with it down, the note's Linked
 * from. A format button acts on the page (Heading 1 makes the paragraph at the caret a heading).
 * Improve this paragraph sends the paragraph at the caret to Scribe's Improve, and the version I
 * pick there replaces that paragraph. With the caret on no paragraph, it says to put the cursor in
 * one.
 *
 * The real Note screen in a real navigator over the real notes library, notes index and the real
 * Scribe hand-off, with the real editor page. Device boundaries only: the disk (memfs-backed
 * react-native-fs), the WebView (the shipped page in jsdom) and the OS keyboard events. The Improve
 * screen is a stand-in that picks a version through the same hand-off the real one uses.
 */
jest.unmock('@react-navigation/native');
jest.mock('react-native-webview', () => require('../../harness/noteWebView').webViewModule());

import type React from 'react';
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { notePage } from '../../harness/noteWebView';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type LibraryModule = typeof import('../../../pro/notes/notesLibrary');
type IndexModule = typeof import('../../../pro/notes/notesIndex');
type ScreenModule = typeof import('../../../pro/notes/ui/NoteScreen');
type EntryModule = typeof import('../../../pro/scribe/scribeEntry');

const describePro = proIsPresent() ? describe : describe.skip;

async function installPhone() {
  installNativeBoundary({ fs: true });
  const library = requirePro<LibraryModule>('@offgrid/pro/notes/notesLibrary')!;
  const { notesIndex } = requirePro<IndexModule>('@offgrid/pro/notes/notesIndex')!;
  const path = await library.createNote('Trip');
  const opened = await library.readNote(path);
  await library.saveNote(path, 'Pack light.\n\nBook early.\n', opened.mtime);
  await notesIndex.load(true);
  return { library, path, text: async () => (await library.readNote(path)).text };
}

/** The note, opened in a real stack navigator with an Improve screen that picks `pick`. */
function openNote(path: string, pick: string) {
  const rtl = requireRTL();
  const ReactRuntime = require('react') as typeof React;
  const { NavigationContainer, createNavigationContainerRef } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { NoteScreen } = requirePro<ScreenModule>('@offgrid/pro/notes/ui/NoteScreen')!;
  const { takeFieldTarget } = requirePro<EntryModule>('@offgrid/pro/scribe/scribeEntry')!;
  const navigation = createNavigationContainerRef();
  const Stack = createNativeStackNavigator();
  /** Improve: the person picks a version, which goes back through the field's hand-off. */
  const Improve = ({ route }: { route: { params: { target: string } } }) => {
    ReactRuntime.useEffect(() => {
      takeFieldTarget(route.params.target)?.(pick).then(() => (navigation as any).goBack());
    }, [route.params.target]);
    return null;
  };
  const view = rtl.render(
    ReactRuntime.createElement(
      NavigationContainer,
      { ref: navigation },
      ReactRuntime.createElement(
        Stack.Navigator,
        { screenOptions: { headerShown: false } },
        ReactRuntime.createElement(Stack.Screen, { name: 'Notes', component: () => null }),
        ReactRuntime.createElement(Stack.Screen, { name: 'Note', component: NoteScreen }),
        ReactRuntime.createElement(Stack.Screen, { name: 'ScribeImprove', component: Improve }),
      ),
    ),
  );
  rtl.act(() => (navigation as any).navigate('Note', { path }));
  return { rtl, view, navigation: navigation as any };
}

type Rtl = ReturnType<typeof requireRTL>;

/** The OS raises or lowers the keyboard. */
function keyboard(rtl: Rtl, up: boolean) {
  const { DeviceEventEmitter, Platform } = require('react-native');
  const name = Platform.OS === 'ios' ? (up ? 'keyboardWillShow' : 'keyboardWillHide') : up ? 'keyboardDidShow' : 'keyboardDidHide';
  rtl.act(() => {
    DeviceEventEmitter.emit(name, { endCoordinates: { height: up ? 300 : 0, screenX: 0, screenY: 0, width: 390 } });
  });
}

/** Put the caret at the start of the page's paragraph `index`. */
function caretIn(index: number) {
  const { view } = notePage().editor();
  let at = -1;
  let seen = 0;
  view.state.doc.descendants((node: any, pos: number) => {
    if (at >= 0) return false;
    if (node.type.name === 'paragraph') {
      if (seen === index) at = pos + 1;
      seen++;
    }
    return true;
  });
  view.focus();
  view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(at))));
}

/** Leave the note as a person does, a moment after their last tap. */
async function leave(rtl: Rtl, navigation: any) {
  await rtl.act(() => new Promise(resolve => setTimeout(resolve, 300)));
  rtl.act(() => navigation.goBack());
}

describePro('The note format bar', () => {
  it('shows with the keyboard, and a format button acts on the page', async () => {
    const phone = await installPhone();
    const { rtl, view, navigation } = openNote(phone.path, '');
    await view.findByTestId('note-editor');
    await rtl.waitFor(() => expect(notePage().text()).toMatch(/Book early\./));
    expect(view.queryByTestId('note-format-bar')).toBeNull();

    keyboard(rtl, true);
    await view.findByTestId('note-format-bar');
    caretIn(1);
    rtl.fireEvent.press(view.getByTestId('note-format-h1'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('note-format-h1').props.accessibilityState).toMatchObject({ selected: true }),
    );

    keyboard(rtl, false);
    await rtl.waitFor(() => expect(view.queryByTestId('note-format-bar')).toBeNull());
    await leave(rtl, navigation);
    await rtl.waitFor(async () => expect(await phone.text()).toBe('Pack light.\n\n# Book early.\n'));
  });

  it('Improve this paragraph replaces the paragraph at the caret with the pick', async () => {
    const phone = await installPhone();
    const { rtl, view, navigation } = openNote(phone.path, 'Travel light.');
    await view.findByTestId('note-editor');
    await rtl.waitFor(() => expect(notePage().text()).toMatch(/Book early\./));
    keyboard(rtl, true);
    caretIn(0);

    rtl.fireEvent.press(await view.findByTestId('note-format-improve'));
    await rtl.waitFor(() => expect(notePage().text()).toMatch(/Travel light\./));
    expect(navigation.getCurrentRoute().name).toBe('Note');
    await leave(rtl, navigation);
    await rtl.waitFor(async () => expect(await phone.text()).toBe('Travel light.\n\nBook early.\n'));
  });
});
