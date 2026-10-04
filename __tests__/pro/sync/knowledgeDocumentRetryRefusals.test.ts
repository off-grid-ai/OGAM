/**
 * Retrying a knowledge document whose file is no longer what was indexed.
 *
 * The Activity row offers Retry, and a user taps it when a transfer failed. Between indexing and that tap the
 * file on disk can have moved on: they deleted it, they replaced it with a newer version, or the path now
 * points at a folder. Sending anyway is the bad outcome, and quietly so - the peer receives bytes the index
 * does not describe, so their knowledge base answers questions from content this phone never indexed and
 * neither device shows anything wrong.
 *
 * Each refusal also has to SAY WHY. The service records the failure as transfer activity carrying the reason,
 * which is the text the Activity row renders; "failed" with no cause leaves the user tapping Retry forever on
 * a document that can never send.
 *
 * Real service, real ragService, real SQLite (harness/sqliteFake), real in-memory filesystem (memfs via the
 * repo's RNFS boundary). Only the native TCP module is stood in for, and nothing reaches it in these cases -
 * that is the point.
 */
import { installRealSqlite } from '../../harness/sqliteFake';
import { installNativeBoundary } from '../../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

jest.mock('react-native-fs', () => {
  const { modelTransferFsBoundary } = require('../../utils/modelTransferFsBoundary');
  return {
    __esModule: true,
    default: modelTransferFsBoundary.module,
    ...modelTransferFsBoundary.module,
  };
});

import { proIsPresent } from '../helpers/requirePro';

const describePro = proIsPresent() ? describe : describe.skip;

const THE_MAC = 'the-mac';
const DOC_PATH = '/docs/contract.txt';
const CONTENTS = 'the indexed contents of a contract';
let applicationFixture: MobileApplicationFixture;
let projectSequence = 0;

type Harness = {
  service: {
    retry: (deviceId: string, syncId: string) => Promise<void>;
    getTransferActivitySnapshot: () => Array<{
      syncId: string;
      status: string;
      error?: string;
    }>;
  };
  fs: { module: Record<string, jest.Mock> };
  syncId: string;
  sourcePath: string;
};

/** Index a real document into a real knowledge base, and return the handles the cases need. */
async function indexedDocument(): Promise<Harness> {
  const {
    knowledgeDocumentSyncService,
  } = require('../../../pro/sync/knowledgeDocumentSyncService');
  const { modelTransferFsBoundary } = require('../../utils/modelTransferFsBoundary');

  modelTransferFsBoundary.reset();
  await modelTransferFsBoundary.module.writeFile(
    '/docs/all-MiniLM-L6-v2-Q8_0.gguf',
    'GGUF',
    'utf8',
  );
  await modelTransferFsBoundary.module.writeFile(DOC_PATH, CONTENTS, 'utf8');

  const indexed = await applicationFixture.application.rag.addDocument({
    projectId: `p${++projectSequence}`,
    path: DOC_PATH,
    fileName: 'contract.txt',
    size: CONTENTS.length,
  });
  if (!indexed.ok) throw new Error(indexed.failure.message);
  const documents = [];
  for await (const document of applicationFixture.application.rag.sync.allDocuments()) {
    documents.push(document);
  }
  const document = documents.at(-1);
  if (!document) throw new Error('the document was not indexed');

  return {
    service: knowledgeDocumentSyncService,
    fs: modelTransferFsBoundary,
    syncId: document.syncId,
    sourcePath: document.filePath,
  };
}

const failureFor = (h: Harness): { status: string; error?: string } | undefined =>
  h.service.getTransferActivitySnapshot().find(entry => entry.syncId === h.syncId);

describePro('retrying a knowledge document that no longer matches what was indexed', () => {
  beforeAll(async () => {
    installNativeBoundary({ llama: true });
    installRealSqlite();
    const ReactNative = require('react-native');
    const { ProximityAir } = require('../../utils/proximityNativeBoundary') as typeof import('../../utils/proximityNativeBoundary');
    ReactNative.NativeModules.SyncProximityModule = new ProximityAir().device({
      id: 'knowledge-retry-phone',
      name: 'This phone',
      platform: 'ios',
    });
    const { startMobileApplicationFixture } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    applicationFixture = await startMobileApplicationFixture({ pro: true });
  });

  afterAll(async () => {
    await applicationFixture.dispose();
  });

  it('refuses when the file has been deleted, and says so', async () => {
    const h = await indexedDocument();
    await h.fs.module.unlink(h.sourcePath);

    await expect(h.service.retry(THE_MAC, h.syncId)).rejects.toThrow(
      'knowledge document source is no longer available',
    );

    // The reason reaches the Activity row. "Failed" alone leaves the user retrying a document that can never
    // send, with nothing telling them the file is gone.
    const activity = failureFor(h);
    expect(activity?.status).toBe('failed');
    expect(activity?.error).toMatch(/no longer available/);
  });

  it('refuses when the file changed after it was indexed, and says so', async () => {
    const h = await indexedDocument();
    // The user edited the contract after adding it. The index still describes the OLD text.
    await h.fs.module.writeFile(h.sourcePath, `${CONTENTS} plus a clause added later`, 'utf8');

    await expect(h.service.retry(THE_MAC, h.syncId)).rejects.toThrow(
      'knowledge document source changed after it was indexed',
    );

    // This is the quiet one. Sending would give the peer bytes the index does not describe, so their knowledge
    // base would answer from content that was never indexed here, with nothing wrong on either screen.
    const activity = failureFor(h);
    expect(activity?.status).toBe('failed');
    expect(activity?.error).toMatch(/changed after it was indexed/);
  });

  it('refuses when the path now points at a folder', async () => {
    const h = await indexedDocument();
    await h.fs.module.unlink(h.sourcePath);
    await h.fs.module.mkdir(h.sourcePath);

    await expect(h.service.retry(THE_MAC, h.syncId)).rejects.toThrow(
      'knowledge document source is not a file',
    );
    expect(failureFor(h)?.status).toBe('failed');
  });

  it('refuses a document that is no longer in the knowledge base at all', async () => {
    const h = await indexedDocument();

    await expect(h.service.retry(THE_MAC, 'a-syncid-that-was-deleted')).rejects.toThrow(
      'knowledge document is no longer available',
    );
  });
});
