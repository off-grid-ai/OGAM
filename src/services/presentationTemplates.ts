/** Offline, editable 16:9 presentation templates shared by PPTX and PDF export. */
export type PresentationStyleId = 'minimal' | 'modern' | 'colorful' | 'dark' | 'academic'
  | 'minimal-green' | 'sage' | 'forest' | 'sunrise' | 'ocean' | 'berry' | 'mono';
/**
 * title / closing: opening and ending slides. bullets: a titled list. section: a divider with a big title.
 * twoColumn: the bullets in two columns. quote: a large quotation (title) and who said it (subtitle).
 * stat: one big number (title) with a caption (subtitle) and notes (bullets). agenda: a numbered list.
 */
export type SlideLayout = 'title' | 'bullets' | 'closing' | 'section' | 'twoColumn' | 'quote' | 'stat' | 'agenda';
export const SLIDE_LAYOUTS: { id: SlideLayout; label: string; icon: string; hasBullets: boolean }[] = [
  { id: 'title', label: 'Title', icon: 'layout', hasBullets: false },
  { id: 'bullets', label: 'Content', icon: 'list', hasBullets: true },
  { id: 'section', label: 'Section', icon: 'minus', hasBullets: false },
  { id: 'twoColumn', label: 'Two columns', icon: 'columns', hasBullets: true },
  { id: 'agenda', label: 'Agenda', icon: 'hash', hasBullets: true },
  { id: 'quote', label: 'Quote', icon: 'message-square', hasBullets: false },
  { id: 'stat', label: 'Big number', icon: 'trending-up', hasBullets: true },
  { id: 'closing', label: 'Closing', icon: 'flag', hasBullets: false },
];
export const slideHasBullets = (layout: SlideLayout) => SLIDE_LAYOUTS.find((l) => l.id === layout)?.hasBullets ?? false;
export interface PresentationSlide {
  layout: SlideLayout;
  title: string;
  subtitle: string;
  bullets: string[];
}
export interface PresentationTemplate {
  id: PresentationStyleId;
  name: string;
  description: string;
  background: string;
  foreground: string;
  secondary: string;
  accent: string;
  panel: string;
  font: string;
}
export const PRESENTATION_TEMPLATES: PresentationTemplate[] = [
  { id: 'minimal', name: 'Minimal', description: 'Clean and understated', background: 'FFFFFF', foreground: '111827', secondary: '475569', accent: '2563EB', panel: 'F1F5F9', font: 'Aptos' },
  { id: 'modern', name: 'Modern', description: 'Teal with structured sections', background: 'F3F9FA', foreground: '10333C', secondary: '42636B', accent: '008E89', panel: 'DCEFED', font: 'Aptos Display' },
  { id: 'colorful', name: 'Colorful', description: 'Playful violet and pastel', background: 'F7F3FF', foreground: '281548', secondary: '65578C', accent: '8351E2', panel: 'EEE0FF', font: 'Aptos' },
  { id: 'dark', name: 'Dark', description: 'High-contrast midnight', background: '101827', foreground: 'F8FAFC', secondary: 'CBD5E1', accent: '38BDF8', panel: '253247', font: 'Aptos' },
  { id: 'academic', name: 'Academic', description: 'Traditional research presentation', background: 'FFFCF5', foreground: '292524', secondary: '57534E', accent: '995D23', panel: 'F4EBDA', font: 'Georgia' },
  { id: 'minimal-green', name: 'Minimal green', description: 'Airy off-white with calm green lines', background: 'F8FAF6', foreground: '16301F', secondary: '566B5C', accent: '2F7D50', panel: 'E7F0E4', font: 'Aptos' },
  { id: 'sage', name: 'Sage', description: 'Soft grey-green, quiet and warm', background: 'F2F4EC', foreground: '2B3A2E', secondary: '67756A', accent: '7A9A6B', panel: 'E1E8D6', font: 'Georgia' },
  { id: 'forest', name: 'Forest', description: 'Deep green with light text', background: '12261B', foreground: 'F1F7EE', secondary: 'B9CDBF', accent: '6FD196', panel: '1F3B2B', font: 'Aptos' },
  { id: 'sunrise', name: 'Sunrise', description: 'Warm cream with coral and amber', background: 'FFF8F0', foreground: '3A2216', secondary: '7C5B49', accent: 'E2573B', panel: 'FCE6D4', font: 'Aptos Display' },
  { id: 'ocean', name: 'Ocean', description: 'Cool navy and bright blue', background: 'F2F7FB', foreground: '0E2A47', secondary: '4A6580', accent: '1672C4', panel: 'DDEAF6', font: 'Aptos' },
  { id: 'berry', name: 'Berry', description: 'Rich plum with a pink accent', background: 'FBF4F8', foreground: '3B1230', secondary: '7A5671', accent: 'B4246B', panel: 'F3DDEA', font: 'Aptos Display' },
  { id: 'mono', name: 'Mono', description: 'Black and white, no color at all', background: 'FFFFFF', foreground: '000000', secondary: '555555', accent: '000000', panel: 'EFEFEF', font: 'Aptos' },
];

/** The layouts the PDF writer knows. Every other layout is turned into one of them (the text is kept). */
export function basicLayouts(slides: PresentationSlide[]): PresentationSlide[] {
  return slides.map((s) => {
    switch (s.layout) {
      case 'section': return { ...s, layout: 'title' };
      case 'quote': return { ...s, layout: 'title', title: `"${s.title}"`, subtitle: s.subtitle ? `- ${s.subtitle}` : '' };
      case 'stat': return { ...s, layout: 'bullets', bullets: [s.subtitle, ...s.bullets].filter(Boolean), subtitle: '' };
      case 'agenda': return { ...s, layout: 'bullets', bullets: s.bullets.map((b, i) => `${i + 1}. ${b}`) };
      case 'twoColumn': return { ...s, layout: 'bullets' };
      default: return s;
    }
  });
}
export const defaultPresentationSlides = (): PresentationSlide[] => [
  { layout: 'title', title: 'My Presentation', subtitle: 'Add a subtitle or presenter name', bullets: [] },
  { layout: 'bullets', title: 'Key Points', subtitle: 'Overview', bullets: ['First key point', 'Second key point', 'Third key point'] },
  { layout: 'closing', title: 'Thank You', subtitle: 'Questions?', bullets: [] },
];
export const cleanPresentationSlides = (slides: PresentationSlide[]): PresentationSlide[] =>
  slides.slice(0, 40).map(slide => ({
    layout: slide.layout,
    title: slide.title.trim().slice(0, 140),
    subtitle: slide.subtitle.trim().slice(0, 260),
    bullets: slide.bullets.slice(0, 10).map(b => b.trim().slice(0, 260)).filter(Boolean),
  }));
