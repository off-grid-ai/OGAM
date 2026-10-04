/**
 * The full send journey now uses the real Shared ChatSessionService in
 * firstMessage.happy.test.tsx and queuedForceImagePreservesMode.rendered.redflow.test.tsx.
 * Shared queue and cancellation contracts live in the Shared chat-session suite.
 * This file keeps the Mobile-only alert boundary.
 */
import { handleSendFn } from '../../src/screens/ChatScreen/useChatGenerationActions';

describe('send UI boundary', () => {
  it('alerts and creates no conversation when no model is active', async () => {
    const setAlertState = jest.fn();
    const createConversation = jest.fn();
    await handleSendFn({
      hasActiveModel: false,
      setAlertState,
      createConversation,
    } as any, {
      text: 'hello',
      imageMode: 'disabled',
      setDebugInfo: jest.fn(),
    });
    expect(setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No Model Selected' }),
    );
    expect(createConversation).not.toHaveBeenCalled();
  });
});
