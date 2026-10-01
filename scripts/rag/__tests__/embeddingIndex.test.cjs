/* eslint-env node, es2022 */
/* Real SQLite at the native op-sqlite boundary. No application services are replaced. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function database(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'embedding-index-'));
  const connections = [];
  const sqlite = {
    open({ name }) {
      const db = new DatabaseSync(path.join(directory, name));
      connections.push(db);
      db.exec('PRAGMA max_page_count = 100');
      return {
        executeSync(sql, params = []) {
          const statement = db.prepare(sql);
          const bindings = params.map(p => p instanceof ArrayBuffer ? new Uint8Array(p) : p);
          if (statement.columns().length) {
            return { rows: statement.all(...bindings).map(row => Object.fromEntries(
              Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array
                ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value]),
            )) };
          }
          const result = statement.run(...bindings);
          return { rows: [], insertId: Number(result.lastInsertRowid), rowsAffected: result.changes };
        },
      };
    },
  };
  t.after(() => { connections.forEach(db => db.close()); rmSync(directory, { recursive: true }); });
  function reopen() {
    const cache = new Map();
    function load(filename) {
      if (cache.has(filename)) return cache.get(filename).exports;
      const module = { exports: {} };
      cache.set(filename, module);
      const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const boundaryRequire = name => {
        if (name === '@op-engineering/op-sqlite') return sqlite;
        if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
        return require(name);
      };
      vm.runInThisContext(`(function(require,module,exports,__DEV__){${source}\n})`, { filename })(boundaryRequire, module, module.exports, false);
      return module.exports;
    }
    return load(path.resolve(__dirname, '../../../src/services/rag/database.ts')).ragDatabase;
  }
  return reopen;
}

async function seed(db) {
  await db.ensureReady();
  const docId = db.insertDocument({ projectId: 'project', name: 'note.txt', path: '/note.txt', size: 12 });
  const [chunkRowid] = db.insertChunks(docId, [{ content: 'Searchable note', position: 0 }]);
  db.insertEmbeddingsBatch([{ docId, chunkRowid, embedding: [1, 0] }]);
  return { docId, chunkRowid };
}

function replace(db, model, entries) {
  db.beginEmbeddingRebuild();
  for (const entry of entries) db.stageEmbedding(entry);
  db.commitEmbeddingRebuild(model);
  db.discardEmbeddingRebuild();
}

const model = { id: 'repo@revision/encoder.gguf', name: 'Encoder', filePath: '/encoder.gguf', size: 42 };

test('switch persists the model and replacement vectors together; original documents remain', async t => {
  const reopen = database(t);
  const db = reopen();
  const entry = await seed(db);
  assert.equal(db.getEmbeddingModel(), null);
  replace(db, model, [{ ...entry, embedding: [0, 1, 0] }]);
  const restarted = reopen();
  await restarted.ensureReady();
  assert.deepEqual(restarted.getEmbeddingModel(), model);
  assert.deepEqual(restarted.getEmbeddingsByProject('project').map(row => row.embedding), [[0, 1, 0]]);
  assert.equal(restarted.getDocumentsByProject('project')[0].name, 'note.txt');
  assert.equal(restarted.getChunksByDocument(entry.docId)[0].content, 'Searchable note');
  replace(restarted, null, [{ ...entry, embedding: [1, 0] }]);
  assert.equal(restarted.getEmbeddingModel(), null);
  assert.deepEqual(restarted.getEmbeddingsByProject('project').map(row => row.embedding), [[1, 0]]);
});

test('a storage failure preserves both the prior model and searchable vectors', async t => {
  const reopen = database(t);
  const db = reopen();
  const entry = await seed(db);
  replace(db, model, [{ ...entry, embedding: [0, 1] }]);
  assert.throws(() => replace(db, { ...model, id: 'another' }, [
    { ...entry, embedding: new Array(200000).fill(1) },
  ]));
  const restarted = reopen();
  await restarted.ensureReady();
  assert.deepEqual(restarted.getEmbeddingModel(), model);
  assert.deepEqual(restarted.getEmbeddingsByProject('project').map(row => row.embedding), [[0, 1]]);
});

test('uncommitted or cancelled staging never changes the saved model or same-size vectors', async t => {
  const reopen = database(t);
  const db = reopen();
  const entry = await seed(db);
  db.beginEmbeddingRebuild();
  db.stageEmbedding({ ...entry, embedding: [0, 1] });
  const restarted = reopen();
  await restarted.ensureReady();
  assert.equal(restarted.getEmbeddingModel(), null);
  assert.deepEqual(restarted.getEmbeddingsByProject('project').map(row => row.embedding), [[1, 0]]);
  db.discardEmbeddingRebuild();
  assert.deepEqual(db.getEmbeddingsByProject('project').map(row => row.embedding), [[1, 0]]);
  replace(db, model, [{ ...entry, embedding: [0, 1] }]);
  assert.deepEqual(db.getEmbeddingsByProject('project').map(row => row.embedding), [[0, 1]]);
});
