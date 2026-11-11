/**
 * A message longer than the model's memory used to be cut silently (its beginning was dropped), so the model answered from a
 * partial prompt and nobody knew. This tells the person, and says what to do instead. Pure text here; the chat posts it.
 */
export function longMessageText(latestTokens: number, budgetTokens: number): string {
  const fmt = (n: number) => Math.round(n / 100) * 100;
  return `Your message is about ${fmt(latestTokens).toLocaleString()} tokens long, but this model can read about ${fmt(budgetTokens).toLocaleString()} at once. `
    + 'The start of it was left out, so the answer is based on the end only. '
    + 'To get the whole thing read: raise the memory size in Chat settings, or add the text as a document (a project, or Knowledge for a textbook) and ask about it, or send it in parts.';
}

/** Posts the notice in the chat that is open (the one being answered). */
export function postLongMessageNotice(latestTokens: number, budgetTokens: number): void {
  try {
    const { useChatStore } = require('../stores');
    const store = useChatStore.getState();
    if (!store.activeConversationId) return;
    store.addMessage(store.activeConversationId, {
      role: 'assistant', isSystemInfo: true, content: longMessageText(latestTokens, budgetTokens),
    });
  } catch { /* no chat to tell */ }
}
