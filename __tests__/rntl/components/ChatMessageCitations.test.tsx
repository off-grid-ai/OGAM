/**
 * Page citations in an answer, and the row a knowledge-base search leaves in the chat.
 *
 * An answer written from documents carries `[S#]` tags; the reply's `documentSources` say which page of
 * which file each tag is. The person sees a page link ("p. 214", or the part's label) where the tag was,
 * never the raw tag, and tapping it hands the app that exact source so it can open the page. A tag with no
 * source behind it is dropped rather than shown as a link to nowhere.
 *
 * Rendered through the real ChatMessage (MessageContent → MarkdownText's link rule). The search row's
 * content is built by the shared engine's own `searchBlock`, the same text the tool hands the model.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { searchBlock } from '@offgrid/rag/documents';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { createMessage } from '../../utils/factories';
import type { DocumentCitation, Message } from '../../../src/types';

const MANUAL: DocumentCitation = {
  id: 'S1',
  documentId: 'doc-manual',
  name: 'manual.pdf',
  page: 214,
  snippet: 'Torque the bolts to 40 Nm.',
};
const NOTES: DocumentCitation = {
  id: 'S2',
  documentId: 'doc-notes',
  name: 'notes.txt',
  page: 3,
  label: 'part 3',
  snippet: 'Check the seals weekly.',
};

const answer = (content: string, documentSources?: DocumentCitation[]): Message => ({
  ...createMessage({ id: 'reply-1', role: 'assistant', content }),
  documentSources,
});

describe('page citations in an answer', () => {
  it('shows each [S#] as a page link, and not the raw tag', () => {
    const view = render(
      <ChatMessage message={answer('Torque them to 40 Nm [S1]. Check the seals weekly [S2].', [MANUAL, NOTES])} />,
    );

    expect(view.getByText('p. 214')).toBeTruthy();
    expect(view.getByText('part 3')).toBeTruthy();
    expect(view.queryByText(/\[S1\]|\[S2\]/)).toBeNull();
  });

  it('hands the tapped link\'s own source to the app, so the right page opens', () => {
    const opened: DocumentCitation[] = [];
    const view = render(
      <ChatMessage
        message={answer('Torque them to 40 Nm [S1]. Check the seals weekly [S2].', [MANUAL, NOTES])}
        onCitationPress={source => opened.push(source)}
      />,
    );
    expect(opened).toEqual([]);

    fireEvent.press(view.getByText('part 3'));
    fireEvent.press(view.getByText('p. 214'));

    expect(opened).toEqual([NOTES, MANUAL]);
  });

  it('links each tag of a grouped citation ([S1, S2]) to its own page', () => {
    const view = render(<ChatMessage message={answer('Both say so [S1, S2].', [MANUAL, NOTES])} />);

    expect(view.getByText('p. 214')).toBeTruthy();
    expect(view.getByText('part 3')).toBeTruthy();
  });

  it('drops a tag that points at no source instead of linking to nowhere', () => {
    const view = render(<ChatMessage message={answer('Torque them to 40 Nm [S1]. Made up [S9].', [MANUAL])} />);

    expect(view.getByText('p. 214')).toBeTruthy();
    expect(view.queryByText(/S9/)).toBeNull();
  });

  it('leaves an answer without document sources exactly as written', () => {
    const view = render(<ChatMessage message={answer('Plain answer [S1].')} />);

    expect(view.getByText(/Plain answer \[S1\]\./)).toBeTruthy();
    expect(view.queryByText('p. 214')).toBeNull();
  });
});

describe('the row a knowledge-base search leaves in the chat', () => {
  const toolResult = (content: string): Message =>
    createMessage({ id: 'tool-1', role: 'tool', toolName: 'search_knowledge_base', content });

  it('says how many passages it found, in how many documents', () => {
    const { text } = searchBlock(
      'torque',
      [
        { documentId: 'doc-manual', name: 'manual.pdf', page: 214, position: 3, text: 'Torque the bolts to 40 Nm.' },
        { documentId: 'doc-manual', name: 'manual.pdf', page: 215, position: 4, text: 'Re-torque after 50 km.' },
        { documentId: 'doc-notes', name: 'notes.txt', page: 3, label: 'part 3', position: 0, text: 'Torque wrench is in bay 2.' },
      ],
      [1, 2, 3],
    );

    const view = render(<ChatMessage message={toolResult(text)} />);

    expect(view.getByText('Found 3 passages in 2 documents')).toBeTruthy();
  });

  it('says it found nothing when the knowledge base had no passage for the question', () => {
    const { text } = searchBlock('quarterly ledger', [], []);

    const view = render(<ChatMessage message={toolResult(text)} />);

    expect(view.getByText('Searched your documents: nothing matched')).toBeTruthy();
  });
});
