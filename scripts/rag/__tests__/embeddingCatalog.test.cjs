/* eslint-env node, es2022 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// HTTP is the external boundary. Repository and file responses use the Hub API contract.
function browser(fetchBoundary) {
  const filename = path.resolve(__dirname, '../../../src/services/huggingFaceModelBrowser.ts');
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const nativeRequire = name => name === 'react-native-fs' ? require('node:fs/promises') : require(name);
  vm.runInThisContext(`(function(require,module,exports,fetch){${source}\n})`, { filename })(nativeRequire, module, module.exports, fetchBoundary);
  return module.exports;
}
const revision = 'a'.repeat(40);
const response = data => new Response(JSON.stringify(data));

test('search combines embedding tasks and returns pinned single-file candidates only', async () => {
  const { searchEmbeddingModels } = browser(async address => {
    const url = new URL(address);
    if (url.pathname === '/api/models') {
      return response(url.searchParams.get('pipeline_tag') === 'feature-extraction'
        ? [{ id: 'org/encoder' }, { id: 'org/decoder' }]
        : [{ id: 'org/encoder' }]);
    }
    if (url.pathname === '/api/models/org/decoder') return response({ sha: revision, gguf: { architecture: 'llama' }, siblings: [] });
    if (url.pathname === '/api/models/org/encoder') return response({
      sha: revision, gguf: { architecture: 'bert' }, siblings: [
        { rfilename: 'nested/encoder Q8.gguf', lfs: { size: 40000000, sha256: 'b'.repeat(64) } },
        { rfilename: 'encoder-00001-of-00002.gguf', size: 30 },
        { rfilename: 'mmproj.gguf', size: 30 },
        { rfilename: 'encoder.onnx', size: 30 },
        { rfilename: 'unknown.gguf' },
      ],
    });
    throw new Error(`Unexpected API resource: ${url.pathname}`);
  });
  const found = await searchEmbeddingModels('encoder');
  assert.equal(found.length, 1);
  assert.equal(found[0].id, `org/encoder@${revision}/nested/encoder Q8.gguf`);
  assert.equal(found[0].downloadUrl, `https://huggingface.co/org/encoder/resolve/${revision}/nested/encoder%20Q8.gguf`);
  assert.equal(found[0].size, 40000000);
  assert.equal(found[0].sha256, 'b'.repeat(64));
});

test('search reports a failed file listing instead of claiming no compatible models exist', async () => {
  const { searchEmbeddingModels } = browser(async address => new URL(address).pathname === '/api/models'
    ? response([{ id: 'org/encoder' }]) : new Response('', { status: 503 }));
  await assert.rejects(searchEmbeddingModels('encoder'), /Could not read embedding model files/);
});

test('recommendations have pinned identities, checksums, and explicit download bytes', () => {
  const { RECOMMENDED_EMBEDDING_MODELS, BUNDLED_EMBEDDING_MODEL } = browser(fetch);
  assert.equal(BUNDLED_EMBEDDING_MODEL.size, 0);
  assert.equal(BUNDLED_EMBEDDING_MODEL.downloadUrl, undefined);
  for (const candidate of RECOMMENDED_EMBEDDING_MODELS) {
    assert.match(candidate.id, /@[a-f0-9]{40}\/.+\.gguf$/);
    assert.match(candidate.downloadUrl, /\/resolve\/[a-f0-9]{40}\/.+\.gguf$/);
    assert.match(candidate.sha256, /^[a-f0-9]{64}$/);
    assert.ok(candidate.size > 0);
  }
});
