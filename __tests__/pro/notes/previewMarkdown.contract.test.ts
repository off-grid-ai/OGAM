/**
 * The plain-Markdown editor's `[[` link helpers.
 *
 * SPEC: the `[[` query keeps a `[bracketed]` part of a note's name, closed or still being typed.
 * Inserting a link replaces the `[[` being typed, or wraps the selection as the link's text.
 *
 * Real previewMarkdown. Nothing faked: it is pure.
 */
import { proIsPresent, requirePro } from '../helpers/requirePro';

type PreviewModule = typeof import('../../../pro/notes/previewMarkdown');

const describePro = proIsPresent() ? describe : describe.skip;
const load = () => requirePro<PreviewModule>('@offgrid/pro/notes/previewMarkdown')!;

describePro('note [[ links', () => {
  it('keeps the brackets of a [bracketed] note name in the [[ query', () => {
    const { openLinkQuery } = load();
    const typed = 'See [[[draft] La';
    expect(openLinkQuery(typed, typed.length)).toEqual({ start: 6, query: '[draft] La' });
    const open = 'See [[[dra';
    expect(openLinkQuery(open, open.length)).toEqual({ start: 6, query: '[dra' });
  });

  it('inserts a link over the typed [[, or around the selection', () => {
    const { insertNoteLink } = load();

    expect(insertNoteLink('See [[Pl]] now', { start: 8, end: 8 }, { start: 6 }, 'Plan')).toEqual({ text: 'See [[Plan]] now', caret: 12 });
    expect(insertNoteLink('See [[Pl', { start: 8, end: 8 }, { start: 6 }, 'Plan')).toEqual({ text: 'See [[Plan]]', caret: 12 });
    expect(insertNoteLink('Read this', { start: 9, end: 5 }, null, 'Plan')).toEqual({ text: 'Read [[Plan|this]]', caret: 18 });
    expect(insertNoteLink('Read Plan', { start: 5, end: 9 }, null, 'Plan')).toEqual({ text: 'Read [[Plan]]', caret: 13 });
    expect(insertNoteLink('Read ', { start: 5, end: 5 }, null, 'Plan')).toEqual({ text: 'Read [[Plan]]', caret: 13 });
  });
});
