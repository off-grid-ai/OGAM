import { describeAgainstExpected, parseChecksum, parseLfsPointer, pointerUrl, resolveExpected } from '../../src/services/expectedChecksum';

const SHA = '59656d7494d6376ca97e9e20b64ea2e16cd97f12ec6d47bfccba91cb785b5134';
const POINTER = `version https://git-lfs.github.com/spec/v1\noid sha256:${SHA}\nsize 7381381760\n`;

describe('expected checksum from what the person pastes', () => {
  it('finds the SHA-256 in sha256sum output, labelled text or bare hex, in any case', () => {
    expect(parseChecksum(`${SHA}  Gemma4-12B-Q4_K_M.gguf`)).toBe(SHA);
    expect(parseChecksum(`SHA256: ${SHA.toUpperCase()}`)).toBe(SHA);
    expect(parseChecksum('not a checksum')).toBeNull();
    expect(parseChecksum('abc123')).toBeNull();
  });

  it('turns Hugging Face download and page links into the small pointer address, and ignores other sites', () => {
    const want = 'https://huggingface.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced/raw/main/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf';
    expect(pointerUrl('https://huggingface.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced/resolve/main/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf?download=true')).toBe(want);
    expect(pointerUrl('https://huggingface.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced/blob/main/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf')).toBe(want);
    expect(pointerUrl('https://example.com/model.gguf')).toBeNull();
  });

  it('reads the checksum and size from an LFS pointer, and refuses an ordinary page', () => {
    expect(parseLfsPointer(POINTER)).toEqual({ sha256: SHA, bytes: 7381381760 });
    expect(parseLfsPointer('<html>not a pointer</html>')).toBeNull();
  });

  it('resolves a link through the network, a bare checksum without it, and says why when it cannot', async () => {
    const fetched: string[] = [];
    const link = 'https://huggingface.co/o/r/resolve/main/f.gguf';
    expect(await resolveExpected(link, async (u) => { fetched.push(u); return POINTER; })).toEqual({ sha256: SHA, bytes: 7381381760, source: 'the Hugging Face page you gave' });
    expect(fetched).toEqual(['https://huggingface.co/o/r/raw/main/f.gguf']);
    expect(await resolveExpected(SHA, async () => { throw new Error('no network used'); })).toEqual({ sha256: SHA, source: 'the checksum you gave' });
    expect(await resolveExpected(link, async () => { throw new Error('offline'); })).toEqual({ error: expect.stringMatching(/Could not read the checksum from that link \(offline\)/) });
    expect(await resolveExpected(link, async () => '<html></html>')).toEqual({ error: expect.stringMatching(/not a large file with a published checksum/) });
    expect(await resolveExpected('hello', async () => '')).toEqual({ error: expect.stringMatching(/not a SHA-256/) });
    expect(await resolveExpected('   ')).toBeNull();
  });

  it('judges a file against it by checksum and size', () => {
    const expected = { sha256: SHA, bytes: 7381381760, source: 'the checksum you gave' };
    expect(describeAgainstExpected({ bytes: 7381381760, sha256: SHA }, expected)).toMatch(/^OK: identical to the checksum you gave/);
    expect(describeAgainstExpected({ bytes: 7381381760, sha256: '0'.repeat(64) }, expected)).toMatch(/^DAMAGED: does NOT match the checksum you gave.*delete it/);
    expect(describeAgainstExpected({ bytes: 100, sha256: SHA }, expected)).toMatch(/^DAMAGED:.*100 bytes, it should be 7,381,381,760/);
  });
});
