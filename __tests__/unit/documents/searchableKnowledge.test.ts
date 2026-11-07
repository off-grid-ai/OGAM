/**
 * A new chat with nothing to search must not be offered search_knowledge_base: on the phone the model
 * called it, found nothing, and answered "I don't have specific passages" instead of the question.
 */
import { toolsForTurn, hasSearchableKnowledge, KNOWLEDGE_SEARCH_TOOL } from '../../../src/services/documents/searchableKnowledge';
import { useChatStore } from '../../../src/stores/chatStore';

const enabled = ['web_search', 'read_url', KNOWLEDGE_SEARCH_TOOL];

describe('knowledge search is offered only when there is something to search', () => {
  beforeEach(() => useChatStore.setState({ conversations: [] }));

  it('drops knowledge search from a turn with nothing to search, and keeps the rest', () => {
    expect(toolsForTurn(enabled, false)).toEqual(['web_search', 'read_url']);
    expect(toolsForTurn(enabled, true)).toEqual(enabled);
  });

  it('a new chat outside a project has nothing to search', async () => {
    useChatStore.setState({
      conversations: [{ id: 'c1', title: '[test] trip', modelId: 'm', messages: [], createdAt: '', updatedAt: '' }] as never,
    });
    await expect(hasSearchableKnowledge('c1')).resolves.toBe(false);
  });

  it('a chat with a document attached has something to search', async () => {
    useChatStore.setState({
      conversations: [{
        id: 'c2', title: '[test] lease', modelId: 'm', createdAt: '', updatedAt: '',
        messages: [{ id: 'm1', role: 'user', content: 'summarise', timestamp: 0,
          attachments: [{ id: 'a1', type: 'document', uri: 'file:///lease.pdf', documentId: 'doc-1', fileName: 'lease.pdf' }] }],
      }] as never,
    });
    await expect(hasSearchableKnowledge('c2')).resolves.toBe(true);
  });
});
