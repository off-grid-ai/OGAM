import { useDevInferenceStore } from '../stores/devInferenceStore';
import logger from '../utils/logger';

/**
 * DEV-ONLY grammar test harness (see docs/plans/chat-grammar-test-harness-plan.md).
 *
 * When the dev inference override is enabled, mutate an in-flight llama.rn
 * `completionParams` object to apply a pasted GBNF grammar, a fixed temperature,
 * and/or an assistant prefill - and drop tools, since a custom grammar can't
 * coexist with the tool-calling grammar.
 *
 * No-op unless explicitly enabled from the __DEV__ grammar modal, so it has zero
 * effect on normal / production chat.
 *
 * @returns true if a custom grammar was applied, so the caller can fall back to
 * an ungrammared retry if llama.rn rejects an invalid GBNF.
 */
/**
 * Cheap sanity check so an obviously-malformed grammar never reaches native
 * (a pathological GBNF can hard-crash llama.cpp below the JS layer, which a
 * try/catch can't recover). A valid GBNF must define a `root` rule with `::=`.
 * Returns an error string if the grammar looks invalid, else null.
 */
function grammarLooksInvalid(grammar: string): string | null {
  const g = grammar.trim();
  if (!g.includes('::=')) return 'no rule definition (missing "::=")';
  if (!/(^|\n)\s*root\s*::=/.test(g)) return 'no "root" rule';
  return null;
}

export function applyDevGrammarOverrides(params: Record<string, any>): boolean {
  const dev = useDevInferenceStore.getState();
  if (!dev.enabled) return false;

  const toolCount = Array.isArray(params.tools) ? params.tools.length : 0;
  let grammarApplied = false;
  const hasGrammar = !!(dev.grammar && dev.grammar.trim().length > 0);
  if (hasGrammar) {
    const invalid = grammarLooksInvalid(dev.grammar);
    if (invalid) {
      // Don't hand a broken grammar to native - record it and run this turn
      // normally so chat never crashes.
      useDevInferenceStore.getState().setLastError(`Invalid grammar: ${invalid}`);
      logger.warn(`[DevGrammar] grammar rejected before native (${invalid}) - running turn normally`);
    } else {
      params.grammar = dev.grammar;
      // A pasted grammar and the tool-calling grammar are mutually exclusive, so
      // tools are off for any turn that carries a custom grammar.
      delete params.tools;
      delete params.tool_choice;
      grammarApplied = true;
    }
  } else {
    // Enabled but nothing pasted - the most common "why isn't it working" case.
    logger.warn('[DevGrammar] override ENABLED but grammar is empty - this turn runs normally');
  }
  if (typeof dev.temperature === 'number' && !Number.isNaN(dev.temperature)) {
    params.temperature = dev.temperature;
  }
  if (dev.assistantPrefix.length > 0 && Array.isArray(params.messages)) {
    // Prefill: a trailing partial assistant turn the model continues from.
    params.messages = [...params.messages, { role: 'assistant', content: dev.assistantPrefix }];
  }
  // Hard output cap (words -> tokens, ~1.5 tokens/word incl. formatting). Also
  // the safety valve against a grammar that never lets the model stop.
  if (typeof dev.maxWords === 'number' && dev.maxWords > 0) {
    params.n_predict = Math.ceil(dev.maxWords * 1.5);
  }
  logger.log(
    `[DevGrammar] APPLIED grammar=${grammarApplied} grammarLen=${grammarApplied ? dev.grammar.length : 0} ` +
      `temp=${params.temperature} prefill=${dev.assistantPrefix ? JSON.stringify(dev.assistantPrefix) : 'none'} ` +
      `maxWords=${dev.maxWords ?? 'none'} n_predict=${params.n_predict} toolsStripped=${grammarApplied ? toolCount : 0}`,
  );
  // A fresh run clears any stale error, unless we just set one above.
  if (dev.lastError && grammarApplied) useDevInferenceStore.getState().setLastError(undefined);
  return grammarApplied;
}

/**
 * Record a completion failure that happened after a dev grammar was applied and
 * strip the grammar from `params`, so the caller can retry ungrammared. A bad
 * GBNF paste should surface in the modal, never brick chat.
 */
export function noteDevGrammarError(params: Record<string, any>, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  useDevInferenceStore.getState().setLastError(msg);
  delete params.grammar;
  logger.warn(`[DevGrammar] completion failed, retrying ungrammared: ${msg}`);
}
