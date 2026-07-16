/**
 * Integration Tests: Onboarding Spotlight Flow Coordination
 *
 * Tests the full lifecycle of each onboarding flow — from initial state
 * through multi-step spotlight sequencing and reactive triggers.
 *
 * These tests verify the integration between:
 * - appStore (onboardingChecklist, shownSpotlights, model state)
 * - chatStore (conversations, messages)
 * - projectStore (projects)
 * - spotlightState module (pending spotlight queue)
 * - spotlightConfig (step indices, tab mappings)
 *
 * Unlike the unit tests, these simulate realistic multi-step sequences
 * where one step's completion enables the next.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';
import {
  setPendingSpotlight,
  consumePendingSpotlight,
  peekPendingSpotlight,
} from '../../../src/components/onboarding/spotlightState';
import {
  STEP_INDEX_MAP,
  STEP_TAB_MAP,
  CHAT_INPUT_STEP_INDEX,
  MODEL_SETTINGS_STEP_INDEX,
  PROJECT_EDIT_STEP_INDEX,
  DOWNLOAD_FILE_STEP_INDEX,
  DOWNLOAD_MANAGER_STEP_INDEX,
  MODEL_PICKER_STEP_INDEX,
  VOICE_HINT_STEP_INDEX,
  IMAGE_LOAD_STEP_INDEX,
  IMAGE_NEW_CHAT_STEP_INDEX,
  IMAGE_DRAW_STEP_INDEX,
  IMAGE_SETTINGS_STEP_INDEX,
} from '../../../src/components/onboarding/spotlightConfig';
import { resetStores, getAppState } from '../../utils/testHelpers';
import {
  createDownloadedModel,
  createONNXImageModel,
  createConversation,
  createMessage,
  createGeneratedImage,
  createProject,
} from '../../utils/factories';

describe('Onboarding Spotlight Flow Integration', () => {
  beforeEach(() => {
    resetStores();
    setPendingSpotlight(null);
  });

  // ==========================================================================
  // Flow 1: Download a Model (3-part chain)
  //
  // Step sequence: 0 (model card) → 9 (file card) → 10 (download manager)
  // State changes: downloadedModels.length goes from 0 → 1
  // ==========================================================================
  describe('Flow 1: Download a Model — full 3-part chain', () => {
    it('simulates the complete download flow: queue → consume → re-queue → consume', () => {
      // 1. handleStepPress('downloadedModel') queues step 9 and fires step 0
      setPendingSpotlight(DOWNLOAD_FILE_STEP_INDEX);
      expect(peekPendingSpotlight()).toBe(9);

      // 2. User dismisses step 0, taps the model → model detail opens
      //    Model detail consumes step 9
      const step9 = consumePendingSpotlight();
      expect(step9).toBe(9);

      // 3. Model detail pre-queues step 10 before firing step 9
      setPendingSpotlight(DOWNLOAD_MANAGER_STEP_INDEX);
      expect(peekPendingSpotlight()).toBe(10);

      // 4. User dismisses step 9, taps download, presses back
      //    Back handler consumes step 10
      const step10 = consumePendingSpotlight();
      expect(step10).toBe(10);

      // 5. Step 10 fires on download manager icon
      // 6. User dismisses — flow complete

      // No pending spotlights remain
      expect(consumePendingSpotlight()).toBeNull();
    });

    it('checklist step completes when model finishes downloading', () => {
      expect(getAppState().downloadedModels).toHaveLength(0);

      // Simulate download completion
      useAppStore.getState().addDownloadedModel(createDownloadedModel());

      const state = getAppState();
      expect(state.downloadedModels).toHaveLength(1);
      // useOnboardingSteps checks: downloadedModels.length > 0
    });
  });

  // ==========================================================================
  // Flow 2: Load a Model (2-part chain)
  //
  // Step sequence: 1 (TextModelCard) → 11 (picker item via pulsating border)
  // State changes: activeModelId goes from null → model ID
  // ==========================================================================
  describe('Flow 2: Load a Model — full 2-part chain', () => {
    it('simulates the complete load flow: queue step 11 → consume in picker', () => {
      // Precondition: user has downloaded a model
      useAppStore.getState().addDownloadedModel(createDownloadedModel({ id: 'model-1' }));

      // 1. handleStepPress('loadedModel') queues step 11
      setPendingSpotlight(MODEL_PICKER_STEP_INDEX);

      // 2. Step 1 spotlights TextModelCard on HomeScreen
      // 3. User dismisses step 1, taps TextModelCard → picker opens
      // 4. Picker consumes step 11
      const step11 = consumePendingSpotlight();
      expect(step11).toBe(11);

      // 5. Picker shows pulsating border on first model
      // 6. User taps model → model loads
      useAppStore.getState().setActiveModelId('model-1');

      expect(getAppState().activeModelId).toBe('model-1');
      expect(consumePendingSpotlight()).toBeNull();
    });

    it('checklist step completes when activeModelId is set', () => {
      expect(getAppState().activeModelId).toBeNull();

      useAppStore.getState().setActiveModelId('some-model');

      expect(getAppState().activeModelId).not.toBeNull();
    });
  });

  // ==========================================================================
  // Flow 3: Send Your First Message (3-part chain)
  //
  // Step sequence: 2 ("New" button) → 3 (ChatInput) → 12 (VoiceRecordButton)
  // ChatScreen chains 3 → 12 internally via pendingNextRef
  // ==========================================================================
  describe('Flow 3: Send Your First Message — full 3-part chain', () => {
    it('simulates the complete message flow: step 2 → step 3 → step 12 chain', () => {
      // 1. handleStepPress('sentMessage') queues step 3 and fires step 2
      setPendingSpotlight(CHAT_INPUT_STEP_INDEX);
      expect(peekPendingSpotlight()).toBe(3);

      // 2. Step 2 spotlights "New" button on ChatsListScreen
      // 3. User taps "New" → ChatScreen mounts

      // 4. ChatScreen consumes step 3
      const step3 = consumePendingSpotlight();
      expect(step3).toBe(3);

      // 5. ChatScreen internally queues step 12 via pendingNextRef (not module state)
      //    This is done inside ChatScreen via: pendingNextRef.current = VOICE_HINT_STEP_INDEX
      //    When step 3 is dismissed (current goes undefined), ChatScreen fires goTo(12)

      // Verify the VOICE_HINT_STEP_INDEX constant is correct
      expect(VOICE_HINT_STEP_INDEX).toBe(12);

      // No module-level pending spotlight — the chain is internal to ChatScreen
      expect(consumePendingSpotlight()).toBeNull();
    });

    it('checklist step completes when a conversation has messages', () => {
      const conv = createConversation({
        messages: [createMessage({ role: 'user', content: 'Hello!' })],
      });
      useChatStore.setState({ conversations: [conv] });

      const conversations = useChatStore.getState().conversations;
      expect(conversations.some(c => c.messages.length > 0)).toBe(true);
    });
  });

  // ==========================================================================
  // Flow 4: Try Image Generation (5-part, reactive)
  //
  // Part 1: Step 4 (Image Models tab) — immediate
  // Part 2: Step 13 (ImageModelCard) — reactive: image model downloaded
  // Part 3: Step 14 (New Chat button) — reactive: image model loaded
  // Part 4: Step 15 (ChatInput "draw a dog") — reactive: on ChatScreen
  // Part 5: Step 16 (image mode toggle) — reactive: after first image
  // ==========================================================================
  describe('Flow 4: Try Image Generation — full 5-part reactive chain', () => {
    it('simulates the complete image generation onboarding journey', () => {
      const { markSpotlightShown, addDownloadedImageModel, setActiveImageModelId, addGeneratedImage, completeChecklistStep } = useAppStore.getState();

      // ==== Part 1: Immediate — spotlight Image Models tab ====
      // handleStepPress('triedImageGen') fires goTo(4) after navigation
      // No pending spotlight queued — reactive parts handle the rest
      expect(STEP_INDEX_MAP.triedImageGen).toBe(4);
      expect(STEP_TAB_MAP.triedImageGen).toBe('ModelsTab');

      // User dismisses step 4, switches to Image Models tab, downloads a model
      addDownloadedImageModel(createONNXImageModel());

      // ==== Part 2: Reactive — image model downloaded but not loaded ====
      let state = getAppState();
      const shouldShowPart2 =
        state.downloadedImageModels.length > 0 &&
        !state.activeImageModelId &&
        !state.shownSpotlights.imageLoad &&
        !state.onboardingChecklist.triedImageGen;
      expect(shouldShowPart2).toBe(true);

      // HomeScreen effect fires goTo(IMAGE_LOAD_STEP_INDEX) and marks shown
      markSpotlightShown('imageLoad');
      expect(IMAGE_LOAD_STEP_INDEX).toBe(13);

      // ==== Part 3: Reactive — image model loaded ====
      setActiveImageModelId('test-image-model');

      state = getAppState();
      const shouldShowPart3 =
        state.activeImageModelId !== null &&
        !state.shownSpotlights.imageNewChat &&
        !state.onboardingChecklist.triedImageGen;
      expect(shouldShowPart3).toBe(true);

      // ChatsListScreen effect fires goTo(IMAGE_NEW_CHAT_STEP_INDEX) and marks shown
      markSpotlightShown('imageNewChat');
      expect(IMAGE_NEW_CHAT_STEP_INDEX).toBe(14);

      // ==== Part 4: Reactive — on ChatScreen with image model loaded ====
      state = getAppState();
      const shouldShowPart4 =
        state.activeImageModelId !== null &&
        !state.shownSpotlights.imageDraw &&
        !state.onboardingChecklist.triedImageGen;
      expect(shouldShowPart4).toBe(true);

      // ChatScreen effect fires goTo(IMAGE_DRAW_STEP_INDEX) and marks shown
      markSpotlightShown('imageDraw');
      expect(IMAGE_DRAW_STEP_INDEX).toBe(15);

      // User types "draw a dog" and sends → image generates

      // ==== Part 5: Reactive — after first image generated ====
      addGeneratedImage(createGeneratedImage());
      completeChecklistStep('triedImageGen');

      state = getAppState();
      const shouldShowPart5 =
        state.generatedImages.length > 0 &&
        !state.shownSpotlights.imageSettings &&
        state.onboardingChecklist.triedImageGen;
      expect(shouldShowPart5).toBe(true);

      // ChatScreen effect fires goTo(IMAGE_SETTINGS_STEP_INDEX) and marks shown
      markSpotlightShown('imageSettings');
      expect(IMAGE_SETTINGS_STEP_INDEX).toBe(16);

      // ==== All reactive spotlights have been shown ====
      state = getAppState();
      expect(state.shownSpotlights).toEqual({
        imageLoad: true,
        imageNewChat: true,
        imageDraw: true,
        imageSettings: true,
      });
    });

    it('reactive spotlights do not re-trigger after being marked as shown', () => {
      const { markSpotlightShown, addDownloadedImageModel, setActiveImageModelId } = useAppStore.getState();

      // Part 2: Mark as shown, then trigger condition
      markSpotlightShown('imageLoad');
      addDownloadedImageModel(createONNXImageModel());

      let state = getAppState();
      expect(
        state.downloadedImageModels.length > 0 &&
        !state.activeImageModelId &&
        !state.shownSpotlights.imageLoad
      ).toBe(false);

      // Part 3: Mark as shown, then trigger condition
      markSpotlightShown('imageNewChat');
      setActiveImageModelId('test-model');

      state = getAppState();
      expect(
        state.activeImageModelId !== null &&
        !state.shownSpotlights.imageNewChat
      ).toBe(false);
    });

    it('completing triedImageGen suppresses all pending reactive spotlights', () => {
      useAppStore.getState().completeChecklistStep('triedImageGen');
      useAppStore.getState().addDownloadedImageModel(createONNXImageModel());
      useAppStore.getState().setActiveImageModelId('test-model');

      const state = getAppState();

      // Parts 2-4 all check !triedImageGen
      expect(state.onboardingChecklist.triedImageGen).toBe(true);
      expect(
        !state.onboardingChecklist.triedImageGen &&
        state.downloadedImageModels.length > 0
      ).toBe(false);
    });
  });

  // ==========================================================================
  // Flow 5: Explore Settings (2-part chain)
  //
  // Step sequence: 5 (Settings nav) → 6 (accordion)
  // ==========================================================================
  describe('Flow 5: Explore Settings — full 2-part chain', () => {
    it('simulates the complete settings exploration flow', () => {
      // 1. handleStepPress('exploredSettings') queues step 6
      setPendingSpotlight(MODEL_SETTINGS_STEP_INDEX);
      expect(peekPendingSpotlight()).toBe(6);

      // 2. Step 5 spotlights Settings nav section
      // 3. User taps "Model Settings" → ModelSettingsScreen mounts
      // 4. ModelSettingsScreen consumes step 6
      const step6 = consumePendingSpotlight();
      expect(step6).toBe(6);

      // 5. Step 6 spotlights accordion section
      // 6. User dismisses — flow complete

      // 7. Screen sets the completion flag
      useAppStore.getState().completeChecklistStep('exploredSettings');
      expect(getAppState().onboardingChecklist.exploredSettings).toBe(true);

      expect(consumePendingSpotlight()).toBeNull();
    });
  });

  // ==========================================================================
  // Flow 6: Create a Project (2-part chain)
  //
  // Step sequence: 7 ("New" button) → 8 (name input)
  // ==========================================================================
  describe('Flow 6: Create a Project — full 2-part chain', () => {
    it('simulates the complete project creation flow', () => {
      // 1. handleStepPress('createdProject') queues step 8
      setPendingSpotlight(PROJECT_EDIT_STEP_INDEX);
      expect(peekPendingSpotlight()).toBe(8);

      // 2. Step 7 spotlights "New" button on ProjectsScreen
      // 3. User taps "New" → ProjectEditScreen mounts
      // 4. ProjectEditScreen consumes step 8
      const step8 = consumePendingSpotlight();
      expect(step8).toBe(8);

      // 5. Step 8 spotlights name input
      // 6. User fills in name, saves

      expect(consumePendingSpotlight()).toBeNull();
    });

    it('checklist step completes when projects.length > 4', () => {
      // 4 is NOT enough
      const fourProjects = Array.from({ length: 4 }, (_, i) => createProject({ id: `proj-${i}` }));
      useProjectStore.setState({ projects: fourProjects });
      expect(useProjectStore.getState().projects).toHaveLength(4);
      expect(useProjectStore.getState().projects.length).toBeLessThanOrEqual(4);

      // 5 completes it
      const fiveProjects = [...fourProjects, createProject({ id: 'proj-4' })];
      useProjectStore.setState({ projects: fiveProjects });
      expect(useProjectStore.getState().projects).toHaveLength(5);
      expect(useProjectStore.getState().projects.length).toBeGreaterThan(4);
    });
  });

  // ==========================================================================
  // Cross-flow interactions
  //
  // Tests that verify flows don't interfere with each other.
  // ==========================================================================
  describe('cross-flow interactions', () => {
    it('completing all 6 checklist steps gives a full checklist', () => {
      const store = useAppStore.getState();

      // Step 1: Download a model
      store.addDownloadedModel(createDownloadedModel());

      // Step 2: Load a model
      store.setActiveModelId('model-1');

      // Step 3: Send a message
      const conv = createConversation({
        messages: [createMessage({ role: 'user', content: 'hello' })],
      });
      useChatStore.setState({ conversations: [conv] });

      // Step 4: Try image generation
      store.addDownloadedImageModel(createONNXImageModel());
      store.setActiveImageModelId('img-model');
      store.addGeneratedImage(createGeneratedImage());
      store.completeChecklistStep('triedImageGen');

      // Step 5: Explore settings
      store.completeChecklistStep('exploredSettings');

      // Step 6: Create a project (need > 4 projects)
      const projects = Array.from({ length: 5 }, (_, i) => createProject({ id: `p-${i}` }));
      useProjectStore.setState({ projects });

      // Verify all completion criteria
      const appState = getAppState();
      expect(appState.downloadedModels.length).toBeGreaterThan(0);
      expect(appState.activeModelId).not.toBeNull();
      expect(useChatStore.getState().conversations.some(c => c.messages.length > 0)).toBe(true);
      expect(appState.onboardingChecklist.triedImageGen).toBe(true);
      expect(appState.onboardingChecklist.exploredSettings).toBe(true);
      expect(useProjectStore.getState().projects.length).toBeGreaterThan(4);
    });

    it('resetting checklist clears ALL onboarding state while preserving app data', () => {
      const store = useAppStore.getState();

      // Set up various onboarding state
      store.completeChecklistStep('downloadedModel');
      store.completeChecklistStep('triedImageGen');
      store.dismissChecklist();
      store.markSpotlightShown('imageLoad');
      store.markSpotlightShown('imageDraw');

      // Also have some app data
      store.addDownloadedModel(createDownloadedModel());
      store.setActiveModelId('model-1');

      // Reset
      useAppStore.getState().resetChecklist();

      const state = getAppState();

      // Onboarding state cleared
      expect(state.onboardingChecklist.downloadedModel).toBe(false);
      expect(state.onboardingChecklist.triedImageGen).toBe(false);
      expect(state.checklistDismissed).toBe(false);
      expect(state.shownSpotlights).toEqual({});

      // App data preserved
      expect(state.downloadedModels).toHaveLength(1);
      expect(state.activeModelId).toBe('model-1');
    });

    it('pending spotlight state is independent of store state', () => {
      // Queue a pending spotlight
      setPendingSpotlight(9);

      // Reset stores
      resetStores();

      // Pending spotlight survives store reset (it's module-level)
      expect(consumePendingSpotlight()).toBe(9);
    });

    it('reactive Flow 4 spotlights fire in correct order through state progression', () => {
      const store = useAppStore.getState();

      // Initial state: no reactive conditions met
      let state = getAppState();
      expect(state.downloadedImageModels).toHaveLength(0);
      expect(state.activeImageModelId).toBeNull();
      expect(state.generatedImages).toHaveLength(0);

      // Part 2 condition not yet met (no image model downloaded)
      expect(
        state.downloadedImageModels.length > 0 &&
        !state.activeImageModelId &&
        !state.shownSpotlights.imageLoad &&
        !state.onboardingChecklist.triedImageGen
      ).toBe(false);

      // Download image model → Part 2 triggers
      store.addDownloadedImageModel(createONNXImageModel());
      state = getAppState();
      expect(
        state.downloadedImageModels.length > 0 &&
        !state.activeImageModelId &&
        !state.shownSpotlights.imageLoad &&
        !state.onboardingChecklist.triedImageGen
      ).toBe(true);

      // Mark Part 2 shown
      store.markSpotlightShown('imageLoad');

      // Part 3 condition not yet met (no active image model)
      state = getAppState();
      expect(state.activeImageModelId).toBeNull();

      // Load image model → Part 3 triggers
      store.setActiveImageModelId('img-model');
      state = getAppState();
      expect(
        state.activeImageModelId !== null &&
        !state.shownSpotlights.imageNewChat &&
        !state.onboardingChecklist.triedImageGen
      ).toBe(true);

      // Mark Part 3 shown
      store.markSpotlightShown('imageNewChat');

      // Part 4 can trigger (same condition check as Part 3 but different key)
      state = getAppState();
      expect(
        state.activeImageModelId !== null &&
        !state.shownSpotlights.imageDraw &&
        !state.onboardingChecklist.triedImageGen
      ).toBe(true);

      // Mark Part 4 shown
      store.markSpotlightShown('imageDraw');

      // Part 5 condition not yet met (no image generated)
      state = getAppState();
      expect(state.generatedImages).toHaveLength(0);

      // Generate image → Part 5 triggers
      store.addGeneratedImage(createGeneratedImage());
      store.completeChecklistStep('triedImageGen');
      state = getAppState();
      expect(
        state.generatedImages.length > 0 &&
        !state.shownSpotlights.imageSettings &&
        state.onboardingChecklist.triedImageGen
      ).toBe(true);

      // Mark Part 5 shown
      store.markSpotlightShown('imageSettings');

      // All reactive conditions exhausted
      state = getAppState();
      expect(Object.keys(state.shownSpotlights)).toHaveLength(4);
    });
  });

  // ==========================================================================
  // Spotlight step-to-flow mapping validation
  //
  // Ensures every spotlight index maps to the correct flow.
  // ==========================================================================
  describe('spotlight step-to-flow mapping', () => {
    const flowStepMapping: Record<string, number[]> = {
      'Flow 1 (Download a Model)': [0, 9, 10],
      'Flow 2 (Load a Model)': [1, 11],
      'Flow 3 (Send Message)': [2, 3, 12],
      'Flow 4 (Image Generation)': [4, 13, 14, 15, 16],
      'Flow 5 (Explore Settings)': [5, 6],
      'Flow 6 (Create Project)': [7, 8],
    };

    it('all 17 step indices (0-16) are accounted for across all flows', () => {
      const allIndices = Object.values(flowStepMapping).flat().sort((a, b) => a - b);
      expect(allIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    });

    it('no step index is shared between flows', () => {
      const seen = new Set<number>();
      for (const [_flow, indices] of Object.entries(flowStepMapping)) {
        for (const idx of indices) {
          expect(seen.has(idx)).toBe(false);
          seen.add(idx);
        }
      }
    });

    it('primary step for each flow matches STEP_INDEX_MAP', () => {
      expect(flowStepMapping['Flow 1 (Download a Model)'][0]).toBe(STEP_INDEX_MAP.downloadedModel);
      expect(flowStepMapping['Flow 2 (Load a Model)'][0]).toBe(STEP_INDEX_MAP.loadedModel);
      expect(flowStepMapping['Flow 3 (Send Message)'][0]).toBe(STEP_INDEX_MAP.sentMessage);
      expect(flowStepMapping['Flow 4 (Image Generation)'][0]).toBe(STEP_INDEX_MAP.triedImageGen);
      expect(flowStepMapping['Flow 5 (Explore Settings)'][0]).toBe(STEP_INDEX_MAP.exploredSettings);
      expect(flowStepMapping['Flow 6 (Create Project)'][0]).toBe(STEP_INDEX_MAP.createdProject);
    });
  });
});
