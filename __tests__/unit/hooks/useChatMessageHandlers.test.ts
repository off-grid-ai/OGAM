/**
 * Unit tests for useChatMessageHandlers — the resend/retry + edit-and-resend
 * handlers.
 *
 * Regression: ejecting all models then tapping Resend/Retry used to silently
 * no-op (no message, no feedback). Now it alerts "No Model Selected", mirroring
 * the send path (handleSendFn). See handleRetryMessageFn / handleEditMessageFn.
 */

import { handleRetryMessageFn, handleEditMessageFn } from '../../../src/screens/ChatScreen/useChatMessageHandlers';
import * as generationActions from '../../../src/screens/ChatScreen/useChatGenerationActions';
import { createMessage } from '../../utils/factories';

// Light mocks — the no-model path bails before any of these are touched, but
// they still need to exist so the module imports cleanly.
jest.mock('../../../src/services/modelResidency', () => ({
  modelResidencyManager: { getResidents: jest.fn(() => []), reclaimSttForGeneration: jest.fn() },
}));
jest.mock('../../../src/services/hardware', () => ({
  hardwareService: { getAvailableMemoryGB: jest.fn(() => 4), getTotalMemoryGB: jest.fn(() => 8) },
}));

const makeDeps = (overrides: Partial<any> = {}): any => ({
  setAlertState: jest.fn(),
  ...overrides,
});

describe('handleRetryMessageFn — no active model', () => {
  let regenSpy: jest.SpyInstance;

  beforeEach(() => {
    regenSpy = jest.spyOn(generationActions, 'regenerateResponseFn').mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('alerts "No Model Selected" and does not regenerate when no model is loaded', async () => {
    const genDeps = makeDeps();
    const message = createMessage({ role: 'user', content: 'hi' });

    await handleRetryMessageFn(message, genDeps, {
      activeConversationId: 'conv-1',
      hasActiveModel: false,
      activeConversation: { messages: [message] },
      deleteMessagesAfter: jest.fn(),
      setDebugInfo: jest.fn(),
    });

    expect(genDeps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ visible: true, title: 'No Model Selected' }),
    );
    expect(regenSpy).not.toHaveBeenCalled();
  });

  it('does NOT alert and bails quietly when a model exists but there is no conversation', async () => {
    const genDeps = makeDeps();
    const message = createMessage({ role: 'user', content: 'hi' });

    await handleRetryMessageFn(message, genDeps, {
      activeConversationId: null,
      hasActiveModel: true,
      activeConversation: null,
      deleteMessagesAfter: jest.fn(),
      setDebugInfo: jest.fn(),
    });

    expect(genDeps.setAlertState).not.toHaveBeenCalled();
    expect(regenSpy).not.toHaveBeenCalled();
  });
});

describe('handleEditMessageFn — no active model', () => {
  let regenSpy: jest.SpyInstance;

  beforeEach(() => {
    regenSpy = jest.spyOn(generationActions, 'regenerateResponseFn').mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('alerts "No Model Selected" and does not regenerate when no model is loaded', async () => {
    const genDeps = makeDeps();
    const message = createMessage({ role: 'user', content: 'original' });

    await handleEditMessageFn(genDeps, {
      message,
      newContent: 'edited',
      activeConversationId: 'conv-1',
      hasActiveModel: false,
      updateMessageContent: jest.fn(),
      deleteMessagesAfter: jest.fn(),
      setDebugInfo: jest.fn(),
    });

    expect(genDeps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ visible: true, title: 'No Model Selected' }),
    );
    expect(regenSpy).not.toHaveBeenCalled();
  });
});
