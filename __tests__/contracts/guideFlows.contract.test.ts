/**
 * Contract: the guide's "how do I…" flows for the phone (@offgrid/models GUIDE_FLOWS) answer with
 * this app's own labels, in order, word for word and with no model. This fails when a label a flow
 * names is no longer in the app, so the guide cannot send anyone to a button that is gone. Fix the
 * flow in shared/packages/models/src/guide-kb/mobile.json and run `npm run build:guide-kb` there.
 */
import fs from 'fs';
import path from 'path';
import { GUIDE_FLOWS, GUIDE_NOT_SUPPORTED, guideFlowLabels } from '@offgrid/models';

const ROOT = path.join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', '__tests__', 'docs', 'e2e', 'build', 'Pods']);

function read(dir: string, into: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) read(file, into);
    else if (/\.(tsx?|xml|plist)$/.test(name) && !/\.test\./.test(name))
      into.push(fs.readFileSync(file, 'utf8').replace(/&amp;/g, '&'));
  }
}

const texts: string[] = [];
for (const dir of ['src', 'pro', 'android/app/src/main/res', 'ios/ImproveShare']) read(path.join(ROOT, dir), texts);
// Pro is a private submodule: a checkout without it skips the flows whose code lives there.
const hasPro = fs.existsSync(path.join(ROOT, 'pro', 'package.json'));

const sourceOf = (source: string) => source.replace(/^mobile\//, '').replace(/:\d+$/, '');
const phone = [...GUIDE_FLOWS, ...GUIDE_NOT_SUPPORTED].filter(
  e => e.surface === 'mobile' || (e.surface === 'cross' && e.source.startsWith('mobile/')),
);
const checked = phone.filter(e => hasPro || !sourceOf(e.source).startsWith('pro/'));

describe('guide flows match the phone app', () => {
  it('has phone flows to check', () => {
    expect(phone.length).toBeGreaterThan(100);
  });

  it.each(checked.map(e => [e.id, e] as const))('%s cites a file that exists', (_id, entry) => {
    expect(fs.existsSync(path.join(ROOT, sourceOf(entry.source)))).toBe(true);
  });

  const flows = GUIDE_FLOWS.filter(f => checked.includes(f) && f.surface === 'mobile');
  it.each(flows.map(f => [f.id, f] as const))('%s names only labels the app shows', (_id, flow) => {
    const missing = guideFlowLabels(flow).filter((label: string) => !texts.some(t => t.includes(label)));
    expect(missing).toEqual([]);
  });
});
