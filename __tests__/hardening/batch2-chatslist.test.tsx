/**
 * Batch 2 hardening — Chats list (sort, timestamp formatting, delete, empty state)
 *
 * Renders the REAL ChatsListScreen on a real React Navigation stack, with the real alert, model
 * sheet, list rows, swipe actions and chat store, so the REAL formatDate(), the REAL sort comparator
 * and the REAL chatStore.deleteConversation run. Chats are written through the chat store's own
 * actions; their dates come from a faked clock. Only the device is faked (installNativeBoundary:
 * native modules and RAM). These tests assert the actual formatted string and the actual row order:
 *
 *   25/30 — most-recently-active conversation floats to position 1 (real sort order).
 *   26    — a conversation from TODAY shows a clock time (HH:MM), not a date.
 *   27    — a conversation from a prior day shows a weekday / month-day, not a clock.
 *   31    — deleting a conversation removes exactly that row (real store delete).
 *   32    — deleting all conversations shows the empty state ("No Chats Yet").
 */
import { installNativeBoundary, requireRTL, GB } from '../harness/nativeBoundary';
import { withNavigator } from '../harness/realNavigation';

jest.unmock('@react-navigation/native');

type Rtl = ReturnType<typeof requireRTL>;

function boot() {
  installNativeBoundary({ ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 4 * GB } });
  const React = require('react');
  const rtl = requireRTL();
  const { useChatStore } = require('../../src/stores/chatStore');
  const { useAppStore } = require('../../src/stores/appStore');
  const localTime = require('../../src/utils/localTime');
  // A downloaded, chosen model so the list behaves as a returning person's.
  const model = require('../utils/factories').createDownloadedModel();
  useAppStore.getState().addDownloadedModel(model);
  useAppStore.getState().setActiveModelId(model.id);
  return {
    rtl,
    chats: useChatStore,
    localTime,
    /** Start a chat now (on the clock as it stands). */
    chat: (title: string): string => useChatStore.getState().createConversation(model.id, title),
    render: (): ReturnType<Rtl['render']> => {
      const { ChatsListScreen } = require('../../src/screens/ChatsListScreen');
      return rtl.render(withNavigator(React.createElement(ChatsListScreen)));
    },
  };
}

/** Start a chat dated `daysAgo` days before the faked "now". */
function chatDaysAgo(app: ReturnType<typeof boot>, title: string, now: Date, daysAgo: number): Date {
  const when = new Date(now);
  when.setDate(when.getDate() - daysAgo);
  jest.setSystemTime(when);
  app.chat(title);
  jest.setSystemTime(now);
  return when;
}

describe('batch2 ChatsListScreen — sort, timestamp format, delete, empty', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // Case 26: today's conversation shows a clock time, NOT a date. Expected strings are built with
  // src/utils/localTime (the app's own device-zone formatting), so this agrees with the app in any zone.
  it('case26: shows a clock time for a conversation from today', () => {
    const app = boot();
    const now = new Date(2026, 9, 30, 14, 5);
    jest.useFakeTimers({ now });
    app.chat('Today Chat');

    const { getByText } = app.render();
    const expectedClock = app.localTime.formatClockTime(now);
    expect(getByText(expectedClock)).toBeTruthy();
    // it is NOT a weekday or month/day string
    expect(expectedClock).toMatch(/\d/);
  });

  // Case 27: a prior-day conversation shows a weekday (within a week) — not a clock.
  it('case27: shows a weekday name for a conversation 3 days ago (not a clock time)', () => {
    const app = boot();
    const now = new Date(2026, 9, 30, 14, 5);
    jest.useFakeTimers({ now });
    const threeDaysAgo = chatDaysAgo(app, 'Recent Chat', now, 3);

    const { getByText } = app.render();
    const expectedWeekday = app.localTime.formatWeekday(threeDaysAgo);
    expect(getByText(expectedWeekday)).toBeTruthy();
    // guard: a weekday short name is not a HH:MM clock
    expect(expectedWeekday).not.toMatch(/^\d{1,2}:\d{2}/);
  });

  // Case 27 (older bucket): a >1-week-old conversation shows month/day.
  it('case27: shows month/day for a conversation 14 days ago', () => {
    const app = boot();
    const now = new Date(2026, 9, 30, 14, 5);
    jest.useFakeTimers({ now });
    const twoWeeksAgo = chatDaysAgo(app, 'Old Chat', now, 14);

    const { getByText } = app.render();
    expect(getByText(app.localTime.formatShortDate(twoWeeksAgo))).toBeTruthy();
  });

  // Cases 25/30: most-recently-active conversation is at position 1 (row index 0).
  it('case25/30: most-recently-updated conversation sorts to the top row', () => {
    const app = boot();
    // created oldest-first so ONLY the real comparator can produce the correct order
    jest.useFakeTimers({ now: new Date(2024, 0, 1, 10, 0) });
    app.chat('Older Chat');
    jest.setSystemTime(new Date(2024, 5, 1, 10, 0));
    app.chat('Newer Chat');

    const { getByTestId } = app.render();
    expect(app.rtl.within(getByTestId('conversation-item-0')).getByText('Newer Chat')).toBeTruthy();
    expect(app.rtl.within(getByTestId('conversation-item-1')).getByText('Older Chat')).toBeTruthy();
  });

  // Case 31 (through the UI): the swipe-delete action opens a confirm alert whose Delete button
  // removes exactly that conversation from the real store, leaving the rest intact.
  it('case31: confirming the swipe-delete alert removes exactly that conversation', async () => {
    const app = boot();
    app.chat('Bravo');
    app.chat('Alpha');
    const view = app.render();

    app.rtl.fireEvent.press(view.getByLabelText('Delete Alpha'));
    expect(view.getByText('Delete Chat')).toBeTruthy();
    // The delete removes the chat's image files first, then the chat.
    await app.rtl.act(async () => { app.rtl.fireEvent.press(view.getByText('Delete')); });

    await app.rtl.waitFor(() => expect(view.queryByText('Alpha')).toBeNull());
    // exactly one conversation was removed; the other survives
    expect(app.chats.getState().conversations.map((c: { title: string }) => c.title)).toEqual(['Bravo']);
    expect(view.getByText('Bravo')).toBeTruthy();
  });

  // Case 32: deleting all conversations shows the empty state.
  it('case32: empty conversation list renders the "No Chats Yet" empty state', async () => {
    const app = boot();
    app.chat('Only Chat');
    const view = app.render();

    app.rtl.fireEvent.press(view.getByLabelText('Delete Only Chat'));
    await app.rtl.act(async () => { app.rtl.fireEvent.press(view.getByText('Delete')); });

    await app.rtl.waitFor(() => expect(view.getByText('No Chats Yet')).toBeTruthy());
    expect(view.queryByTestId('conversation-list')).toBeNull();
  });
});
