/**
 * Links and contents in a phone note, as the person uses them.
 *
 * SPEC: a `[TOC]` line in a note shows the note's headings in its preview, live: a heading added
 * in the editor is in the list next time. Tapping an entry scrolls to that heading. In the editor,
 * typing `[[` offers the library's notes and picking one writes `[[Note]]`; when no note has the
 * name typed, Create note makes it and links it. The Link action opens the same picker, and
 * selected text becomes the link's text. In the preview, tapping `[[Note#Heading]]` opens that
 * note at that heading; tapping a link to a note that does not exist yet makes it and opens it.
 *
 * The real Note screen in a real navigator over the real notes library, notes index and
 * @offgrid/notes. Device boundaries only: the disk (memfs-backed react-native-fs), native layout
 * (fired as the OS would report it) and the native scroll view. A full disk is the disk refusing
 * one write.
 */
jest.unmock('@react-navigation/native');

import type React from 'react';
import { installNativeBoundary, requireRTL, type FsFake } from '../../harness/nativeBoundary';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type LibraryModule = typeof import('../../../pro/notes/notesLibrary');
type IndexModule = typeof import('../../../pro/notes/notesIndex');
type ScreenModule = typeof import('../../../pro/notes/ui/NoteScreen');

const describePro = proIsPresent() ? describe : describe.skip;

interface Phone {
  fs: FsFake;
  library: LibraryModule;
  /** A note written the way the app writes one: created, then saved. */
  write: (name: string, text: string) => Promise<string>;
  text: (path: string) => Promise<string>;
}

async function installPhone(): Promise<Phone> {
  const { fs } = installNativeBoundary({ fs: true });
  const library = requirePro<LibraryModule>('@offgrid/pro/notes/notesLibrary')!;
  const { notesIndex } = requirePro<IndexModule>('@offgrid/pro/notes/notesIndex')!;
  const write = async (name: string, text: string): Promise<string> => {
    const path = await library.createNote(name);
    const opened = await library.readNote(path);
    await library.saveNote(path, text, opened.mtime);
    // The index loads when the Notes list opens; the Note screen reads it.
    await notesIndex.load(true);
    return path;
  };
  return { fs: fs!, library, write, text: async (path: string) => (await library.readNote(path)).text };
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

/** Type `text` into the editor with the caret (or selection) where a person left it. */
function type(rtl: ReturnType<typeof requireRTL>, editor: any, text: string, start = text.length, end = start) {
  rtl.fireEvent.changeText(editor, text);
  rtl.fireEvent(editor, 'selectionChange', { nativeEvent: { selection: { start, end } } });
}

/** The OS reports where each heading's block sits in the preview. */
function layOut(rtl: ReturnType<typeof requireRTL>, blocks: any[], ys: number[]) {
  blocks.forEach((block, i) =>
    rtl.fireEvent(block, 'layout', { nativeEvent: { layout: { x: 0, y: ys[i], width: 300, height: 80 } } }),
  );
}

function nativeScrolls(): unknown[][] {
  return (require('react-native').ScrollView.prototype.scrollTo as jest.Mock).mock.calls;
}

describePro('Note links and contents', () => {
  it('[TOC] shows the headings, live, and an entry scrolls to its heading', async () => {
    const phone = await installPhone();
    const path = await phone.write('Guide', '# Guide\n\n[TOC]\n\n## Install\n\nSteps.\n\n## Use\n\nMore.\n');

    const { rtl, view } = openNote(path);
    await view.findByTestId('note-editor');
    rtl.fireEvent.press(view.getByTestId('note-preview-toggle'));

    expect(view.getByTestId('note-toc')).toBeTruthy();
    expect(view.getAllByTestId('note-toc-entry')).toHaveLength(2);

    layOut(rtl, view.getAllByTestId('note-heading-block'), [0, 120, 480]);
    nativeScrolls().length = 0;
    rtl.fireEvent.press(view.getAllByTestId('note-toc-entry')[1]);
    expect(nativeScrolls()).toEqual([[{ y: 480, animated: true }]]);

    rtl.fireEvent.press(view.getByTestId('note-preview-toggle'));
    type(rtl, view.getByTestId('note-editor'), `${await phone.text(path)}\n## Share\n\nLast.\n`);
    rtl.fireEvent.press(view.getByTestId('note-preview-toggle'));
    expect(view.getAllByTestId('note-toc-entry')).toHaveLength(3);
  });

  it('typing [[ offers notes, and picking one writes the link', async () => {
    const phone = await installPhone();
    await phone.write('Plan', '# Plan\n');
    const ideas = await phone.write('Ideas', '');

    const { rtl, view, navigation } = openNote(ideas);
    type(rtl, await view.findByTestId('note-editor'), 'See [[Plan');
    expect(view.queryByTestId('note-link-create')).toBeNull();
    type(rtl, view.getByTestId('note-editor'), 'See [[Pl');

    expect(view.getByTestId('note-link-picker')).toBeTruthy();
    expect(view.getAllByTestId('note-link-option')).toHaveLength(1);
    rtl.fireEvent.press(view.getByTestId('note-link-option'));
    expect(view.queryByTestId('note-link-picker')).toBeNull();

    rtl.act(() => navigation.goBack());
    await rtl.waitFor(async () => expect(await phone.text(ideas)).toBe('See [[Plan]]'));
  });

  it('Create note makes the note and links it', async () => {
    const phone = await installPhone();
    await phone.write('Projects/Plan', '');
    const ideas = await phone.write('Ideas', '');

    const { rtl, view, navigation } = openNote(ideas);
    type(rtl, await view.findByTestId('note-editor'), 'See [[Pla');
    expect(view.getAllByTestId('note-link-option')).toHaveLength(1);
    type(rtl, view.getByTestId('note-editor'), 'See [[Brand new');

    expect(view.queryByTestId('note-link-option')).toBeNull();
    phone.fs.module.writeFile.mockRejectedValueOnce(new Error('No space left on device'));
    rtl.fireEvent.press(view.getByTestId('note-link-create'));
    expect(await view.findByTestId('note-notice')).toBeTruthy();
    expect(view.getByTestId('note-link-picker')).toBeTruthy();
    rtl.fireEvent.press(view.getByTestId('note-link-create'));
    await rtl.waitFor(() => expect(view.queryByTestId('note-link-picker')).toBeNull());

    expect(await phone.text('Brand new.md')).toBe('');
    rtl.act(() => navigation.goBack());
    await rtl.waitFor(async () => expect(await phone.text(ideas)).toBe('See [[Brand new]]'));
  });

  it('the Link action opens the same picker, and the selected text becomes the link text', async () => {
    const phone = await installPhone();
    await phone.write('Plan', '');
    const ideas = await phone.write('Ideas', '');

    const { rtl, view, navigation } = openNote(ideas);
    type(rtl, await view.findByTestId('note-editor'), 'Read this', 5, 9);
    rtl.fireEvent.press(view.getByTestId('note-link'));
    rtl.fireEvent.changeText(view.getByTestId('note-link-search'), 'plan');
    rtl.fireEvent.press(view.getByTestId('note-link-option'));

    rtl.act(() => navigation.goBack());
    await rtl.waitFor(async () => expect(await phone.text(ideas)).toBe('Read [[Plan|this]]'));
  });

  it('tapping [[Note#Heading]] opens that note at that heading', async () => {
    const phone = await installPhone();
    const plan = await phone.write('Plan', '# Plan\n\nIntro.\n\n## Steps\n\nDo it.\n');
    const ideas = await phone.write('Ideas', 'See [[Plan#Steps]].\n');

    const { rtl, view, navigation } = openNote(ideas);
    await view.findByTestId('note-editor');
    rtl.fireEvent.press(view.getByTestId('note-preview-toggle'));
    rtl.fireEvent.press(view.getByRole('link'));

    expect(navigation.getCurrentRoute()).toMatchObject({ name: 'Note', params: { path: plan, heading: 'Steps' } });
    const blocks = await view.findAllByTestId('note-heading-block');
    nativeScrolls().length = 0;
    layOut(rtl, blocks, [0, 360]);
    expect(nativeScrolls()).toEqual([[{ y: 360, animated: false }]]);
  });

  it('tapping a link to a note that does not exist yet makes it and opens it', async () => {
    const phone = await installPhone();
    const ideas = await phone.write('Ideas', 'Next: [[Projects/Launch]]\n');

    const { rtl, view, navigation } = openNote(ideas);
    await view.findByTestId('note-editor');
    rtl.fireEvent.press(view.getByTestId('note-preview-toggle'));
    phone.fs.module.writeFile.mockRejectedValueOnce(new Error('No space left on device'));
    rtl.fireEvent.press(view.getByRole('link'));
    expect(await view.findByTestId('note-notice')).toBeTruthy();
    expect(navigation.getCurrentRoute()).toMatchObject({ params: { path: ideas } });

    rtl.fireEvent.press(view.getByRole('link'));

    await rtl.waitFor(() =>
      expect(navigation.getCurrentRoute()).toMatchObject({ name: 'Note', params: { path: 'Projects/Launch.md' } }),
    );
    expect(await phone.text('Projects/Launch.md')).toBe('');
  });

  it('[[#Heading]] scrolls within the note, and a note linking here is listed once in Linked from and opens', async () => {
    const phone = await installPhone();
    const plan = await phone.write('Plan', 'Jump to [[#Steps]].\n\n## Steps\n\nDo it.\n');
    const ideas = await phone.write('Ideas', 'See [[Plan]], and again [[Plan#Steps]].\n');

    const { rtl, view, navigation } = openNote(plan);
    await view.findByTestId('note-editor');
    rtl.fireEvent.press(view.getByTestId('note-preview-toggle'));
    layOut(rtl, view.getAllByTestId('note-heading-block'), [200]);
    nativeScrolls().length = 0;
    rtl.fireEvent.press(view.getByRole('link'));
    expect(nativeScrolls()).toEqual([[{ y: 200, animated: true }]]);

    expect(view.getAllByTestId('note-backlink')).toHaveLength(1);
    rtl.fireEvent.press(view.getByTestId('note-backlink'));
    expect(navigation.getCurrentRoute()).toMatchObject({ name: 'Note', params: { path: ideas } });
  });

  it('[TOC] in a note with no headings says so', async () => {
    const phone = await installPhone();
    const path = await phone.write('Empty', '[TOC]\n\nJust text.\n');

    const { rtl, view } = openNote(path);
    await view.findByTestId('note-editor');
    rtl.fireEvent.press(view.getByTestId('note-preview-toggle'));

    expect(view.getByTestId('note-toc')).toBeTruthy();
    expect(view.queryByTestId('note-toc-entry')).toBeNull();
  });

  it('in the Link action, Done links the best match or creates the name, and Close leaves the note as it was', async () => {
    const phone = await installPhone();
    const ideas = await phone.write('Ideas', '');

    const { rtl, view, navigation } = openNote(ideas);
    type(rtl, await view.findByTestId('note-editor'), 'Next ');
    rtl.fireEvent.press(view.getByTestId('note-link'));
    expect(view.queryByTestId('note-link-option')).toBeNull();
    rtl.fireEvent(view.getByTestId('note-link-search'), 'submitEditing');
    rtl.fireEvent.press(view.getByTestId('note-link-close'));
    expect(view.queryByTestId('note-link-picker')).toBeNull();

    rtl.fireEvent.press(view.getByTestId('note-link'));
    rtl.fireEvent.changeText(view.getByTestId('note-link-search'), 'Launch');
    rtl.fireEvent(view.getByTestId('note-link-search'), 'submitEditing');
    await rtl.waitFor(() => expect(view.queryByTestId('note-link-picker')).toBeNull());
    expect(await phone.text('Launch.md')).toBe('');

    rtl.fireEvent.press(view.getByTestId('note-link'));
    rtl.fireEvent.changeText(view.getByTestId('note-link-search'), 'laun');
    rtl.fireEvent(view.getByTestId('note-link-search'), 'submitEditing');

    rtl.act(() => navigation.goBack());
    await rtl.waitFor(async () => expect(await phone.text(ideas)).toBe('Next [[Launch]][[Launch]]'));
  });
});
