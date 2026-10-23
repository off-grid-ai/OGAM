/**
 * `features_snapshot` (docs/ANALYTICS.md): one true/false per feature that is switched on.
 * Core reads its own stores; Pro adds its features through HOOKS.analyticsProFeatures.
 */
import { useAppStore } from '../../stores/appStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useWhisperStore } from '../../stores/whisperStore';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';

export function featureSnapshot(): Record<string, boolean> {
  const app = useAppStore.getState();
  const tools = app.settings.enabledTools;
  const active = app.downloadedModels.find(model => model.id === app.activeModelId);
  const visionFlag = active?.engine === 'litert' ? active.liteRTVision : active?.isVisionModel;
  const vision = !!visionFlag;
  return {
    voice_input: !!useWhisperStore.getState().downloadedModelId,
    image_generation: !!app.activeImageModelId,
    video_generation: !!app.activeVideoModelId || !!useRemoteServerStore.getState().activeRemoteMediaServerIds.video,
    vision,
    web_search: tools.includes('web_search'),
    tools: tools.length > 0,
    remote_server: useRemoteServerStore.getState().servers.length > 0,
    ...callHook<Record<string, boolean>>(HOOKS.analyticsProFeatures),
  };
}
