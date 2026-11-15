/**
 * Notes on the phone never change a byte the person did not change.
 *
 * SPEC: a note opened and saved without an edit is not rewritten: its CRLF line endings,
 * frontmatter, trailing spaces and links stay byte for byte. An edited save writes exactly the
 * editor's text, and the first save keeps the file as it was in history. A file another app wrote
 * after the note was opened is not overwritten: the save reports a conflict, and Keep both puts the
 * other text beside the note. Deleting a note moves it to the library's .trash, keeps its text in
 * history, and tells sync which bytes went.
 *
 * Real notesLibrary and @offgrid/notes. Device boundaries only: the disk (memfs-backed
 * react-native-fs with real bytes and sha256) and the clock.
 */
import { createHash } from 'node:crypto';
import { installNativeBoundary, type FsFake } from '../../harness/nativeBoundary';
import { proIsPresent, requirePro } from '../helpers/requirePro';

type LibraryModule = typeof import('../../../pro/notes/notesLibrary');

const describePro = proIsPresent() ? describe : describe.skip;

const NOTE = 'Projects/Plan.md';
const ORIGINAL =
  '---\r\ntitle: Plan\r\ntags: [alpha, beta]\r\n---\r\n# Plan  \r\n\r\nSee [[Other note]] for the rest.   \r\n- item one\t\r\n';

interface Phone {
  fs: FsFake;
  library: LibraryModule;
  file: (path: string) => string;
  bytes: (path: string) => Promise<Buffer>;
  history: (path: string) => Promise<Array<{ id: string; why: string }>>;
  historyText: (path: string, id: string) => Promise<string>;
}

function installPhone(): Phone {
  const boundary = installNativeBoundary({ fs: true });
  const fs = boundary.fs!;
  const library = requirePro<LibraryModule>('@offgrid/pro/notes/notesLibrary')!;
  const file = (path: string) => `${library.LIBRARY_ROOT}/${path}`;
  const historyDir = (path: string) =>
    `${fs.DocumentDirectoryPath}/notes-history/${encodeURIComponent(path)}`;
  return {
    fs,
    library,
    file,
    bytes: async path => Buffer.from(await fs.module.readFile(file(path), 'base64'), 'base64'),
    history: async path => JSON.parse(await fs.module.readFile(`${historyDir(path)}/index.json`, 'utf8')),
    historyText: (path, id) => fs.module.readFile(`${historyDir(path)}/${id}.txt`, 'utf8'),
  };
}

/** Every disk call that targeted `absolute` (the first argument, or a move/copy's destination). */
function writesTo(fs: FsFake, absolute: string): unknown[][] {
  return [
    ...fs.module.writeFile.mock.calls,
    ...fs.module.write.mock.calls,
    ...fs.module.appendFile.mock.calls,
    ...fs.module.unlink.mock.calls,
  ]
    .filter(call => call[0] === absolute)
    .concat(
      [...fs.module.moveFile.mock.calls, ...fs.module.copyFile.mock.calls].filter(
        call => call[1] === absolute || call[0] === absolute,
      ),
    );
}

describePro('Notes save byte for byte', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('a note saved without an edit is not rewritten', async () => {
    const phone = installPhone();
    phone.fs.seedTextFile(phone.file(NOTE), ORIGINAL);
    const before = await phone.bytes(NOTE);
    const opened = await phone.library.readNote(NOTE);
    expect(opened.text).toBe(ORIGINAL);

    const result = await phone.library.saveNote(NOTE, opened.text, opened.mtime);

    expect(result).toEqual({ status: 'saved', mtime: opened.mtime });
    expect((await phone.bytes(NOTE)).equals(before)).toBe(true);
    expect(writesTo(phone.fs, phone.file(NOTE))).toEqual([]);
  });

  it('an edited save writes exactly the editor text, and the first save keeps the original in history', async () => {
    const phone = installPhone();
    phone.fs.seedTextFile(phone.file(NOTE), ORIGINAL);
    const opened = await phone.library.readNote(NOTE);
    const edited = `${opened.text}- item two  \r\n`;

    const result = await phone.library.saveNote(NOTE, edited, opened.mtime);

    expect(result.status).toBe('saved');
    expect((await phone.bytes(NOTE)).equals(Buffer.from(edited, 'utf8'))).toBe(true);
    const versions = await phone.history(NOTE);
    const original = versions.find(v => v.why === 'original');
    expect(original).toBeDefined();
    expect(await phone.historyText(NOTE, original!.id)).toBe(ORIGINAL);
    const edit = versions.find(v => v.why === 'edit');
    expect(await phone.historyText(NOTE, edit!.id)).toBe(edited);
  });

  it('a file another app changed after it was opened is a conflict; Keep both puts my text beside it', async () => {
    const start = new Date('2026-10-30T10:00:00Z');
    jest.useFakeTimers({ now: start, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
    const phone = installPhone();
    phone.fs.seedTextFile(phone.file(NOTE), ORIGINAL);
    const opened = await phone.library.readNote(NOTE);

    // Another app writes the file two seconds later.
    jest.setSystemTime(new Date(start.getTime() + 2_000));
    const outside = `${ORIGINAL}Written in another app.\r\n`;
    phone.fs.seedTextFile(phone.file(NOTE), outside);
    phone.fs.module.writeFile.mockClear();
    phone.fs.module.moveFile.mockClear();
    const mine = `${ORIGINAL}Written here.\r\n`;

    const result = await phone.library.saveNote(NOTE, mine, opened.mtime);

    expect(result).toEqual({ status: 'conflict', diskText: outside });
    expect((await phone.bytes(NOTE)).equals(Buffer.from(outside, 'utf8'))).toBe(true);
    expect(writesTo(phone.fs, phone.file(NOTE))).toEqual([]);

    const copy = await phone.library.keepBoth(NOTE, mine);

    expect(copy).toMatch(/^Projects\/Plan \(conflict .+\)\.md$/);
    expect((await phone.bytes(copy)).equals(Buffer.from(mine, 'utf8'))).toBe(true);
    expect((await phone.bytes(NOTE)).equals(Buffer.from(outside, 'utf8'))).toBe(true);
  });

  it('deleting a note moves it to .trash, keeps its text in history and tells sync which bytes went', async () => {
    const phone = installPhone();
    phone.fs.seedTextFile(phone.file(NOTE), ORIGINAL);
    const sha256 = createHash('sha256').update(Buffer.from(ORIGINAL, 'utf8')).digest('hex');
    const heard: Array<[string, string]> = [];
    const stop = phone.library.onNoteDeleted((path, hash) => heard.push([path, hash]));

    try {
      await phone.library.deleteNote(NOTE);
    } finally {
      stop();
    }

    expect(await phone.fs.exists(phone.file(NOTE))).toBe(false);
    expect(phone.fs.module.unlink).not.toHaveBeenCalled();
    const [[from, to]] = phone.fs.module.moveFile.mock.calls;
    expect(from).toBe(phone.file(NOTE));
    expect(to.startsWith(`${phone.library.LIBRARY_ROOT}/${phone.library.TRASH_FOLDER}/`)).toBe(true);
    expect(to.endsWith(`/${NOTE}`)).toBe(true);
    const trashed = Buffer.from(await phone.fs.module.readFile(to, 'base64'), 'base64');
    expect(trashed.equals(Buffer.from(ORIGINAL, 'utf8'))).toBe(true);

    const versions = await phone.history(NOTE);
    const kept = versions.find(v => v.why === 'trashed');
    expect(await phone.historyText(NOTE, kept!.id)).toBe(ORIGINAL);
    expect(heard).toEqual([[NOTE, sha256]]);
    // The trash is hidden: never listed as a note.
    expect((await phone.library.listNotes()).map(n => n.path)).toEqual([]);
  });
});
