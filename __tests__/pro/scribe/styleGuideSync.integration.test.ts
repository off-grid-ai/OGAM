/**
 * Scribe's style guides on the phone: a guide synced from a paired device shapes the next rewrite.
 *
 * SPEC: a style guide from the paired desktop lands on the phone, and the next Improve rewrite's prompt
 * carries it as the writer's voice. When the desktop deletes it, the next rewrite no longer does. A file
 * that is not a guide (a path in a folder) is refused at the door.
 *
 * Real styleGuideSyncService, noteFileTransfer staging, fileTransferService's sink registry, the
 * rewrite service and @offgrid/sync's style-guide NoteFileSync. The bytes go through the sink the
 * service registers, built from a FileRequestMessage the way the sender builds one. Device boundaries
 * only: the disk (memfs-backed react-native-fs, real sha256), AsyncStorage, llama.rn (the model that
 * receives the prompt) and the native TCP / mDNS modules the sync services build over at import.
 */
import { createHash, randomUUID } from 'node:crypto';
import { installNativeBoundary, GB, type NativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import { proIsPresent, requirePro } from '../helpers/requirePro';

jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

type ServiceModule = typeof import('../../../pro/sync/styleGuideSyncService');
type TransferServiceModule = typeof import('../../../pro/sync/fileTransferService');
type RewriteModule = typeof import('../../../pro/scribe/rewriteService');
type SyncModule = typeof import('@offgrid/sync');
type ChecksumModule = typeof import('../../../src/services/sync/fileChecksum');
type NoteFileDescriptor = import('@offgrid/sync').NoteFileDescriptor;

const describePro = proIsPresent() ? describe : describe.skip;

const APPLIED_KEY = 'offgrid-style-guide-sync-applied-v1';
const MODEL_PATH = '/models/small.gguf';
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

/** A phone with Scribe, a loaded text model, and the style-guide owner listening for revisions. */
async function installPhone() {
  const boundary: NativeBoundary = installNativeBoundary({
    llama: true,
    fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  const fs = boundary.fs!;
  const storageModule = require('@react-native-async-storage/async-storage');
  const AsyncStorage = storageModule.default ?? storageModule;
  await AsyncStorage.clear();

  const { llmService } = require('../../../src/services/llm');
  const { hardwareService } = require('../../../src/services/hardware');
  const { useAppStore } = require('../../../src/stores');
  fs.seedFile(MODEL_PATH, 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  await llmService.loadModel(MODEL_PATH);
  useAppStore.setState({
    downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: MODEL_PATH, fileSize: 500 * 1024 * 1024 })],
    activeModelId: 'llm',
  });

  const { styleGuideSyncService: service } = requirePro<ServiceModule>('@offgrid/pro/sync/styleGuideSyncService')!;
  const { fileTransferService } = requirePro<TransferServiceModule>('@offgrid/pro/sync/fileTransferService')!;
  const rewrites = requirePro<RewriteModule>('@offgrid/pro/scribe/rewriteService')!;
  const sync = require('@offgrid/sync') as SyncModule;
  const { fileTransferChecksum } = require('../../../src/services/sync/fileChecksum') as ChecksumModule;

  // Call-through: only reads which sink factory the service registered.
  const registerSink = jest.spyOn(fileTransferService, 'registerSink');
  service.start();
  const registration = registerSink.mock.calls.find(([mime]) => mime === sync.WRITING_STYLE_GUIDE_MIME);
  if (!registration) throw new Error('the style-guide sink was not registered');
  const createSink = registration[1];

  const applied = async (syncId: string) => ((await AsyncStorage.getItem(APPLIED_KEY)) ?? '').includes(syncId);

  const offer = async (descriptor: NoteFileDescriptor, bytes: Buffer, metadata = sync.createWritingStyleGuideTransferMetadata) => {
    const senderCopy = `${fs.module.CachesDirectoryPath}/desktop-outbox/${descriptor.syncId}`;
    await fs.module.writeFile(senderCopy, bytes.toString('base64'), 'base64');
    return {
      type: 'file_request' as const,
      id: randomUUID(),
      timestamp: Date.now(),
      payload: {
        fileName: descriptor.path.split('/').pop()!,
        fileSize: bytes.length,
        mimeType: sync.WRITING_STYLE_GUIDE_MIME,
        checksum: await fileTransferChecksum(senderCopy, bytes.length),
        metadata: metadata(descriptor),
      },
    };
  };

  /** A revision from the paired desktop: its bytes through the registered sink, then its record. */
  const receive = async (descriptor: NoteFileDescriptor, bytes: Buffer | null) => {
    if (bytes) {
      const request = await offer(descriptor, bytes);
      const sink = await createSink('desktop', request);
      if (!sink) throw new Error('the style-guide sink refused a well-formed revision');
      expect(await sink.prepare(request)).toBe(0);
      await sink.write(0, new Uint8Array(bytes));
      expect(await sink.finalize(request)).toBe(true);
    }
    service.applyControlPut(descriptor.syncId, sync.createWritingStyleGuideStateFields(descriptor));
    await waitFor(() => applied(descriptor.syncId), `revision ${descriptor.syncId} to settle`);
  };

  /** The prompt the phone's model receives for the next Improve rewrite. */
  const nextRewritePrompt = async (): Promise<string> => {
    boundary.llama!.scriptCompletion({ text: 'A clearer line.' });
    await rewrites.rewriteVersion('a draft line', 'improve', [], () => undefined);
    const [params] = boundary.llama!.calls.completion.at(-1) as [{ messages: Array<{ content: string }> }];
    return params.messages.map(message => message.content).join('\n');
  };

  return { sync, offer, createSink, receive, nextRewritePrompt };
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
    const request = await phone.offer(
      revision(phone.sync, { path: 'notes/plan.md', bytes }),
      bytes,
      phone.sync.createNoteFileTransferMetadata,
    );

    await expect(Promise.resolve().then(() => phone.createSink('desktop', request))).rejects.toThrow();
  });
});
