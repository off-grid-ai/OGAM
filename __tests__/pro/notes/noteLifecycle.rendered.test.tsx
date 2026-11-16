/**
 * A phone note from New to Delete, as the person uses it.
 *
 * SPEC: a new note left empty is gone when I leave it; a new note I wrote in is named from its first
 * line. Delete in the header asks first; Delete moves the note to the library's trash and goes back,
 * and when the disk refuses, it says so and the note stays. Dictate on a phone without a voice
 * model goes to get one.
 *
 * The real Note screen in a real navigator over the real notes library, notes index and
 * @offgrid/notes, with the real editor page. Device boundaries only: the disk (memfs-backed
 * react-native-fs) and the WebView (the shipped page in jsdom). A refused delete is the disk
 * refusing one move.
 */
jest.unmock('@react-navigation/native');
jest.mock('react-native-webview', () => require('../../harness/noteWebView').webViewModule());

import type React from 'react';
import { installNativeBoundary, requireRTL, type FsFake } from '../../harness/nativeBoundary';
import { notePage } from '../../harness/noteWebView';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type LibraryModule = typeof import('../../../pro/notes/notesLibrary');
type IndexModule = typeof import('../../../pro/notes/notesIndex');
type ScreenModule = typeof import('../../../pro/notes/ui/NoteScreen');

const describePro = proIsPresent() ? describe : describe.skip;

async function installPhone() {
  const { fs } = installNativeBoundary({ fs: true });
  const library = requirePro<LibraryModule>('@offgrid/pro/notes/notesLibrary')!;
  const { notesIndex } = requirePro<IndexModule>('@offgrid/pro/notes/notesIndex')!;
  const RNFS = require('react-native-fs');
  return {
    fs: fs as FsFake,
    library,
    notesIndex,
    exists: (path: string): Promise<boolean> => RNFS.exists(`${library.LIBRARY_ROOT}/${path}`),
    /** The notes in the library, trash left out. */
    notes: async (): Promise<string[]> => (await library.listNotes()).map(n => n.path).sort(),
  };
}

/** The note at `path`, opened from a list screen, in a real stack navigator. */
function openNote(path: string, fresh = false) {
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
        ReactRuntime.createElement(Stack.Screen, { name: 'Main', component: () => null }),
      ),
    ),
  );
  rtl.act(() => (navigation as any).navigate('Note', { path, fresh }));
  return { rtl, view, navigation: navigation as any };
}

type Rtl = ReturnType<typeof requireRTL>;

/** Leave the note as a person does, a moment after their last tap. */
async function leave(rtl: Rtl, navigation: any) {
  await rtl.act(() => new Promise(resolve => setTimeout(resolve, 300)));
  rtl.act(() => navigation.goBack());
}

describePro('A note from New to Delete', () => {
  it('a new note left empty is gone when I leave it', async () => {
    const phone = await installPhone();
    const path = await phone.library.createNote('Untitled');
    await phone.notesIndex.load(true);

    const { rtl, view, navigation } = openNote(path, true);
    await view.findByTestId('note-editor');
    await leave(rtl, navigation);

    await rtl.waitFor(async () => expect(await phone.exists(path)).toBe(false));
    expect(phone.notesIndex.notes().map(n => n.path)).not.toContain(path);
  });

  it('a new note I wrote in is named from its first line', async () => {
    const phone = await installPhone();
    const path = await phone.library.createNote('Untitled');
    await phone.notesIndex.load(true);

    const { rtl, view, navigation } = openNote(path, true);
    await view.findByTestId('note-editor');
    await rtl.waitFor(() => expect(notePage().editor()).toBeTruthy());
    notePage().type('Packing list');
    await leave(rtl, navigation);

    await rtl.waitFor(async () => expect(await phone.notes()).toEqual(['Packing list.md']));
    expect(phone.notesIndex.notes().map(n => n.path)).toEqual(['Packing list.md']);
  });

  it('Delete asks first, then moves the note to the trash and goes back; a refusing disk says so', async () => {
    const phone = await installPhone();
    const path = await phone.library.createNote('Plan');
    const opened = await phone.library.readNote(path);
    await phone.library.saveNote(path, 'Ship it.\n', opened.mtime);
    await phone.notesIndex.load(true);

    const { rtl, view, navigation } = openNote(path);
    await view.findByTestId('note-editor');
    await rtl.waitFor(() => expect(notePage().text()).toMatch(/Ship it\./));

    rtl.fireEvent.press(view.getByTestId('note-delete'));
    rtl.fireEvent.press(rtl.within(await view.findByTestId('app-alert')).getByLabelText('Cancel'));
    expect(await phone.exists(path)).toBe(true);

    phone.fs.module.moveFile.mockRejectedValueOnce(new Error('Operation not permitted'));
    rtl.fireEvent.press(view.getByTestId('note-delete'));
    rtl.fireEvent.press(rtl.within(await view.findByTestId('app-alert')).getByLabelText('Delete'));
    expect(await view.findByTestId('note-notice')).toBeTruthy();
    expect(await phone.exists(path)).toBe(true);

    rtl.fireEvent.press(view.getByTestId('note-delete'));
    rtl.fireEvent.press(rtl.within(await view.findByTestId('app-alert')).getByLabelText('Delete'));
    await rtl.waitFor(() => expect(navigation.getCurrentRoute().name).toBe('Notes'));
    expect(await phone.exists(path)).toBe(false);
    expect(phone.notesIndex.notes()).toEqual([]);
  });

  it('Dictate without a voice model goes to get one', async () => {
    const phone = await installPhone();
    const path = await phone.library.createNote('Plan');
    await phone.notesIndex.load(true);

    const { rtl, view, navigation } = openNote(path);
    rtl.fireEvent.press(await view.findByTestId('note-dictate'));
    expect(navigation.getCurrentRoute()).toMatchObject({
      name: 'Main',
      params: { screen: 'ModelsTab', params: { initialTab: 'transcription' } },
    });
  });
});
