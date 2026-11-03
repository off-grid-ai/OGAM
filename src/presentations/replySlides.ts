/**
 * Turns a chat reply (markdown) into slides, with no AI and no network: a title slide, then one slide per heading (or per
 * run of paragraphs when there are none), bullets from lists and sentences, a table as one bullet per row, and a closing
 * slide. The result opens in the slide editor, where everything can be changed. Pure, so it is tested without a device.
 */
import type { PresentationSlide } from '../services/presentationTemplates';

const MAX_BULLETS = 6;

const plain = (s: string) => s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();

function sentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? []).map((x) => plain(x)).filter((x) => x.length > 2);
}

interface Block { title: string; lines: string[] }

export function slidesFromReply(markdown: string, fallbackTitle = 'My Presentation'): { name: string; slides: PresentationSlide[] } {
  const lines = markdown.replace(/```[\s\S]*?```/g, (code) => code.split('\n').slice(1, -1).join('\n')).split('\n');
  let deckTitle = '';
  const blocks: Block[] = [];
  let current: Block = { title: '', lines: [] };
  const flush = () => { if (current.lines.length || current.title) blocks.push(current); current = { title: '', lines: [] }; };
  let paragraph: string[] = [];
  const endParagraph = () => { if (paragraph.length) { current.lines.push(...sentences(paragraph.join(' '))); paragraph = []; } };
  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      endParagraph();
      if (heading[1].length === 1 && !deckTitle) { deckTitle = plain(heading[2]); continue; }
      flush();
      current.title = plain(heading[2]);
      continue;
    }
    if (!line) { endParagraph(); continue; }
    if (/^[-*+]\s+|^\d+[.)]\s+/.test(line)) { endParagraph(); current.lines.push(plain(line.replace(/^([-*+]|\d+[.)])\s+/, ''))); continue; }
    if (/^\|?\s*:?-{2,}/.test(line)) continue; // table separator
    if (line.startsWith('|')) { endParagraph(); current.lines.push(line.split('|').map(plain).filter(Boolean).join(': ')); continue; }
    paragraph.push(line);
  }
  endParagraph();
  flush();

  const slides: PresentationSlide[] = [{ layout: 'title', title: (deckTitle || fallbackTitle).slice(0, 140), subtitle: '', bullets: [] }];
  for (const block of blocks) {
    const items = block.lines.filter(Boolean);
    if (!items.length && !block.title) continue;
    // Long blocks continue on another slide.
    for (let i = 0; i < Math.max(1, items.length); i += MAX_BULLETS) {
      slides.push({
        layout: 'bullets', title: (block.title || (slides.length === 1 ? 'Overview' : 'More')).slice(0, 140),
        subtitle: i > 0 ? 'continued' : '', bullets: items.slice(i, i + MAX_BULLETS).map((b) => b.slice(0, 260)),
      });
    }
  }
  slides.push({ layout: 'closing', title: 'Thank You', subtitle: 'Questions?', bullets: [] });
  return { name: (deckTitle || fallbackTitle).slice(0, 70), slides: slides.slice(0, 40) };
}
