/**
 * Links and contents in a phone note, as the person uses them.
 *
 * SPEC: the note is a live page. A `[TOC]` line shows the note's headings under its title, live: a heading typed
 * into the page is in the list at once, and tapping an entry puts the caret on that heading.
 * Typing `[[` offers the library's notes and picking one writes `[[Note]]`; unless a note has
 * exactly the name typed, Create note is offered too, and makes it and links it. Tapping `[[Note#Heading]]` opens that note at that
 * heading; tapping a link to a note that does not exist yet makes it and opens it, and a full disk
 * says so and stays put. Under the page, Linked from lists each note that links here once.
 *
 * The real Note screen in a real navigator over the real notes library, notes index and
 * @offgrid/notes, with the real editor page. Device boundaries only: the disk (memfs-backed
 * react-native-fs) and the WebView (the shipped page in jsdom). A full disk is the disk refusing
 * one write.
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

/** The note's page, loaded with its text. */
async function pageOf(rtl: ReturnType<typeof requireRTL>, view: any, shows: RegExp) {
  await view.findByTestId('note-editor');
  await rtl.waitFor(() => expect(notePage().text()).toMatch(shows));
  return notePage();
}

/** The caret at the end of the page, where a person taps to keep writing. */
function caretAtEnd(page: ReturnType<typeof notePage>) {
  const { view } = page.editor();
  view.focus();
  // The page's own Selection class (the app has no ProseMirror of its own).
  view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.atEnd(view.state.doc)));
}

/**
 * Leave the note as a person does, a moment after their last tap. The test navigator drops the
 * screen at once, where a phone's exit transition gives the page time to send its last edit.
 */
async function leave(rtl: ReturnType<typeof requireRTL>, navigation: any) {
  await rtl.act(() => new Promise(resolve => setTimeout(resolve, 300)));
  rtl.act(() => navigation.goBack());
}

/** The `[[` suggestions on screen. */
function suggestions(page: ReturnType<typeof notePage>): { textContent: string }[] {
  const list = page.document.querySelector('.npg-cmp');
  return list.hidden ? [] : [...list.querySelectorAll('[data-c]')];
}

describePro('Note links and contents', () => {
  it('[TOC] shows the headings, live, and an entry puts the caret on its heading', async () => {
    const phone = await installPhone();
    const path = await phone.write('Guide', '# Guide\n\n[TOC]\n\n## Install\n\nSteps.\n\n## Use\n\nMore.\n');

    const { rtl, view } = openNote(path);
    const page = await pageOf(rtl, view, /Steps\./);
    const entries = () => [...page.document.querySelectorAll('.npg-toc [data-toc-i]')].map(b => b.textContent);
    // The title heading names the note; the contents list what is under it.
    expect(entries()).toEqual(['Install', 'Use']);

    caretAtEnd(page);
    page.type('\n## Later');
    await rtl.waitFor(() => expect(entries()).toEqual(['Install', 'Use', 'Later']));

    page.tap(page.document.querySelectorAll('.npg-toc [data-toc-i]')[0]!);
    expect(page.editor().state.selection.$from.parent.textContent).toBe('Install');
  });

  it('[[ offers the library\'s notes, and picking one writes the link', async () => {
    const phone = await installPhone();
    await phone.write('Plan', '# Plan\n');
    const ideas = await phone.write('Ideas', 'Start\n');

    const { rtl, view, navigation } = openNote(ideas);
    const page = await pageOf(rtl, view, /Start/);
    caretAtEnd(page);
    page.type(' [[pl');
    await rtl.waitFor(() => expect(suggestions(page).map(s => s.textContent)).toEqual(['Plan', 'Create note ‘pl’']));
    page.tap(suggestions(page)[0]!);

    await leave(rtl, navigation);
    await rtl.waitFor(async () => expect(await phone.text(ideas)).toBe('Start [[Plan]]\n'));
  });

  it('[[ with a name no note has offers Create note, which makes it and links it', async () => {
    const phone = await installPhone();
    const ideas = await phone.write('Ideas', 'Next\n');

    const { rtl, view, navigation } = openNote(ideas);
    const page = await pageOf(rtl, view, /Next/);
    caretAtEnd(page);
    page.type(' [[Launch');
    await rtl.waitFor(() => expect(suggestions(page).map(s => s.textContent)).toEqual(['Create note ‘Launch’']));
    page.tap(suggestions(page)[0]!);

    await rtl.waitFor(async () => expect(await phone.text('Launch.md')).toBe(''));
    await leave(rtl, navigation);
    await rtl.waitFor(async () => expect(await phone.text(ideas)).toBe('Next [[Launch]]\n'));
  });

  it('tapping [[Note#Heading]] opens that note at that heading', async () => {
    const phone = await installPhone();
    const plan = await phone.write('Plan', '# Plan\n\nIntro.\n\n## Steps\n\nDo it.\n');
    const ideas = await phone.write('Ideas', 'See [[Plan#Steps]].\n');

    const { rtl, view, navigation } = openNote(ideas);
    const page = await pageOf(rtl, view, /See/);
    page.tap(page.document.querySelector('[data-wikilink]')!);

    await rtl.waitFor(() =>
      expect(navigation.getCurrentRoute()).toMatchObject({ name: 'Note', params: { path: plan, heading: 'Steps' } }),
    );
    await rtl.waitFor(() => expect(notePage().text()).toMatch(/Do it\./));
    await rtl.waitFor(() => expect(notePage().editor().state.selection.$from.parent.textContent).toBe('Steps'));
  });

  it('tapping a link to a note that does not exist yet makes it and opens it; a full disk says so', async () => {
    const phone = await installPhone();
    const ideas = await phone.write('Ideas', 'Next: [[Projects/Launch]]\n');

    const { rtl, view, navigation } = openNote(ideas);
    const page = await pageOf(rtl, view, /Next/);
    phone.fs.module.writeFile.mockRejectedValueOnce(new Error('No space left on device'));
    page.tap(page.document.querySelector('[data-wikilink]')!);
    expect(await view.findByTestId('note-notice')).toBeTruthy();
    expect(navigation.getCurrentRoute()).toMatchObject({ params: { path: ideas } });

    page.tap(page.document.querySelector('[data-wikilink]')!);

    await rtl.waitFor(() =>
      expect(navigation.getCurrentRoute()).toMatchObject({ name: 'Note', params: { path: 'Projects/Launch.md' } }),
    );
    expect(await phone.text('Projects/Launch.md')).toBe('');
  });

  it('a note linking here is listed once in Linked from, and opens', async () => {
    const phone = await installPhone();
    const plan = await phone.write('Plan', '## Steps\n\nDo it.\n');
    const ideas = await phone.write('Ideas', 'See [[Plan]], and again [[Plan#Steps]].\n');

    const { rtl, view, navigation } = openNote(plan);
    await pageOf(rtl, view, /Do it\./);

    expect(view.getAllByTestId('note-backlink')).toHaveLength(1);
    rtl.fireEvent.press(view.getByTestId('note-backlink'));
    expect(navigation.getCurrentRoute()).toMatchObject({ name: 'Note', params: { path: ideas } });
  });
});
