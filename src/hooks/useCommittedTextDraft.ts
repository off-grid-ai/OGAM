import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A text field whose keystrokes are LOCAL ONLY. Nothing leaves this hook until `save` runs, so a
 * character can never reach persistence, sync or a global store write.
 *
 * Latest-wins is explicit: each save takes a ticket, and only the newest ticket may report a
 * result. A save that is superseded neither clears the draft nor overwrites a newer error.
 *
 * A failed save keeps the draft exactly as the user typed it and exposes an actionable message.
 */
export interface CommittedTextDraft {
  /** The value the input renders. Local draft while dirty, otherwise the committed value. */
  value: string;
  setValue: (next: string) => void;
  /** True while the draft differs from the committed value. */
  isDirty: boolean;
  saving: boolean;
  /** Actionable failure from the last save attempt, or null. */
  error: string | null;
  save: () => void;
  revert: () => void;
}

const failureMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message
    ? cause.message
    : 'Could not save. Please try again.';

export function useCommittedTextDraft(
  committed: string,
  commit: (value: string) => void | Promise<void>,
): CommittedTextDraft {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const value = draft ?? committed;
  const isDirty = draft !== null && draft !== committed;

  const setValue = useCallback((next: string) => {
    setDraft(next);
    setError(null);
  }, []);

  const revert = useCallback(() => {
    setDraft(null);
    setError(null);
  }, []);

  const save = useCallback(() => {
    if (draft === null || draft === committed) return;
    const mine = (ticket.current += 1);
    const pending = draft;
    setSaving(true);
    setError(null);
    const run = async (): Promise<void> => {
      try {
        await commit(pending);
        if (!live.current || ticket.current !== mine) return;
        // Only drop the draft when it is still the text that was saved; a keystroke that landed
        // during the save must survive.
        setDraft(current => (current === pending ? null : current));
      } catch (cause) {
        if (!live.current || ticket.current !== mine) return;
        setError(failureMessage(cause));
      } finally {
        if (live.current && ticket.current === mine) setSaving(false);
      }
    };
    run().catch(() => {
      /* run() already reports every failure through setError. */
    });
  }, [commit, committed, draft]);

  return { value, setValue, isDirty, saving, error, save, revert };
}
