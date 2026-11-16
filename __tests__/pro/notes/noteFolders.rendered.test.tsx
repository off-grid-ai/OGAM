/**
 * Folders in the phone's notes list, as the person uses them.
 *
 * SPEC: New folder makes an empty folder here, shown at once with no notes in it; a second with the
 * same name gets a number. Opening a folder lists what is in it. A long press on a folder offers
 * Rename and Delete. Renaming moves every note in it, with the folders that hold them, and links
 * to its notes from other notes follow, so they still open. A name that is empty, already taken, or
 * differs only in capital letters is refused with the reason, and nothing moves. Delete asks a
 * second time, saying how many notes go; then the notes move to the library's trash and the folder
 * goes. An empty folder says it is empty. New inside a folder makes the note there. A search reads
 * every note in every folder, says where each one is, and says when nothing matches.
 *
 * The real Notes screen in a real navigator over the real notes library, notes index and
 * @offgrid/notes. Device boundary only: the disk (memfs-backed react-native-fs).
 */
jest.unmock('@react-navigation/native');

import type React from 'react';
import { installNativeBoundary, requireRTL, type FsFake } from '../../harness/nativeBoundary';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type LibraryModule = typeof import('../../../pro/notes/notesLibrary');
type IndexModule = typeof import('../../../pro/notes/notesIndex');
type ScreenModule = typeof import('../../../pro/notes/ui/NotesScreen');

const describePro = proIsPresent() ? describe : describe.skip;

interface Phone {
  fs: FsFake;
  library: LibraryModule;
  notesIndex: IndexModule['notesIndex'];
  /** A note written the way the app writes one: created, then saved. */
  write: (name: string, text: string) => Promise<string>;
  text: (path: string) => Promise<string>;
  exists: (path: string) => Promise<boolean>;
  /** Every note file under the library's trash. */
  trashed: () => Promise<string[]>;
}

async function installPhone(): Promise<Phone> {
  const { fs } = installNativeBoundary({ fs: true });
  const library = requirePro<LibraryModule>('@offgrid/pro/notes/notesLibrary')!;
  const { notesIndex } = requirePro<IndexModule>('@offgrid/pro/notes/notesIndex')!;
  const RNFS = require('react-native-fs');
  const write = async (name: string, text: string): Promise<string> => {
    const path = await library.createNote(name);
    const opened = await library.readNote(path);
    await library.saveNote(path, text, opened.mtime);
    return path;
  };
  const trashed = async (): Promise<string[]> => {
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      if (!(await RNFS.exists(dir))) return;
      for (const item of await RNFS.readDir(dir)) {
        const path = rel ? `${rel}/${item.name}` : item.name;
        if (item.isDirectory()) await walk(item.path, path);
        else out.push(path);
      }
    };
    await walk(`${library.LIBRARY_ROOT}/${library.TRASH_FOLDER}`, '');
    // Each delete lands under a timestamp folder: drop it, keep the note's own path.
    return out.map(p => p.slice(p.indexOf('/') + 1)).sort();
  };
  return {
    fs: fs!,
    library,
    notesIndex,
    write,
    text: async path => (await library.readNote(path)).text,
    exists: path => RNFS.exists(`${library.LIBRARY_ROOT}/${path}`),
    trashed,
  };
}

/** The Notes list (the library, or `folder`) in a real stack navigator. */
function openNotes(folder?: string) {
  const rtl = requireRTL();
  const ReactRuntime = require('react') as typeof React;
  const { NavigationContainer, createNavigationContainerRef } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { NotesScreen } = requirePro<ScreenModule>('@offgrid/pro/notes/ui/NotesScreen')!;
  const navigation = createNavigationContainerRef();
  const Stack = createNativeStackNavigator();
  const view = rtl.render(
    ReactRuntime.createElement(
      NavigationContainer,
      { ref: navigation },
      ReactRuntime.createElement(
        Stack.Navigator,
        { screenOptions: { headerShown: false } },
        ReactRuntime.createElement(Stack.Screen, {
          name: 'Notes',
          component: NotesScreen,
          initialParams: folder ? { folder } : undefined,
        }),
        ReactRuntime.createElement(Stack.Screen, { name: 'Note', component: () => null }),
      ),
    ),
  );
  return { rtl, view, navigation: navigation as any };
}

type Rtl = ReturnType<typeof requireRTL>;

/** Type a folder name into the open name sheet and save it. */
function nameFolder(rtl: Rtl, view: any, name: string): void {
  rtl.fireEvent.changeText(view.getByTestId('notes-folder-name-input'), name);
  rtl.fireEvent.press(view.getByTestId('notes-folder-name-save'));
}

/** Long-press a folder and pick one of its actions. */
async function folderAction(rtl: Rtl, view: any, folder: string, action: 'Rename' | 'Delete') {
  rtl.fireEvent(view.getByTestId(`notes-folder-${folder}`), 'longPress');
  const alert = await view.findByTestId('app-alert');
  rtl.fireEvent.press(rtl.within(alert).getByLabelText(action));
}

describePro('Note folders', () => {
  it('New folder makes an empty folder here; the same name again gets a number', async () => {
    const phone = await installPhone();
    await phone.write('Groceries', 'Milk.\n');
    const { rtl, view } = openNotes();
    await view.findByTestId('note-Groceries.md');

    rtl.fireEvent.press(view.getByTestId('notes-new-folder'));
    nameFolder(rtl, view, 'Trips');
    await view.findByTestId('notes-folder-Trips');
    expect(view.getByLabelText('Trips, folder').props.accessibilityHint).toBe('0 notes');

    rtl.fireEvent.press(view.getByTestId('notes-new-folder'));
    nameFolder(rtl, view, 'Trips');
    await view.findByTestId('notes-folder-Trips 2');
    expect(await phone.exists('Trips 2')).toBe(true);
  });

  it('opening a folder lists its notes; an empty one says so', async () => {
    const phone = await installPhone();
    await phone.write('Work/Plan', 'Ship it.\n');
    await phone.notesIndex.newFolder('', 'Empty');

    const library = openNotes();
    await library.view.findByTestId('notes-folder-Work');
    expect(library.view.getByLabelText('Work, folder').props.accessibilityHint).toBe('1 note');
    library.view.unmount();

    const inWork = openNotes('Work');
    await inWork.view.findByTestId('note-Work/Plan.md');
    inWork.view.unmount();

    const inEmpty = openNotes('Empty');
    await inEmpty.view.findByText('Nothing in this folder yet.');
  });

  it('renaming a folder moves its notes and the folders holding them, and links to them still open', async () => {
    const phone = await installPhone();
    await phone.write('Work/Plan', 'Ship it.\n');
    await phone.write('Work/Q3/Goals', 'Grow.\n');
    const ideas = await phone.write('Ideas', 'See [[Work/Plan]] and [[Work/Q3/Goals]].\n');
    const { rtl, view } = openNotes();
    await view.findByTestId('notes-folder-Work');
    expect(view.getByLabelText('Work, folder').props.accessibilityHint).toBe('2 notes');

    await folderAction(rtl, view, 'Work', 'Rename');
    nameFolder(rtl, view, 'Projects');

    await view.findByTestId('notes-folder-Projects');
    expect(view.queryByTestId('notes-folder-Work')).toBeNull();
    expect(await phone.text('Projects/Plan.md')).toBe('Ship it.\n');
    expect(await phone.text('Projects/Q3/Goals.md')).toBe('Grow.\n');
    expect(await phone.exists('Work')).toBe(false);
    expect(await phone.text(ideas)).not.toMatch(/Work\//);
    expect(phone.notesIndex.links.outgoing(ideas).map(link => link.path)).toEqual([
      'Projects/Plan.md',
      'Projects/Q3/Goals.md',
    ]);
  });

  it('a folder name that is empty, taken, or only changes capitals is refused, and nothing moves', async () => {
    const phone = await installPhone();
    await phone.write('Work/Plan', 'Ship it.\n');
    await phone.notesIndex.newFolder('', 'Home');
    const { rtl, view } = openNotes();
    await view.findByTestId('notes-folder-Work');

    await folderAction(rtl, view, 'Work', 'Rename');
    for (const [name, why] of [
      ['..', 'A folder needs a name.'],
      ['Home', 'Home already exists there.'],
      ['WORK', 'That name differs only in capital letters.'],
    ]) {
      nameFolder(rtl, view, name);
      expect((await view.findByRole('alert')).props.children).toBe(why);
    }
    expect(await phone.text('Work/Plan.md')).toBe('Ship it.\n');
  });

  it('deleting a folder asks again, then its notes go to the trash', async () => {
    const phone = await installPhone();
    await phone.write('Work/Plan', 'Ship it.\n');
    await phone.write('Work/Budget', 'Tight.\n');
    await phone.write('Groceries', 'Milk.\n');
    const { rtl, view } = openNotes();
    await view.findByTestId('notes-folder-Work');

    await folderAction(rtl, view, 'Work', 'Delete');
    await rtl.waitFor(() =>
      expect(view.getByTestId('app-alert-message').props.children).toBe(
        'Its 2 notes move to the trash here and on your paired devices.',
      ),
    );
    rtl.fireEvent.press(rtl.within(view.getByTestId('app-alert')).getByLabelText('Delete'));

    await rtl.waitFor(() => expect(view.queryByTestId('notes-folder-Work')).toBeNull());
    expect(await phone.exists('Work')).toBe(false);
    expect(await phone.trashed()).toEqual(['Work/Budget.md', 'Work/Plan.md']);
    expect(view.getByTestId('note-Groceries.md')).toBeTruthy();
  });

  it('an empty folder says it is empty before it goes', async () => {
    const phone = await installPhone();
    await phone.write('Groceries', 'Milk.\n');
    await phone.notesIndex.newFolder('', 'Spare');
    const { rtl, view } = openNotes();
    await view.findByTestId('notes-folder-Spare');

    await folderAction(rtl, view, 'Spare', 'Delete');
    await rtl.waitFor(() =>
      expect(view.getByTestId('app-alert-message').props.children).toBe('It is empty.'),
    );
    rtl.fireEvent.press(rtl.within(view.getByTestId('app-alert')).getByLabelText('Delete'));
    await rtl.waitFor(() => expect(view.queryByTestId('notes-folder-Spare')).toBeNull());
    expect(await phone.exists('Spare')).toBe(false);
  });

  it('New inside a folder makes the note there and opens it', async () => {
    const phone = await installPhone();
    await phone.write('Work/Plan', 'Ship it.\n');
    const { rtl, view, navigation } = openNotes('Work');
    await view.findByTestId('note-Work/Plan.md');

    rtl.fireEvent.press(view.getByTestId('notes-new'));
    await rtl.waitFor(() =>
      expect(navigation.getCurrentRoute()).toMatchObject({
        name: 'Note',
        params: { path: 'Work/Untitled.md', fresh: true },
      }),
    );
    expect(await phone.exists('Work/Untitled.md')).toBe(true);
  });

  it('a search reads every note in every folder, says where each is, and says when nothing matches', async () => {
    const phone = await installPhone();
    await phone.write('Work/Plan', 'Book the venue.\n');
    await phone.write('Groceries', 'Milk.\n');
    const { rtl, view } = openNotes();
    await view.findByTestId('note-Groceries.md');

    rtl.fireEvent.changeText(view.getByTestId('notes-search'), 'venue');
    const found = await view.findByTestId('note-Work/Plan.md');
    expect(found.props.accessibilityHint).toMatch(/, in Work$/);
    expect(view.queryByTestId('note-Groceries.md')).toBeNull();
    expect(view.queryByTestId('notes-folder-Work')).toBeNull();

    rtl.fireEvent.changeText(view.getByTestId('notes-search'), 'nothing like this');
    expect(await view.findByText(/No note matches/)).toBeTruthy();
  });
});
