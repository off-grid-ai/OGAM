/** P1 #113/#117/#118/#119/#170 — complete project + knowledge-base journey through the real App. */
import { Switch } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  relaunchMainApp,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { createPersistentRealSqliteBoundary } from '../../harness/sqliteFake';

const PROJECT = 'Field Research';
const FACT = 'The North Ridge beacon code is QUARTZ-731.';
const REPLACEMENT_FACT = 'The North Ridge beacon code is now AMBER-902.';
const PDF_NAME = 'ridge-notes.pdf';
const PDF_PATH = '/tmp/ridge-notes.pdf';
const QUESTION = 'What is the North Ridge beacon code?';
const ANSWER = 'The beacon code is QUARTZ-731.';
const REPLACEMENT_ANSWER = 'The current beacon code is AMBER-902.';
const TOOL_MODEL: DownloadedModel = {
  id: 'test/llama-3-tools/llama-3-tools-Q4_K_M.gguf',
  name: 'Llama 3 Tools',
  author: 'test',
  fileName: 'llama-3-tools-Q4_K_M.gguf',
  filePath: '/docs/models/llama-3-tools-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

function installPdfBoundary(text: string): void {
  const { NativeModules } = require('react-native');
  if (NativeModules.PDFExtractorModule?.extractText?.mockImplementation) {
    NativeModules.PDFExtractorModule.extractText.mockImplementation(
      async () => text,
    );
    return;
  }
  NativeModules.PDFExtractorModule = {
    extractText: jest.fn(async () => text),
  };
}

async function createProjectThroughApp(
  rtl: Awaited<ReturnType<typeof renderMainApp>>['rtl'],
  view: Awaited<ReturnType<typeof renderMainApp>>['view'],
): Promise<void> {
  rtl.fireEvent.press(view.getByTestId('projects-tab'));
  rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('New')));
  rtl.fireEvent.changeText(
    view.getByPlaceholderText('e.g., Spanish Learning, Code Review'),
    PROJECT,
  );
  rtl.fireEvent.changeText(
    view.getByPlaceholderText('Brief description of this project'),
    'Offline expedition notes',
  );
  rtl.fireEvent.changeText(
    view.getByPlaceholderText(
      'Enter the instructions or context for the AI...',
    ),
    'Answer from the expedition knowledge base.',
  );
  rtl.fireEvent.press(view.getByText('Save'));
  await rtl.waitFor(() => expect(view.getByText(PROJECT)).toBeTruthy());
}

function expandKnowledgeBaseResult(
  app: Awaited<ReturnType<typeof renderMainApp>>,
  expectedContent: RegExp,
): void {
  if (app.view.queryAllByText(expectedContent).length > 1) return;
  let node = app.view.getByTestId('tool-result-label-search_knowledge_base');
  while (node.parent && node.props.accessible !== true) {
    node = node.parent;
  }
  app.rtl.fireEvent.press(node);
}

describe('P1 full-App project knowledge-base journey', () => {
  it('retries failed PDF embedding, then deletes and replaces its index without stale retrieval', async () => {
    const sqlite = createPersistentRealSqliteBoundary();
    const first = await renderMainApp({
      boundary: {
        llama: true,
        ram: {
          platform: 'ios',
          totalBytes: 8 * 1024 ** 3,
          availBytes: 6 * 1024 ** 3,
        },
      },
      downloadedModels: [TOOL_MODEL],
      beforeRender: async ({ boundary }) => {
        sqlite.install();
        installPdfBoundary(FACT);
        boundary.fs!.seedFile(PDF_PATH, 4096);
        // The embedding model ships in the app bundle. Leave Documents empty so
        // the first KB gesture proves the real first-use install/copy path.
        boundary.fs!.seedFile(
          '/bundle/all-MiniLM-L6-v2-Q8_0.gguf',
          25 * 1024 * 1024,
        );
        const picker = require('@react-native-documents/picker');
        picker.pick.mockResolvedValue([
          {
            uri: `file://${PDF_PATH}`,
            name: PDF_NAME,
            type: 'application/pdf',
            size: 4096,
          },
        ]);

        const embeddingContext = await boundary.llama!.module.initLlama({
          embedding: true,
        });
        embeddingContext.embedding
          .mockRejectedValueOnce(new Error('OOM: embedding allocation failed'))
          .mockImplementation(async (text: string) => ({
            embedding: Array.from({ length: 384 }, (_v, i) =>
              Math.sin(i + text.length * 0.1),
            ),
          }));
      },
    });

    await createProjectThroughApp(first.rtl, first.view);
    first.rtl.fireEvent.press(first.view.getByText(PROJECT));
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('Knowledge Base')).toBeTruthy(),
    );
    first.rtl.fireEvent.press(first.view.getByText('Knowledge Base'));
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('No documents yet')).toBeTruthy(),
    );
    const embeddingDocumentPath = `${
      first.boundary.fs!.DocumentDirectoryPath
    }/all-MiniLM-L6-v2-Q8_0.gguf`;
    expect(
      await (first.boundary.fs!.module.exists as jest.Mock)(
        embeddingDocumentPath,
      ),
    ).toBe(false);

    first.rtl.fireEvent.press(first.view.getByText('Add Document'));
    await first.rtl.waitFor(
      () => {
        expect(first.view.getByTestId('kb-index-error-card')).toHaveTextContent(
          /ridge-notes\.pdf/,
        );
        expect(first.view.getByText('No documents yet')).toBeTruthy();
      },
      { timeout: 8000 },
    );

    first.rtl.fireEvent.press(first.view.getByTestId('kb-index-retry'));
    await first.rtl.waitFor(
      () => {
        expect(first.view.getByText(PDF_NAME)).toBeTruthy();
        expect(first.view.queryByTestId('kb-index-error-card')).toBeNull();
      },
      { timeout: 8000 },
    );
    expect(
      await (first.boundary.fs!.module.exists as jest.Mock)(
        embeddingDocumentPath,
      ),
    ).toBe(true);

    const { useProjectStore } = require('../../../src/stores/projectStore');
    const { ragService } = require('../../../src/services/rag');
    const projectId = useProjectStore
      .getState()
      .projects.find(
        (project: { name: string }) => project.name === PROJECT,
      ).id;
    const [indexedDocument] = await ragService.getDocumentsByProject(projectId);
    const durablePdfPath = indexedDocument.path;
    expect(durablePdfPath).toContain('/attachments/');

    // Return through real navigation, then start a new chat and select the project before first send.
    first.rtl.fireEvent.press(
      first.view
        .UNSAFE_getAllByType(Icon)
        .find(icon => icon.props.name === 'arrow-left')!,
    );
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('Knowledge Base')).toBeTruthy(),
    );
    first.rtl.fireEvent.press(
      first.view
        .UNSAFE_getAllByType(Icon)
        .find(icon => icon.props.name === 'arrow-left')!,
    );
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('projects-tab')).toBeTruthy(),
    );
    first.rtl.fireEvent.press(first.view.getByTestId('home-tab'));
    // #92: the real embed load remains visible as a reclaimable sidecar in the
    // product's In Memory surface after the KB operation completes.
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByTestId('models-summary')),
    );
    await first.rtl.waitFor(
      () => {
        expect(first.view.getByTestId('resident-item-embedding')).toBeTruthy();
        expect(
          first.view.getByTestId('resident-item-embedding-ram'),
        ).toHaveTextContent(/GB/);
      },
      { timeout: 4000 },
    );
    const doneButtons = first.view.getAllByText('Done');
    first.rtl.fireEvent.press(doneButtons[doneButtons.length - 1]);
    await first.rtl.waitFor(() =>
      expect(first.view.queryByTestId('resident-item-embedding')).toBeNull(),
    );
    await openChatWithJourneyModel(first.rtl, first.view);
    first.rtl.fireEvent.press(
      first.view.getByText('Project: Default — tap to change'),
    );
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByText(PROJECT)),
    );
    await first.rtl.waitFor(() =>
      expect(
        first.view.getByText(`Project: ${PROJECT} — tap to change`),
      ).toBeTruthy(),
    );

    first.rtl.fireEvent.press(first.view.getByTestId('quick-settings-button'));
    const tools = await first.rtl.waitFor(() =>
      first.view.getByTestId('quick-tools'),
    );
    await first.rtl.waitFor(
      () => expect(first.rtl.within(tools).queryByText('N/A')).toBeNull(),
      { timeout: 8000 },
    );
    first.rtl.fireEvent.press(tools);
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('tools-back-button')).toBeTruthy(),
    );
    const kbTool = await first.rtl.waitFor(() =>
      first.view.getByTestId('tool-picker-row-search_knowledge_base'),
    );
    first.rtl.fireEvent(
      first.rtl.within(kbTool).UNSAFE_getByType(Switch),
      'valueChange',
      true,
    );
    first.rtl.fireEvent.press(first.view.getByTestId('tools-back-button'));

    first.boundary.llama!.scriptCompletions([
      {
        toolCalls: [
          {
            name: 'search_knowledge_base',
            arguments: { query: QUESTION },
          },
        ],
      },
      { text: ANSWER },
    ]);
    sendChatMessage(first.rtl, first.view, QUESTION);
    await first.rtl.waitFor(
      () => {
        expect(
          first.view.getByTestId('tool-result-label-search_knowledge_base'),
        ).toBeTruthy();
        expect(first.view.getByText(ANSWER)).toBeTruthy();
      },
      { timeout: 10000 },
    );
    expandKnowledgeBaseResult(first, /QUARTZ-731/);
    await first.rtl.waitFor(() =>
      expect(first.view.getAllByText(/QUARTZ-731/).length).toBeGreaterThan(1),
    );

    first.rtl.fireEvent.press(
      first.view
        .UNSAFE_getAllByType(Icon)
        .find(icon => icon.props.name === 'arrow-left')!,
    );
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('home-screen')).toBeTruthy(),
    );
    first.rtl.fireEvent.press(first.view.getByTestId('projects-tab'));
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByText(PROJECT)),
    );
    await first.rtl.waitFor(() =>
      expect(first.view.getByText(PDF_NAME)).toBeTruthy(),
    );
    let documentRow = first.view.getByText(PDF_NAME);
    while (
      documentRow.parent &&
      documentRow.findAllByType(Switch).length === 0
    ) {
      documentRow = documentRow.parent;
    }
    const trash = documentRow
      .findAllByType(Icon)
      .find(icon => icon.props.name === 'trash-2');
    if (!trash) throw new Error('Knowledge-base delete control not found');
    first.rtl.fireEvent.press(trash.parent!);
    await first.rtl.waitFor(() =>
      expect(first.view.getByText('Remove Document')).toBeTruthy(),
    );
    const removeButtons = first.view.getAllByText('Remove');
    first.rtl.fireEvent.press(removeButtons[removeButtons.length - 1]);
    await first.rtl.waitFor(() => {
      expect(first.view.queryByText(PDF_NAME)).toBeNull();
      expect(first.view.getByText('No documents added')).toBeTruthy();
    });

    installPdfBoundary(REPLACEMENT_FACT);
    first.rtl.fireEvent.press(first.view.getByText('Add'));
    await first.rtl.waitFor(
      () => expect(first.view.getByText(PDF_NAME)).toBeTruthy(),
      { timeout: 8000 },
    );
    first.rtl.fireEvent.press(first.view.getByText(PDF_NAME));
    await first.rtl.waitFor(
      () => {
        expect(first.view.getByText(REPLACEMENT_FACT)).toBeTruthy();
        expect(first.view.queryByText(FACT)).toBeNull();
      },
      { timeout: 8000 },
    );
    first.rtl.fireEvent.press(
      first.view
        .UNSAFE_getAllByType(Icon)
        .find(icon => icon.props.name === 'arrow-left')!,
    );
    // APP-P2-010: multi-select two supported text formats through the real
    // picker/indexer, retain their stable names/sizes, and preview each format.
    const markdownName = 'research notes.md';
    const jsonName = 'metrics.json';
    const markdownContent = '# Field Notes\nThe north sample is stable.';
    const jsonContent = '{"sample":"north","stable":true}';
    await (first.boundary.fs!.module.writeFile as jest.Mock)(
      `/docs/${markdownName}`,
      markdownContent,
      'utf8',
    );
    await (first.boundary.fs!.module.writeFile as jest.Mock)(
      `/docs/${jsonName}`,
      jsonContent,
      'utf8',
    );
    require('@react-native-documents/picker').pick.mockResolvedValueOnce([
      {
        uri: `file:///docs/${markdownName}`,
        name: markdownName,
        type: 'text/markdown',
        size: 2048,
      },
      {
        uri: `file:///docs/${jsonName}`,
        name: jsonName,
        type: 'application/json',
        size: 32,
      },
    ]);
    first.rtl.fireEvent.press(first.view.getByText('Add'));
    await first.rtl.waitFor(
      () => {
        expect(first.view.getByText(markdownName)).toBeTruthy();
        expect(first.view.getByText(jsonName)).toBeTruthy();
        expect(first.view.getByText('2.0 KB')).toBeTruthy();
        expect(first.view.getByText('32 B')).toBeTruthy();
      },
      { timeout: 10000 },
    );
    first.rtl.fireEvent.press(first.view.getByText(markdownName));
    await first.rtl.waitFor(() => {
      expect(first.view.getByText(markdownContent)).toBeTruthy();
      expect(first.view.getByText('2.0 KB')).toBeTruthy();
    });
    first.rtl.fireEvent.press(
      first.view
        .UNSAFE_getAllByType(Icon)
        .find(icon => icon.props.name === 'arrow-left')!,
    );
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByText(jsonName)),
    );
    await first.rtl.waitFor(() => {
      expect(first.view.getByText(jsonContent)).toBeTruthy();
      expect(first.view.getByText('32 B')).toBeTruthy();
    });
    first.rtl.fireEvent.press(
      first.view
        .UNSAFE_getAllByType(Icon)
        .find(icon => icon.props.name === 'arrow-left')!,
    );

    const replacementDocument = (
      await ragService.getDocumentsByProject(projectId)
    ).find((doc: { name: string }) => doc.name === PDF_NAME)!;
    const replacementPdfPath = replacementDocument.path;

    first.rtl.fireEvent.press(
      first.view
        .UNSAFE_getAllByType(Icon)
        .find(icon => icon.props.name === 'arrow-left')!,
    );
    first.rtl.fireEvent.press(first.view.getByTestId('home-tab'));
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByTestId('new-chat-button')),
    );
    await first.rtl.waitFor(() =>
      expect(first.view.getByTestId('chat-screen')).toBeTruthy(),
    );
    first.rtl.fireEvent.press(
      first.view.getByText('Project: Default — tap to change'),
    );
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByText(PROJECT)),
    );
    first.rtl.fireEvent.press(first.view.getByTestId('quick-settings-button'));
    const replacementTools = await first.rtl.waitFor(() =>
      first.view.getByTestId('quick-tools'),
    );
    await first.rtl.waitFor(
      () =>
        expect(
          first.rtl.within(replacementTools).queryByText('N/A'),
        ).toBeNull(),
      { timeout: 8000 },
    );
    first.rtl.fireEvent.press(replacementTools);
    const replacementKbTool = await first.rtl.waitFor(() =>
      first.view.getByTestId('tool-picker-row-search_knowledge_base'),
    );
    first.rtl.fireEvent(
      first.rtl.within(replacementKbTool).UNSAFE_getByType(Switch),
      'valueChange',
      true,
    );
    first.rtl.fireEvent.press(first.view.getByTestId('tools-back-button'));
    first.boundary.llama!.scriptCompletions([
      {
        toolCalls: [
          {
            name: 'search_knowledge_base',
            arguments: { query: QUESTION },
          },
        ],
      },
      { text: REPLACEMENT_ANSWER },
    ]);
    sendChatMessage(first.rtl, first.view, QUESTION);
    await first.rtl.waitFor(
      () => expect(first.view.getByText(REPLACEMENT_ANSWER)).toBeTruthy(),
      { timeout: 10000 },
    );
    expandKnowledgeBaseResult(first, /AMBER-902/);
    await first.rtl.waitFor(() => {
      expect(first.view.getAllByText(/AMBER-902/).length).toBeGreaterThan(1);
      expect(first.view.queryByText(/QUARTZ-731/)).toBeNull();
    });

    first.view.unmount();
    const relaunched = await relaunchMainApp({
      boundary: {
        llama: true,
        ram: {
          platform: 'ios',
          totalBytes: 8 * 1024 ** 3,
          availBytes: 6 * 1024 ** 3,
        },
      },
      beforeRender: ({ boundary }) => {
        sqlite.install();
        installPdfBoundary(REPLACEMENT_FACT);
        boundary.fs!.seedFile(replacementPdfPath!, 4096);
      },
    });
    relaunched.rtl.fireEvent.press(relaunched.view.getByTestId('projects-tab'));
    await relaunched.rtl.waitFor(() =>
      expect(relaunched.view.getByText(PROJECT)).toBeTruthy(),
    );
    relaunched.rtl.fireEvent.press(relaunched.view.getByText(PROJECT));
    await relaunched.rtl.waitFor(() =>
      expect(relaunched.view.getByText(PDF_NAME)).toBeTruthy(),
    );
    relaunched.rtl.fireEvent.press(relaunched.view.getByText(PDF_NAME));
    await relaunched.rtl.waitFor(
      () => {
        expect(relaunched.view.getByText(REPLACEMENT_FACT)).toBeTruthy();
        expect(relaunched.view.queryByText(FACT)).toBeNull();
      },
      { timeout: 8000 },
    );

    relaunched.view.unmount();
    sqlite.close();
  }, 60000);
});
