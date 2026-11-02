import { defaultPresentationSlides, cleanPresentationSlides, basicLayouts, PRESENTATION_TEMPLATES, SLIDE_LAYOUTS, type PresentationSlide } from '../../../src/services/presentationTemplates';

jest.mock('react-native-fs', () => ({ __esModule: true, default: { CachesDirectoryPath: '/cache' } }));
jest.mock('react-native-zip-archive', () => ({ zip: jest.fn() }));

import { pptxParts } from '../../../src/services/presentationExport';

describe('Atlas Presentation Studio', () => {
  test('includes at least five distinct visual templates and three editable starter slides', () => {
    expect(new Set(PRESENTATION_TEMPLATES.map(s => s.id)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(PRESENTATION_TEMPLATES.map(s => s.background)).size).toBeGreaterThanOrEqual(5);
    expect(defaultPresentationSlides().map(s => s.layout)).toEqual(['title', 'bullets', 'closing']);
  });
  test('clamps user-entered content before export', () => {
    const slides = cleanPresentationSlides([{
      layout: 'bullets', title: 'x'.repeat(250), subtitle: 'y'.repeat(400),
      bullets: Array(12).fill('z'.repeat(350)),
    }]);
    expect(slides[0].title).toHaveLength(140);
    expect(slides[0].subtitle).toHaveLength(260);
    expect(slides[0].bullets).toHaveLength(10);
    expect(slides[0].bullets[0]).toHaveLength(260);
  });
  test.each(PRESENTATION_TEMPLATES)('builds a complete editable PPTX package: $id', template => {
    const slides = defaultPresentationSlides();
    slides[0].title = '<Hello & World>';
    const parts = pptxParts(slides, template);
    expect(parts['[Content_Types].xml']).toContain('presentationml.presentation.main+xml');
    expect(parts['ppt/presentation.xml']).toContain('screen16x9');
    expect(parts['ppt/theme/theme1.xml']).toContain(template.accent);
    expect(parts['ppt/slides/slide1.xml']).toContain('&lt;Hello &amp; World&gt;');
    expect(parts['ppt/slides/slide2.xml']).toContain('First key point');
    expect(parts['ppt/slideMasters/slideMaster1.xml']).toContain('sldLayoutId');
    expect(parts['ppt/slides/_rels/slide3.xml.rels']).toContain('slideLayout1.xml');
    expect(Object.keys(parts).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k))).toHaveLength(3);
  });
  test('rejects a blank presentation instead of saving a broken archive', () => {
    expect(() => pptxParts([], PRESENTATION_TEMPLATES[0])).toThrow(/at least one slide/);
  });
  test('has more than a dozen templates, including a minimal green one', () => {
    expect(PRESENTATION_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(PRESENTATION_TEMPLATES.some(t => t.id === 'minimal-green')).toBe(true);
  });
  test('every slide type builds in every template, with its own text in the slide', () => {
    for (const template of PRESENTATION_TEMPLATES) {
      const slides: PresentationSlide[] = SLIDE_LAYOUTS.map(l => ({ layout: l.id, title: `T-${l.id}`, subtitle: `S-${l.id}`, bullets: ['one', 'two', 'three'] }));
      const parts = pptxParts(slides, template);
      slides.forEach((slide, i) => {
        const xml = parts[`ppt/slides/slide${i + 1}.xml`];
        expect(xml).toContain(`T-${slide.layout}`);
        if (slide.layout !== 'closing') expect(xml.length).toBeGreaterThan(500);
      });
    }
  });
  test('the PDF writer gets only the three layouts it knows, keeping all the text', () => {
    const slides: PresentationSlide[] = SLIDE_LAYOUTS.map(l => ({ layout: l.id, title: `T-${l.id}`, subtitle: `S-${l.id}`, bullets: ['one', 'two'] }));
    const mapped = basicLayouts(slides);
    expect(mapped.every(s => ['title', 'bullets', 'closing'].includes(s.layout))).toBe(true);
    expect(JSON.stringify(mapped.find((_, i) => slides[i].layout === 'quote'))).toContain('T-quote');
    expect(mapped.find((_, i) => slides[i].layout === 'agenda')?.bullets).toEqual(['1. one', '2. two']);
    expect(mapped.find((_, i) => slides[i].layout === 'stat')?.bullets).toEqual(['S-stat', 'one', 'two']);
  });
});
