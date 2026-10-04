import { downloadStatusIcon, PAUSED_ICON, QUEUED_ICON } from '../../../src/utils/downloadStatusIcon';

describe('downloadStatusIcon (single status->icon source of truth)', () => {
  it('maps a queued (pending) download to the clock icon', () => {
    // Queued was previously text-only with no icon; it must now be icon-coded like
    // every other state so the Download Manager row and ModelCard agree.
    expect(downloadStatusIcon('pending')).toBe('clock');
    expect(QUEUED_ICON).toBe('clock');
  });

  it('maps the other non-running states to their icons', () => {
    expect(downloadStatusIcon('failed')).toBe('alert-circle');
    expect(downloadStatusIcon('retrying')).toBe('refresh-cw');
    expect(downloadStatusIcon('waiting_for_network')).toBe('wifi-off');
  });

  it('maps a paused download to the pause glyph, so the row and the card agree on it', () => {
    // Paused used to fall through to null: a person stopped it on purpose, yet the row showed
    // nothing where every other non-running state shows its glyph.
    expect(downloadStatusIcon('paused')).toBe('pause-circle');
    expect(PAUSED_ICON).toBe('pause-circle');
  });

  it('returns null for running/completed (no status glyph)', () => {
    expect(downloadStatusIcon('running')).toBeNull();
    expect(downloadStatusIcon('completed')).toBeNull();
  });
});
