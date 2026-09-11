import { loadingTextRowId } from '../../../src/components/ModelSelectorModal/rowState';
import type { ActiveModelInfo } from '../../../src/services/modelServices/modelStateTypes';

const idleStatus = {
  text: { isLoading: false, model: null },
  image: { isLoading: false, model: null },
} as ActiveModelInfo;

describe('model selector row loading state', () => {
  it('shows the Shared pending local selection on the tapped row', () => {
    expect(
      loadingTextRowId({
        status: idleStatus,
        parentIsLoading: false,
        selectedId: 'old-model',
        pendingSelectionId: 'new-model',
      }),
    ).toBe('new-model');
  });

  it('shows no loader for an idle selected model', () => {
    expect(
      loadingTextRowId({
        status: idleStatus,
        parentIsLoading: false,
        selectedId: 'selected-model',
      }),
    ).toBeNull();
  });
});
