/**
 * What a phone note's preview draws, from the note's own text.
 *
 * SPEC: frontmatter is hidden. `[[note]]`, `[[note|alias]]`, `[[note#heading]]` and `[[#heading]]`
 * become links the preview opens, each labelled as the person reads it. Every heading starts a
 * block the preview can scroll to, keyed the way `[[note#heading]]` matches it. A `[TOC]` line
 * (any case) is the note's headings, title left out; a `[TOC]` inside code stays code. Inserting a
 * link replaces the `[[` being typed, or wraps the selection as the link's text.
 *
 * Real previewMarkdown over the real @offgrid/notes. Nothing faked: it is pure.
 */
import { proIsPresent, requirePro } from '../helpers/requirePro';

type PreviewModule = typeof import('../../../pro/notes/previewMarkdown');

const describePro = proIsPresent() ? describe : describe.skip;
const load = () => requirePro<PreviewModule>('@offgrid/pro/notes/previewMarkdown')!;

describePro('note preview', () => {
  it('turns every wikilink form into a note link and hides frontmatter', () => {
    const { previewBlocks, parseNoteLinkUrl } = load();
    const blocks = previewBlocks('---\ntags: [a]\n---\nSee [[Plan]], [[Plan|the plan]], [[Plan#Steps]] and [[#Top]].\n');

    expect(blocks).toHaveLength(1);
    const [only] = blocks;
    if (only?.kind !== 'markdown') throw new Error('expected markdown');
    expect(only.markdown).not.toContain('tags');
    const urls = [...only.markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map(m => [m[1], parseNoteLinkUrl(m[2]!)]);
    expect(urls).toEqual([
      ['Plan', { target: 'Plan' }],
      ['the plan', { target: 'Plan' }],
      ['Plan › Steps', { target: 'Plan', heading: 'Steps' }],
      ['Top', { target: '', heading: 'Top' }],
    ]);
    expect(parseNoteLinkUrl('https://example.com')).toBeNull();
  });

  it('starts a block at each heading and draws [TOC] as the headings, not inside code', () => {
    const { previewBlocks } = load();
    const blocks = previewBlocks('# Guide\n\n[toc]\n\n## Install\n\n```\n[TOC]\n```\n\n## Use Me\n');

    expect(blocks.map(b => (b.kind === 'toc' ? 'toc' : b.anchor ?? 'text'))).toEqual(['guide', 'toc', 'install', 'use me']);
    const toc = blocks[1];
    if (toc?.kind !== 'toc') throw new Error('expected toc');
    expect(toc.entries.map(e => [e.level, e.text])).toEqual([[2, 'Install'], [2, 'Use Me']]);
    const install = blocks[2];
    if (install?.kind !== 'markdown') throw new Error('expected markdown');
    expect(install.markdown).toContain('[TOC]');
  });

  it('links a note named with [brackets]: the preview shows its name, and the [[ query keeps the brackets', () => {
    const { previewBlocks, parseNoteLinkUrl, openLinkQuery } = load();
    const [only] = previewBlocks('See [[[draft] Launch]].\n');
    if (only?.kind !== 'markdown') throw new Error('expected markdown');
    const m = /\[((?:\\.|[^\]\\])+)\]\(([^)]+)\)/.exec(only.markdown);
    expect(m?.[1]).toBe('\\[draft\\] Launch');
    expect(parseNoteLinkUrl(m![2]!)).toEqual({ target: '[draft] Launch' });

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
