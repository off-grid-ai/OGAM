import { useCallback } from 'react';
import { useAppNavigate } from '../navigation/useAppNavigate';
import type { ModelKind, ReadinessAction } from '@offgrid/features';
import { allowPermission, openAppSettings } from '../services/osPermissions';

/** The Models tab where each kind of model is found. */
export const MODELS_TAB: Record<ModelKind, 'text' | 'image' | 'video' | 'voice' | 'transcription'> = {
  chat: 'text',
  vision: 'text',
  image: 'image',
  video: 'video',
  voice: 'voice',
  speech: 'transcription',
};

/**
 * Runs a readiness step: Get a model opens Models on the right tab, Allow and Open Settings fix the
 * permission. Choose model and Try again belong to the screen, so it passes them in.
 */
export function useReadinessAction(handlers: {
  onChooseModel?: () => void;
  onRetry?: () => void;
  /** Called after Allow, with whether the permission is now on. */
  onAllowed?: (granted: boolean) => void;
} = {}): (action: ReadinessAction) => void {
  const navigate = useAppNavigate();
  const { onChooseModel, onRetry, onAllowed } = handlers;
  return useCallback(
    (action: ReadinessAction) => {
      switch (action.kind) {
        case 'get-model':
          navigate('Main', { screen: 'ModelsTab', params: { initialTab: MODELS_TAB[action.tab] } });
          return;
        case 'choose-model':
          onChooseModel?.();
          return;
        case 'retry':
          onRetry?.();
          return;
        case 'allow':
          allowPermission(action.permission).then(granted => onAllowed?.(granted)).catch(() => undefined);
          return;
        case 'open-settings':
          openAppSettings();
      }
    },
    [navigate, onChooseModel, onRetry, onAllowed],
  );
}
