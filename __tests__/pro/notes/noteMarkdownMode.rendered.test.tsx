/**
 * A phone note the page cannot hold intact, edited as plain Markdown.
 *
 * SPEC: a note with Markdown the page would rewrite (an underlined heading) opens as plain Markdown
 * and says why, so not a byte of it changes unasked. Typing there saves exactly what was typed.
 * Link in the header opens a search of the library's notes, and picking one writes `[[Note]]` at
 * the caret; Close puts the search away. Typing `[[` offers the notes too, and Create note makes the
 * note it names and links it.
 *
 * The real Note screen in a real navigator over the real notes library, notes index and
 * @offgrid/notes, with the real editor page. Device boundaries only: the disk (memfs-backed
 * react-native-fs) and the WebView (the shipped page in jsdom).
 */
jest.unmock('@react-navigation/native');
jest.mock('react-native-webview', () => require('../../harness/noteWebView').webViewModule());

import type React from 'react';
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type LibraryModule = typeof import('../../../pro/notes/notesLibrary');
type IndexModule = typeof import('../../../pro/notes/notesIndex');
type ScreenModule = typeof import('../../../pro/notes/ui/NoteScreen');

const describePro = proIsPresent() ? describe : describe.skip;

/** An underlined (setext) heading: the page would write it back as `# Trip`. */
const UNDERLINED = 'Trip\n====\n\nPack light.\n';

async function installPhone() {
  installNativeBoundary({ fs: true });
  const library = requirePro<LibraryModule>('@offgrid/pro/notes/notesLibrary')!;
  const { notesIndex } = requirePro<IndexModule>('@offgrid/pro/notes/notesIndex')!;
  const write = async (name: string, text: string): Promise<string> => {
    const path = await library.createNote(name);
    const opened = await library.readNote(path);
    await library.saveNote(path, text, opened.mtime);
    return path;
  };
  return {
    library,
    notesIndex,
    write,
    text: async (path: string) => (await library.readNote(path)).text,
  };
}

/** The note at `path`, opened from a list screen, in a real stack navigator. */
function openNote(path: string) {
  const rtl = requireRTL();
  const ReactRuntime = require('react') as typeof React;
  const { NavigationContainer, createNavigationContainerRef } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { NoteScreen } = requirePro<ScreenModule>('@offgrid/pro/notes/ui/NoteScreen')!;
  const navigation = createNavigationContainerRef();
  const Stack = createNativeStackNavigator();
  const view = rtl.render(
    ReactRuntime.createElement(
      NavigationContainer,
      { ref: navigation },
      ReactRuntime.createElement(
        Stack.Navigator,
        { screenOptions: { headerShown: false } },
        ReactRuntime.createElement(Stack.Screen, { name: 'Notes', component: () => null }),
        ReactRuntime.createElement(Stack.Screen, { name: 'Note', component: NoteScreen }),
      ),
    ),
  );
  rtl.act(() => (navigation as any).navigate('Note', { path }));
  return { rtl, view, navigation: navigation as any };
}

type Rtl = ReturnType<typeof requireRTL>;

/** Type into the plain Markdown field: its whole new text, with the caret left at the end. */
function typeText(rtl: Rtl, view: any, text: string) {
  const field = view.getByTestId('note-editor-plain');
  rtl.fireEvent.changeText(field, text);
  rtl.fireEvent(field, 'selectionChange', {
    nativeEvent: { selection: { start: text.length, end: text.length } },
  });
}

/** Leave the note as a person does, a moment after their last tap. */
async function leave(rtl: Rtl, navigation: any) {
  await rtl.act(() => new Promise(resolve => setTimeout(resolve, 300)));
  rtl.act(() => navigation.goBack());
}

describePro('A note edited as plain Markdown', () => {
  it('opens as plain Markdown, says why, and saves exactly what is typed', async () => {
    const phone = await installPhone();
    const trip = await phone.write('Trip', UNDERLINED);
    await phone.notesIndex.load(true);

    const { rtl, view, navigation } = openNote(trip);
    await view.findByTestId('note-editor-plain');
    expect(view.getByTestId('note-notice')).toBeTruthy();
    expect(await phone.text(trip)).toBe(UNDERLINED);

    typeText(rtl, view, `${UNDERLINED}Socks.\n`);
    await leave(rtl, navigation);
    await rtl.waitFor(async () => expect(await phone.text(trip)).toBe(`${UNDERLINED}Socks.\n`));
  });

  it('Link searches the notes and writes the picked one at the caret; Close puts it away', async () => {
    const phone = await installPhone();
    await phone.write('Packing list', '- socks\n');
    const trip = await phone.write('Trip', UNDERLINED);
    await phone.notesIndex.load(true);

    const { rtl, view, navigation } = openNote(trip);
    await view.findByTestId('note-editor-plain');
    typeText(rtl, view, `${UNDERLINED}See `);

    rtl.fireEvent.press(view.getByTestId('note-link'));
    rtl.fireEvent.changeText(await view.findByTestId('note-link-search'), 'pack');
    rtl.fireEvent.press(await view.findByLabelText('Link Packing list'));
    await rtl.waitFor(() => expect(view.queryByTestId('note-link-picker')).toBeNull());

    rtl.fireEvent.press(view.getByTestId('note-link'));
    await view.findByTestId('note-link-picker');
    rtl.fireEvent.press(view.getByTestId('note-link-close'));
    await rtl.waitFor(() => expect(view.queryByTestId('note-link-picker')).toBeNull());

    await leave(rtl, navigation);
    await rtl.waitFor(async () =>
      expect(await phone.text(trip)).toBe(`${UNDERLINED}See [[Packing list]]`),
    );
  });

  it('typing [[ offers the notes, and Create note makes the named note and links it', async () => {
    const phone = await installPhone();
    const trip = await phone.write('Trip', UNDERLINED);
    await phone.notesIndex.load(true);

    const { rtl, view, navigation } = openNote(trip);
    await view.findByTestId('note-editor-plain');
    typeText(rtl, view, `${UNDERLINED}Next: [[Budget`);

    rtl.fireEvent.press(await view.findByTestId('note-link-create'));
    await rtl.waitFor(async () => expect(await phone.text('Budget.md')).toBe(''));
    await leave(rtl, navigation);
    await rtl.waitFor(async () => expect(await phone.text(trip)).toMatch(/Next: \[\[Budget\]\]/));
  });
});
