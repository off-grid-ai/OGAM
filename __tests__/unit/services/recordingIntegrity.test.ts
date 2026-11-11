const mockFiles = new Map<string, Buffer>();
let mockFailInstall = false;
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/docs',
    exists: jest.fn(async (p: string) => mockFiles.has(p)),
    mkdir: jest.fn(async () => undefined),
    stat: jest.fn(async (p: string) => ({ size: mockFiles.get(p)!.length })),
    read: jest.fn(async (p: string, len: number, pos: number) =>
      mockFiles.get(p)!.subarray(pos, pos + len).toString('base64')),
    writeFile: jest.fn(async (p: string, data: string) => { mockFiles.set(p, Buffer.from(data, 'base64')); }),
    appendFile: jest.fn(async (p: string, data: string) => {
      mockFiles.set(p, Buffer.concat([mockFiles.get(p)!, Buffer.from(data, 'base64')]));
    }),
    unlink: jest.fn(async (p: string) => { mockFiles.delete(p); }),
    moveFile: jest.fn(async (a: string, b: string) => {
      if (mockFailInstall && a.endsWith('.part')) {
        mockFailInstall = false;
        throw new Error('install failed');
      }
      mockFiles.set(b, mockFiles.get(a)!); mockFiles.delete(a);
    }),
  },
}), { virtual: true });
const { receiveAudio, sendMissingAudio, CHUNK_BYTES, audioPathFor } =
  require('../../../src/services/nearbySync/audio');

beforeEach(() => { mockFiles.clear(); mockFailInstall = false; });

it('verifies recording chunks from disk and assembles the original bytes', async () => {
  const wav = Buffer.alloc(CHUNK_BYTES + 3, 7);
  wav.write('RIFF');
  mockFiles.set('/source.wav', wav);
  const pieces: any[] = [];
  await sendMissingAudio([{ id: 'source', audioPath: '/source.wav' }], [],
    async (chunk: any) => { pieces.push(chunk); });
  expect(pieces).toHaveLength(2);
  expect(pieces[1].checksum).toMatch(/^[a-f0-9]{64}$/);
  for (const p of pieces) await receiveAudio({ ...p, id: 'restored' });
  expect(mockFiles.get(audioPathFor('restored'))).toEqual(wav);
});

it('rejects a tampered final chunk without damaging an existing recording', async () => {
  const original = Buffer.from('old recording');
  mockFiles.set(audioPathFor('tamper'), original);
  const wav = Buffer.alloc(CHUNK_BYTES + 3, 6);
  mockFiles.set('/source.wav', wav);
  const pieces: any[] = [];
  await sendMissingAudio([{ id: 'source', audioPath: '/source.wav' }], [],
    async (chunk: any) => { pieces.push(chunk); });
  await receiveAudio({ ...pieces[0], id: 'tamper' });
  const changed = Buffer.from(pieces[1].data, 'base64'); changed[0] ^= 1;
  await expect(receiveAudio({ ...pieces[1], id: 'tamper', data: changed.toString('base64') }))
    .rejects.toThrow(/checksum/i);
  expect(mockFiles.get(audioPathFor('tamper'))).toEqual(original);
});

it('restores the previous recording after a file-install failure', async () => {
  const original = Buffer.from('original');
  mockFiles.set(audioPathFor('keep'), original);
  mockFailInstall = true;
  await expect(receiveAudio({ kind: 'audio', id: 'keep', index: 0, total: 1,
    data: Buffer.from('RIFF replacement').toString('base64') })).rejects.toThrow('install failed');
  expect(mockFiles.get(audioPathFor('keep'))).toEqual(original);
});
