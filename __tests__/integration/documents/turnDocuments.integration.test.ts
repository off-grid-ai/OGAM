/**
 * What a chat turn reads from its documents on the phone: the document attached to a message, the
 * project's knowledge base, and the passages a knowledge-base search adds during the turn.
 *
 * Everything we own runs: documentService keeps the file, the shared ingest service reads it page by page
 * (services/documents/extract → the native PDF reader) and indexes it into documents.db (FTS5 + vectors),
 * the knowledge base keeps project membership in rag.db, prepareTurnDocuments builds the turn, and
 * search_knowledge_base runs through the real tool handler and citation registry. The device leaves are
 * faked at the native line only (harness/documentEngine): SQLite is a real in-memory engine, the
 * filesystem is memfs, the PDF reader reads the file at the path it is given, the MiniLM model answers
 * through llama.rn's embedding context.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { installDocumentEngine, type DocumentEngineOptions } from '../../harness/documentEngine';

type ChatTurn = typeof import('../../../src/services/documents/chatTurn');

function setup(options: DocumentEngineOptions = {}) {
  const boundary = installNativeBoundary({
    fs: true,
    ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 6 * GB },
  });
  const engine = installDocumentEngine(boundary.fs!, options);
  const { documentService } = require('../../../src/services/documentService');
  const { knowledgeBase } = require('../../../src/services/rag');
  const { prepareTurnDocuments, turnSources } = require('../../../src/services/documents/chatTurn') as ChatTurn;
  const { executeToolCall } = require('../../../src/services/tools/handlers');
  const { useChatStore } = require('../../../src/stores/chatStore');
  const { parseSearchBlock } = require('@offgrid/rag/documents');
  return {
    boundary,
    engine,
    documentService,
    knowledgeBase,
    prepareTurnDocuments,
    turnSources,
    executeToolCall,
    useChatStore,
    parseSearchBlock,
  };
}

const turnFor = (h: ReturnType<typeof setup>, input: Partial<Parameters<ChatTurn['prepareTurnDocuments']>[0]>) =>
  h.prepareTurnDocuments({
    conversationId: 'chat-1',
    question: 'What is the capital of Zenland?',
    systemPrompt: 'You are a helpful assistant.',
    contextLength: 4096,
    isRemote: false,
    ...input,
  });

/** A long atlas: the capital is on one paragraph among many, so a small window gets excerpts, not the whole. */
const ATLAS = [
  'Zenland is a small island nation. The capital of Zenland is Quixotic City, on the northern shore.',
  ...Array.from(
    { length: 14 },
    (_, i) =>
      `Chapter ${i + 1} describes farming terraces, river ferries and the winter market of region ${i + 1}. ${'Orchards of plum and pear line the valley roads, and the harvest festival lasts nine days. '.repeat(5)}`,
  ),
].join('\n\n');

describe('a document attached to a message', () => {
  it('is read in the background and its text reaches the turn, cited by page', async () => {
    const h = setup();
    h.engine.seedPdf('/docs/Downloads/zenland.pdf', [
      'Zenland: an introduction. Geography and climate.',
      'The capital of Zenland is Quixotic City.',
      'Bananas grow in the southern valleys.',
    ]);

    const attachment = await h.documentService.attachDocument('/docs/Downloads/zenland.pdf', 'zenland.pdf');
    const turn = await turnFor(h, { attachments: [attachment] });

    // The model is given the page that answers, and the answer can cite it as that page of that file.
    expect(`${turn?.stable}\n${turn?.turn}`).toContain('The capital of Zenland is Quixotic City.');
    expect(turn?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentId: attachment.documentId, name: 'zenland.pdf', page: 2 }),
      ]),
    );
    // The question itself is not stuffed with the file: documents ride beside it, never in history.
    expect(turn?.stable).not.toContain('What is the capital of Zenland?');
  });

  it('gives the turn nothing when no document is in scope', async () => {
    const h = setup();

    // No attachment, no saved chat, no project: there is nothing to read, so no document block at all.
    await expect(turnFor(h, {})).resolves.toBeNull();
  });
});

describe('a project knowledge base', () => {
  it('reaches every turn of a chat in that project, and a file switched off does not', async () => {
    const h = setup();
    h.engine.seedPdf('/docs/Downloads/handbook.pdf', ['Expense claims are filed within 30 days of travel.']);
    const docId = await h.knowledgeBase.addFile({
      projectId: 'project-travel',
      filePath: '/docs/Downloads/handbook.pdf',
      fileName: 'handbook.pdf',
      fileSize: 120,
    });

    const before = await turnFor(h, { projectId: 'project-travel', question: 'When must expense claims be filed?' });
    expect(before?.stable).toContain('Expense claims are filed within 30 days of travel.');
    expect(before?.sources.map(source => source.name)).toEqual(['handbook.pdf']);

    await h.knowledgeBase.toggleDocument(docId, false);

    // Switched off in the knowledge base: the turn no longer reads it, and has nothing else to read.
    const after = await turnFor(h, { projectId: 'project-travel', question: 'When must expense claims be filed?' });
    expect(after).toBeNull();
  });

  it('is read for a saved chat filed under the project, without the turn naming the project', async () => {
    const h = setup();
    h.engine.seedText('/docs/Downloads/menu.txt', 'The canteen serves dal makhani every Friday.');
    await h.knowledgeBase.addFile({
      projectId: 'project-office',
      filePath: '/docs/Downloads/menu.txt',
      fileName: 'menu.txt',
      fileSize: 44,
    });
    const conversationId = h.useChatStore.getState().createConversation('model-1', 'Lunch', 'project-office');

    const turn = await turnFor(h, { conversationId, question: 'What is served on Friday?' });

    expect(turn?.stable).toContain('dal makhani every Friday');
  });

  it('is left to the knowledge-base search when the model can search it, and still searchable', async () => {
    const h = setup();
    h.engine.seedText('/docs/Downloads/menu.txt', 'The canteen serves dal makhani every Friday.');
    await h.knowledgeBase.addFile({
      projectId: 'project-office',
      filePath: '/docs/Downloads/menu.txt',
      fileName: 'menu.txt',
      fileSize: 44,
    });
    const conversationId = h.useChatStore.getState().createConversation('model-1', 'Lunch', 'project-office');

    // A question that does not need the documents does not wait on them.
    const turn = await turnFor(h, { conversationId, question: 'Tell me a joke.', knowledgeSearch: true });
    expect(turn).toBeNull();

    // The model searches when it needs to, and finds the document.
    const found = await h.executeToolCall({
      id: 'call-kb',
      name: 'search_knowledge_base',
      arguments: { query: 'What is served on Friday?' },
      context: { conversationId, projectId: 'project-office' },
    });
    expect(found.error).toBeUndefined();
    expect(found.content).toContain('dal makhani every Friday');
  });
});

describe('a knowledge-base search during the turn', () => {
  it('keeps the [S#] of a passage the turn already gave, and numbers a new passage after the turn\'s own', async () => {
    const h = setup();
    // The chat: a message carrying a long atlas (read as excerpts in a small window).
    h.engine.seedText('/docs/Downloads/atlas.txt', ATLAS);
    const atlas = await h.documentService.attachDocument('/docs/Downloads/atlas.txt', 'atlas.txt');
    const conversationId = h.useChatStore.getState().createConversation('model-1', 'Zenland');
    h.useChatStore.getState().addMessage(conversationId, {
      role: 'user',
      content: 'Here is the atlas.',
      attachments: [atlas],
    });
    // The project's knowledge base holds a second file the turn itself does not read.
    h.engine.seedText('/docs/Downloads/lakes.txt', 'Lake Mirror lies two hours east of the capital of Zenland.');
    await h.knowledgeBase.addFile({
      projectId: 'project-geo',
      filePath: '/docs/Downloads/lakes.txt',
      fileName: 'lakes.txt',
      fileSize: 58,
    });

    const turn = await turnFor(h, { conversationId, contextLength: 2048 });
    const capital = turn!.sources.find(source => source.snippet.includes('Quixotic City'));
    expect(capital).toBeDefined();
    const turnCount = turn!.sources.length;

    const result = await h.executeToolCall({
      id: 'call-1',
      name: 'search_knowledge_base',
      arguments: { query: 'capital of Zenland' },
      context: { conversationId, projectId: 'project-geo' },
    });
    expect(result.error).toBeUndefined();
    const passages = h.parseSearchBlock(result.content) as { id: string; document: string; text: string }[];

    // The atlas passage the turn already numbered comes back under the SAME tag, so both citations open
    // the same page.
    const again = passages.find(passage => passage.text.includes('Quixotic City'));
    expect(again?.id).toBe(capital!.id);
    // The knowledge-base passage is new to this turn: it is numbered after the turn's own sources.
    const lake = passages.find(passage => passage.document === 'lakes.txt');
    expect(Number(lake?.id.slice(1))).toBeGreaterThan(turnCount);
    // And it joins the turn's sources, so an answer citing it links to its page.
    expect(h.turnSources(conversationId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: lake!.id, name: 'lakes.txt' })]),
    );
    // One numbering for the whole turn: no tag is handed out twice and none is skipped.
    const ids = h.turnSources(conversationId).map(source => source.id);
    expect(ids).toEqual(ids.map((_, i) => `S${i + 1}`));
  });

  it('still finds passages on a SQLite build without FTS5, by meaning alone', async () => {
    const h = setup({ withoutFts5: true });
    h.engine.seedText('/docs/Downloads/lakes.txt', 'Lake Mirror lies two hours east of the capital of Zenland.');
    await h.knowledgeBase.addFile({
      projectId: 'project-geo',
      filePath: '/docs/Downloads/lakes.txt',
      fileName: 'lakes.txt',
      fileSize: 58,
    });
    // Reading finishes (and its vectors are written) before the model searches.
    await h.engine.indexed(await h.engine.documentIdOf('/docs/Downloads/lakes.txt'));

    const result = await h.executeToolCall({
      id: 'call-1',
      name: 'search_knowledge_base',
      arguments: { query: 'Where is Lake Mirror?' },
      context: { projectId: 'project-geo' },
    });

    // No keyword index on this build, yet the vector ranking still hands the model the passage.
    expect(result.content).toContain('Lake Mirror lies two hours east');
    expect(h.parseSearchBlock(result.content)).toHaveLength(1);
  });
});
