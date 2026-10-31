/**
 * useEjectAllModels — the Eject All affordance on Home and in Chat.
 *
 * Two things matter to a user. Whether the button is offered at all, which is a derivation over FOUR independent
 * pieces of state (a local text model, a local image model, and the same two on a remote server) - someone whose
 * only loaded model is a remote image model still has something to eject. And that pressing it delegates to the
 * one owner of the unload, so the count they are shown is the count actually ejected.
 *
 * The REAL stores are used, and reached through their own ACTIONS rather than by writing fields into them. That
 * distinction matters: setActiveModelId is the production write path - activeModelService calls exactly it
 * (index.ts:143,162,227 and loaders.ts:166), as does remoteServerManagerUtils for the remote pair - so a test
 * that calls the action exercises the same transition the app performs. Writing the field with setState would
 * only prove this hook can read a field somebody set, which is a weaker claim and the one an earlier version of
 * this file made.
 *
 * One layer further up is out of reach here and belongs on a device: the gesture that really loads a model runs
 * through the native engine. The line is drawn at the action, which is the last point that is still ours.
 *
 * They were previously stood in for with plain objects behind a fake selector, which cost two things: the
 * derivation ran against invented state, and the fake selector was NOT reactive - so nothing could prove the
 * button appears the moment a model becomes active, which is the entire point of a reactive derivation. Zustand
 * needs no native module (its persistence goes through AsyncStorage, stood in for at the boundary already).
 *
 * The eject itself runs for real: a model is loaded through activeModelService on the phone's fake native engine
 * (harness/generationDevice), and the hook's eject unloads it through the one owner of that journey.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useAppStore, useRemoteServerStore } from '../../../src/stores';

import { useEjectAllModels } from '../../../src/hooks/useEjectAllModels';
import { launchGeneration } from '../../harness/generationDevice';
import { requireRTL } from '../../harness/nativeBoundary';

/** Nothing loaded anywhere - the state a fresh install is in, reached the way the app reaches it. */
const nothingActive = (): void => {
  const app = useAppStore.getState();
  app.setActiveModelId(null);
  app.setActiveImageModelId(null);
  const remote = useRemoteServerStore.getState();
  remote.setActiveRemoteTextModelId(null);
  remote.setActiveRemoteImageModelId(null);
};

beforeEach(() => {
  nothingActive();
});

describe('useEjectAllModels', () => {
  it('offers nothing to eject when nothing is loaded', () => {
    expect(renderHook(() => useEjectAllModels()).result.current.hasActiveModel).toBe(false);
  });

  it.each([
    ['a local text model', (): void => useAppStore.getState().setActiveModelId('gemma')],
    ['a local image model', (): void => useAppStore.getState().setActiveImageModelId('sdxl')],
    [
      'a remote text model',
      (): void => useRemoteServerStore.getState().setActiveRemoteTextModelId('r1'),
    ],
    [
      'a remote image model',
      (): void => useRemoteServerStore.getState().setActiveRemoteImageModelId('r2'),
    ],
  ])('offers the eject when the only thing loaded is %s', (_what, load) => {
    // Each of the four enables it independently. An `||` chain that dropped one would silently strand the user
    // whose only loaded model is that one.
    load();

    expect(renderHook(() => useEjectAllModels()).result.current.hasActiveModel).toBe(true);
  });

  it('appears the moment a model becomes active, with no re-render asked for', () => {
    const { result } = renderHook(() => useEjectAllModels());
    expect(result.current.hasActiveModel).toBe(false);

    // The real store, so this is the real subscription. With a fake selector over a plain object this assertion
    // could not be written at all - and its absence is why a broken subscription would have gone unnoticed.
    act(() => {
      useAppStore.getState().setActiveModelId('gemma');
    });

    expect(result.current.hasActiveModel).toBe(true);
  });

  it('stops being offered once the last model is ejected', () => {
    useAppStore.getState().setActiveModelId('gemma');
    const { result } = renderHook(() => useEjectAllModels());
    expect(result.current.hasActiveModel).toBe(true);

    act(() => {
      nothingActive();
    });

    // A stale Eject All after everything is unloaded is a button that does nothing when pressed.
    expect(result.current.hasActiveModel).toBe(false);
  });

  it('ejects what is loaded and reports how many were ejected', async () => {
    // A model really loaded on the phone, through the app's own load path.
    const device = await launchGeneration();
    expect(device.llmService.isModelLoaded()).toBe(true);
    // The launch started a fresh module graph: render with its React.
    const rtl = requireRTL();
    const { useEjectAllModels: useEject } = require('../../../src/hooks/useEjectAllModels');
    const { result } = rtl.renderHook(() => useEject());
    expect(result.current.hasActiveModel).toBe(true);

    let count = -1;
    await rtl.act(async () => {
      count = await result.current.ejectAll();
    });

    // The count shown to the user is the number the owner of the unload actually ejected.
    expect(count).toBe(1);
    expect(device.llmService.isModelLoaded()).toBe(false);
  });

  // FINDING (2026-11-01): eject keeps the user's selection by design, but this hook offers Eject All from the
  // selection, so after everything is ejected the button stays and a second press ejects nothing. The hook should
  // read what is loaded (the store's loadedTextModelId, plus a loaded-image projection activeModelService does not
  // publish yet). Marked failing so it turns red, and must be flipped to `it`, when that is fixed.
  it.failing('stops offering Eject All once everything is really ejected', async () => {
    await launchGeneration();
    const rtl = requireRTL();
    const { useEjectAllModels: useEject } = require('../../../src/hooks/useEjectAllModels');
    const { result } = rtl.renderHook(() => useEject());
    await rtl.act(async () => {
      await result.current.ejectAll();
    });
    expect(result.current.hasActiveModel).toBe(false);
  });
});
