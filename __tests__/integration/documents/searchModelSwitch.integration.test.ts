/**
 * Changing the search (embedding) model on the phone's document store.
 *
 * SPEC (OGAM user's view, PR #739): picking another search model takes effect at once and keeps every
 * document. The old model's vectors are dropped in the same transaction as the new choice, so search
 * never ranks vectors of two models together; keyword search answers until each document is re-embedded
 * the next time it is used.
 *
 * Everything we own runs (documentService, the shared ingest, prepareTurnDocuments, the documents.db
 * store). Device leaves only (harness/documentEngine): SQLite is a real in-memory engine, the
 * filesystem is memfs, the PDF reader reads the file at its path, MiniLM answers through llama.rn.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { installDocumentEngine } from '../../harness/documentEngine';

function setup() {
  const boundary = installNativeBoundary({ fs: true, ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 6 * GB } });
  const engine = installDocumentEngine(boundary.fs!);
  const { documentService } = require('../../../src/services/documentService');
  const store = require('../../../src/services/documents/store');
  const { prepareTurnDocuments } = require('../../../src/services/documents/chatTurn');
  return { engine, documentService, store, prepareTurnDocuments };
}

const L12 = { id: 'minilm-l12', name: 'MiniLM L12', filePath: '/models/minilm-l12.gguf', size: 35 * 1024 * 1024 };

it('a new search model is kept at once, its predecessor\'s vectors go, and the document still answers', async () => {
  const h = setup();
  h.engine.seedPdf('/docs/Downloads/zenland.pdf', [
    'Zenland: an introduction. Geography and climate.',
    'The capital of Zenland is Quixotic City.',
  ]);
  const attachment = await h.documentService.attachDocument('/docs/Downloads/zenland.pdf', 'zenland.pdf');
  await h.engine.indexed(attachment.documentId);
  expect(h.store.activeEmbeddingModel()).toBeNull();
  expect((await h.store.documentStore.getDocument(attachment.documentId))?.embeddedCount).toBeGreaterThan(0);

  h.store.commitEmbeddingModel(L12);

  expect(h.store.activeEmbeddingModel()).toEqual(L12);
  // No vector of the old model survives the switch.
  expect((await h.store.documentStore.getDocument(attachment.documentId))?.embeddedCount).toBe(0);
  // The document is kept, and a turn still finds its answer (keyword search, then re-embedding as used).
  const turn = await h.prepareTurnDocuments({
    conversationId: 'chat-1',
    question: 'What is the capital of Zenland?',
    systemPrompt: 'You are a helpful assistant.',
    contextLength: 4096,
    isRemote: false,
    attachments: [attachment],
  });
  expect(`${turn?.stable}\n${turn?.turn}`).toContain('The capital of Zenland is Quixotic City.');

  // Back to the built-in model: the choice is cleared the same way.
  h.store.commitEmbeddingModel(null);
  expect(h.store.activeEmbeddingModel()).toBeNull();
});
