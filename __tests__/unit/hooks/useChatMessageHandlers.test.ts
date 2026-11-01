/**
 * useChatMessageHandlers — Resend/Retry and edit-and-resend with no model.
 *
 * Regression: ejecting every model and then tapping Resend/Retry used to do nothing at all (no message, no
 * feedback). Now it shows "No Model Selected", as the send path does, and leaves the chat as it was.
 *
 * Real: the handlers, the chat store (a real conversation and its actions), the residency manager and
 * hardware readings they log, the alert builder. Nothing is faked: the no-model path bails before any
 * device work. The alert setter is the screen's own state setter.
 */
import { handleRetryMessageFn, handleEditMessageFn } from '../../../src/screens/ChatScreen/useChatMessageHandlers';
import { useChatStore } from '../../../src/stores';

/** A chat with one question and its answer, through the store's own actions. */
function chatWithOneTurn() {
  const store = useChatStore.getState();
  const conversationId = store.createConversation('m');
  store.addMessage(conversationId, { role: 'user', content: 'hi' });
  store.addMessage(conversationId, { role: 'assistant', content: 'hello' });
  const thread = () => useChatStore.getState().getConversationMessages(conversationId);
  return { conversationId, thread, question: thread()[0] };
}

/** The screen's alert state, as the handlers set it. */
function screen() {
  const s = { alert: null as any };
  return { s, genDeps: { setAlertState: (a: any) => { s.alert = a; } } as any };
}

const contents = (messages: Array<{ role: string; content: string }>) => messages.map(m => `${m.role}:${m.content}`);

describe('handleRetryMessageFn — no model', () => {
  it('shows "No Model Selected" and leaves the chat as it was', async () => {
    const chat = chatWithOneTurn();
    const before = contents(chat.thread());
    const { s, genDeps } = screen();

    await handleRetryMessageFn(chat.question, genDeps, {
      activeConversationId: chat.conversationId,
      hasActiveModel: false,
      deleteMessagesAfter: useChatStore.getState().deleteMessagesAfter,
      setDebugInfo: () => {},
    });

    expect(s.alert).toEqual(expect.objectContaining({ visible: true, title: 'No Model Selected' }));
    expect(contents(chat.thread())).toEqual(before); // the answer is not deleted, nothing new is asked
  });

  it('with a model but no open chat, does nothing and shows no alert', async () => {
    const chat = chatWithOneTurn();
    const before = contents(chat.thread());
    const { s, genDeps } = screen();

    await handleRetryMessageFn(chat.question, genDeps, {
      activeConversationId: null,
      hasActiveModel: true,
      deleteMessagesAfter: useChatStore.getState().deleteMessagesAfter,
      setDebugInfo: () => {},
    });

    expect(s.alert).toBeNull();
    expect(contents(chat.thread())).toEqual(before);
  });
});

describe('handleEditMessageFn — no model', () => {
  it('shows "No Model Selected" and keeps the question as it was', async () => {
    const chat = chatWithOneTurn();
    const before = contents(chat.thread());
    const { s, genDeps } = screen();

    await handleEditMessageFn(genDeps, {
      message: chat.question,
      newContent: 'edited',
      activeConversationId: chat.conversationId,
      hasActiveModel: false,
      updateMessageContent: useChatStore.getState().updateMessageContent,
      deleteMessagesAfter: useChatStore.getState().deleteMessagesAfter,
      setDebugInfo: () => {},
    });

    expect(s.alert).toEqual(expect.objectContaining({ visible: true, title: 'No Model Selected' }));
    expect(contents(chat.thread())).toEqual(before); // no edited version, no new reply
  });
});
