import { bookKind, paginateText, htmlToText, opfPath, spineHrefs, resolveHref, PAGE_CHARS } from '../../src/knowledge/textPages';

describe('text and EPUB books for study', () => {
  it('tells the kind of book from its name', () => {
    expect(bookKind('Biology.PDF')).toBe('pdf');
    expect(bookKind('novel.epub')).toBe('epub');
    expect(bookKind('notes.md')).toBe('text');
    expect(bookKind('chapter.txt')).toBe('text');
    expect(bookKind('photo.jpg')).toBeNull();
    expect(bookKind('noextension')).toBeNull();
  });
  it('cuts text into pages at paragraph breaks, losing nothing', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ${'word '.repeat(70)}`).join('\n\n');
    const pages = paginateText(text);
    expect(pages.length).toBeGreaterThan(3);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(PAGE_CHARS);
    expect(pages.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
  });
  it('gives no pages for empty text and one page for short text', () => {
    expect(paginateText('   ')).toEqual([]);
    expect(paginateText('A short note.')).toEqual(['A short note.']);
  });
  it('turns a chapter into readable lines without tags, scripts or styles', () => {
    const html = '<html><head><style>p{color:red}</style></head><body><h1>Chapter 1</h1><p>It was a dark &amp; stormy night&hellip;</p><script>alert(1)</script><p>The&nbsp;end.</p></body></html>';
    expect(htmlToText(html)).toBe('Chapter 1\nIt was a dark & stormy night…\nThe end.');
  });
  it('finds the package file and the chapters in reading order', () => {
    expect(opfPath('<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="x"/></rootfiles></container>')).toBe('OEBPS/content.opf');
    const opf = `<package><manifest>
      <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
      <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
      <item id="css" href="style.css" media-type="text/css"/>
      <item id="cover" href="cover.jpg" media-type="image/jpeg"/></manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="css"/></spine></package>`;
    expect(spineHrefs(opf)).toEqual(['text/ch1.xhtml', 'text/ch2.xhtml']);
  });
  it('resolves a chapter path against the package file folder', () => {
    expect(resolveHref('OEBPS/content.opf', 'text/ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml');
    expect(resolveHref('content.opf', 'ch1.xhtml')).toBe('ch1.xhtml');
    expect(resolveHref('OEBPS/content.opf', '../shared/ch.xhtml')).toBe('shared/ch.xhtml');
  });
});
