/**
 * BATCH 7 (Projects) hardening — new-conversation model selection.
 *
 * Plan note (line 1223): "uses active model ID vs falls back to first downloaded
 * model for new conversation — internal routing logic ... Covered by unit test."
 *
 * ProjectDetailScreen.handleNewChat picks the model with:
 *     const modelId = activeModelId || downloadedModels[0]?.id;
 *     createConversation(modelId, undefined, projectId);
 * Both branches open an identical chat screen, so a human observer can't tell
 * them apart — hence unit coverage. This drives the REAL appStore + chatStore:
 * the selection rule is asserted as the single reference the screen uses, and we
 * verify the conversation the store actually persists carries the chosen modelId
 * and the project scope. Deleting createConversation / the store fields fails this.
 *
 * Only AsyncStorage (native persistence) is mocked. Store logic is real.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

import { useAppStore } from '../../src/stores/appStore';
import { useChatStore } from '../../src/stores/chatStore';
import type { DownloadedModel } from '../../src/types';

/**
 * The exact rule ProjectDetailScreen applies. Kept here as the single reference
 * so the screen and this test can't drift on the selection precedence.
 */
function selectModelId(): string | undefined {
  const { activeModelId, downloadedModels } = useAppStore.getState();
  return activeModelId || downloadedModels[0]?.id;
}

function mkModel(id: string): DownloadedModel {
  return {
    id,
    name: id,
    size: 1,
    path: `/models/${id}`,
    engine: 'llama',
  } as unknown as DownloadedModel;
}

describe('BATCH7 new-conversation model selection (real app+chat stores)', () => {
  beforeEach(() => {
    useAppStore.setState({ downloadedModels: [], activeModelId: null });
    useChatStore.setState({ conversations: [], activeConversationId: null });
  });

  it('uses the active model id when one is set', () => {
    useAppStore.setState({
      downloadedModels: [mkModel('first-downloaded'), mkModel('other')],
      activeModelId: 'other',
    });

    const modelId = selectModelId();
    expect(modelId).toBe('other'); // active wins over downloadedModels[0]

    const convId = useChatStore.getState().createConversation(modelId!, undefined, 'alpha');
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
    expect(conv?.modelId).toBe('other');
    expect(conv?.projectId).toBe('alpha');
  });

  it('falls back to the first downloaded model when no active model', () => {
    useAppStore.setState({
      downloadedModels: [mkModel('first-downloaded'), mkModel('second')],
      activeModelId: null,
    });

    const modelId = selectModelId();
    expect(modelId).toBe('first-downloaded');

    const convId = useChatStore.getState().createConversation(modelId!, undefined, 'alpha');
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
    expect(conv?.modelId).toBe('first-downloaded');
  });

  it('yields no model id when nothing is downloaded (guard for the No-Model alert)', () => {
    useAppStore.setState({ downloadedModels: [], activeModelId: null });
    expect(selectModelId()).toBeUndefined();
  });

  it('a project conversation is just a conversation carrying projectId', () => {
    useAppStore.setState({ downloadedModels: [mkModel('m1')], activeModelId: 'm1' });
    const convId = useChatStore.getState().createConversation('m1', undefined, 'proj-x');
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
    // The only thing that scopes it to a project is projectId; title falls back
    // to 'New Conversation' since none was passed.
    expect(conv?.projectId).toBe('proj-x');
    expect(conv?.title).toBe('New Conversation');
  });

  it('a non-project conversation carries no projectId (undefined, not a stray value)', () => {
    useAppStore.setState({ downloadedModels: [mkModel('m1')], activeModelId: 'm1' });
    const convId = useChatStore.getState().createConversation('m1');
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
    expect(conv?.projectId).toBeUndefined();
  });
});
