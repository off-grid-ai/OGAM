import RNFS from 'react-native-fs';
import type { LlamaContext } from 'llama.rn';
import logger from '../utils/logger';
import { hashString } from './llmHelpers';

/**
 * Saved KV state per conversation, so returning to a chat skips re-reading its whole history.
 *
 * A file is keyed by the model AND the conversation: a state is only valid for the weights that
 * built it. On restore llama.cpp keeps only the prefix that still matches the next prompt, so an
 * edited or regenerated chat costs a partial re-read, never a wrong answer. Files are bounded
 * (KV state runs to hundreds of MB): only the most recent few are kept.
 */
const MAX_SAVED_SESSIONS = 3;

function kvSessionPath(dir: string, modelPath: string, conversationId: string): string {
  const key = hashString(`${modelPath}\n${conversationId}`);
  return `${dir}/kv-${key}.bin`;
}

async function pruneOldSessions(dir: string): Promise<void> {
  const entries = (await RNFS.readDir(dir)).filter(entry => entry.isFile() && entry.name.startsWith('kv-'));
  const newestFirst = entries.sort((a, b) => (b.mtime?.getTime() ?? 0) - (a.mtime?.getTime() ?? 0));
  await Promise.all(newestFirst.slice(MAX_SAVED_SESSIONS).map(entry => RNFS.unlink(entry.path).catch(() => {})));
}

export async function saveKvSession(context: LlamaContext, dir: string, modelPath: string, conversationId: string): Promise<void> {
  try {
    if (!await RNFS.exists(dir)) await RNFS.mkdir(dir);
    const tokens = await context.saveSession(kvSessionPath(dir, modelPath, conversationId));
    logger.log(`[KV-SESSION] saved ${tokens} tokens for conversation ${conversationId}`);
    await pruneOldSessions(dir);
  } catch (error) {
    logger.warn('[KV-SESSION] save failed:', error);
  }
}

/** Restores the conversation's saved state. False when there is none or it cannot be read; the
 *  caller then starts from an empty cache, as before. */
export async function loadKvSession(context: LlamaContext, dir: string, modelPath: string, conversationId: string): Promise<boolean> {
  const path = kvSessionPath(dir, modelPath, conversationId);
  try {
    if (!await RNFS.exists(path)) return false;
    const result = await context.loadSession(path);
    logger.log(`[KV-SESSION] restored ${result.tokens_loaded} tokens for conversation ${conversationId}`);
    return true;
  } catch (error) {
    logger.warn('[KV-SESSION] restore failed, starting empty:', error);
    await RNFS.unlink(path).catch(() => {});
    return false;
  }
}
