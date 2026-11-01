/**
 * The engine-pack manifest (off-grid-ai/llama.rn's schema 1) is trusted only when its ed25519
 * signature verifies against the pinned key, and only packs this app build can load are chosen.
 * Signed here with a real key pair.
 */
import nacl from 'tweetnacl';
import { decodeUTF8, encodeBase64 } from 'tweetnacl-util';
import { choosePack, packId, verifyManifest, type EnginePack } from '../../../src/services/enginePacks/manifest';

const keys = nacl.sign.keyPair();
const publicKey = encodeBase64(keys.publicKey);
const sign = (body: string) => encodeBase64(nacl.sign.detached(decodeUTF8(body), keys.secretKey));

const hash = (c: string) => c.repeat(64);
const rawPack = (over: Record<string, unknown> = {}) => ({
  abi: 'arm64-v8a',
  url: 'https://mobile-runtime.getoffgridai.co/android/0.13.0-b12032/engine-pack-arm64-v8a.zip',
  sha256: hash('a'),
  size: 40_000_000,
  files: [
    { path: 'librnllama.so', sha256: hash('b'), size: 1 },
    { path: 'librnllama_jni.so', sha256: hash('c'), size: 1 },
    { path: 'htp/libggml-htp-v73.so', sha256: hash('d'), size: 1 },
  ],
  ...over,
});
const manifest = (packs: unknown[], over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: 1, package: '@offgrid/llama.rn', version: '0.13.0-b12032', llamaCpp: 'b12032', llamaBuild: 12032,
    bridge: 'bridge-1', reactNative: '0.83.1', createdAt: '2026-11-01T00:00:00.000Z', packs, ...over,
  });
const expected: EnginePack = {
  engineVersion: '0.13.0-b12032', llamaBuild: 12032, reactNative: '0.83.1', bridge: 'bridge-1', abi: 'arm64-v8a',
  url: rawPack().url, sha256: hash('a'), bytes: 40_000_000,
  files: { 'librnllama.so': hash('b'), 'librnllama_jni.so': hash('c'), 'htp/libggml-htp-v73.so': hash('d') },
};

describe('verifyManifest', () => {
  it('returns each ABI pack of a manifest signed with the pinned key', () => {
    const body = manifest([rawPack()]);
    expect(verifyManifest(body, sign(body), publicKey)).toEqual([expected]);
  });

  it('takes the fork under its npm name too', () => {
    const body = manifest([rawPack()], { package: '@ogai/llama.rn' });
    expect(verifyManifest(body, sign(body), publicKey)).toEqual([expected]);
  });

  it('refuses a manifest changed after signing', () => {
    const body = manifest([rawPack()]);
    expect(() => verifyManifest(body.replace('12032,', '99999,'), sign(body), publicKey)).toThrow('signature does not match');
  });

  it('refuses a manifest signed with another key', () => {
    const body = manifest([rawPack()]);
    const signature = encodeBase64(nacl.sign.detached(decodeUTF8(body), nacl.sign.keyPair().secretKey));
    expect(() => verifyManifest(body, signature, publicKey)).toThrow('signature does not match');
  });

  it('refuses a signature that is not base64 ed25519', () => {
    const body = manifest([rawPack()]);
    expect(() => verifyManifest(body, 'not a signature', publicKey)).toThrow('signature does not match');
  });

  it.each([
    ['another schema', { schema: 2 }],
    ['another package', { package: 'llama.rn' }],
    ['a version with a slash', { version: '0.13/0' }],
    ['no llama build', { llamaBuild: 0 }],
    ['no bridge', { bridge: null }],
    ['no React Native version', { reactNative: 3 }],
    ['no pack list', { packs: {} }],
  ])('refuses a signed manifest with %s', (_label, over) => {
    const body = manifest([rawPack()], over);
    expect(() => verifyManifest(body, sign(body), publicKey)).toThrow('not a schema 1 llama.rn fork manifest');
  });

  it.each([
    ['an http url', { url: 'http://mobile-runtime.getoffgridai.co/x.zip' }],
    ['another host', { url: 'https://example.com/x.zip' }],
    ['a broken url', { url: 'not a url' }],
    ['no abi', { abi: undefined }],
    ['a short sha256', { sha256: 'abc' }],
    ['no size', { size: 0 }],
    ['no file list', { files: undefined }],
    ['no librnllama.so', { files: [{ path: 'librnllama_jni.so', sha256: hash('c') }] }],
    ['a file outside the pack', { files: [{ path: 'librnllama.so', sha256: hash('b') }, { path: '../x.so', sha256: hash('c') }] }],
    ['a file with a bad hash', { files: [{ path: 'librnllama.so', sha256: 'x' }] }],
    ['a broken file entry', { files: [null] }],
  ])('drops a pack with %s', (_label, over) => {
    const body = manifest([rawPack(over), null, rawPack({ abi: 'x86_64' })]);
    expect(verifyManifest(body, sign(body), publicKey).map(p => p.abi)).toEqual(['x86_64']);
  });
});

describe('choosePack', () => {
  const device = { reactNative: '0.83.1', bridge: 'bridge-1', abis: ['arm64-v8a'], currentBuild: 11385, rejected: new Set<string>() };
  const pack = (over: Partial<EnginePack> = {}): EnginePack => ({ ...expected, ...over });

  it('picks the newest pack this app build can load', () => {
    const packs = [pack({ llamaBuild: 11990 }), pack({ engineVersion: '0.15.0', llamaBuild: 12100 }), pack({ llamaBuild: 12050 })];
    expect(choosePack(packs, device)?.engineVersion).toBe('0.15.0');
  });

  it('picks none that is not newer than the running engine', () => {
    expect(choosePack([pack({ llamaBuild: 11385 })], device)).toBeNull();
  });

  it('picks none built for another React Native, bridge or ABI', () => {
    expect(choosePack([pack({ reactNative: '0.83.2' }), pack({ bridge: 'bridge-2' }), pack({ abi: 'x86_64' })], device)).toBeNull();
  });

  it('picks none when the app does not know its bridge', () => {
    expect(choosePack([pack({ bridge: '' })], { ...device, bridge: '' })).toBeNull();
  });

  it('picks none the phone rejected before', () => {
    expect(choosePack([pack()], { ...device, rejected: new Set([packId(pack())]) })).toBeNull();
  });
});

describe('packId', () => {
  it('names a pack by version and the first 12 hex of its zip hash, as the native store does', () => {
    expect(packId(expected)).toBe('0.13.0-b12032-aaaaaaaaaaaa');
  });
});
