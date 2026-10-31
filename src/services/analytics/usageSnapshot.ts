/**
 * `usage_snapshot` (docs/ANALYTICS.md): once a day, how much the person has, in counts only, each
 * rounded down to a fixed step (countBucket), plus the appearance they chose. Never a name or a word.
 * Core reads its own stores; Pro adds its counts through HOOKS.analyticsProUsage.
 */
import { PixelRatio } from 'react-native';
import { useAppStore } from '../../stores/appStore';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { useWhisperStore } from '../../stores/whisperStore';
import { knowledgeBase } from '../rag';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { countBucket, oneDecimal } from './values';

export async function usageSnapshot(): Promise<Record<string, number | string>> {
  const app = useAppStore.getState();
  const conversations = useChatStore.getState().conversations;
  let messages = 0;
  let userMessages = 0;
  for (const conversation of conversations) {
    messages += conversation.messages.length;
    for (const message of conversation.messages) if (message.role === 'user') userMessages += 1;
  }
  const documents = await knowledgeBase.documentIds().then(ids => ids.length, () => 0);
  const counts: Record<string, number> = {
    chats: conversations.length,
    messages,
    user_messages: userMessages,
    projects: useProjectStore.getState().projects.length,
    knowledge_documents: documents,
    generated_images: app.generatedImages.length,
    generated_videos: app.generatedVideos.length,
    models_text: app.downloadedModels.length,
    models_image: app.downloadedImageModels.length,
    models_video: app.downloadedVideoModels.length,
    models_stt: useWhisperStore.getState().downloadedModelId ? 1 : 0,
    remote_servers: useRemoteServerStore.getState().servers.length,
    ...callHook<Record<string, number>>(HOOKS.analyticsProUsage),
  };
  const bucketed: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(counts)) bucketed[key] = countBucket(value);
  bucketed.theme = app.themeMode;
  bucketed.font_scale = oneDecimal(PixelRatio.getFontScale()) ?? 1;
  return bucketed;
}
