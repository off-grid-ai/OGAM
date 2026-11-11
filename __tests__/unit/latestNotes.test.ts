const { latestNotes } = require('../../scripts/release/latest-notes.cjs');

describe('release notes for a GitHub release', () => {
  const doc = ['# Notes', '', 'intro', '- 0.0.149: first line', '  continued line', '  more', '- 0.0.148: older', '  older continued', '- 0.0.147: oldest'].join('\n');
  it('takes the newest entry only, without the list marker and indent', () => {
    expect(latestNotes(doc)).toBe('0.0.149: first line\ncontinued line\nmore');
  });
  it('takes the last entry to the end of the file', () => {
    expect(latestNotes('- 0.0.1: only\n  entry')).toBe('0.0.1: only\nentry');
  });
  it('picks the highest version even when entries are out of order', () => {
    expect(latestNotes('- 0.0.130: a\n- 0.0.148: b\n  more\n- 0.0.147: c')).toBe('0.0.148: b\nmore');
  });
  it('gives nothing when there are no entries', () => expect(latestNotes('# nothing here')).toBe(''));
  it('reads the real notes file', () => {
    const real = latestNotes(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'docs', 'ATLAS_RELEASE_0.0.105.md'), 'utf8'));
    expect(real).toMatch(/^0\.0\.\d+:/);
  });
});
