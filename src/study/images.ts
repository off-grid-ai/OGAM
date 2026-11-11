/**
 * Pictures from Wikimedia Commons (free-licence images), always with the title, author, licence and a link, so the person can judge
 * and credit them. The first results for a word are not always the right picture, so the answer lists candidates with their
 * descriptions rather than claiming one is correct.
 */
export interface FoundImage { title: string; url: string; thumb: string; page: string; author?: string; license?: string; description?: string }

const strip = (s?: string) => (s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** Reads the Commons API reply into images, dropping anything without a free licence or a usable file. */
export function parseCommons(json: any, max = 4): FoundImage[] {
  const pages = Object.values(json?.query?.pages ?? {}) as any[];
  return pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => {
      const info = p.imageinfo?.[0]; const meta = info?.extmetadata ?? {};
      return { title: strip(p.title).replace(/^File:/, ''), url: info?.url, thumb: info?.thumburl ?? info?.url, page: info?.descriptionurl, author: strip(meta.Artist?.value) || undefined, license: strip(meta.LicenseShortName?.value) || undefined, description: strip(meta.ImageDescription?.value).slice(0, 200) || undefined, mime: info?.mime };
    })
    .filter((i) => i.url && i.page && i.license && /^image\/(jpeg|png|svg|gif|webp)/.test((i as any).mime ?? '') && !/^(copyrighted|all rights)/i.test(i.license))
    .slice(0, max)
    .map(({ ...i }) => { delete (i as any).mime; return i as FoundImage; });
}

export async function findImages(query: string, fetcher: typeof fetch = fetch): Promise<FoundImage[]> {
  const q = query.trim();
  if (!q) throw new Error('Say what picture to look for.');
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=800`;
  // Wikimedia asks every app to say who it is; requests without it can be refused.
  const res = await fetcher(url, { headers: { 'Api-User-Agent': 'AtlasStudyApp/1.0 (private study app; image lookup on request)' } });
  if (!res.ok) throw new Error(`Image search failed (${res.status}).`);
  return parseCommons(await res.json());
}

/** Markdown for the tutor to show: each picture with its credit, plus a warning that matches are not guaranteed. */
export function imagesMarkdown(images: FoundImage[]): string {
  if (!images.length) return 'No freely licensed pictures were found for that. Try other words.';
  const items = images.map((i) => `![${i.title}](${i.thumb})\n${i.title}${i.description ? `: ${i.description}` : ''}\nBy ${i.author ?? 'unknown'}, ${i.license}. ${i.page}`);
  return `${items.join('\n\n')}\n\nThese are search matches from Wikimedia Commons, not checked against your question. Look at each one before relying on it.`;
}
