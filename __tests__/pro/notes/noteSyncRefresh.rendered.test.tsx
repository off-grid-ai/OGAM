/**
 * An open phone note when another device's edit arrives.
 *
 * SPEC: I have a note open. My Mac edits it and sync writes the new version here: the open note
 * shows it at once, not only after I leave and come back. If I have typed something not yet saved,
 * nothing of mine is lost: both versions are kept.
 *
 * The real Note screen in a real navigator over the real notes library and index. Device
 * boundaries only: the disk (memfs-backed react-native-fs). Sync's write is the library's own
 * installFile, the call sync makes for a received note.
 */
jest.unmock('@react-navigation/native');

import type React from 'react';
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type LibraryModule = typeof import('../../../pro/notes/notesLibrary');
type IndexModule = typeof import('../../../pro/notes/notesIndex');
type ScreenModule = typeof import('../../../pro/notes/ui/NoteScreen');

const describePro = proIsPresent() ? describe : describe.skip;

async function installPhone() {
  installNativeBoundary({ fs: true });
  const library = requirePro<LibraryModule>('@offgrid/pro/notes/notesLibrary')!;
  const { notesIndex } = requirePro<IndexModule>('@offgrid/pro/notes/notesIndex')!;
  const path = await library.createNote('Launch');
  const opened = await library.readNote(path);
  await library.saveNote(path, 'Written on the phone.\n', opened.mtime);
  await notesIndex.load(true);
  return { library, path };
}

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
  return { rtl, view };
}

/** The bytes another device sent, staged on disk, then installed at `path` as sync does. */
async function syncWrites(library: LibraryModule, path: string, text: string): Promise<void> {
  const RNFS = require('react-native-fs');
  const staged = `${RNFS.CachesDirectoryPath}/incoming-${Date.now()}.md`;
  await RNFS.writeFile(staged, text, 'utf8');
  await library.installFile(path, staged);
}

/** A sync arrives after the note was opened: later than the screen's copy by more than a tick. */
const later = () => new Promise(resolve => setTimeout(resolve, 1100));

describePro('an open note when a sync edit arrives', () => {
  it('shows the other device\'s version at once', async () => {
    const { library, path } = await installPhone();
    const { rtl, view } = openNote(path);
    const editor = await view.findByTestId('note-editor');
    await rtl.waitFor(() => expect(editor).toHaveTextContent(/Written on the phone\./));

    await later();
    await rtl.act(() => syncWrites(library, path, 'Written on the phone.\nEdited on the Mac.\n'));

    await rtl.waitFor(() => expect(view.getByTestId('note-editor')).toHaveTextContent(/Edited on the Mac\./));
  });

  it('keeps both versions when I have unsaved typing', async () => {
    const { library, path } = await installPhone();
    const { rtl, view } = openNote(path);
    const editor = await view.findByTestId('note-editor');
    await later();
    // Typed, and the edit arrives before the note's autosave: my typing is not on disk yet.
    rtl.fireEvent.changeText(editor, 'Written on the phone.\nTyping here.\n');
    await rtl.act(() => syncWrites(library, path, 'Written on the phone.\nEdited on the Mac.\n'));

    expect(await view.findByText('Two versions kept.')).toBeTruthy();
    expect(view.getByTestId('note-editor')).toHaveTextContent(/Typing here\./);
    expect(view.getByTestId('note-editor')).not.toHaveTextContent(/Edited on the Mac\./);
  });
});
