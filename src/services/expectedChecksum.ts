/**
 * "Is the file I downloaded the file that was published?" The person gives either the SHA-256 shown on the download page, or
 * the download link itself. For a Hugging Face link the published checksum is read from the page's small Git LFS pointer
 * (".../raw/..." serves `oid sha256:<hex>` and `size <bytes>` for large files), so nothing big is downloaded. Other sites:
 * paste the checksum.
 */
export interface Expected { sha256: string; bytes?: number; source: string }
export type ExpectedResult = Expected | { error: string };

const HEX64 = /\b[0-9a-f]{64}\b/i;

/** The 64-hex SHA-256 in some pasted text (sha256sum output, "sha256: ...", or just the hex), lower-cased; null if none. */
export function parseChecksum(input: string): string | null {
  const m = input.match(HEX64);
  return m ? m[0].toLowerCase() : null;
}

/** A Hugging Face download or page link rewritten to the "raw" address that serves the LFS pointer; null if it is not one. */
export function pointerUrl(link: string): string | null {
  const m = link.trim().match(/^https:\/\/(?:www\.)?(?:huggingface\.co|hf\.co)\/([^/\s]+\/[^/\s]+)\/(?:resolve|blob|raw)\/([^/\s]+)\/([^?#\s]+)/i);
  return m ? `https://huggingface.co/${m[1]}/raw/${m[2]}/${m[3]}` : null;
}

/** `oid sha256:<hex>` and `size <n>` from a Git LFS pointer file; null when the text is not one. */
export function parseLfsPointer(text: string): { sha256: string; bytes?: number } | null {
  const oid = text.match(/^oid sha256:([0-9a-f]{64})\s*$/im);
  if (!oid) return null;
  const size = text.match(/^size (\d+)\s*$/im);
  return { sha256: oid[1].toLowerCase(), bytes: size ? Number(size[1]) : undefined };
}

/** Turns what the person typed into the published checksum (and size, from a link). `fetchText` is the network, injected for tests. */
export async function resolveExpected(input: string, fetchText: (url: string) => Promise<string> = defaultFetchText): Promise<ExpectedResult | null> {
  const text = input.trim();
  if (!text) return null;
  const url = pointerUrl(text);
  if (url) {
    try {
      const pointer = parseLfsPointer(await fetchText(url));
      if (!pointer) return { error: 'That page is not a large file with a published checksum. Paste the SHA-256 shown on the download page instead.' };
      return { ...pointer, source: 'the Hugging Face page you gave' };
    } catch (e: any) {
      return { error: `Could not read the checksum from that link (${String(e?.message || e)}). Check the internet connection, or paste the SHA-256 instead.` };
    }
  }
  const sha = parseChecksum(text);
  if (sha) return { sha256: sha, source: 'the checksum you gave' };
  return { error: 'That is not a SHA-256 (64 letters and digits) or a Hugging Face download link.' };
}

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`the page answered ${response.status}`);
  return response.text();
}

/** The verdict line for a file whose checksum was computed on the phone. */
export function describeAgainstExpected(file: { bytes: number; sha256: string }, expected: Expected): string {
  const sizeBad = expected.bytes != null && expected.bytes !== file.bytes;
  if (file.sha256.toLowerCase() === expected.sha256 && !sizeBad) return `OK: identical to ${expected.source} (SHA-256 ${file.sha256.slice(0, 12)}..., ${file.bytes.toLocaleString('en-US')} bytes)`;
  const why = sizeBad ? `${file.bytes.toLocaleString('en-US')} bytes, it should be ${expected.bytes?.toLocaleString('en-US')}` : `SHA-256 ${file.sha256}, it should be ${expected.sha256}`;
  return `DAMAGED: does NOT match ${expected.source} (${why}). Some of its bytes are wrong: delete it and copy or download it again`;
}
