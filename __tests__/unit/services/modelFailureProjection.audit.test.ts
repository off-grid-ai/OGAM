import { useModelFailureStore } from '../../../src/stores/modelFailureStore';
import { projectMobileModelServiceInitializationFailure } from '../../../src/services/modelServices';
import { projectClassifierFailure } from '../../../src/screens/ChatScreen/mobileChatSession';

describe('model initialization failure projection', () => {
  beforeEach(() => useModelFailureStore.getState().clear());

  it('projects inventory initialization failures to the shared UI boundary', () => {
    projectMobileModelServiceInitializationFailure(
      'inventory',
      new Error('inventory unavailable'),
    );

    expect(useModelFailureStore.getState().failures).toEqual([
      expect.objectContaining({
        id: 'mobile-model-services-inventory',
        severity: 'error',
        message: 'inventory unavailable',
      }),
    ]);
  });

  it('projects classifier fallback as a non-blocking warning', () => {
    projectClassifierFailure('classification', new Error('classifier failed'));

    expect(useModelFailureStore.getState().failures).toEqual([
      expect.objectContaining({
        id: 'mobile-chat-classifier',
        severity: 'warning',
        message: 'Off Grid will use the selected text model for this message.',
      }),
    ]);
  });
});
