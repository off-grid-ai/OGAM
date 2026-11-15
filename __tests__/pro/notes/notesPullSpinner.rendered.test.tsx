/**
 * The pull spinner on the notes list.
 *
 * SPEC: I come back to my notes from a note. The list picks up what changed without a spinner,
 * because I did not ask for one. When I pull down, the spinner shows until the library is read
 * again, then goes. (On iOS a spinner raised while the screen animates in never went away.)
 *
 * The real Notes screen in a real navigator over the real notes library and index. Device boundary
 * only: the disk (memfs-backed react-native-fs).
 */
jest.unmock('@react-navigation/native');

import type React from 'react';
import { RefreshControl } from 'react-native';
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type LibraryModule = typeof import('../../../pro/notes/notesLibrary');
type IndexModule = typeof import('../../../pro/notes/notesIndex');
type ScreenModule = typeof import('../../../pro/notes/ui/NotesScreen');

const describePro = proIsPresent() ? describe : describe.skip;

async function installPhone() {
  installNativeBoundary({ fs: true });
  const library = requirePro<LibraryModule>('@offgrid/pro/notes/notesLibrary')!;
  const { notesIndex } = requirePro<IndexModule>('@offgrid/pro/notes/notesIndex')!;
  const path = await library.createNote('Garden plan');
  const opened = await library.readNote(path);
  await library.saveNote(path, 'Three raised beds.\n', opened.mtime);
  await notesIndex.load(true);
}

function openNotes() {
  const rtl = requireRTL();
  const ReactRuntime = require('react') as typeof React;
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { NotesScreen } = requirePro<ScreenModule>('@offgrid/pro/notes/ui/NotesScreen')!;
  const Stack = createNativeStackNavigator();
  const view = rtl.render(
    ReactRuntime.createElement(
      NavigationContainer,
      null,
      ReactRuntime.createElement(
        Stack.Navigator,
        { screenOptions: { headerShown: false } },
        ReactRuntime.createElement(Stack.Screen, { name: 'Notes', component: NotesScreen }),
      ),
    ),
  );
  const spinner = () => view.UNSAFE_getByType(RefreshControl).props;
  return { rtl, view, spinner };
}

describePro('the notes list pull spinner', () => {
  it('stays hidden while the list rescans on open', async () => {
    await installPhone();
    const { rtl, view, spinner } = openNotes();

    // The focus rescan is in flight (nothing awaited yet): the list shows the notes it has, with
    // no spinner.
    expect(view.getByText('Garden plan')).toBeTruthy();
    expect(spinner().refreshing).toBe(false);
    await rtl.waitFor(() => expect(view.getByText('Garden plan')).toBeTruthy());
    expect(spinner().refreshing).toBe(false);
  });

  it('shows while a pull reads the library, then goes', async () => {
    await installPhone();
    const { rtl, view, spinner } = openNotes();
    await rtl.waitFor(() => expect(view.getByText('Garden plan')).toBeTruthy());

    rtl.act(() => spinner().onRefresh());
    expect(spinner().refreshing).toBe(true);
    await rtl.waitFor(() => expect(spinner().refreshing).toBe(false));
  });
});
