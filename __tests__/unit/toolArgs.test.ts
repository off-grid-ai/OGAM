import { executeToolCall } from '../../src/services/tools/handlers';

jest.mock('../../src/atlasTools/deviceTools', () => ({
  ...jest.requireActual('../../src/atlasTools/deviceTools'),
  writeFile: jest.fn(async (p: string, c: string, a: boolean) => `wrote ${p} ${c.length} ${a}`),
}));

const call = (args: Record<string, unknown>) => executeToolCall({ id: '1', name: 'write_file', arguments: args } as any);

describe('write_file with the argument names small models use', () => {
  it('accepts filename and text', async () => {
    const r = await call({ filename: 'a.md', text: 'hello' });
    expect(r.content).toContain('wrote a.md 5 false');
  });
  it('accepts the proper names', async () => {
    expect((await call({ path: 'b.md', content: 'x', append: 'true' })).content).toContain('wrote b.md 1 true');
  });
  it('explains an empty write instead of saving an empty file', async () => {
    const r = await call({ path: 'c.md', content: '' });
    expect(r.content).toContain('Nothing was written');
  });
});
