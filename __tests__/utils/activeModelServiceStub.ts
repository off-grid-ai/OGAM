/**
 * The model-selection answers every stub of `activeModelService` has to give.
 *
 * The service owns two questions the whole app asks on render: which text model is selected
 * (`resolveSelectedTextModel`) and which id should be loaded (`selectedTextModelId`). A suite that
 * stubs the service and omits them takes down every test in the file with "is not a function".
 *
 * Defined once so the next method added to that seam is added HERE, not hunted through twenty
 * files. Resolved from the real store, so a stub answers what the app would answer rather than a
 * constant that quietly disagrees with the fixtures the test just set up.
 *
 * (These suites mock our own service, which the testing doctrine rules out. This keeps them honest
 * until they move to the integration harness; it is not an endorsement of the pattern.)
 */
export function activeModelSelectionStub(): {
  resolveSelectedTextModel: () => unknown;
  selectedTextModelId: () => string | null;
} {
  // Selection is the shared active route, persisted in the one selection store. A suite that mocks the
  // app store still shares that store, so the stub answers what the app would answer.
  const selectedId = (): string | null => {
    try {
      const { readMobileModelSelection, rememberedLocalTextModelId } =
        require('../../src/services/modelServices/modelSelectionProjection');
      const { decodeModelRouteId } = require('@offgrid/models');
      const route = readMobileModelSelection('text');
      const decoded = route ? decodeModelRouteId(route) : null;
      return (decoded && !decoded.serverId ? decoded.modelId : null) ?? rememberedLocalTextModelId();
    } catch {
      return null;
    }
  };
  const downloadedModels = (): Array<{ id: string }> => {
    try {
      const hook = require('../../src/stores').useAppStore as any;
      const fromSelector =
        typeof hook === 'function' && hook.mock ? hook((value: unknown) => value) : undefined;
      const state = fromSelector ?? hook?.getState?.();
      return state?.downloadedModels ?? [];
    } catch {
      return [];
    }
  };

  return {
    resolveSelectedTextModel: () => {
      const id = selectedId();
      return downloadedModels().find(model => model.id === id) ?? null;
    },
    selectedTextModelId: () => selectedId(),
  };
}
