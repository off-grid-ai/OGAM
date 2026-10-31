/**
 * The parallel mobile nightly (.github/workflows/uat-dev.yml).
 *
 * SPEC: a plan job pins the version and the commit; Android and iOS build in parallel from that commit;
 * each upload starts only once every build that runs has succeeded; finalize (commit, tag, GitHub
 * prerelease) starts only once every upload has. The plan reads the private shared repository's
 * origin/main, so its shared checkout keeps credentials.
 *
 * These read the workflow as data, so a broken nightly shows on the pull request, not at night.
 */
import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';

type Step = { uses?: string; with?: Record<string, unknown>; run?: string };
type Job = { needs?: string | string[]; if?: string; steps: Step[] };

const workflow = parse(fs.readFileSync(path.join(__dirname, '../../.github/workflows/uat-dev.yml'), 'utf8')) as {
  jobs: Record<string, Job>;
};
const jobs = workflow.jobs;
const needs = (name: string) => ([] as string[]).concat(jobs[name].needs ?? []);
const checkouts = (job: Job) => job.steps.filter(step => step.uses?.startsWith('actions/checkout@'));
const PINNED = '${{ needs.plan.outputs.sha }}';

it('the plan keeps credentials on the shared checkout it fetches with uat.sh --plan', () => {
  const plan = jobs.plan;
  expect(plan.steps.some(step => step.run?.includes('scripts/uat.sh --plan'))).toBe(true);
  const shared = checkouts(plan).filter(step => step.with?.repository === 'off-grid-ai/shared');
  expect(shared).toHaveLength(1);
  expect(shared[0].with?.['persist-credentials']).not.toBe(false);
});

it('every build, upload and finalize job checks out the commit the plan pinned', () => {
  const later = Object.keys(jobs).filter(name => name !== 'plan');
  expect(later.sort()).toEqual(['build-android', 'build-ios', 'finalize', 'upload-android', 'upload-ios']);
  for (const name of later) {
    expect(needs(name)).toContain('plan');
    const own = checkouts(jobs[name]).filter(step => !step.with?.repository);
    expect(own).toHaveLength(1);
    expect(own[0].with?.ref).toBe(PINNED);
  }
});

it('Android and iOS build in parallel, uploads wait for both builds, finalize waits for both uploads', () => {
  expect(needs('build-android')).toEqual(['plan']);
  expect(needs('build-ios')).toEqual(['plan']);
  for (const upload of ['upload-android', 'upload-ios']) {
    expect(needs(upload)).toEqual(expect.arrayContaining(['build-android', 'build-ios']));
    // A failed build anywhere stops every upload.
    expect(jobs[upload].if).toContain("!contains(needs.*.result, 'failure')");
  }
  expect(needs('finalize')).toEqual(expect.arrayContaining(['upload-android', 'upload-ios']));
  expect(jobs.finalize.if).toContain("!contains(needs.*.result, 'failure')");
  expect(jobs.finalize.steps.some(step => step.run?.includes('scripts/uat.sh --finalize'))).toBe(true);
});
