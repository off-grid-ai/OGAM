import { arrangeTiles, moveTile, toggleTile } from '../../src/screens/HomeScreen/homeTiles';

const keys = ['chat', 'projects', 'models', 'settings'];

describe('home tiles', () => {
  it('keep the default order with no choices', () => expect(arrangeTiles(keys, undefined)).toEqual(keys));
  it('follow the saved order and put new tiles last', () => {
    expect(arrangeTiles(keys, { order: ['models', 'chat'] })).toEqual(['models', 'chat', 'projects', 'settings']);
  });
  it('drop a saved tile that no longer exists', () => {
    expect(arrangeTiles(keys, { order: ['gone', 'chat'] })).toEqual(keys);
  });
  it('hide tiles, but show them all while customizing', () => {
    expect(arrangeTiles(keys, { hidden: ['projects'] })).toEqual(['chat', 'models', 'settings']);
    expect(arrangeTiles(keys, { hidden: ['projects'] }, true)).toEqual(keys);
  });
  it('move a tile and stop at the ends', () => {
    expect(moveTile(keys, undefined, { key: 'models', by: -1 }).order).toEqual(['chat', 'models', 'projects', 'settings']);
    expect(moveTile(keys, undefined, { key: 'chat', by: -1 }).order).toEqual(keys);
    expect(moveTile(keys, undefined, { key: 'settings', by: 1 }).order).toEqual(keys);
  });
  it('toggle a tile, and never hide Settings', () => {
    const hidden = toggleTile(undefined, 'chat');
    expect(hidden.hidden).toEqual(['chat']);
    expect(toggleTile(hidden, 'chat').hidden).toEqual([]);
    expect(toggleTile(undefined, 'settings')).toEqual({});
  });
});
