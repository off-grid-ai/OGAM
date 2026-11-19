/**
 * BEHAVIORAL (rendered) — the "Support Open-Source AI" sheet shows at most ONCE per
 * app session, no matter how many times generation triggers it (replacing the old
 * 2/10/20 cadence that re-popped it several times a session).
 *
 * Mounts the REAL SharePromptSheet wired to the REAL subscribeSharePrompt (exactly
 * how ChatScreen wires it), drives the REAL trigger (maybeScheduleSharePrompt), and
 * asserts the terminal artifact the user perceives: the sheet's title on screen.
 */
import React, { useEffect, useState } from 'react';
import { render, act } from '@testing-library/react-native';
import { SharePromptSheet } from '../../../src/components/SharePromptSheet';
import {
  subscribeSharePrompt,
  maybeScheduleSharePrompt,
  resetSharePromptSession,
} from '../../../src/utils/sharePrompt';

// The exact wiring ChatScreen uses: an emit flips the sheet visible. `shows` counts how
// many times the sheet was triggered to appear (a false→true visible transition) — the
// user-perceived "the sheet popped up N times". (AppSheet keeps its content mounted after
// first show, so visibility isn't queryable by title; the show-count is the honest signal.)
function Host({ onShow }: { onShow: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => subscribeSharePrompt(() => { onShow(); setVisible(true); }), [onShow]);
  return <SharePromptSheet visible={visible} onClose={() => setVisible(false)} />;
}

const TITLE = /Did that just work for you\?/;

// The ask follows the third good reply in a row.
const threeGoodReplies = () => {
  for (let i = 0; i < 3; i += 1) maybeScheduleSharePrompt({ variant: 'text', hasEngaged: false, delayMs: 0 });
};

describe('share prompt — once per session (rendered)', () => {
  beforeEach(() => { jest.useFakeTimers(); resetSharePromptSession(); });
  afterEach(() => { jest.useRealTimers(); });

  it('pops the sheet exactly once even when generation triggers it repeatedly in a session', () => {
    let shows = 0;
    const view = render(<Host onShow={() => { shows += 1; }} />);
    expect(view.queryByText(TITLE)).toBeNull(); // precondition: nothing shown before any trigger

    // Generation fires the trigger many times across the session (2nd, 3rd, 10th, 20th, 30th).
    act(() => {
      for (let i = 0; i < 30; i += 1) {
        maybeScheduleSharePrompt({ variant: 'text', hasEngaged: false, delayMs: 0 });
      }
      jest.runOnlyPendingTimers();
    });

    expect(shows).toBe(1);                          // popped exactly once, not per-milestone
    expect(view.queryByText(TITLE)).not.toBeNull(); // and the real sheet rendered
  });

  it('pops again in a NEW session (once per session, not once ever)', () => {
    let shows = 0;
    render(<Host onShow={() => { shows += 1; }} />);
    act(() => { threeGoodReplies(); jest.runOnlyPendingTimers(); });
    expect(shows).toBe(1);

    resetSharePromptSession(); // relaunch = new session
    act(() => { threeGoodReplies(); jest.runOnlyPendingTimers(); });
    expect(shows).toBe(2); // once per session
  });
});
