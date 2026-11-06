import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { KnowledgeDocumentRow } from '../../../../src/components/knowledge/KnowledgeDocumentRow';

const doc = (over: Record<string, unknown> = {}) =>
  ({ sync_id: 's1', document_id: 'd1', name: 'notes.txt', size: 2048, enabled: 1, ...over }) as never;

const renderRow = (over: Record<string, unknown> = {}) => {
  const onOpen = jest.fn();
  const onToggle = jest.fn();
  const onRemove = jest.fn();
  const view = render(
    <KnowledgeDocumentRow doc={doc(over)} onOpen={onOpen} onToggle={onToggle} onRemove={onRemove} />,
  );
  return { view, onOpen, onToggle, onRemove };
};

describe('KnowledgeDocumentRow: open, use in answers and remove are three controls', () => {
  it('gives each action its own control, so a screen reader reaches all three', () => {
    const { view } = renderRow();
    expect(view.getByRole('button', { name: 'File notes.txt' })).toBeTruthy();
    expect(view.getByRole('switch', { name: 'Use in answers: notes.txt' })).toBeChecked();
    expect(view.getByRole('button', { name: 'Remove notes.txt' })).toBeTruthy();
    // Siblings: the switch is not inside the open control.
    const open = view.getByTestId('knowledge-document-row-s1');
    expect(open.findAll(node => node.props.testID === 'knowledge-document-toggle-s1')).toHaveLength(0);
  });

  it('names its controls with the fixed knowledge-document ids, so analytics can count them', () => {
    const { view } = renderRow();
    expect(view.getByTestId('knowledge-document-row-s1')).toBeTruthy();
    expect(view.getByTestId('knowledge-document-toggle-s1')).toBeTruthy();
    expect(view.getByTestId('knowledge-document-remove-s1')).toBeTruthy();
  });

  it('opens, switches and removes the document it shows', () => {
    const { view, onOpen, onToggle, onRemove } = renderRow({ enabled: 0 });
    expect(view.getByRole('switch', { name: 'Use in answers: notes.txt' })).not.toBeChecked();
    fireEvent.press(view.getByTestId('knowledge-document-row-s1'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'notes.txt', document_id: 'd1' }));
    fireEvent(view.getByTestId('knowledge-document-toggle-s1'), 'valueChange', true);
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ sync_id: 's1' }), true);
    fireEvent.press(view.getByTestId('knowledge-document-remove-s1'));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ sync_id: 's1' }));
  });

  it('a document still arriving (no local id yet) cannot be opened', () => {
    const { view, onOpen } = renderRow({ document_id: undefined });
    fireEvent.press(view.getByTestId('knowledge-document-row-s1'));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
