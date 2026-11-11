jest.mock('react-native-zip-archive', () => ({ zip: jest.fn(async () => '/out.pptx') }));
import RNFS from 'react-native-fs';
import { zip } from 'react-native-zip-archive';
import { buildPptxFiles, deckSlides, writePptx, xmlEscape } from '../../../src/study/pptx';

const deck = deckSlides('Water & <Fire>', 'sub "title"', { slides: [
  { title: 'Why boil', bullets: ['Kills germs & bacteria', 'Under 2000 m: 1 minute'], narration: 'n', src: [1] },
  { title: 'Empty', bullets: [], narration: 'n', src: [] },
], sources: [{ n: 1, doc: 'water.pdf', part: 1, text: 't' }, { n: 2, doc: 'water.pdf', part: 2, text: 'u' }] });

describe('PowerPoint export', () => {
  it('adds a title slide and one sources slide listing each document once', () => {
    expect(deck.map((d) => d.title)).toEqual(['Water & <Fire>', 'Why boil', 'Empty', 'Sources']);
    expect(deck[3].bullets).toEqual(['water.pdf']);
  });

  it('escapes text so the XML stays valid', () => {
    expect(xmlEscape('a & b < c > "d"\u0001')).toBe('a &amp; b &lt; c &gt; &quot;d&quot;');
    const files = buildPptxFiles(deck, 'Water & <Fire>');
    expect(files['ppt/slides/slide1.xml']).toContain('Water &amp; &lt;Fire&gt;');
    expect(files['ppt/slides/slide1.xml']).not.toContain('Water & <Fire>');
  });

  it('declares every part and points every relationship at a file that exists', () => {
    const files = buildPptxFiles(deck, 't');
    const types = files['[Content_Types].xml'];
    for (let i = 1; i <= deck.length; i++) {
      expect(types).toContain(`/ppt/slides/slide${i}.xml`);
      expect(files[`ppt/slides/slide${i}.xml`]).toBeDefined();
    }
    const pres = files['ppt/presentation.xml'];
    expect([...pres.matchAll(/<p:sldId /g)]).toHaveLength(deck.length);
    for (const [path, xml] of Object.entries(files)) {
      if (!path.endsWith('.rels')) continue;
      const base = path.replace(/_rels\/[^/]*\.rels$/, '');
      for (const m of xml.matchAll(/Target="([^"]+)"/g)) {
        const target = m[1];
        const resolved = target.split('/').reduce<string[]>((acc, part) => {
          if (part === '..') acc.pop(); else acc.push(part);
          return acc;
        }, base.split('/').filter(Boolean)).join('/');
        expect(files[resolved]).toBeDefined();
      }
    }
  });

  it('zips the whole folder (the Android library then keeps folder names and puts [Content_Types].xml at the root)', async () => {
    await writePptx(deck, 't', '/cache/out.pptx');
    const [source, target] = (zip as jest.Mock).mock.calls[0];
    expect(target).toBe('/cache/out.pptx');
    expect(typeof source).toBe('string'); // the folder, not a list of its top-level entries
    expect(source).toMatch(/pptx-\d+$/);
    expect(RNFS.writeFile).toHaveBeenCalledWith(expect.stringContaining('/ppt/slides/slide1.xml'), expect.any(String), 'utf8');
  });
});
