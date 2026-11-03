/**
 * Switching the search (embedding) model from the Models > Search tab: download, load, check, keep.
 *
 * SPEC (community report, 2026-11-03): picking Multilingual MiniLM L12 showed "Failed to load model The
 * previous model is still active." The file llama.cpp refused gave no reason, and the next good XLM-R
 * encoder (context 511) was refused by our own 512-token floor. A model the engine refuses must say so in
 * a sentence, keep the built-in model, and keep llama.cpp's reason for support; an encoder that holds a
 * document chunk must switch.
 *
 * Everything we own runs (embeddingModelChanger, embeddingService, the residency manager, the documents
 * store). Device leaves only: llama.rn (GGUF header, contexts and its native log), memfs with the Hub
 * answering the download, in-memory SQLite.
 */
import { createHash } from 'crypto';
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { installDocumentEngine } from '../../harness/documentEngine';

const BODY = 'GGUF xlm-roberta encoder bytes';
const CANDIDATE = {
  id: 'org/multilingual-encoder@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/encoder-Q6_K.gguf',
  name: 'Multilingual MiniLM L12',
  size: 130724128,
  downloadUrl: 'https://huggingface.co/org/multilingual-encoder/resolve/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/encoder-Q6_K.gguf',
  sha256: createHash('sha256').update(BODY).digest('hex'),
};
// What the XLM-R encoder's GGUF header declares (read from the real mykor Q6_K file).
const XLMR_HEADER = {
  'general.architecture': 'bert',
  'bert.context_length': 511,
  'bert.pooling_type': 1,
  'bert.embedding_length': 384,
};

function setup() {
  const boundary = installNativeBoundary({
    llama: true,
    fs: true,
    llamaModelInfo: XLMR_HEADER,
    ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
  });
  installDocumentEngine(boundary.fs!, { llama: boundary.llama!.module });
  boundary.fs!.serveRemoteFile(CANDIDATE.downloadUrl, { body: BODY, reportedSize: CANDIDATE.size });
  const { embeddingModelChanger } = require('../../../src/services/documents/embeddingModel');
  const store = require('../../../src/services/documents/store');
  return { llama: boundary.llama!, embeddingModelChanger, store };
}

it('a model llama.cpp refuses says so in one sentence, keeps llama.cpp\'s reason, and keeps the built-in model', async () => {
  const h = setup();
  const reason = "llama_model_load: error loading model: check_tensor_dims: tensor 'token_embd.weight' has wrong shape";
  h.llama.scriptInitFailure(true, 'Failed to load model', reason);

  const failure = await h.embeddingModelChanger.install(CANDIDATE).catch((error: Error) => error);

  expect(h.embeddingModelChanger.getChange()).toMatchObject({
    busy: false,
    error: "This model file can't be loaded (damaged or unsupported). The previous model is still active.",
  });
  expect(failure.message).toContain(reason);
  expect(h.store.activeEmbeddingModel()).toBeNull();
});

it('an XLM-R encoder that declares 511 tokens switches, and loads within its own context', async () => {
  const h = setup();

  await h.embeddingModelChanger.install(CANDIDATE);

  expect(h.embeddingModelChanger.getChange()).toMatchObject({ busy: false, error: '' });
  expect(h.store.activeEmbeddingModel()).toMatchObject({ id: CANDIDATE.id, size: CANDIDATE.size });
  const load = h.llama.calls.initLlama.find(params => params.embedding);
  expect(load).toMatchObject({ n_ctx: 511, n_batch: 511 });
});

it('an encoder too short to hold one document chunk is refused before it loads', async () => {
  const h = setup();
  h.llama.module.loadLlamaModelInfo.mockResolvedValue({ ...XLMR_HEADER, 'bert.context_length': 128 });

  await expect(h.embeddingModelChanger.install(CANDIDATE)).rejects.toThrow('at least 256 tokens');

  expect(h.llama.calls.initLlama.some(params => params.embedding)).toBe(false);
  expect(h.store.activeEmbeddingModel()).toBeNull();
});
