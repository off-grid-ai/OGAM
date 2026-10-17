/**
 * knowledgeBaseApp — a project's Knowledge Base screen mounted on a REAL navigation stack (a project page
 * that opens it, the knowledge base, and the document preview its rows open), over the REAL document
 * engine (harness/documentEngine). Tests drive it by gestures: pick files, flip a switch, remove a row,
 * open a row, go back.
 *
 * The test file must `jest.unmock('@react-navigation/native')` (top level, hoisted) so the real
 * navigation runs.
 *
 * Device leaves only: the document picker (the OS sheet) answers with the files the test seeded on the
 * memfs disk, the OS confirmation dialog (Alert) is answered by the test, and everything under
 * harness/documentEngine.
 */
import { installNativeBoundary, requireRTL, GB, type NativeBoundary } from './nativeBoundary';
import { installDocumentEngine, type DocumentEngineBoundary, type DocumentEngineOptions } from './documentEngine';

export interface PickedFile {
  /** Where the file sits on the device (seed it first). */
  path: string;
  name: string;
  size?: number;
}

export async function openKnowledgeBase(
  options: DocumentEngineOptions & { projectName?: string; beforeMount?: (engine: DocumentEngineBoundary) => void } = {},
) {
  const boundary: NativeBoundary = installNativeBoundary({
    fs: true,
    ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 6 * GB },
  });
  const engine = installDocumentEngine(boundary.fs!, options);
  const React = require('react');
  const rtl = requireRTL();
  const RN = require('react-native');
  const picker = require('@react-native-documents/picker');
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { KnowledgeBaseScreen } = require('../../src/screens/KnowledgeBaseScreen');
  const { DocumentPreviewScreen } = require('../../src/screens/DocumentPreviewScreen');
  const { useProjectStore } = require('../../src/stores/projectStore');
  options.beforeMount?.(engine);

  // A knowledge base belongs to a project; the project is made with the store's own action.
  const project = useProjectStore.getState().createProject({
    name: options.projectName ?? 'Research',
    description: '',
    systemPrompt: '',
  });

  // The OS confirmation dialog: remember what it offered so the test can answer it like a person.
  let dialog: { title: string; message?: string; buttons: { text?: string; onPress?: () => void }[] } | null = null;
  RN.Alert.alert = (title: string, message?: string, buttons?: { text?: string; onPress?: () => void }[]) => {
    dialog = { title, message, buttons: buttons ?? [] };
  };

  const Stack = createNativeStackNavigator();
  const ProjectPage = ({ navigation }: { navigation: { navigate: (name: string, params: object) => void } }) =>
    React.createElement(
      RN.TouchableOpacity,
      { onPress: () => navigation.navigate('KnowledgeBase', { projectId: project.id }) },
      React.createElement(RN.Text, null, 'Open knowledge base'),
    );
  const view = rtl.render(
    React.createElement(
      NavigationContainer,
      null,
      React.createElement(
        Stack.Navigator,
        { screenOptions: { headerShown: false } },
        React.createElement(Stack.Screen, { name: 'ProjectDetail', component: ProjectPage }),
        React.createElement(Stack.Screen, { name: 'KnowledgeBase', component: KnowledgeBaseScreen }),
        React.createElement(Stack.Screen, { name: 'DocumentPreview', component: DocumentPreviewScreen }),
      ),
    ),
  );
  rtl.fireEvent.press(view.getByText('Open knowledge base'));
  await view.findByTestId('knowledge-base-screen');

  return {
    boundary,
    engine,
    rtl,
    view,
    project,
    /** The picker hands back these files (seeded on disk first), then the add button is tapped. */
    async addFiles(files: PickedFile[]) {
      picker.pick.mockResolvedValue(
        files.map(file => ({ uri: `file://${file.path}`, name: file.name, size: file.size ?? 0 })),
      );
      const empty = view.queryByText('Add Document');
      rtl.fireEvent.press(empty ?? view.getByLabelText('Add documents'));
      // Each file is either listed or named on the error card, and the add button works again.
      await rtl.waitFor(() =>
        expect(files.every(file => view.queryByText(file.name)) || view.queryByTestId('kb-index-error-card')).toBeTruthy(),
      );
      await rtl.waitFor(() =>
        expect(view.getByLabelText('Add documents').props.accessibilityState?.disabled).toBeFalsy(),
      );
    },
    /** The status line of a document's row ("12.0 KB · 3 pages"), found by the file it came from. */
    async statusOf(path: string) {
      return view.findByTestId(`knowledge-document-status-${await engine.documentIdOf(path)}`);
    },
    /** Answer the open OS dialog by tapping one of its buttons. */
    answerDialog(buttonText: string) {
      const open = dialog;
      if (!open) throw new Error('no dialog is open');
      dialog = null;
      const button = open.buttons.find(candidate => candidate.text === buttonText);
      if (!button) throw new Error(`the dialog "${open.title}" has no "${buttonText}" button`);
      return rtl.act(async () => {
        await button.onPress?.();
      });
    },
    dialogTitle: () => (dialog as { title: string } | null)?.title ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------
// The whole app, for knowledge-base journeys that cross into a project chat.
// ---------------------------------------------------------------------------------------------------

/** What is on the phone's disk: every file with its bytes (base64) and the size the OS reports. */
export type DiskImage = Array<{ path: string; base64: string; size: number }>;

async function readDisk(fs: import('./nativeFileSystem').NativeFileSystemBoundary): Promise<DiskImage> {
  const files: DiskImage = [];
  const walk = async (directory: string): Promise<void> => {
    if (!(await fs.module.exists(directory))) return;
    for (const entry of await fs.module.readDir(directory)) {
      if (entry.isDirectory()) await walk(entry.path);
      else files.push({ path: entry.path, base64: await fs.module.readFile(entry.path, 'base64'), size: entry.size });
    }
  };
  const roots = [fs.module.DocumentDirectoryPath, fs.module.CachesDirectoryPath, fs.module.MainBundlePath];
  for (const root of roots) await walk(root);
  return files;
}

async function writeDisk(fs: import('./nativeFileSystem').NativeFileSystemBoundary, image: DiskImage): Promise<void> {
  for (const file of image) {
    await fs.module.writeFile(file.path, file.base64, 'base64');
    fs.setReportedFileSize(file.path, file.size);
  }
}

export interface ProjectChatAppOptions extends DocumentEngineOptions {
  /**
   * A relaunch: start over the disk, the databases (sqlite.persistAt) and the saved settings an
   * earlier run left, with nothing seeded again.
   */
  relaunchFrom?: DiskImage;
}

const RENDER_WAIT = { timeout: 8000 };
/** A tool-calling family (Qwen3), so the chat offers tools from the first message, as on a phone. */
const MODEL_FILE = 'Qwen3-1.7B-Q4_K_M.gguf';

/**
 * Start the REAL App (boot, NavigationContainer, AppNavigator) on a phone with one downloaded GGUF
 * model, over the real document engine (harness/documentEngine). Every helper is a gesture.
 *
 * Device leaves only: llama.rn (the chat model and the embedding model), the PDF reader, op-sqlite (a
 * real SQLite), the in-memory disk, AsyncStorage (a first launch finds what onboarding left: the
 * downloaded model's row), the RAM sensor and the OS document picker.
 *
 * The test file must `jest.unmock('@react-navigation/native')` and mock 'react-native-bootsplash'.
 */
export async function launchProjectChatApp(options: ProjectChatAppOptions = {}) {
  const boundary: NativeBoundary = installNativeBoundary({
    llama: true,
    fs: true,
    ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 6 * GB },
  });
  const fs = boundary.fs!;
  if (options.relaunchFrom) await writeDisk(fs, options.relaunchFrom);
  const engine = installDocumentEngine(fs, { ...options, llama: boundary.llama!.module });
  const React = require('react');
  const rtl = requireRTL();
  const picker = require('@react-native-documents/picker');
  const storage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');

  if (!options.relaunchFrom) {
    await storage.clear();
    const { createDownloadedModel } = require('../utils/factories');
    const modelPath = `${fs.DocumentDirectoryPath}/models/${MODEL_FILE}`;
    fs.seedFile(modelPath, 600 * 1024 * 1024);
    const model = createDownloadedModel({
      id: 'm', name: 'Qwen3 1.7B', fileName: MODEL_FILE, filePath: modelPath, engine: 'llama',
      fileSize: 600 * 1024 * 1024,
    });
    await storage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
    await storage.setItem('local-llm-app-storage', JSON.stringify({
      state: { hasCompletedOnboarding: true, checklistDismissed: true, settings: { autoDiscoverRemoteModels: false } },
      version: 0,
    }));
  }

  const App = require('../../App').default;
  const view = rtl.render(React.createElement(App));
  await view.findByTestId('home-screen', {}, RENDER_WAIT);
  const { fireEvent, waitFor } = rtl;

  return {
    boundary,
    engine,
    rtl,
    view,

    /** Home: open the model picker and tap the downloaded model. */
    async chooseModel() {
      fireEvent.press(view.getByTestId('home-tab'));
      fireEvent.press(await waitFor(() => view.getByTestId('browse-models-button'), RENDER_WAIT));
      fireEvent.press(await view.findByTestId('text-model-row-m', {}, RENDER_WAIT));
      await waitFor(() => expect(view.queryByTestId('text-model-row-m')).toBeNull(), RENDER_WAIT);
    },

    /** Projects tab → New → name and instructions → Save, then open the new project. */
    async createProject(name: string) {
      fireEvent.press(view.getByTestId('projects-tab'));
      fireEvent.press(await waitFor(
        () => view.queryByTestId('new-project-empty-button') ?? view.getByTestId('new-project-button'),
        RENDER_WAIT,
      ));
      fireEvent.changeText(await view.findByTestId('project-edit-name', {}, RENDER_WAIT), name);
      fireEvent.changeText(view.getByTestId('project-edit-system-prompt'), 'Answer from the project documents.');
      fireEvent.press(view.getByTestId('project-edit-save'));
      await this.openProject(name);
    },

    /** Projects tab → the project's row. */
    async openProject(name: string) {
      fireEvent.press(view.getByTestId('projects-tab'));
      fireEvent.press(await waitFor(() => view.getByText(name), RENDER_WAIT));
      await view.findByTestId('project-detail-screen', {}, RENDER_WAIT);
    },

    /**
     * From the project page: open its knowledge base, pick these files (seeded on the disk first), wait
     * until each one has been read to the end ("<size> · <n> pages"), then go back to the project.
     */
    async addKnowledge(files: Array<PickedFile & { pages: number }>) {
      fireEvent.press(view.getByTestId('project-knowledge-base-open'));
      await view.findByTestId('knowledge-base-screen', {}, RENDER_WAIT);
      picker.pick.mockResolvedValue(
        files.map(file => ({ uri: `file://${file.path}`, name: file.name, size: file.size ?? 0 })),
      );
      fireEvent.press(view.queryByText('Add Document') ?? view.getByLabelText('Add documents'));
      for (const file of files) {
        const status = await view.findByTestId(
          `knowledge-document-status-${await engine.documentIdOf(file.path)}`, {}, RENDER_WAIT,
        );
        const pages = file.pages === 1 ? '1 page' : `${file.pages} pages`;
        await waitFor(() => expect(status.props.children).toMatch(new RegExp(`· ${pages}$`)), RENDER_WAIT);
      }
      expect(view.queryByTestId('kb-index-error-card')).toBeNull();
      fireEvent.press(view.getByTestId('knowledge-base-back'));
      await view.findByTestId('project-detail-screen', {}, RENDER_WAIT);
    },

    /** The project page's New chat button. */
    async newProjectChat() {
      fireEvent.press(await waitFor(
        () => view.queryByTestId('project-start-chat') ?? view.getByTestId('project-new-chat'),
        RENDER_WAIT,
      ));
      await view.findByTestId('chat-input', {}, RENDER_WAIT);
    },

    /**
     * Type and send a message, the model answering with `turns` (one llama.rn completion each: a tool
     * call, then the answer). Resolves once `answer` shows and the reply has finished.
     */
    async ask(question: string, answer: string | RegExp, turns: import('./nativeBoundary').LlamaCompletionScript[]) {
      boundary.llama!.scriptCompletions(turns);
      fireEvent.changeText(view.getByTestId('chat-input'), question);
      fireEvent.press(await waitFor(() => view.getByTestId('send-button'), RENDER_WAIT));
      await waitFor(() => expect(view.getAllByText(answer).length).toBeGreaterThan(0), RENDER_WAIT);
      await waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull(), RENDER_WAIT);
    },

    /** The prompts llama.rn's chat completions were given, newest last (the native boundary's record). */
    prompts(): string[] {
      return boundary.llama!.calls.completion.map(([params]) => JSON.stringify(params));
    },

    /** Quit the app: unmount it and stop anything still generating. Returns the disk it leaves. */
    async close(): Promise<DiskImage> {
      view.unmount();
      await require('../../src/services/generationService').generationService.stopGeneration();
      return readDisk(fs);
    },
  };
}
