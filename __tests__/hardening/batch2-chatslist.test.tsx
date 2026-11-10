/**
 * Batch 2 hardening — Chats list (sort, timestamp formatting, delete, empty state)
 *
 * Renders the REAL ChatsListScreen on a real React Navigation stack, with the real alert, model
 * sheet, list rows, swipe actions and chat store, so the REAL day grouping, the REAL sort comparator
 * and the REAL chatStore.deleteConversation run. Chats are written through the chat store's own
 * actions; their dates come from a faked clock. Only the device is faked (installNativeBoundary:
 * native modules and RAM). These tests assert the actual heading, row text and row order:
 *
 *   25/30 — most-recently-active conversation floats to position 1 (real sort order).
 *   26    — a conversation from TODAY sits under the Today heading; its row shows no clock time.
 *   27    — an older conversation sits under This week / Older; its row shows no weekday or date.
 *   31    — deleting a conversation removes exactly that row (real store delete).
 *   32    — deleting all conversations shows the empty state ("No Chats Yet").
 */
import { installNativeBoundary, requireRTL, GB } from '../harness/nativeBoundary';
import { withNavigator } from '../harness/realNavigation';
// Pure date formatting: the same module the list renders with, for the expected text.
import { formatShortDate, formatWeekday } from '../../src/utils/localTime';

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

/** The one day heading of a one-chat list, and every text its single row shows. */
function headingAndRow(app: ReturnType<typeof boot>, view: ReturnType<Rtl['render']>) {
  const list = app.rtl.within(view.getByTestId('conversation-list'));
  const row = app.rtl.within(view.getByTestId('conversation-item-0'));
  const texts = (nodes: ReadonlyArray<{ props: Record<string, unknown> }>) => nodes.map(node => String(node.props.children));
  return { heading: list.getAllByRole('header').map(node => String(node.props.accessibilityLabel)).join(), row: texts(row.queryAllByText(/./)) };
}

describe('batch2 ChatsListScreen — sort, timestamp format, delete, empty', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // Cases 26/27: the day heading says when (Today, Yesterday, then the day itself, like Claude's list); the row itself shows no clock time, weekday, "Last week",
  // "N weeks ago" or date. Each case reads the heading above the chat and the row's own texts.
  it('case26: a conversation from today sits under Today, and its row shows no clock time', () => {
    const app = boot();
    const now = new Date(2026, 9, 30, 14, 5);
    jest.useFakeTimers({ now });
    app.chat('Today Chat');

    const view = app.render();
    expect(headingAndRow(app, view)).toEqual({ heading: 'Today', row: ['Today Chat'] });
    expect(view.queryByText(app.localTime.formatClockTime(now))).toBeNull();
  });

  it('case27: a conversation 3 days ago sits under its day, and its row shows no weekday', () => {
    const app = boot();
    const now = new Date(2026, 9, 30, 14, 5);
    jest.useFakeTimers({ now });
    const threeDaysAgo = chatDaysAgo(app, 'Recent Chat', now, 3);

    const view = app.render();
    expect(headingAndRow(app, view)).toEqual({ heading: 'Oct 27', row: ['Recent Chat'] });
    expect(view.queryByText(formatWeekday(threeDaysAgo))).toBeNull();
  });

  it('case27: a conversation 10 days ago sits under its day, and its row does not say "Last week"', () => {
    const app = boot();
    const now = new Date(2026, 9, 30, 14, 5);
    jest.useFakeTimers({ now });
    chatDaysAgo(app, 'Last Week Chat', now, 10);

    const view = app.render();
    expect(headingAndRow(app, view)).toEqual({ heading: 'Oct 20', row: ['Last Week Chat'] });
    expect(view.queryByText('Last week')).toBeNull();
  });

  it('case27: a conversation 14 days ago sits under its day, and its row does not say "2 weeks ago"', () => {
    const app = boot();
    const now = new Date(2026, 9, 30, 14, 5);
    jest.useFakeTimers({ now });
    chatDaysAgo(app, 'Old Chat', now, 14);

    const view = app.render();
    expect(headingAndRow(app, view)).toEqual({ heading: 'Oct 16', row: ['Old Chat'] });
    expect(view.queryByText('2 weeks ago')).toBeNull();
  });

  it('case27: a conversation 30 days ago sits under its day, and its row shows no date', () => {
    const app = boot();
    const now = new Date(2026, 9, 30, 14, 5);
    jest.useFakeTimers({ now });
    const monthAgo = chatDaysAgo(app, 'Older Chat', now, 30);

    const view = app.render();
    expect(headingAndRow(app, view)).toEqual({ heading: 'Sep 30', row: ['Older Chat'] });
    // The heading names the day; the row itself does not.
    expect(app.rtl.within(view.getByTestId('conversation-item-0')).queryByText(formatShortDate(monthAgo))).toBeNull();
  });

  // Like Claude's chat list: a view menu groups by date, project or nothing, and a header folds.
  it('the view menu groups chats by project, a header folds its chats, and the choice is kept', async () => {
    const app = boot();
    const { useChatStore } = require('../../src/stores/chatStore');
    const { useProjectStore } = require('../../src/stores/projectStore');
    const { useAppStore } = require('../../src/stores/appStore');
    const garden = useProjectStore.getState().createProject({ name: 'Garden', description: '', systemPrompt: '' });
    useChatStore.getState().createConversation(useAppStore.getState().activeModelId, 'Tomatoes', garden.id);
    app.chat('Loose chat');

    const view = app.render();
    app.rtl.fireEvent.press(view.getByLabelText('View options'));
    app.rtl.fireEvent.press(await view.findByTestId('chats-group-project'));
    // The choice is chosen at once, before the list has regrouped (design principle 10: pressed,
    // working, done; it used to show nothing for ~7 s on Android, then jump).
    expect(view.getByTestId('chats-group-project').props.accessibilityState.selected).toBe(true);

    const headers = () => app.rtl.within(view.getByTestId('conversation-list')).getAllByRole('header')
      .map(node => String(node.props.accessibilityLabel));
    await app.rtl.waitFor(() => expect(headers()).toEqual(['Garden', 'No project']));
    // Done: the row settles on its tick, not a spinner.
    expect(view.getByTestId('chats-group-project').props.accessibilityState.busy).toBe(false);
    expect(view.queryByTestId('chats-group-project-working')).toBeNull();
    expect(useAppStore.getState().settings.chatsGroupBy).toBe('project');
    // The header names the project, so the row carries no project tag of its own.
    expect(view.getAllByText('Garden')).toHaveLength(1);

    // Folding Garden hides its chat and keeps the other section.
    app.rtl.fireEvent.press(view.getByTestId(`chats-section-project:${garden.id}`));
    expect(view.queryByText('Tomatoes')).toBeNull();
    expect(view.getByText('Loose chat')).toBeTruthy();
    app.rtl.fireEvent.press(view.getByTestId(`chats-section-project:${garden.id}`));
    expect(view.getByText('Tomatoes')).toBeTruthy();

    // Reset goes back to grouping by date.
    app.rtl.fireEvent.press(view.getByTestId('chats-view-reset'));
    await app.rtl.waitFor(() => expect(headers()).toEqual(['Today']));
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

    await app.rtl.waitFor(() => expect(view.getByText('No chats yet')).toBeTruthy());
    expect(view.queryByTestId('conversation-list')).toBeNull();
  });
});
