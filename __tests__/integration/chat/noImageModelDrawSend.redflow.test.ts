/**
 * RED-FLOW (integration) — N3: forcing image generation with NO image model silently sends an internal
 * marker string to the TEXT model instead of telling the user.
 *
 * When the user forces image mode (manual + force) but has no image model, dispatchGenerationFn takes the
 * text route and PREFIXES the message with an internal "[User wanted an image but no image model is
 * loaded]" marker (useChatGenerationActions.ts:447), then sends THAT to the text generator — the user
 * sees a confusing text reply and no guidance. Drives the REAL dispatchGenerationFn + resolveTurnKind
 * (real intentClassifier); store/UI deps are stubbed recorders. No native leaf.
 */
import { dispatchGenerationFn, type GenerationDeps } from '../../../src/screens/ChatScreen/useChatGenerationActions';

describe('N3 — forced image gen with no image model (red-flow)', () => {
  it('does not leak an internal marker to the text model (and does not silently answer)', async () => {
    const added: Array<{ role: string; content: string }> = [];
    let alertShown = false;
    const deps = {
      activeImageModel: null,
      hasTextModel: true,
      activeModelInfo: { isRemote: false, model: null, modelId: 'txt', modelName: 'Txt' },
      downloadedModels: [],
      settings: { imageGenerationMode: 'manual', autoDetectMethod: 'pattern', showGenerationDetails: false },
      addMessage: (_c: string, m: { role: string; content: string }) => { added.push(m); },
      setAlertState: () => { alertShown = true; },
      setAppImageGenerationStatus: () => {},
      setIsClassifying: () => {},
      ensureTextModelForChat: async () => true,
      setPendingMessage: () => {},
    } as unknown as GenerationDeps;

    let sentToTextModel = '';
    const startTextGeneration = async (_convId: string, text: string) => { sentToTextModel = text; };

    await dispatchGenerationFn(deps, { text: 'a fire-breathing dragon', conversationId: 'c1', imageMode: 'force' }, startTextGeneration);

    // Correct: the user is told no image model is available (an alert), and no internal marker is fed to
    // the text model. Today no alert fires and the text model receives the "[User wanted an image…]"
    // marker prepended to the prompt → RED.
    expect(sentToTextModel).not.toContain('[User wanted an image');
    expect(alertShown).toBe(true);
  });
});
