/**
 * session_summary.actions ids (docs/ANALYTICS.md): only a testID written in source can leave the
 * device; a templated one shrinks to its fixed part, so ids and names inside it never do.
 */
import fs from 'fs';
import { ACTION_ID, normalizeActionId, UNKNOWN_ACTION } from '../../../src/services/analytics/actionIds';
import { FIXED_ACTION_IDS, TEMPLATE_ACTION_IDS } from '../../../src/services/analytics/actionIds.generated';

const collector = require('../../../scripts/collect-action-ids.js');

describe('action ids', () => {
  it('keeps a fixed testID as written', () => {
    expect(normalizeActionId('send-button')).toBe('send-button');
    expect(normalizeActionId('stop-button')).toBe('stop-button');
  });

  it.each([
    ['kb-document-remove-My Diary 2024.pdf', 'kb-document-remove'],
    ['project-row-3f2a9c1e-uuid', 'project-row'],
    ['text-model-row-local_import/secret notes.gguf', 'text-model-row'],
    ['backend-gpu-button', 'backend-button'],
    ['theme-option-dark', 'theme-option'],
  ])('shrinks the template %s to its fixed part', (testID, id) => {
    expect(normalizeActionId(testID)).toBe(id);
  });

  it('counts a testID that is not in source as other, and no testID as nothing', () => {
    expect(normalizeActionId('Grandma’s recipes')).toBe(UNKNOWN_ACTION);
    expect(normalizeActionId(undefined)).toBeNull();
    expect(normalizeActionId('')).toBeNull();
  });

  it('every id that can be sent is a short lowercase id', () => {
    for (const id of [...FIXED_ACTION_IDS, ...TEMPLATE_ACTION_IDS.map(([, fixed]) => fixed)]) {
      expect(id).toMatch(ACTION_ID);
    }
  });

  it('the generated list matches the testIDs in source (run node scripts/collect-action-ids.js)', () => {
    expect(fs.readFileSync(collector.OUT, 'utf8')).toBe(collector.render(collector.collect()));
  });
});
