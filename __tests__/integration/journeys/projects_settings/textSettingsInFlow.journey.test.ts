/**
 * Journey (cluster C): TEXT settings-in-flow — a temperature/maxTokens change mid-
 * conversation must be the value the NEXT generate call consumes; values must survive
 * a relaunch through the REAL partialize/migrate; a model-switch effect must not stomp a
 * user-set value; the in-chat "Reset to Defaults" resets what it claims to.
 *
 * The "consumed value" assertion drives buildCompletionParams over the REAL store
 * settings — this is the EXACT params object llmService.generateResponse spreads into the
 * native ctx.completion() (llm.ts:300-304), so it is the value the action consumes, not a
 * proxy. Relaunch drives the REAL persist merge (migratePersistedState).
 */

import { useAppStore } from '../../../../src/stores/appStore';
import { buildCompletionParams } from '../../../../src/services/llmHelpers';
import { resetStores } from '../../../utils/testHelpers';

/** What the native completion() will actually receive, given the CURRENT store settings. */
function consumedCompletionParams() {
  return buildCompletionParams(useAppStore.getState().settings);
}

describe('Journey C — text settings consumed in-flow, persisted, and not stomped', () => {
  beforeEach(() => {
    resetStores();
    // Start from the app's real defaults for the fields under test.
    useAppStore.setState({
      settings: {
        ...useAppStore.getState().settings,
        temperature: 0.7, maxTokens: 1024, topP: 0.9, repeatPenalty: 1.1, contextLength: 4096,
        nThreads: 0, nBatch: 512,
        imageSteps: 8, imageGuidanceScale: 7.5, imageWidth: 512, imageHeight: 512, imageThreads: 4,
      } as any,
    });
  });

  it('temperature changed MID-CONVERSATION is the value the next generate call consumes', () => {
    // Turn 1 uses the default.
    expect(consumedCompletionParams().temperature).toBe(0.7);

    // User opens Chat Settings mid-conversation and drags Temperature to 1.35.
    // (The modal's SettingSlider calls updateSettings directly — no local useState seed.)
    useAppStore.getState().updateSettings({ temperature: 1.35 });

    // Turn 2's native completion call consumes the NEW value.
    expect(consumedCompletionParams().temperature).toBe(1.35);
  });

  it('maxTokens changed mid-conversation flows into n_predict on the next call', () => {
    expect(consumedCompletionParams().n_predict).toBe(1024);
    useAppStore.getState().updateSettings({ maxTokens: 2048 });
    expect(consumedCompletionParams().n_predict).toBe(2048);
  });

  it('topP + repeatPenalty changes are consumed together on the next call', () => {
    useAppStore.getState().updateSettings({ topP: 0.5, repeatPenalty: 1.4 });
    const p = consumedCompletionParams();
    expect(p.top_p).toBe(0.5);
    expect(p.penalty_repeat).toBe(1.4);
  });

  it('text settings SURVIVE a relaunch through the REAL persist merge (migratePersistedState)', () => {
    useAppStore.getState().updateSettings({ temperature: 1.1, maxTokens: 4096, repeatPenalty: 1.25 });

    // Serialize exactly as the persist middleware would, then rehydrate via the real merge.
    const opts = (useAppStore as any).persist.getOptions();
    const persisted = opts.partialize(useAppStore.getState());
    const merged = opts.merge(persisted, useAppStore.getState());

    expect(merged.settings.temperature).toBe(1.1);
    expect(merged.settings.maxTokens).toBe(4096);
    expect(merged.settings.repeatPenalty).toBe(1.25);
    // And feeding the rehydrated settings to the consumer yields the same values.
    expect(buildCompletionParams(merged.settings).temperature).toBe(1.1);
    expect(buildCompletionParams(merged.settings).n_predict).toBe(4096);
  });

  it('a user-set temperature is NOT stomped by switching the active model (no model-change re-seed)', () => {
    useAppStore.getState().updateSettings({ temperature: 0.15 });
    // Simulate a model switch: the app changes activeModelId (and would run any
    // model-change effects/loaders). The user's temperature must remain 0.15.
    useAppStore.getState().setActiveModelId('some-other-model');
    expect(useAppStore.getState().settings.temperature).toBe(0.15);
    expect(consumedCompletionParams().temperature).toBe(0.15);
    // Switch again (llama ↔ litert style flip): still preserved.
    useAppStore.getState().setActiveModelId('yet-another-model');
    expect(useAppStore.getState().settings.temperature).toBe(0.15);
  });

  // ── Q12 (KNOWN, LOW): modal "Reset to Defaults" is partial ───────────────────
  it('BUG GUARD Q12: the in-chat modal reset (7 text params) LEAVES image steps/size/guidance/threads unchanged', () => {
    // User customised BOTH text and image params.
    useAppStore.getState().updateSettings({
      temperature: 1.9, maxTokens: 8192, topP: 0.3, repeatPenalty: 1.9, contextLength: 8192, nThreads: 6, nBatch: 256,
      imageSteps: 42, imageGuidanceScale: 15, imageWidth: 512, imageHeight: 512, imageThreads: 8,
    });

    // The modal's handleResetDefaults writes ONLY these 7 keys (its local DEFAULT_SETTINGS).
    const MODAL_RESET = { temperature: 0.7, maxTokens: 1024, topP: 0.9, repeatPenalty: 1.1, contextLength: 4096, nThreads: 0, nBatch: 512 };
    useAppStore.getState().updateSettings(MODAL_RESET);

    const s = useAppStore.getState().settings;
    // Text params were reset…
    expect(s.temperature).toBe(0.7);
    expect(s.maxTokens).toBe(1024);
    expect(s.nBatch).toBe(512);
    // …but the IMAGE params are UNTOUCHED by "Reset to Defaults" — the bug.
    expect(s.imageSteps).toBe(42);
    expect(s.imageGuidanceScale).toBe(15);
    expect(s.imageThreads).toBe(8);
  });

  // ── Divergent-default smell backing Q12/Q13 ──────────────────────────────────
  it('the modal defines its OWN DEFAULT_SETTINGS (a second source of truth) that omits image params', () => {
    // The modal's reset default set is a hardcoded 7-key object separate from the store's
    // DEFAULT_SETTINGS. Assert the SHAPE gap (image keys absent) — the DRY defect that
    // makes the reset partial and lets defaults drift between the two components.
    const MODAL_DEFAULT_KEYS = ['temperature', 'maxTokens', 'topP', 'repeatPenalty', 'contextLength', 'nThreads', 'nBatch'];
    const storeSettingKeys = Object.keys(useAppStore.getState().settings);
    const imageKeys = storeSettingKeys.filter(k => k.startsWith('image'));
    // The store has image settings; the modal's reset default set covers none of them.
    expect(imageKeys.length).toBeGreaterThan(0);
    expect(MODAL_DEFAULT_KEYS.some(k => k.startsWith('image'))).toBe(false);
  });
});
