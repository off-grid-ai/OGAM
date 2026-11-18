import { APP_CONFIG } from '../constants';
import { useAppStore } from '../stores/appStore';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { llmService } from './llm';

/**
 * The context window the configured text model has, in tokens, without LiteRT (engines.ts adds what a
 * loaded LiteRT model holds): for a remote server, what that server reports for the active model
 * (LM Studio, Ollama, llama-server); otherwise llama.cpp's setting. A remote model that reports nothing
 * falls back to the context setting, as before.
 */
export function configuredContextTokens(): number {
  const remote = useRemoteServerStore.getState();
  if (remote.activeServerId) {
    return (
      remote.getActiveRemoteTextModel()?.capabilities.maxContextLength ||
      useAppStore.getState().settings.contextLength ||
      APP_CONFIG.maxContextLength
    );
  }
  return llmService.getPerformanceSettings().contextLength || APP_CONFIG.maxContextLength;
}
