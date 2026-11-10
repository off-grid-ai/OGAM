/**
 * Builds a PowerPoint (.pptx) from Study slides, on the phone, with no library: a .pptx is a zip
 * of small XML files. buildPptxFiles returns those files; savePptx writes them and zips them.
 */
import RNFS from 'react-native-fs';
import { zip } from 'react-native-zip-archive';
import type { Slide, Source } from './engine';
import { MIME_PPTX, saveToPhone } from './exportFiles';

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;

export const xmlEscape = (s: string): string =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface DeckSlide { title: string; bullets: string[] }

const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`;
const rels = (items: string[]) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;

const emptyTree = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function textBox(box: { id: number; name: string; x: number; y: number; w: number; h: number; anchor?: string }, paragraphs: string): string {
  const { id, name, x, y, w, h, anchor = 't' } = box;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

const run = (text: string, style: { size: number; color: string; bold?: boolean }) => {
  const { size, color, bold = false } = style;
  return `<a:r><a:rPr lang="en-US" sz="${size * 100}" b="${bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${xmlEscape(text)}</a:t></a:r>`;
};

function accentBar(id: number): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Accent"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="228600" cy="${SLIDE_H}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="10B981"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
}

function slideXml(slide: DeckSlide, where: { index: number; total: number; titleSlide: boolean }): string {
  const { index, total, titleSlide } = where;
  const bg = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
  let shapes = accentBar(2);
  if (titleSlide) {
    shapes += textBox({ id: 3, name: 'Title', x: 914400, y: 2286000, w: 10363200, h: 1600200, anchor: 'b' }, `<a:p>${run(slide.title, { size: 48, color: 'FFFFFF', bold: true })}</a:p>`);
    const sub = slide.bullets.map((b) => `<a:p><a:pPr><a:spcBef><a:spcPts val="600"/></a:spcBef></a:pPr>${run(b, { size: 22, color: '94A3B8' })}</a:p>`).join('');
    if (sub) shapes += textBox({ id: 4, name: 'Subtitle', x: 914400, y: 4000500, w: 10363200, h: 1200000 }, sub);
  } else {
    shapes += textBox({ id: 3, name: 'Title', x: 685800, y: 457200, w: 10820400, h: 1143000, anchor: 'ctr' }, `<a:p>${run(slide.title, { size: 36, color: 'FFFFFF', bold: true })}</a:p>`);
    const chars = slide.bullets.reduce((n, b) => n + b.length, 0);
    const size = chars > 600 ? 18 : chars > 380 ? 20 : chars > 220 ? 24 : 28;
    const paras = slide.bullets.map((b) =>
      `<a:p><a:pPr marL="342900" indent="-342900"><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buClr><a:srgbClr val="10B981"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/></a:pPr>${run(b, { size, color: 'E2E8F0' })}</a:p>`).join('');
    shapes += textBox({ id: 4, name: 'Body', x: 685800, y: 1828800, w: 10820400, h: 4343400 }, paras || `<a:p>${run(' ', { size, color: 'E2E8F0' })}</a:p>`);
    shapes += textBox({ id: 5, name: 'Number', x: 10515600, y: 6324600, w: 990600, h: 304800 }, `<a:p><a:pPr algn="r"/>${run(`${index} / ${total}`, { size: 12, color: '64748B' })}</a:p>`);
  }
  return `${XML}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld>${bg}<p:spTree>${emptyTree}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = `${XML}<a:theme xmlns:a="${NS_A}" name="Atlas"><a:themeElements><a:clrScheme name="Atlas"><a:dk1><a:srgbClr val="0F172A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1E293B"/></a:dk2><a:lt2><a:srgbClr val="E2E8F0"/></a:lt2><a:accent1><a:srgbClr val="10B981"/></a:accent1><a:accent2><a:srgbClr val="3B82F6"/></a:accent2><a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="8B5CF6"/></a:accent4><a:accent5><a:srgbClr val="EF4444"/></a:accent5><a:accent6><a:srgbClr val="14B8A6"/></a:accent6><a:hlink><a:srgbClr val="38BDF8"/></a:hlink><a:folHlink><a:srgbClr val="A78BFA"/></a:folHlink></a:clrScheme><a:fontScheme name="Atlas"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Atlas"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const MASTER = `${XML}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${emptyTree}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const LAYOUT = `${XML}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${emptyTree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/** Slides to draw: a title slide, one per Study slide, and a sources slide when there are any. */
export function deckSlides(title: string, subtitle: string, content: { slides: Slide[]; sources: Source[] }): DeckSlide[] {
  const { slides, sources } = content;
  const deck: DeckSlide[] = [{ title, bullets: subtitle ? [subtitle] : [] }];
  for (const s of slides) deck.push({ title: s.title, bullets: s.bullets });
  const names = [...new Set(sources.map((s) => s.doc))].slice(0, 12);
  if (names.length) deck.push({ title: 'Sources', bullets: names });
  return deck;
}

/** Every file of the .pptx, by path inside the zip. */
export function buildPptxFiles(deck: DeckSlide[], title: string): Record<string, string> {
  const files: Record<string, string> = {};
  const n = deck.length;
  files['[Content_Types].xml'] = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${deck.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  files['_rels/.rels'] = rels([
    rel('rId1', 'officeDocument', 'ppt/presentation.xml'),
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
    rel('rId3', 'extended-properties', 'docProps/app.xml'),
  ]);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files['docProps/core.xml'] = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>Atlas</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  files['docProps/app.xml'] = `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Atlas</Application><Slides>${n}</Slides></Properties>`;
  files['ppt/presentation.xml'] = `${XML}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${deck.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  files['ppt/_rels/presentation.xml.rels'] = rels([
    rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'),
    rel('rId2', 'theme', 'theme/theme1.xml'),
    ...deck.map((_, i) => rel(`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`)),
  ]);
  files['ppt/slideMasters/slideMaster1.xml'] = MASTER;
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = rels([rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'), rel('rId2', 'theme', '../theme/theme1.xml')]);
  files['ppt/slideLayouts/slideLayout1.xml'] = LAYOUT;
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = rels([rel('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')]);
  files['ppt/theme/theme1.xml'] = THEME;
  deck.forEach((s, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = slideXml(s, { index: i, total: n - 1, titleSlide: i === 0 });
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels([rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml')]);
  });
  return files;
}

/** Writes the files into a folder and zips its top-level entries into the target .pptx. */
export async function writePptx(deck: DeckSlide[], title: string, target: string): Promise<void> {
  const dir = `${RNFS.CachesDirectoryPath}/pptx-${Date.now()}`;
  const files = buildPptxFiles(deck, title);
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = `${dir}/${path}`;
      await RNFS.mkdir(full.slice(0, full.lastIndexOf('/')));
      await RNFS.writeFile(full, content, 'utf8');
    }
    // Zip the folder itself: on Android the library adds its children, so [Content_Types].xml sits at
    // the zip root and _rels, docProps and ppt keep their own folder names. (Passing the four
    // top-level entries separately drops the folder names and corrupts the package.)
    await zip(dir, target);
  } finally {
    RNFS.unlink(dir).catch(() => undefined);
  }
}

export const savePptx = (fileName: string, title: string, deck: DeckSlide[]): Promise<string | null> =>
  saveToPhone(fileName, MIME_PPTX, (path) => writePptx(deck, title, path));
