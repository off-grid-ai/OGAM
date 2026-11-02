/**
 * Notes sync on the phone: a revision from a paired device lands on real files in the library.
 *
 * SPEC: a received edit lands when this phone still has the content it was made from, and what was
 * here goes to history. A revision this phone already has, or has moved past, writes nothing. When
 * both sides changed a note, both versions are kept: the newer at the note's path and the other as
 * a conflict copy beside it, so nothing is lost. A delete from another device moves the note to the
 * library's .trash only while it is still the content that was deleted; an edit made here since
 * wins. An attachment lands byte for byte. And when I delete a synced note here, paired devices
 * are told exactly which bytes went.
 *
 * The real App with Pro decided by a real licence, paired with a Desktop on the LAN by the code the
 * Sync screen shows. The Desktop is the shared sync engine over the in-memory TCP boundary: it puts
 * each revision's bytes on the wire as a file_request and its record as a state op, exactly as a
 * Desktop does. The phone joins the Desktop's vault the way it does in the field, by adopting the
 * vault of the first revision it is sent. Device boundaries only: the disk (memfs-backed
 * react-native-fs, real sha256), AsyncStorage, the Keychain, SQLite and the native TCP / mDNS modules.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { FsFake } from '../../harness/nativeBoundary';
import type { LicensedMesh } from '../../harness/licensedMesh';
import type { PairedPeer } from '../../harness/proHarness';
import { proIsPresent, requirePro } from '../helpers/requirePro';

jest.unmock('@react-navigation/native');

jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

jest.mock('@op-engineering/op-sqlite', () =>
  require('../../harness/sqliteFake').realSqliteModule({ only: ['offgrid-sync.sqlite'] }),
);

type App = Awaited<ReturnType<typeof import('../../harness/proHarness').launchLicensedApp>>;
type LibraryModule = typeof import('../../../pro/notes/notesLibrary');
type SyncModule = typeof import('@offgrid/sync');
type NoteFileDescriptor = import('@offgrid/sync').NoteFileDescriptor;

const describePro = proIsPresent() ? describe : describe.skip;

const DESKTOP = { id: 'desktop-notes', name: 'Studio Mac' };
const VAULT = '6f1c2a4e-8d3b-4c5a-9e7f-0a1b2c3d4e5f';
const APPLIED_KEY = 'offgrid-notes-sync-applied-v1';
const NOTE = 'Projects/Plan.md';
/** The Desktop's first revision, which the phone joins its vault by. In a folder of its own. */
const WELCOME = 'Welcome.md';
const EARLY = '2000-01-01T00:00:00.000Z';
const LATE = '2099-01-01T00:00:00.000Z';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const utf8 = (text: string): Buffer => Buffer.from(text, 'utf8');

async function waitFor(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

interface Phone {
  fs: FsFake;
  library: LibraryModule;
  desktop: PairedPeer;
  file(path: string): string;
  bytes(path: string): Promise<Buffer>;
  history(path: string): Promise<Array<{ id: string; why: string }> | null>;
  historyText(path: string, id: string): Promise<string>;
  /** A revision from the paired desktop: its bytes as a file transfer, its record as a state op. */
  receive(descriptor: NoteFileDescriptor, bytes: Buffer | null, order?: 'bytes-first' | 'record-first'): Promise<void>;
  /** Files in the folder of `path` other than it (conflict copies). */
  siblings(path: string): string[];
}

let mesh: LicensedMesh;
let app: App | undefined;
let desktop: PairedPeer | undefined;

async function installPhone(): Promise<Phone> {
  const { launchLicensedApp, startPairedPeer } = require('../../harness/proHarness');
  app = await launchLicensedApp({ mesh, secrets: new Map() });
  const { view, rtl } = app!;
  const fs = app!.boundary.fs!;
  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  rtl.fireEvent.press(await view.findByTestId('open-sync-settings'));
  desktop = (await startPairedPeer({ mesh, device: DESKTOP })) as PairedPeer;
  const phoneId = await desktop.pairWithPhone(view);

  const library = requirePro<LibraryModule>('@offgrid/pro/notes/notesLibrary')!;
  const sync = require('@offgrid/sync') as SyncModule;
  const storageModule = require('@react-native-async-storage/async-storage');
  const AsyncStorage = storageModule.default ?? storageModule;
  const peer = desktop;

  const file = (path: string) => `${library.LIBRARY_ROOT}/${path}`;
  const historyDir = (path: string) => `${fs.DocumentDirectoryPath}/notes-history/${encodeURIComponent(path)}`;
  const applied = async (syncId: string) =>
    ((await AsyncStorage.getItem(APPLIED_KEY)) ?? '').includes(syncId);

  const sendBytes = (descriptor: NoteFileDescriptor, bytes: Buffer) =>
    peer.sendFile(phoneId, {
      fileName: descriptor.path.split('/').pop()!,
      bytes: new Uint8Array(bytes),
      mimeType: sync.NOTE_FILE_MIME,
      metadata: sync.createNoteFileTransferMetadata(descriptor) as unknown as Record<string, unknown>,
    });

  const phone: Phone = {
    fs,
    library,
    desktop: peer,
    file,
    bytes: async path => Buffer.from(await fs.module.readFile(file(path), 'base64'), 'base64'),
    history: async path => {
      const index = `${historyDir(path)}/index.json`;
      return (await fs.exists(index)) ? JSON.parse(await fs.module.readFile(index, 'utf8')) : null;
    },
    historyText: (path, id) => fs.module.readFile(`${historyDir(path)}/${id}.txt`, 'utf8'),
    receive: async (descriptor, bytes, order = 'bytes-first') => {
      const record = sync.createNoteFileStateFields(descriptor) as unknown as Record<string, unknown>;
      if (bytes && order === 'bytes-first') await sendBytes(descriptor, bytes);
      peer.record(sync.NOTE_FILE_ENTITY, descriptor.syncId, 'put', record);
      if (bytes && order === 'record-first') await sendBytes(descriptor, bytes);
      await waitFor(() => applied(descriptor.syncId), `revision ${descriptor.syncId} to settle`);
    },
    siblings: path => {
      const dir = file(path).slice(0, file(path).lastIndexOf('/'));
      return fs.listFiles(dir).filter(p => p !== file(path) && !p.split('/').pop()!.startsWith('.'));
    },
  };
  // The phone joins the Desktop's vault by the first revision it is sent there.
  const welcome = utf8('# Welcome\n');
  await phone.receive(revision({ path: WELCOME, bytes: welcome }), welcome);
  return phone;
}

function revision(fields: Partial<NoteFileDescriptor> & { path: string; bytes: Buffer | null; deletes?: Buffer }): NoteFileDescriptor {
  const content = fields.bytes ?? fields.deletes!;
  return {
    syncId: randomUUID(),
    vaultId: VAULT,
    path: fields.path,
    contentHash: sha256(content),
    baseHash: fields.baseHash ?? '',
    size: fields.bytes ? fields.bytes.length : 0,
    modifiedAt: fields.modifiedAt ?? new Date().toISOString(),
    deleted: fields.bytes === null,
  };
}

/** Disk calls that wrote, replaced or removed `absolute`. */
function writesTo(fs: FsFake, absolute: string): unknown[][] {
  return [
    ...fs.module.writeFile.mock.calls.filter(c => c[0] === absolute),
    ...fs.module.write.mock.calls.filter(c => c[0] === absolute),
    ...fs.module.unlink.mock.calls.filter(c => c[0] === absolute),
    ...fs.module.moveFile.mock.calls.filter(c => c[0] === absolute || c[1] === absolute),
    ...fs.module.copyFile.mock.calls.filter(c => c[1] === absolute),
  ];
}

describePro('Notes sync on the phone', () => {
  beforeEach(() => {
    const { createLicensedMesh } = require('../../harness/licensedMesh');
    mesh = createLicensedMesh();
    mesh.reset();
  });

  afterEach(async () => {
    await desktop?.stop();
    desktop = undefined;
    await app?.close();
    app = undefined;
    mesh.restore();
  });

  const LOCAL = '# Plan\r\n\r\nAs on this phone.  \r\n';
  const INCOMING = '# Plan\r\n\r\nAs edited on the desktop.\r\nSee [[Other]].\r\n';

  it('an edit made from this phone\'s content lands, and what was here goes to history', async () => {
    const phone = await installPhone();
    phone.fs.seedTextFile(phone.file(NOTE), LOCAL);
    const rev = revision({ path: NOTE, bytes: utf8(INCOMING), baseHash: sha256(utf8(LOCAL)) });

    await phone.receive(rev, utf8(INCOMING));

    expect((await phone.bytes(NOTE)).equals(utf8(INCOMING))).toBe(true);
    const versions = (await phone.history(NOTE))!;
    const texts = await Promise.all(
      versions.filter(v => v.why === 'outside').map(v => phone.historyText(NOTE, v.id)),
    );
    expect(texts).toContain(LOCAL);
    expect(phone.siblings(NOTE)).toEqual([]);
  });

  it('either arrival order lands the same edit', async () => {
    const phone = await installPhone();
    phone.fs.seedTextFile(phone.file(NOTE), LOCAL);
    const rev = revision({ path: NOTE, bytes: utf8(INCOMING), baseHash: sha256(utf8(LOCAL)) });

    await phone.receive(rev, utf8(INCOMING), 'record-first');

    expect((await phone.bytes(NOTE)).equals(utf8(INCOMING))).toBe(true);
  });

  it('a revision with the content already here writes nothing', async () => {
    const phone = await installPhone();
    phone.fs.seedTextFile(phone.file(NOTE), INCOMING);
    const rev = revision({ path: NOTE, bytes: utf8(INCOMING), baseHash: sha256(utf8(LOCAL)) });

    await phone.receive(rev, utf8(INCOMING));

    expect((await phone.bytes(NOTE)).equals(utf8(INCOMING))).toBe(true);
    expect(writesTo(phone.fs, phone.file(NOTE))).toEqual([]);
    expect(phone.siblings(NOTE)).toEqual([]);
  });

  it('a revision this phone has moved past writes nothing', async () => {
    const phone = await installPhone();
    const older = '# Plan\r\n\r\nAn older draft.\r\n';
    phone.fs.seedTextFile(phone.file(NOTE), older);
    const opened = await phone.library.readNote(NOTE);
    await phone.library.saveNote(NOTE, LOCAL, opened.mtime);
    phone.fs.module.writeFile.mockClear();
    phone.fs.module.moveFile.mockClear();
    phone.fs.module.unlink.mockClear();
    // The desktop replays the older draft this phone has since edited.
    const rev = revision({ path: NOTE, bytes: utf8(older), baseHash: '', modifiedAt: LATE });

    await phone.receive(rev, utf8(older));

    expect((await phone.bytes(NOTE)).equals(utf8(LOCAL))).toBe(true);
    expect(writesTo(phone.fs, phone.file(NOTE))).toEqual([]);
    expect(phone.siblings(NOTE)).toEqual([]);
  });

  it('a conflict the desktop wins keeps its edit at the path and this phone\'s beside it', async () => {
    const phone = await installPhone();
    phone.fs.seedTextFile(phone.file(NOTE), LOCAL);
    const rev = revision({
      path: NOTE,
      bytes: utf8(INCOMING),
      baseHash: sha256(utf8('# Plan\r\n')),
      modifiedAt: LATE,
    });

    await phone.receive(rev, utf8(INCOMING));

    expect((await phone.bytes(NOTE)).equals(utf8(INCOMING))).toBe(true);
    const copies = phone.siblings(NOTE);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/\/Plan \(conflict .+\)\.md$/);
    const copy = Buffer.from(await phone.fs.module.readFile(copies[0], 'base64'), 'base64');
    expect(copy.equals(utf8(LOCAL))).toBe(true);
    const versions = (await phone.history(NOTE))!;
    const conflict = versions.find(v => v.why === 'conflict');
    expect(await phone.historyText(NOTE, conflict!.id)).toBe(LOCAL);
  });

  it('a conflict this phone wins keeps its note and puts the desktop\'s edit beside it', async () => {
    const phone = await installPhone();
    phone.fs.seedTextFile(phone.file(NOTE), LOCAL);
    const rev = revision({
      path: NOTE,
      bytes: utf8(INCOMING),
      baseHash: sha256(utf8('# Plan\r\n')),
      modifiedAt: EARLY,
    });

    await phone.receive(rev, utf8(INCOMING));

    expect((await phone.bytes(NOTE)).equals(utf8(LOCAL))).toBe(true);
    const copies = phone.siblings(NOTE);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/\/Plan \(conflict 2000-01-01 0000\)\.md$/);
    const copy = Buffer.from(await phone.fs.module.readFile(copies[0], 'base64'), 'base64');
    expect(copy.equals(utf8(INCOMING))).toBe(true);
  });

  it('a delete of the content still here moves the note to .trash', async () => {
    const phone = await installPhone();
    phone.fs.seedTextFile(phone.file(NOTE), LOCAL);
    const tombstone = revision({ path: NOTE, bytes: null, deletes: utf8(LOCAL) });

    await phone.receive(tombstone, null);

    expect(await phone.fs.exists(phone.file(NOTE))).toBe(false);
    expect(phone.fs.module.unlink.mock.calls.filter(c => c[0] === phone.file(NOTE))).toEqual([]);
    const [move] = phone.fs.module.moveFile.mock.calls.filter(c => c[0] === phone.file(NOTE));
    expect(move[1]).toContain(`/${phone.library.TRASH_FOLDER}/`);
    const trashed = Buffer.from(await phone.fs.module.readFile(move[1], 'base64'), 'base64');
    expect(trashed.equals(utf8(LOCAL))).toBe(true);
    const versions = (await phone.history(NOTE))!;
    const kept = versions.find(v => v.why === 'trashed');
    expect(await phone.historyText(NOTE, kept!.id)).toBe(LOCAL);
  });

  it('a delete of content edited here since keeps the note', async () => {
    const phone = await installPhone();
    phone.fs.seedTextFile(phone.file(NOTE), LOCAL);
    const tombstone = revision({ path: NOTE, bytes: null, deletes: utf8('# Plan\r\n') });

    await phone.receive(tombstone, null);

    expect((await phone.bytes(NOTE)).equals(utf8(LOCAL))).toBe(true);
    expect(writesTo(phone.fs, phone.file(NOTE))).toEqual([]);
  });

  it('an attachment lands byte for byte, with no text history', async () => {
    const phone = await installPhone();
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x0d, 0x0a, 0x80, 0x7f]);
    const rev = revision({ path: 'img/a.png', bytes: image });

    await phone.receive(rev, image);

    expect((await phone.bytes('img/a.png')).equals(image)).toBe(true);
    expect(await phone.history('img/a.png')).toBeNull();
  });

  it('deleting a synced note here tells the desktop exactly which bytes went', async () => {
    const phone = await installPhone();
    const rev = revision({ path: NOTE, bytes: utf8(INCOMING) });
    await phone.receive(rev, utf8(INCOMING));
    const { NOTE_FILE_ENTITY } = require('@offgrid/sync') as SyncModule;
    const tombstoneOf = () =>
      phone.desktop.findRecord(NOTE_FILE_ENTITY, fields => fields.path === NOTE && fields.deleted === 1);

    await phone.library.deleteNote(NOTE);

    await waitFor(() => tombstoneOf() !== undefined, 'the tombstone on the desktop');
    expect(phone.desktop.records.get(`${NOTE_FILE_ENTITY}:${tombstoneOf()}`)).toMatchObject({
      vault_id: VAULT,
      path: NOTE,
      deleted: 1,
      content_hash: sha256(utf8(INCOMING)),
      base_hash: sha256(utf8(INCOMING)),
      size: 0,
    });
    expect(await phone.fs.exists(phone.file(NOTE))).toBe(false);
  });
});
