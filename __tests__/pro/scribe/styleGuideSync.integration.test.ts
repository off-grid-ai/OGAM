/**
 * Scribe's style guides on the phone: a guide synced from a paired device shapes the next rewrite.
 *
 * SPEC: a style guide from the paired desktop lands on the phone, and the next Improve rewrite's prompt
 * carries it as the writer's voice. When the desktop deletes it, the next rewrite no longer does. A file
 * that is not a guide (a path in a folder) is refused at the door.
 *
 * The real App with Pro decided by a real licence, paired with a Desktop by the code the Sync screen
 * shows. The Desktop is the shared sync engine over the in-memory TCP boundary: each guide's bytes go
 * on the wire as a file_request and its record as a state op, as a Desktop sends them. The text model
 * is imported and picked the way a person does it. Device boundaries only: the disk (memfs-backed
 * react-native-fs, real sha256), AsyncStorage, the Keychain, SQLite, llama.rn (the model that receives
 * the prompt) and the native TCP / mDNS modules.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { LicensedMesh } from '../../harness/licensedMesh';
import type { PairedPeer } from '../../harness/proHarness';
import { importAndPickTextModel } from '../../harness/phoneTextModel';
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
type RewriteModule = typeof import('../../../pro/scribe/rewriteService');
type SyncModule = typeof import('@offgrid/sync');
type NoteFileDescriptor = import('@offgrid/sync').NoteFileDescriptor;

const describePro = proIsPresent() ? describe : describe.skip;

/** Improve, in the text's own tone and layout, as plain text. */
const IMPROVE = { action: 'improve', tone: null, layout: 'keep', format: 'plain' } as const;

const DESKTOP = { id: 'desktop-writing', name: 'Studio Mac' };
const APPLIED_KEY = 'offgrid-style-guide-sync-applied-v1';
const GUIDE = 'brand_voice.md';
const VOICE = 'Write short sentences. Never say "leverage".';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function waitFor(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

let mesh: LicensedMesh;
let app: App | undefined;
let desktop: PairedPeer | undefined;

/** A phone with Scribe and a text model, paired with a Desktop that has style guides. */
async function installPhone() {
  const { launchLicensedApp, startPairedPeer } = require('../../harness/proHarness');
  app = await launchLicensedApp({ mesh, secrets: new Map() });
  const { view, rtl, boundary } = app!;
  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  rtl.fireEvent.press(await view.findByTestId('open-sync-settings'));
  desktop = (await startPairedPeer({ mesh, device: DESKTOP })) as PairedPeer;
  const peer = desktop;
  const phoneId = await peer.pairWithPhone(view);
  await importAndPickTextModel(boundary.fs!, { fileName: 'voice.gguf', sizeBytes: 500 * 1024 * 1024 });

  const storageModule = require('@react-native-async-storage/async-storage');
  const AsyncStorage = storageModule.default ?? storageModule;
  const rewrites = requirePro<RewriteModule>('@offgrid/pro/scribe/rewriteService')!;
  const sync = require('@offgrid/sync') as SyncModule;

  const applied = async (syncId: string) => ((await AsyncStorage.getItem(APPLIED_KEY)) ?? '').includes(syncId);

  /** The Desktop sends a file under the guide MIME, with `metadata` as its sender builds it. */
  const offer = (descriptor: NoteFileDescriptor, bytes: Buffer, metadata = sync.createWritingStyleGuideTransferMetadata) =>
    peer.sendFile(phoneId, {
      fileName: descriptor.path.split('/').pop()!,
      bytes: new Uint8Array(bytes),
      mimeType: sync.WRITING_STYLE_GUIDE_MIME,
      metadata: metadata(descriptor) as unknown as Record<string, unknown>,
    });

  /** A revision from the paired desktop: its bytes as a file transfer, then its record as a state op. */
  const receive = async (descriptor: NoteFileDescriptor, bytes: Buffer | null) => {
    if (bytes) await offer(descriptor, bytes);
    peer.record(
      sync.WRITING_STYLE_GUIDE_ENTITY,
      descriptor.syncId,
      'put',
      sync.createWritingStyleGuideStateFields(descriptor) as unknown as Record<string, unknown>,
    );
    await waitFor(() => applied(descriptor.syncId), `revision ${descriptor.syncId} to settle`);
  };

  /** The prompt the phone's model receives for the next Improve rewrite. */
  const nextRewritePrompt = async (): Promise<string> => {
    // As Improve opens: ready the picked model, then write.
    await expect(rewrites.prepareRewrites()).resolves.toEqual({ ready: true });
    boundary.llama!.scriptCompletion({ text: 'A clearer line.' });
    await rewrites.rewriteVersion('a draft line', IMPROVE, [], () => undefined);
    const [params] = boundary.llama!.calls.completion.at(-1) as [{ messages: Array<{ content: string }> }];
    return params.messages.map(message => message.content).join('\n');
  };

  return { sync, offer, receive, nextRewritePrompt };
}

function revision(sync: SyncModule, fields: { path: string; bytes: Buffer | null; deletes?: Buffer; baseHash?: string }): NoteFileDescriptor {
  const content = fields.bytes ?? fields.deletes!;
  return {
    syncId: randomUUID(),
    vaultId: sync.WRITING_STYLE_GUIDE_VAULT_ID,
    path: fields.path,
    contentHash: sha256(content),
    baseHash: fields.baseHash ?? '',
    size: fields.bytes ? fields.bytes.length : 0,
    modifiedAt: new Date().toISOString(),
    deleted: fields.bytes === null,
  };
}

describePro('Scribe style guides synced to the phone', () => {
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

  it('a guide from the desktop shapes the next rewrite; deleted there, it no longer does', async () => {
    const phone = await installPhone();
    expect(await phone.nextRewritePrompt()).not.toContain(VOICE);

    const bytes = Buffer.from(VOICE, 'utf8');
    await phone.receive(revision(phone.sync, { path: GUIDE, bytes }), bytes);
    const withGuide = await phone.nextRewritePrompt();
    expect(withGuide).toContain('brand_voice');
    expect(withGuide).toContain(VOICE);

    await phone.receive(revision(phone.sync, { path: GUIDE, bytes: null, deletes: bytes, baseHash: sha256(bytes) }), null);
    expect(await phone.nextRewritePrompt()).not.toContain(VOICE);
  });

  it('a file that is not a guide is refused at the door', async () => {
    const phone = await installPhone();
    const bytes = Buffer.from('not a guide', 'utf8');
    // A sender that dresses a note in a folder up as a guide: the guide MIME, the note-file metadata.
    const sent = phone.offer(
      revision(phone.sync, { path: 'notes/plan.md', bytes }),
      bytes,
      phone.sync.createNoteFileTransferMetadata,
    );

    // Refused by the guide sink itself, not declined by a sharing setting.
    await expect(sent).rejects.toThrow("invalid writing style guide transfer metadata");
    expect(await phone.nextRewritePrompt()).not.toContain('not a guide');
  });
});
