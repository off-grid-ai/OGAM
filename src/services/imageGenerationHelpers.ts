import type { PortableMessageState } from '@offgrid/application';
import {
  selectImageEnhancementContext,
} from '@offgrid/models';
import {
  isRuntimeOnlyMessage,
  PROMPT_ENHANCEMENT_REASONING_LABEL,
} from '@offgrid/sync';
import { useAppStore } from '../stores';
import { Message } from '../types';
import { parseModelOutput } from '../utils/messageContent';
import { maybeScheduleSharePrompt } from '../utils/sharePrompt';
import { applicationFacade } from './applicationFacade';
import { reportModelFailure } from './modelFailureHandler';
import { checkProPromptForImage } from './proPrompt';
import type {
  ImageGenerationState,
} from './imageGenerationTypes';

export function imagePhaseTransitionLog(
  previous: ImageGenerationState['phase'],
  state: Omit<ImageGenerationState, 'isGenerating'>,
): string {
  const status = state.status ? ` (${state.status})` : '';
  const error = state.error ? ` error=${state.error}` : '';
  return `[IMG-SM] phase ${previous} → ${state.phase}${status}${error}`;
}

export function reportEnhancementSkipped(reason: string): void {
  reportModelFailure('text', reason, {
    severity: 'warning',
    title: 'Prompt enhancement skipped',
    message: `Generating from your original prompt — ${reason}.`,
  });
}

export function scheduleImageSharePrompt(): void {
  const appStore = useAppStore.getState();
  const count = appStore.incrementImageGenerationCount();
  const delayMs = 2000;
  maybeScheduleSharePrompt({
    variant: 'image',
    count,
    hasEngaged: appStore.hasEngagedSharePrompt,
    delayMs,
  });
  checkProPromptForImage(delayMs);
}

/**
 * The conversation as a READER sees it, which is the only thing a model should be shown.
 *
 * Sending `message.content` sent the STORAGE form: the enhancement card's own container markup, and
 * our completion strings. Shown ten of those, the model stopped enhancing and started imitating -
 * it emitted `<think>__LABEL:Enhanced prompt__` token by token, and returned `Generated image for:
 * "Draw a fox"` as its idea of an enhanced prompt. A marker we invented for the screen must never
 * become model input.
 *
 * So: the enhancement's own cards are dropped, because they are this feature talking to itself and
 * carry no conversation, and everything else is passed through the one display parse.
 *
 * Reads the Workspace Content snapshot, not the legacy Zustand mirror: the generated-image result
 * row and tool-loop context rows are durable ONLY through Workspace Content (see
 * `imageGenerationResult.ts` / `modelServices/toolExecutorPorts.ts`), so a Shared-created
 * conversation's context would be silently incomplete if this still read `useChatStore`.
 */
function contextMessageText(content: PortableMessageState['content']): string {
  if (typeof content === 'string') return content;
  return content.map(part => (part.type === 'text' ? part.text : '')).join('');
}

export function getConversationContext(conversationId: string): Message[] {
  const messages = applicationFacade()
    .workspaceContent.snapshot()
    .messages.filter(message => message.conversationId === conversationId);
  if (!messages.length) return [];
  return selectImageEnhancementContext(messages.map(message => {
    const content = contextMessageText(message.portable.content);
    const reasoningContent = message.portable.context?.reasoning;
    const isSystemInfo = message.portable.context?.notice;
    const generationMeta = (message.local as Partial<Message> | undefined)?.generationMeta;
    const timestamp = Date.parse(message.createdAt);
    const parsed = parseModelOutput(content, reasoningContent);
    return {
      id: `ctx-${message.id}`,
      role: message.portable.role,
      content,
      timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
      answer: parsed.answer,
      reasoning: parsed.reasoning,
      runtimeOnly: isRuntimeOnlyMessage({
        role: message.portable.role,
        content,
        notice: isSystemInfo,
      }),
      generatedImage: Boolean(generationMeta?.resolution),
      promptEnhancement: parsed.reasoningLabel === PROMPT_ENHANCEMENT_REASONING_LABEL,
    };
  })) as Message[];
}

/** THE one writer of the "Enhanced prompt" card's message content — partial (streaming) and final
 *  both go through it, so the two can never disagree.
 *
 *  The card is a labelled `<think>` container the renderer turns into the collapsible block. Raw
 *  model output must NEVER be dropped into it verbatim: the model emits its own `<think>…</think>`,
 *  and a nested pair makes the outer container ambiguous (the first `</think>` closes it), which is
 *  how markup reached the screen. So the partial is run through the ONE display parse first and only
 *  its clean text is wrapped. While the model is still reasoning there is no answer yet — the
 *  reasoning is shown instead, so the card fills in live rather than sitting empty. */
export function buildEnhancementCardContent(raw: string): string {
  const { reasoning, answer } = parseModelOutput(raw);
  const body = (answer || reasoning || '').trim();
  return `<think>__LABEL:${PROMPT_ENHANCEMENT_REASONING_LABEL}__\n${body}</think>`;
}
