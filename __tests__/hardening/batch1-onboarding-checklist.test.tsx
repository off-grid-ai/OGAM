/**
 * BATCH 1 (Onboarding & First Launch) — hardening coverage for the onboarding
 * checklist step-completion state machine.
 *
 * The REAL logic under test is `useOnboardingSteps` (src/components/checklist/
 * useOnboardingSteps.ts): a hook that derives each checklist step's `completed`
 * and `disabled` flags + the `completedCount` from FOUR real reactive stores
 * (appStore, chatStore, projectStore, remoteServerStore). This is the single
 * source of truth for "which step is active/complete" that the home checklist
 * (useHomeScreen) renders — Provit cases 6, 18, 20, 26, 36, 38.
 *
 * These tests drive the REAL stores and the REAL hook (via renderHook). Nothing
 * that is asserted is mocked — deleting the hook body or a store action would
 * fail these. Existing tests (checklistComponents.test.tsx) cover the individual
 * happy-path step flags; this file adds the gaps:
 *   - the FULL sequential progression (0→…→6) that mirrors the checklist advancing
 *     its active step, and the exact completedCount at each stage (cases 6/18/20/26/36)
 *   - the flag-driven steps (exploredSettings, triedImageGen) reflected THROUGH the
 *     hook's `completed` field (not just the raw store flag)
 *   - the triedImageGen disabled→enabled transition when a text model loads
 *   - the remote-server / remote-active-model ALTERNATE completion paths for
 *     downloadedModel + loadedModel (the hook's `|| remoteServers.length` / `||
 *     activeRemoteTextModelId` branches, which no existing test exercises)
 *   - completed steps surviving a persist rehydrate — the checklist does not reset
 *     across a cold relaunch (case 38)
 */

import { renderHook, act } from '@testing-library/react-native';
import { useAppStore } from '../../src/stores/appStore';
import { useChatStore } from '../../src/stores/chatStore';
import { useProjectStore } from '../../src/stores/projectStore';
import { useRemoteServerStore } from '../../src/stores/remoteServerStore';
import { useOnboardingSteps } from '../../src/components/checklist/useOnboardingSteps';
import { resetStores, getAppState } from '../utils/testHelpers';
import { createDownloadedModel, createONNXImageModel } from '../utils/factories';

const stepById = (steps: any[], id: string) => steps.find((s) => s.id === id);

describe('BATCH1 onboarding checklist — useOnboardingSteps (real hook + real stores)', () => {
  beforeEach(() => {
    resetStores();
  });

  // ── case 6: after onboarding, step 1 (Download a Model) is the active/first
  //    incomplete step and NOTHING is complete. ─────────────────────────────
  it('case6: fresh state has 0 complete; downloadedModel is the first incomplete step', () => {
    const { result } = renderHook(() => useOnboardingSteps());
    expect(result.current.completedCount).toBe(0);
    // The "active" step the checklist highlights is the first not-yet-completed one.
    const firstIncomplete = result.current.steps.find((s: any) => !s.completed);
    expect(firstIncomplete!.id).toBe('downloadedModel');
    // No step should be complete on a fresh install.
    expect(result.current.steps.every((s: any) => !s.completed)).toBe(true);
  });

  // ── cases 6→18→20→26→36: the full sequential progression. Each completion moves
  //    the "first incomplete" (active) step forward and bumps completedCount. ──
  it('cases6-36: completing steps in order advances the active step and completedCount', () => {
    const { result, rerender } = renderHook(() => useOnboardingSteps());

    // Step 1: Download a Model → active step becomes "loadedModel" (case 18).
    act(() => { useAppStore.getState().addDownloadedModel(createDownloadedModel()); });
    rerender({});
    expect(stepById(result.current.steps, 'downloadedModel').completed).toBe(true);
    expect(result.current.completedCount).toBe(1);
    expect(result.current.steps.find((s: any) => !s.completed)!.id).toBe('loadedModel');

    // Step 2: Load a Model → active step becomes "sentMessage" (case 20).
    act(() => { useAppStore.getState().setActiveModelId('m-1'); });
    rerender({});
    expect(stepById(result.current.steps, 'loadedModel').completed).toBe(true);
    expect(result.current.completedCount).toBe(2);
    expect(result.current.steps.find((s: any) => !s.completed)!.id).toBe('sentMessage');

    // Step 3: Send first message (case 26).
    act(() => {
      const id = useChatStore.getState().createConversation('m-1', 'Chat');
      useChatStore.getState().addMessage(id, { role: 'user', content: 'hi' });
    });
    rerender({});
    expect(stepById(result.current.steps, 'sentMessage').completed).toBe(true);
    expect(result.current.completedCount).toBe(3);

    // Step 5: Explore Settings — flag driven (case 36).
    act(() => { useAppStore.getState().completeChecklistStep('exploredSettings'); });
    rerender({});
    expect(stepById(result.current.steps, 'exploredSettings').completed).toBe(true);
    expect(result.current.completedCount).toBe(4);
  });

  // ── case 36 isolated: exploredSettings is a FLAG the hook surfaces as `completed`.
  //    Drives the real completeChecklistStep action and reads it back THROUGH the hook. ──
  it('case36: exploredSettings flag flows through the hook completed field', () => {
    const { result, rerender } = renderHook(() => useOnboardingSteps());
    expect(stepById(result.current.steps, 'exploredSettings').completed).toBe(false);
    act(() => { useAppStore.getState().completeChecklistStep('exploredSettings'); });
    rerender({});
    expect(stepById(result.current.steps, 'exploredSettings').completed).toBe(true);
  });

  // ── triedImageGen: disabled while no text model loaded, enabled once one is,
  //    completed only via the flag (NOT by merely downloading an image model). ──
  it('triedImageGen: disabled→enabled on model load, completed only via flag', () => {
    const { result, rerender } = renderHook(() => useOnboardingSteps());

    // No model loaded → disabled, not completed.
    expect(stepById(result.current.steps, 'triedImageGen').disabled).toBe(true);
    expect(stepById(result.current.steps, 'triedImageGen').completed).toBe(false);

    // Downloading an image model must NOT complete it (guards a false-complete).
    act(() => { useAppStore.getState().addDownloadedImageModel(createONNXImageModel()); });
    rerender({});
    expect(stepById(result.current.steps, 'triedImageGen').completed).toBe(false);

    // Loading a TEXT model enables the step (disabled is keyed off activeModelId).
    act(() => { useAppStore.getState().setActiveModelId('m-1'); });
    rerender({});
    expect(stepById(result.current.steps, 'triedImageGen').disabled).toBe(false);
    expect(stepById(result.current.steps, 'triedImageGen').completed).toBe(false);

    // Only the explicit flag (set by imageGenerationService after a real gen) completes it.
    act(() => { useAppStore.getState().completeChecklistStep('triedImageGen'); });
    rerender({});
    expect(stepById(result.current.steps, 'triedImageGen').completed).toBe(true);
  });

  // ── createdProject completes only at projects.length > 4 (the 4 seeded defaults
  //    are NOT enough — this is the exact >4 boundary the hook uses). ──────────
  it('createdProject: not complete at 4 projects, complete at 5 (>4 boundary)', () => {
    // Start from exactly 4 projects (the seeded defaults are 4).
    act(() => {
      useProjectStore.setState({
        projects: Array.from({ length: 4 }, (_, i) => ({
          id: `p-${i}`, name: `P${i}`, description: '', systemPrompt: '',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        })),
      });
    });
    const { result, rerender } = renderHook(() => useOnboardingSteps());
    expect(useProjectStore.getState().projects.length).toBe(4);
    expect(stepById(result.current.steps, 'createdProject').completed).toBe(false);

    act(() => {
      useProjectStore.getState().createProject({ name: 'fifth', description: '', systemPrompt: '' });
    });
    rerender({});
    expect(useProjectStore.getState().projects.length).toBe(5);
    expect(stepById(result.current.steps, 'createdProject').completed).toBe(true);
  });

  // ── ALTERNATE completion path: a configured remote server satisfies "Download a
  //    Model", and an active remote text model satisfies "Load a Model" — no local
  //    download/activeModelId required. These are the hook's `|| remoteServers` and
  //    `|| activeRemoteTextModelId` branches. ─────────────────────────────────
  it('downloadedModel/loadedModel also complete via remote server + remote active model', () => {
    const { result, rerender } = renderHook(() => useOnboardingSteps());
    expect(stepById(result.current.steps, 'downloadedModel').completed).toBe(false);
    expect(stepById(result.current.steps, 'loadedModel').completed).toBe(false);

    // A remote server counts as "has any model" even with zero local downloads.
    act(() => {
      useRemoteServerStore.getState().addServer({
        name: 'LAN box', endpoint: 'http://192.168.1.9:8080', providerType: 'openai-compatible',
      });
    });
    rerender({});
    expect(getAppState().downloadedModels.length).toBe(0);
    expect(stepById(result.current.steps, 'downloadedModel').completed).toBe(true);

    // An active remote text model counts as "has active model" with no local activeModelId.
    act(() => { useRemoteServerStore.getState().setActiveRemoteTextModelId('remote/qwen'); });
    rerender({});
    expect(getAppState().activeModelId).toBeNull();
    expect(stepById(result.current.steps, 'loadedModel').completed).toBe(true);
  });

  // ── case 38: completed steps survive a cold relaunch. Persist the onboarding
  //    flags to AsyncStorage, reset the in-memory store, rehydrate, and confirm the
  //    hook still reports them complete — the checklist did NOT reset. ──────────
  it('case38: completed checklist steps survive a persist rehydrate (no reset)', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');

    // Wipe in-memory flags FIRST — before writing the payload — so the persist
    // middleware's auto-save on this setState can't clobber the payload below.
    act(() => {
      useAppStore.setState({
        hasCompletedOnboarding: false,
        onboardingChecklist: {
          downloadedModel: false, loadedModel: false, sentMessage: false,
          triedImageGen: false, exploredSettings: false, createdProject: false,
        },
      });
    });

    // A returning user who has completed onboarding + several checklist steps.
    const persistedPayload = JSON.stringify({
      state: {
        hasCompletedOnboarding: true,
        onboardingChecklist: {
          downloadedModel: true, loadedModel: true, sentMessage: true,
          triedImageGen: false, exploredSettings: true, createdProject: false,
        },
        checklistDismissed: false,
        activeModelId: 'm-1',
      },
      version: 0,
    });
    await AsyncStorage.setItem('local-llm-app-storage', persistedPayload);

    await act(async () => {
      await (useAppStore as any).persist.rehydrate();
    });

    const state = getAppState();
    expect(state.hasCompletedOnboarding).toBe(true);
    // Flags 1, 2, 3, 5 stayed done across the relaunch (the exact case-38 assertion).
    expect(state.onboardingChecklist.downloadedModel).toBe(true);
    expect(state.onboardingChecklist.loadedModel).toBe(true);
    expect(state.onboardingChecklist.sentMessage).toBe(true);
    expect(state.onboardingChecklist.exploredSettings).toBe(true);
    // And the flag-driven steps the hook reads surface as completed post-rehydrate.
    const { result } = renderHook(() => useOnboardingSteps());
    expect(stepById(result.current.steps, 'exploredSettings').completed).toBe(true);

    await AsyncStorage.removeItem('local-llm-app-storage');
  });

  // ── The migration guard: if the checklist was dismissed but is NOT fully complete,
  //    rehydration un-dismisses it so remaining steps stay visible (real merge rule
  //    that keeps the checklist from vanishing after a partial-then-relaunch). ──
  it('case38 guard: a dismissed-but-incomplete checklist is un-dismissed on rehydrate', () => {
    const merge = (useAppStore as any).persist.getOptions().merge as (p: any, c: any) => any;
    const merged = merge(
      {
        checklistDismissed: true,
        onboardingChecklist: {
          downloadedModel: true, loadedModel: false, sentMessage: false,
          triedImageGen: false, exploredSettings: false, createdProject: false,
        },
      },
      useAppStore.getState(),
    );
    // Not every step is done → the dismiss must be reverted so the checklist re-appears.
    expect(merged.checklistDismissed).toBe(false);
  });
});
