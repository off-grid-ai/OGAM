/**
 * A phone note's name, folder and earlier versions, opened from its title.
 *
 * SPEC: tapping the title opens the note's details. A new name and another folder are saved
 * together: the file moves, the screen follows it, and links to it from other notes follow too.
 * A name that is empty or another note's, or a folder that already holds a note of that name, is
 * refused with the reason and nothing moves. Earlier versions lists what the note said before
 * (never the text on screen); picking one asks first, and restoring it puts that text back while
 * the text there now stays in Earlier versions, so a restore can be undone. A version whose file
 * is gone says it could not be restored, and the text stays as it is.
 *
 * The real Note screen in a real navigator over the real notes library, notes index and
 * @offgrid/notes, with the real editor page. Device boundaries only: the disk (memfs-backed
 * react-native-fs), the WebView (the shipped page in jsdom) and the clock.
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

const describePro = proIsPresent() ? describe : describe.skip;

async function installPhone() {
  installNativeBoundary({ fs: true });
  const library = requirePro<LibraryModule>('@offgrid/pro/notes/notesLibrary')!;
  const { notesIndex } = requirePro<IndexModule>('@offgrid/pro/notes/notesIndex')!;
  /** A note written the way the app writes one: created, then saved. */
  const write = async (name: string, text: string): Promise<string> => {
    const path = await library.createNote(name);
    const opened = await library.readNote(path);
    await library.saveNote(path, text, opened.mtime);
    return path;
  };
  /** The text the note had in each kept version, newest first. */
  const versions = async (path: string): Promise<string[]> =>
    Promise.all(
      (await library.listVersions(path)).map(async v => (await library.readVersion(path, v.id)) ?? ''),
    );
  return {
    library,
    notesIndex,
    write,
    versions,
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

/** The note's page loaded with its text, then its details opened from the title. */
async function openDetails(rtl: Rtl, view: any, shows: RegExp) {
  await view.findByTestId('note-editor');
  await rtl.waitFor(() => expect(notePage().text()).toMatch(shows));
  rtl.fireEvent.press(view.getByTestId('note-header-title'));
  await view.findByTestId('note-details-name');
}

/** Leave the note as a person does, a moment after their last tap. */
async function leave(rtl: Rtl, navigation: any) {
  await rtl.act(() => new Promise(resolve => setTimeout(resolve, 300)));
  rtl.act(() => navigation.goBack());
}

describePro('Note details', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('a new name and another folder move the note, and links to it follow', async () => {
    const phone = await installPhone();
    const plan = await phone.write('Plan', 'Ship it.\n');
    const ideas = await phone.write('Ideas', 'See [[Plan]].\n');
    await phone.notesIndex.newFolder('', 'Work');
    await phone.notesIndex.load(true);

    const { rtl, view, navigation } = openNote(plan);
    await openDetails(rtl, view, /Ship it\./);
    rtl.fireEvent.changeText(view.getByTestId('note-details-name'), 'Roadmap');
    rtl.fireEvent.press(view.getByTestId('note-details-folder-Work'));
    rtl.fireEvent.press(view.getByTestId('note-details-save'));

    await rtl.waitFor(() =>
      expect(navigation.getCurrentRoute()).toMatchObject({ name: 'Note', params: { path: 'Work/Roadmap.md' } }),
    );
    expect(await phone.text('Work/Roadmap.md')).toBe('Ship it.\n');
    expect(await phone.library.readIfExists(plan)).toBeNull();
    expect(phone.notesIndex.links.outgoing(ideas).map(link => link.path)).toEqual(['Work/Roadmap.md']);
  });

  it('an empty name, another note\'s name, or a folder holding that name is refused', async () => {
    const phone = await installPhone();
    const plan = await phone.write('Plan', 'Ship it.\n');
    await phone.write('Taken', 'Mine.\n');
    await phone.write('Work/Plan', 'Other plan.\n');
    await phone.notesIndex.load(true);

    const { rtl, view } = openNote(plan);
    await openDetails(rtl, view, /Ship it\./);
    for (const [name, folder, why] of [
      ['..', '', 'A note needs a name.'],
      ['Taken', '', 'Taken already exists there.'],
      ['Plan', 'Work', 'Plan is already in that folder.'],
    ]) {
      rtl.fireEvent.changeText(view.getByTestId('note-details-name'), name);
      rtl.fireEvent.press(view.getByTestId(`note-details-folder-${folder || 'root'}`));
      rtl.fireEvent.press(view.getByTestId('note-details-save'));
      expect((await view.findByRole('alert')).props.children).toBe(why);
    }
    expect(await phone.text(plan)).toBe('Ship it.\n');
    expect(await phone.text('Work/Plan.md')).toBe('Other plan.\n');
  });

  it('restoring an earlier version asks first, and the text there now stays in Earlier versions', async () => {
    const start = new Date('2026-11-16T09:00:00Z');
    jest.useFakeTimers({
      now: start,
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'],
    });
    const phone = await installPhone();
    const plan = await phone.write('Plan', 'First draft.\n');
    // An hour later, a second sitting: its own version, not folded into the first.
    jest.setSystemTime(new Date(start.getTime() + 60 * 60 * 1000));
    const opened = await phone.library.readNote(plan);
    await phone.library.saveNote(plan, 'Second draft.\n', opened.mtime);
    await phone.notesIndex.load(true);

    const { rtl, view, navigation } = openNote(plan);
    await openDetails(rtl, view, /Second draft\./);
    const earlier = await view.findAllByTestId(/^note-version-/);
    // The text on screen is not offered back.
    expect(earlier).toHaveLength((await phone.versions(plan)).length - 1);
    const firstDraftId = (await phone.library.listVersions(plan))[1]!.id;
    rtl.fireEvent.press(view.getByTestId(`note-version-${firstDraftId}`));

    const alert = await view.findByTestId('app-alert', {}, { timeout: 2000 });
    expect(rtl.within(alert).getByTestId('app-alert-message').props.children).toBe(
      'The text you have now stays in Earlier versions.',
    );
    rtl.fireEvent.press(rtl.within(alert).getByLabelText('Restore'));
    await rtl.waitFor(() => expect(notePage().text()).toMatch(/First draft\./));

    jest.setSystemTime(new Date(start.getTime() + 2 * 60 * 60 * 1000));
    await leave(rtl, navigation);
    await rtl.waitFor(async () => expect(await phone.text(plan)).toBe('First draft.\n'));
    expect(await phone.versions(plan)).toContain('Second draft.\n');
  });

  it('a version whose file is gone says so, and the text stays', async () => {
    const start = new Date('2026-11-16T09:00:00Z');
    jest.useFakeTimers({
      now: start,
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'],
    });
    const phone = await installPhone();
    const plan = await phone.write('Plan', 'First draft.\n');
    jest.setSystemTime(new Date(start.getTime() + 60 * 60 * 1000));
    const opened = await phone.library.readNote(plan);
    await phone.library.saveNote(plan, 'Second draft.\n', opened.mtime);
    await phone.notesIndex.load(true);

    const { rtl, view } = openNote(plan);
    await openDetails(rtl, view, /Second draft\./);
    const firstDraftId = (await phone.library.listVersions(plan))[1]!.id;
    await view.findByTestId(`note-version-${firstDraftId}`);
    // The version file goes from the disk while the list is open.
    const RNFS = require('react-native-fs');
    await RNFS.unlink(`${RNFS.DocumentDirectoryPath}/notes-history/${encodeURIComponent(plan)}/${firstDraftId}.txt`);
    rtl.fireEvent.press(view.getByTestId(`note-version-${firstDraftId}`));
    rtl.fireEvent.press(rtl.within(await view.findByTestId('app-alert')).getByLabelText('Restore'));

    expect(await view.findByTestId('note-notice')).toBeTruthy();
    expect(notePage().text()).toMatch(/Second draft\./);
  });
});
