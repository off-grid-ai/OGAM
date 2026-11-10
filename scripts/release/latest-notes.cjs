// The newest entry of docs/ATLAS_RELEASE_0.0.105.md ("- 0.0.NNN: ..." up to the next entry), as the text of a GitHub release.
const fs = require('node:fs');
const path = require('node:path');

function latestNotes(markdown) {
  const lines = markdown.split('\n');
  const isEntry = (l) => /^- 0\.0\.\d+:/.test(l);
  const num = (l) => Number(/^- 0\.0\.(\d+):/.exec(l)[1]);
  let start = -1;
  lines.forEach((l, i) => { if (isEntry(l) && (start < 0 || num(l) > num(lines[start]))) start = i; });
  if (start < 0) return '';
  let end = lines.findIndex((l, i) => i > start && isEntry(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).map((l, i) => (i === 0 ? l.replace(/^- /, '') : l.replace(/^ {2}/, ''))).join('\n').trim();
}

module.exports = { latestNotes };

if (require.main === module) {
  const file = path.join(__dirname, '..', '..', 'docs', 'ATLAS_RELEASE_0.0.105.md');
  const notes = latestNotes(fs.readFileSync(file, 'utf8'));
  process.stdout.write(`Install this APK on your Android phone or tablet (download it, open it, allow installing from this source).\n\n${notes}\n`);
}
