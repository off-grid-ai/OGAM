/**
 * Qwen3-ASR transcription on llama.rn: the GGUF plus its audio projector (llama.cpp mtmd `qwen3a`).
 *
 * The model takes one user turn holding only the audio and answers
 * `language <Name><asr_text><transcript>`. When the person pinned a language Qwen3-ASR knows, the
 * assistant turn is prefilled with `language <Name><asr_text>`, so the model writes that language.
 */
import { Platform } from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';
import logger from '../utils/logger';
import { transcriptionLanguages } from '@offgrid/speech';
import { QWEN_ASR_MODEL_ID, type QwenAsrFiles } from './qwenAsrModel';

/** Room for a few minutes of audio (the encoder emits about 13 tokens a second) and the transcript. */
const ASR_CONTEXT_TOKENS = 4096;
const ASR_MAX_TRANSCRIPT_TOKENS = 1024;
const ASR_TEXT = '<asr_text>';

/** The languages Qwen3-ASR names, by the codes the language setting stores: the shared list's label
 *  is the name the model writes before its transcript, so the picker and the prompt cannot disagree. */
const QWEN_ASR_LANGUAGES: Readonly<Record<string, string>> = Object.fromEntries(
  transcriptionLanguages('qwen3-asr', QWEN_ASR_MODEL_ID)
    .filter(({ code }) => code !== 'auto')
    .map(({ code, label }) => [code, label]),
);

/** The transcript in a Qwen3-ASR reply: the text after `<asr_text>`, without special tokens. */
function parseQwenAsrText(raw: string): string {
  const at = raw.lastIndexOf(ASR_TEXT);
  const body = at >= 0 ? raw.slice(at + ASR_TEXT.length) : raw.replace(/^\s*language\s+\S+\s*/i, '');
  return body.replace(/<\|[^|>]*\|>/g, '').replace(/<\/?asr_text>/g, '').trim();
}

export class QwenAsrEngine {
  private context: LlamaContext | null = null;

  isLoaded(): boolean {
    return this.context !== null;
  }

  async load(files: QwenAsrFiles): Promise<void> {
    await this.release();
    const ios = Platform.OS === 'ios';
    logger.log(`[ASR] Loading Qwen3-ASR ${files.primary.name} (${ios ? 'Metal' : 'CPU'})`);
    const context = await initLlama({
      model: files.primary.path,
      n_ctx: ASR_CONTEXT_TOKENS,
      n_gpu_layers: ios ? 99 : 0,
      use_mlock: false,
      ...(ios ? {} : { devices: ['CPU'] }),
    });
    let audio = false;
    try {
      audio = await context.initMultimodal({ path: files.mmproj.path, use_gpu: ios });
    } catch (error) {
      logger.error('[ASR] Audio projector failed to load:', error);
    }
    if (!audio) {
      await context.release().catch(() => {});
      throw new Error('Qwen3-ASR audio projector did not load');
    }
    this.context = context;
  }

  async transcribe(wavPath: string, language?: string): Promise<string> {
    const context = this.context;
    if (!context) throw new Error('No Qwen3-ASR model loaded');
    const messages = [{
      role: 'user',
      content: [{ type: 'input_audio', input_audio: { format: 'wav', url: wavPath } }],
    }];
    const sampling = { temperature: 0, n_predict: ASR_MAX_TRANSCRIPT_TOKENS };
    const languageName = language ? QWEN_ASR_LANGUAGES[language] : undefined;
    const started = Date.now();
    let result;
    if (languageName) {
      const chat = await context.getFormattedChat(messages, null, { add_generation_prompt: true });
      result = await context.completion({
        ...sampling,
        prompt: `${chat.prompt}language ${languageName}${ASR_TEXT}`,
        media_paths: chat.media_paths,
      });
    } else {
      result = await context.completion({ ...sampling, messages });
    }
    const text = parseQwenAsrText(result.text ?? '');
    // Shape only: the transcript is what the person said and never goes in the log.
    logger.log(`[ASR] Qwen3-ASR transcribed ${text.length}ch in ${Date.now() - started}ms (language=${languageName ?? 'auto'})`);
    return text;
  }

  async release(): Promise<void> {
    const context = this.context;
    this.context = null;
    if (!context) return;
    try {
      await context.release();
    } catch (error) {
      logger.error('[ASR] Error releasing Qwen3-ASR context:', error);
    }
  }
}
