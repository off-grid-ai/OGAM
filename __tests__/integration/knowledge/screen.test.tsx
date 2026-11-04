/**
 * The whole path through the real Knowledge screen: add a PDF, study it, read the cited provisional finding in the library, approve
 * it, export, and ask chat a question that gets routed to the expert. Fakes only the device boundary.
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: {} }),
}));

beforeEach(() => jest.resetModules());

const sentence = (n: number) => `The ledger concept ${n} is explained here with a worked example and a short definition.`;
const pages = Array.from({ length: 8 }, (_, p) => `${p === 0 ? 'Chapter 1 Accounting Basics\n\n' : ''}${Array.from({ length: 12 }, (_, i) => sentence(p * 12 + i)).join(' ')}`);

it('adds a PDF, studies it into a cited provisional finding, lets the person approve it, exports it, and routes a chat question to the expert', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const rtl = requireRTL();
  const React = require('react');
  const { NativeModules } = require('react-native');
  NativeModules.PDFExtractorModule = { pageCount: async () => pages.length, extractPages: async (_p: string, s: number, c: number) => pages.slice(s, s + c) };
  boundary.fs!.seedFile('/picked/book.pdf', 3 * 1024 * 1024);
  const picker = require('@react-native-documents/picker');
  (picker.pick as jest.Mock).mockResolvedValue([{ uri: 'file:///picked/book.pdf', name: 'Accounting Textbook.pdf' }]);

  const { useAppStore } = require('../../../src/stores');
  const { hardwareService } = require('../../../src/services/hardware');
  useAppStore.getState().updateSettings({ inferenceBackend: 'cpu' });
  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf', fileSize: 500 * 1024 * 1024 })], activeModelId: 'llm' });
  const { initLlama } = require('llama.rn');
  const real = (initLlama as jest.Mock).getMockImplementation()!;
  (initLlama as jest.Mock).mockImplementation(async (params: Record<string, unknown>, cb?: (p: number) => void) => {
    const context: any = await real(params, cb);
    if (!context.__reader) {
      const original = context.completion;
      context.completion = async (p: any, tokenCb: any) => {
        const user: string = p.messages.find((m: any) => m.role === 'user')?.content ?? '';
        const first = ((user.match(/"""\n([\s\S]*?)\n"""/) ?? [])[1] ?? '').match(/The ledger concept \d+ is[^.]*\./)?.[0];
        boundary.llama!.scriptCompletion({ text: first ? JSON.stringify([{ question: 'What is said about the ledger?', finding: first, quote: first.slice(0, 50), uncertainty: '', confidence: 0.8, basis: 'observed' }]) : '[]' });
        return original.call(context, p, tokenCb);
      };
      context.__reader = true;
    }
    return context;
  });

  const { KnowledgeScreen } = require('../../../src/knowledge/KnowledgeScreen');
  const view = rtl.render(React.createElement(KnowledgeScreen));

  // Documents: add the PDF, study it.
  rtl.fireEvent.press(view.getByTestId('knowledge-tab-documents'));
  rtl.fireEvent.press(view.getByTestId('knowledge-add-pdf'));
  const study = await rtl.waitFor(() => view.getByText('Study'), { timeout: 5000 });
  expect(view.getByText(/Accounting Textbook/)).toBeTruthy();
  rtl.fireEvent.press(study);
  await rtl.waitFor(() => expect(view.queryByText(/sections studied/)).not.toBeNull(), { timeout: 20000 });
  await rtl.waitFor(() => expect(view.queryByText(/^done/)).not.toBeNull(), { timeout: 20000 });

  // The completion report is on the Now tab.
  rtl.fireEvent.press(view.getByTestId('knowledge-tab-now'));
  const report = await rtl.waitFor(() => view.getByTestId('knowledge-last-report'));
  expect(rtl.within(report).queryByText(/Studied "Accounting Textbook"/)).toBeTruthy();

  // Experts: the accounting expert exists and holds the knowledge.
  rtl.fireEvent.press(view.getByTestId('knowledge-tab-experts'));
  await rtl.waitFor(() => expect(view.getByTestId('expert-accounting-expert')).toBeTruthy());

  // Library: a provisional finding with its page citation; approving it makes it reviewed.
  rtl.fireEvent.press(view.getByTestId('knowledge-tab-library'));
  await rtl.waitFor(() => expect(view.queryAllByText(/Provisional, not reviewed/).length).toBeGreaterThan(0));
  expect(view.queryAllByText(/Accounting Textbook, page \d/).length).toBeGreaterThan(0);
  const before = view.queryAllByText('Approve').length;
  rtl.fireEvent.press(view.getAllByText('Approve')[0]);
  await rtl.waitFor(() => expect(view.queryAllByText('Reviewed').length).toBe(1));
  expect(view.queryAllByText('Approve').length).toBe(before - 1);

  // Transfer: exporting asks where to save (nothing leaves until then).
  rtl.fireEvent.press(view.getByTestId('knowledge-tab-transfer'));
  rtl.fireEvent.press(view.getByTestId('knowledge-export-all'));
  await rtl.waitFor(() => expect(picker.saveDocuments).toHaveBeenCalled());
  expect((picker.saveDocuments as jest.Mock).mock.calls[0][0]).toMatchObject({ mimeType: 'application/zip', fileName: expect.stringMatching(/^atlas-learning-export-.*\.zip$/) });
  await rtl.waitFor(() => expect(rtl.within(view.getByTestId('knowledge-notice')).queryByText(/findings/)).toBeTruthy());

  // Chat: a question about the book's subject gets the expert's cited knowledge; an unrelated one gets nothing.
  const { expertKnowledgeNote } = require('../../../src/knowledge/chatHook');
  const note = await expertKnowledgeNote('Can you explain the ledger concept from the accounting book?');
  expect(note).toMatch(/accounting expert/);
  expect(note).toMatch(/Accounting Textbook, page \d/);
  expect(note).toMatch(/\(reviewed\)|\(provisional, not yet reviewed\)/);
  expect(await expertKnowledgeNote('What is the weather like on Mars this week?')).toBe('');
}, 90000);
