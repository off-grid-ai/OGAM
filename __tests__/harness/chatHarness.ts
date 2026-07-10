/**
 * chatHarness — heavy-entry-point setup for UI-level chat integration tests.
 *
 * Mounts the REAL ChatScreen and drives it via REAL user actions (type into the real input, press the real
 * send button), with ONLY the native leaves faked (via nativeBoundary). Everything we own — the screen,
 * useChatScreen, generationService, the tool loop, the engine services, the stores, residency — runs for
 * real. This is the "integration test, heavy entry point" contract.
 *
 * Usage (the jest.mock for navigation MUST be top-level in the test file — it is hoisted — and points its
 * route at this module's shared `routeHolder`):
 *
 *   jest.mock('@react-navigation/native', () => ({
 *     useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
 *     useRoute: () => require('../../harness/chatHarness').routeHolder,
 *     useFocusEffect: () => {}, useIsFocused: () => true,
 *   }));
 *
 *   const h = await setupChatScreen({ engine: 'llama' });   // installs boundary + loads a real engine
 *   h.render();                                             // mounts the real ChatScreen
 *   await h.send('what is the capital of France', { text: 'Paris.' });  // types, presses send, awaits reply
 *   expect(h.view.queryByText(/Paris\./)).not.toBeNull();
 */
import { installNativeBoundary, requireRTL, GB, type RamProfile } from './nativeBoundary';
import { createDownloadedModel } from '../utils/factories';

/** Shared route params the test's navigation mock reads (set by setupChatScreen). */
export const routeHolder: { params: Record<string, unknown> } = { params: {} };

export interface ChatHarnessOptions {
  engine: 'llama' | 'litert';
  /** 'ios' surfaces the Metal accelerator path for llama; default 'android'. */
  platform?: 'ios' | 'android';
  ram?: RamProfile;
}

const LLAMA_PATH = '/models/small.gguf';
const LITERT_PATH = '/models/gemma.litertlm';

export async function setupChatScreen(opts: ChatHarnessOptions) {
  const platform = opts.platform ?? 'android';
  const ram = opts.ram ?? { platform, totalBytes: 12 * GB, availBytes: 8 * GB };
  const boundary = installNativeBoundary({ llama: opts.engine === 'llama', fs: true, ram });

  // Global boundary polyfill: React 19's error reporter calls window.dispatchEvent; in the node test
  // env there is no window, so an unrelated crash would mask real errors. This is a jsdom/global shim,
  // NOT app logic.
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  if (!g.window) g.window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };

  /* eslint-disable @typescript-eslint/no-var-requires */
  const React = require('react');
  const rtl = requireRTL();
  const { hardwareService } = require('../../src/services/hardware');
  const { useAppStore, useChatStore } = require('../../src/stores');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const modelPath = opts.engine === 'llama' ? LLAMA_PATH : LITERT_PATH;

  // Load the REAL engine over the faked native leaf so the readiness gate (engines.isModelReady) passes.
  if (opts.engine === 'llama') {
    boundary.fs!.seedFile(modelPath, 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();
    const { llmService } = require('../../src/services/llm');
    await llmService.loadModel(modelPath);
  } else {
    const { liteRTService } = require('../../src/services/litert');
    await liteRTService.loadModel(modelPath, 'gpu', { maxNumTokens: 4096 });
  }

  // The active model's filePath MUST equal the loaded path — llama readiness compares them.
  useAppStore.setState({
    downloadedModels: [createDownloadedModel({ id: 'm', engine: opts.engine, filePath: modelPath })],
    activeModelId: 'm',
  });

  const conversationId = useChatStore.getState().createConversation('m');
  useChatStore.getState().setActiveConversation(conversationId);
  routeHolder.params = { conversationId };

  const harness = {
    boundary, React, rtl, useAppStore, useChatStore, conversationId,
    view: null as ReturnType<typeof rtl.render> | null,

    /**
     * Arrive-via-UI: enable a built-in tool the way the user does — navigate to the Tools tab (a real
     * separate screen) and flip its switch. Shares the same store as ChatScreen, so the enablement is
     * live when we return to chat. NOT settings.updateSettings seeding.
     */
    enableToolViaUI(toolId: string) {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const { ToolsScreen } = require('../../src/screens/ToolsScreen');
      const { Switch } = require('react-native');
      /* eslint-enable @typescript-eslint/no-var-requires */
      const tools = rtl.render(React.createElement(ToolsScreen, {}));
      const row = tools.getByTestId(`tool-picker-row-${toolId}`);
      // The RN Switch toggles via onValueChange (not press) — locate it in the row and flip it.
      rtl.fireEvent(rtl.within(row).UNSAFE_getByType(Switch), 'valueChange', true);
      tools.unmount();
    },

    /** Mount the real ChatScreen. */
    render() {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ChatScreen } = require('../../src/screens/ChatScreen');
      this.view = rtl.render(React.createElement(ChatScreen, {}));
      return this.view;
    },

    /**
     * Script the next engine turn, then drive the real user send: type into the real input, press the real
     * send button, and await the assistant reply rendering. `scripted` is what the (faked) native engine
     * returns — the real generation pipeline turns it into the rendered bubble.
     */
    async send(text: string, scripted: { text?: string; content?: string; reasoning?: string; toolCalls?: unknown[] }) {
      if (opts.engine === 'llama') boundary.llama!.scriptCompletion(scripted as { text?: string });
      else boundary.litert.scriptTurn(scripted as { content?: string; toolCalls?: { name: string; arguments: Record<string, unknown> }[] });

      const view = this.view!;
      const input = await rtl.waitFor(() => view.getByTestId('chat-input'));
      rtl.fireEvent.changeText(input, text);
      rtl.fireEvent.press(view.getByTestId('send-button'));
    },

    /**
     * Open the REAL action menu for the last message of `role`, via the requested affordance:
     *  - 'longpress' → long-press the message bubble
     *  - 'dots'      → tap the 3-dots '•••' button in the message meta row
     * BOTH are real user entry points and must both be exercised (they wire the same setShowActionMenu).
     */
    async openActionMenu(role: 'user' | 'assistant', via: 'longpress' | 'dots') {
      const view = this.view!;
      const testId = role === 'user' ? 'user-message' : 'assistant-message';
      const bubbles = await rtl.waitFor(() => { const b = view.queryAllByTestId(testId); expect(b.length).toBeGreaterThan(0); return b; });
      const target = bubbles[bubbles.length - 1];
      if (via === 'longpress') {
        rtl.fireEvent(target, 'longPress');
      } else {
        // The 3-dots '•••' lives inside THIS message's element — scope to it (not the global-last dots,
        // which would be a different message's button).
        const dots = await rtl.waitFor(() => rtl.within(target).getByText('•••'));
        rtl.fireEvent.press(dots);
      }
      await rtl.waitFor(() => { expect(view.getByTestId('action-menu')).toBeTruthy(); });
    },

    /**
     * REAL regenerate gesture: open the action menu (via long-press OR 3-dots) and press "Retry".
     */
    async regenerateLast(scripted: { text?: string; content?: string; reasoning?: string; toolCalls?: unknown[] }, via: 'longpress' | 'dots' = 'longpress') {
      if (opts.engine === 'llama') boundary.llama!.scriptCompletion(scripted as { text?: string });
      else boundary.litert.scriptTurn(scripted as { content?: string });
      await this.openActionMenu('assistant', via);
      rtl.fireEvent.press(this.view!.getByTestId('action-retry'));
    },

    /**
     * REAL edit gesture: open the action menu (via long-press OR 3-dots) → "Edit" → change text →
     * "SAVE & RESEND". The real edit handler rewrites history and re-runs generation.
     */
    async editLastUserMessage(newText: string, scripted: { text?: string; content?: string }, via: 'longpress' | 'dots' = 'longpress') {
      if (opts.engine === 'llama') boundary.llama!.scriptCompletion(scripted as { text?: string });
      else boundary.litert.scriptTurn(scripted as { content?: string });
      await this.openActionMenu('user', via);
      const view = this.view!;
      rtl.fireEvent.press(view.getByTestId('action-edit'));
      const input = await rtl.waitFor(() => view.getByPlaceholderText('Enter message...'));
      rtl.fireEvent.changeText(input, newText);
      rtl.fireEvent.press(view.getByText('SAVE & RESEND'));
    },
  };
  return harness;
}
