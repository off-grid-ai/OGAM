/* eslint-disable prefer-template, max-params */
import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { zip } from 'react-native-zip-archive';
import { basicLayouts, cleanPresentationSlides, type PresentationSlide, type PresentationTemplate } from './presentationTemplates';

export type PresentationFormat = 'pptx' | 'pdf';
export interface ExportedPresentation { uri: string; mime: string; name: string }
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PDF_MIME = 'application/pdf';
const W = 12192000, H = 6858000;
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"']/g, c => (
  c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&apos;'
));
const rgb = (s: string) => '<a:solidFill><a:srgbClr val="' + s + '"/></a:solidFill>';
const ns = 'xmlns:p="' + P + '" xmlns:a="' + A + '" xmlns:r="' + R + '"';
const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function paragraph(text: string, color: string, font: string, size: number, bold: boolean): string {
  return '<a:p><a:pPr algn="l"/><a:r><a:rPr lang="en-US" sz="' + size +
    '" b="' + (bold ? '1' : '0') + '">' + rgb(color) + '<a:latin typeface="' + esc(font) +
    '"/></a:rPr><a:t>' + esc(text) + '</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>';
}
function shape(id: number, name: string, x: number, y: number, w: number, h: number,
  fill: string | null, lines: string[]): string {
  return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + esc(name) +
    '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + x +
    '" y="' + y + '"/><a:ext cx="' + w + '" cy="' + h +
    '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    (fill ? rgb(fill) : '<a:noFill/>') + '<a:ln><a:noFill/></a:ln></p:spPr>' +
    (lines.length ? '<p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/>' +
      lines.join('') + '</p:txBody>' : '') + '</p:sp>';
}
/** Shapes for the layouts beyond title / content / closing; null for those three. */
function extraLayoutShapes(slide: PresentationSlide, t: PresentationTemplate): string | null {
  const bullets = slide.bullets.length ? slide.bullets : ['Add your points'];
  const hf = t.headingFont ?? t.font;
  let out = '';
  if (slide.layout === 'section') {
    out += shape(2, 'Section block', 0, 0, 3300000, H, t.accent, []);
    out += shape(3, 'Section title', 4000000, 2300000, 7600000, 1700000, null, [paragraph(slide.title, t.foreground, hf, 4800, true)]);
    if (slide.subtitle) out += shape(4, 'Section subtitle', 4020000, 4150000, 7400000, 900000, null, [paragraph(slide.subtitle, t.secondary, t.font, 2200, false)]);
    return out;
  }
  if (slide.layout === 'quote') {
    out += shape(2, 'Quote mark', 900000, 700000, 1600000, 1500000, null, [paragraph('\u201C', t.accent, hf, 12000, true)]);
    out += shape(3, 'Quote', 1300000, 2200000, 9600000, 2700000, null, [paragraph(slide.title, t.foreground, t.font, 3400, false)]);
    out += shape(4, 'Quote rule', 1300000, 5150000, 1200000, 60000, t.accent, []);
    if (slide.subtitle) out += shape(5, 'Said by', 1300000, 5350000, 9000000, 600000, null, [paragraph(slide.subtitle, t.secondary, t.font, 2000, false)]);
    return out;
  }
  if (slide.layout === 'stat') {
    out += shape(2, 'Stat rule', 900000, 1100000, 1200000, 60000, t.accent, []);
    out += shape(3, 'Big number', 900000, 1500000, 10400000, 2300000, null, [paragraph(slide.title, t.accent, hf, 11000, true)]);
    if (slide.subtitle) out += shape(4, 'Caption', 960000, 3900000, 10200000, 700000, null, [paragraph(slide.subtitle, t.foreground, t.font, 2800, false)]);
    out += shape(5, 'Notes', 960000, 4800000, 10200000, 1700000, null, bullets.slice(0, 4).map(b => paragraph(b, t.secondary, t.font, 1900, false)));
    return out;
  }
  if (slide.layout === 'agenda') {
    out += shape(2, 'Section accent', 680000, 520000, 150000, 820000, t.accent, []);
    out += shape(3, 'Slide title', 960000, 560000, 10500000, 900000, null, [paragraph(slide.title, t.foreground, hf, 3600, true)]);
    bullets.slice(0, 6).forEach((b, i) => {
      const y = 1750000 + i * 780000;
      out += shape(10 + i * 2, 'Number ' + (i + 1), 960000, y, 800000, 640000, null, [paragraph(String(i + 1).padStart(2, '0'), t.accent, hf, 3000, true)]);
      out += shape(11 + i * 2, 'Item ' + (i + 1), 1900000, y + 40000, 9400000, 640000, null, [paragraph(b, t.foreground, t.font, 2400, false)]);
    });
    return out;
  }
  if (slide.layout === 'twoColumn') {
    out += shape(2, 'Section accent', 680000, 520000, 150000, 820000, t.accent, []);
    out += shape(3, 'Slide title', 960000, 560000, 10500000, 900000, null, [paragraph(slide.title, t.foreground, hf, 3600, true)]);
    if (slide.subtitle) out += shape(4, 'Subtitle', 960000, 1530000, 9800000, 500000, null, [paragraph(slide.subtitle, t.secondary, t.font, 1900, false)]);
    const items = bullets.slice(0, 10);
    const half = Math.ceil(items.length / 2);
    const column = (list: string[]) => list.map(b => paragraph('\u2022  ' + b, t.foreground, t.font, 2000, false));
    out += shape(5, 'Left panel', 750000, 2220000, 5150000, 3980000, t.panel, []);
    out += shape(6, 'Left column', 1000000, 2500000, 4700000, 3500000, null, column(items.slice(0, half)));
    out += shape(7, 'Right panel', 6150000, 2220000, 5150000, 3980000, t.panel, []);
    out += shape(8, 'Right column', 6400000, 2500000, 4700000, 3500000, null, column(items.slice(half)));
    return out;
  }
  return null;
}
function slideXml(slide: PresentationSlide, t: PresentationTemplate): string {
  const hf = t.headingFont ?? t.font;
  let shapes = extraLayoutShapes(slide, t) ?? '';
  if (shapes) { /* drawn by extraLayoutShapes */ } else if (slide.layout === 'title') {
    shapes += shape(2, 'Accent bar', 720000, 1240000, 10600000, 130000, t.accent, []);
    shapes += shape(3, 'Presentation title', 780000, 1840000, 10600000, 1700000, null,
      [paragraph(slide.title, t.foreground, hf, 4900, true)]);
    shapes += shape(4, 'Subtitle', 800000, 3800000, 10200000, 1000000, null,
      [paragraph(slide.subtitle, t.secondary, t.font, 2400, false)]);
  } else if (slide.layout === 'closing') {
    shapes += shape(2, 'Accent panel', 760000, 1920000, 9500000, 220000, t.accent, []);
    shapes += shape(3, 'Closing message', 820000, 2650000, 10000000, 1500000, null,
      [paragraph(slide.title, t.foreground, hf, 4900, true)]);
    shapes += shape(4, 'Follow up', 840000, 4480000, 10000000, 650000, null,
      [paragraph(slide.subtitle, t.secondary, t.font, 2300, false)]);
  } else {
    shapes += shape(2, 'Section accent', 680000, 520000, 150000, 820000, t.accent, []);
    shapes += shape(3, 'Slide title', 960000, 560000, 10500000, 900000, null,
      [paragraph(slide.title, t.foreground, hf, 3600, true)]);
    if (slide.subtitle) shapes += shape(4, 'Subtitle', 960000, 1530000, 9800000, 500000, null,
      [paragraph(slide.subtitle, t.secondary, t.font, 1900, false)]);
    shapes += shape(5, 'Content panel', 750000, 2220000, 10600000, 3980000, t.panel, []);
    shapes += shape(6, 'Bullet points', 1050000, 2560000, 9800000, 3450000, null,
      (slide.bullets.length ? slide.bullets : ['Add your main points']).slice(0, 9)
        .map(b => paragraph('\u2022  ' + b, t.foreground, t.font, 2200, false)));
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld ' + ns + '><p:cSld><p:bg><p:bgPr>' + rgb(t.background) +
    '<a:effectLst/></p:bgPr></p:bg><p:spTree>' + group + shapes +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}
const relationship = (id: string, type: string, target: string) =>
  '<Relationship Id="' + id + '" Type="' + officeRel + type + '" Target="' + target + '"/>';
const relations = (children: string) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="' + REL + '">' + children + '</Relationships>';

function themeXml(t: PresentationTemplate): string {
  const color = (tag: string, c: string) => '<a:' + tag + '>' + '<a:srgbClr val="' + c + '"/></a:' + tag + '>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<a:theme xmlns:a="' + A + '" name="Atlas ' + esc(t.name) + '"><a:themeElements>' +
    '<a:clrScheme name="Atlas">' + color('dk1', t.foreground) + color('lt1', t.background) +
    color('dk2', t.secondary) + color('lt2', t.panel) +
    ['accent1','accent2','accent3','accent4','accent5','accent6'].map((n,i) => color(n, i%2 ? t.secondary : t.accent)).join('') +
    color('hlink', t.accent) + color('folHlink', t.secondary) + '</a:clrScheme>' +
    '<a:fontScheme name="Atlas"><a:majorFont><a:latin typeface="' + esc(t.headingFont ?? t.font) +
    '"/></a:majorFont><a:minorFont><a:latin typeface="' + esc(t.font) +
    '"/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="Atlas"><a:fillStyleLst>' + rgb(t.accent) + rgb(t.panel) + rgb(t.background) +
    '</a:fillStyleLst><a:lnStyleLst>' + [0,1,2].map(() => '<a:ln w="9525">' + rgb(t.accent) + '</a:ln>').join('') +
    '</a:lnStyleLst><a:effectStyleLst>' + [0,1,2].map(() => '<a:effectStyle><a:effectLst/></a:effectStyle>').join('') +
    '</a:effectStyleLst><a:bgFillStyleLst>' + rgb(t.background) + rgb(t.panel) + rgb(t.background) +
    '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
}

export function pptxParts(slides: PresentationSlide[], template: PresentationTemplate): Record<string, string> {
  const safe = cleanPresentationSlides(slides);
  if (safe.length === 0) throw new Error('Create at least one slide to export.');
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    safe.map((_,i) => '<Override PartName="/ppt/slides/slide' + (i+1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('') +
    '</Types>';
  const ids = safe.map((_,i) => '<p:sldId id="' + (256+i) + '" r:id="rId' + (i+2) + '"/>').join('');
  const master = '<p:sldMaster ' + ns + '><p:cSld><p:spTree>' + group +
    '</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" tx1="dk1" tx2="dk2" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';
  const layout = '<p:sldLayout ' + ns + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>' + group +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  const parts: Record<string, string> = {
    '[Content_Types].xml': ct,
    '_rels/.rels': relations('<Relationship Id="rId1" Type="' + officeRel + 'officeDocument" Target="ppt/presentation.xml"/>'),
    'ppt/presentation.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ' + ns +
      '><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst>' + ids + '</p:sldIdLst><p:sldSz cx="' + W + '" cy="' + H +
      '" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    'ppt/_rels/presentation.xml.rels': relations(relationship('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml') +
      safe.map((_,i) => relationship('rId'+(i+2), 'slide', 'slides/slide'+(i+1)+'.xml')).join('')),
    'ppt/slideMasters/slideMaster1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + master,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': relations(relationship('rId1','slideLayout','../slideLayouts/slideLayout1.xml') +
      relationship('rId2','theme','../theme/theme1.xml')),
    'ppt/slideLayouts/slideLayout1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + layout,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relations(relationship('rId1','slideMaster','../slideMasters/slideMaster1.xml')),
    'ppt/theme/theme1.xml': themeXml(template),
  };
  safe.forEach((slide,i) => {
    parts['ppt/slides/slide'+(i+1)+'.xml'] = slideXml(slide,template);
    parts['ppt/slides/_rels/slide'+(i+1)+'.xml.rels'] =
      relations(relationship('rId1','slideLayout','../slideLayouts/slideLayout1.xml'));
  });
  return parts;
}

function sanitizedName(name: string): string {
  const printable = name.trim().split('').filter(ch => ch.charCodeAt(0) >= 32).join('');
  return (printable.replace(/[<>:"/\\|?*]/g, '_').slice(0,70) || 'Atlas Presentation');
}
function nativeExporter(): any {
  if (Platform.OS !== 'android' || !NativeModules.AtlasPresentationExporter) {
    throw new Error('Presentation exporting requires the Atlas Android app.');
  }
  return NativeModules.AtlasPresentationExporter;
}
export async function exportPresentation(slides: PresentationSlide[], t: PresentationTemplate, filename: string,
  format: PresentationFormat): Promise<ExportedPresentation> {
  const safe = cleanPresentationSlides(slides);
  if (!safe.length) throw new Error('Add a slide first.');
  const name = sanitizedName(filename) + '.' + format;
  if (format === 'pdf') {
    const uri = await nativeExporter().exportPdf(basicLayouts(safe), t, name);
    return { uri, mime: PDF_MIME, name };
  }
  const temp = RNFS.CachesDirectoryPath + '/atlas-presentation-' + Date.now();
  const archive = temp + '.pptx';
  try {
    await RNFS.mkdir(temp);
    const parts = pptxParts(safe, t);
    for (const [file, content] of Object.entries(parts)) {
      const absolute = temp + '/' + file;
      await RNFS.mkdir(absolute.slice(0, absolute.lastIndexOf('/')));
      await RNFS.writeFile(absolute, content, 'utf8');
    }
    await zip(temp, archive);
    const uri: string = await nativeExporter().publishFile(archive, name, PPTX_MIME);
    return { uri, mime: PPTX_MIME, name };
  } finally {
    await RNFS.unlink(archive).catch(() => undefined);
    await RNFS.unlink(temp).catch(() => undefined);
  }
}
export async function sharePresentation(file: ExportedPresentation): Promise<void> {
  await nativeExporter().shareUri(file.uri, file.mime);
}
