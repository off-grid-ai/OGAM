/**
 * When to ask for analytics consent outside Auto Setup (docs/ANALYTICS.md, Consent):
 *
 * - After a model download, model load or generation fails, when the person has not opted in and
 *   was not asked in the last 30 days.
 * - Once ever, after the first successful reply, for a person who installed before this version
 *   and was never asked.
 *
 * This module owns only WHICH prompt is open. The prompt component renders it and records the
 * answer through the analytics owner.
 */
import { create } from 'zustand';
import { useAppStore } from '../../stores/appStore';

export type ConsentPromptKind = 'failure' | 'first_chat';

const PROMPT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export const useConsentPromptStore = create<{ kind: ConsentPromptKind | null }>(() => ({ kind: null }));

function optedIn(): boolean {
  const { analyticsUsage, analyticsCrashes } = useAppStore.getState().settings;
  return !!analyticsUsage || !!analyticsCrashes;
}

/** Each caller records the ask first, so a second prompt can never open over the first. */
function show(kind: ConsentPromptKind): void {
  useAppStore.getState().updateSettings({ analyticsAsked: true, analyticsLastPromptAt: Date.now() });
  useConsentPromptStore.setState({ kind });
}

export function maybePromptAfterFailure(): void {
  if (optedIn()) return;
  const last = useAppStore.getState().settings.analyticsLastPromptAt;
  if (last && Date.now() - last < PROMPT_INTERVAL_MS) return;
  show('failure');
}

export function maybePromptAfterFirstChat(): void {
  if (optedIn() || useAppStore.getState().settings.analyticsAsked) return;
  show('first_chat');
}

export function closeConsentPrompt(): void {
  useConsentPromptStore.setState({ kind: null });
}
