import { TIERS, packsForTier, tierBytes, tierSubjects } from '../../src/atlasTools/emergencyTiers';

const packs = ['01_Medical_part1.zip', '01_Medical_part2.zip', '02_Water_Sanitation.zip', '03_Food_Agriculture.zip', '04_Engineering_Repair.zip',
  '05_Science_Measurement.zip', '06_Survival_Navigation.zip', '07_Civilization_Crafts.zip', '08_General_Reference.zip', '09_Visual_Atlases.zip', '90_Human_Read_Only.zip']
  .map((name, i) => ({ name, size: (i + 1) * 100 }));
const names = (id: any) => packsForTier(id, packs).map((p) => p.name);

describe('emergency package sizes', () => {
  it('come in four sizes, smallest first', () => expect(TIERS.map((t) => t.id)).toEqual(['small', 'medium', 'large', 'full']));
  it('Small is medicine, water and survival', () => {
    expect(names('small')).toEqual(['01_Medical_part1.zip', '01_Medical_part2.zip', '02_Water_Sanitation.zip', '06_Survival_Navigation.zip']);
  });
  it('each size contains the one before it', () => {
    for (const [a, b] of [['small', 'medium'], ['medium', 'large'], ['large', 'full']] as const) {
      for (const n of names(a)) expect(names(b)).toContain(n);
      expect(names(b).length).toBeGreaterThan(names(a).length);
    }
  });
  it('Medium adds food and engineering; Large adds science, crafts and reference', () => {
    expect(names('medium')).toEqual(expect.arrayContaining(['03_Food_Agriculture.zip', '04_Engineering_Repair.zip']));
    expect(names('medium')).not.toContain('05_Science_Measurement.zip');
    expect(names('large')).toEqual(expect.arrayContaining(['05_Science_Measurement.zip', '07_Civilization_Crafts.zip', '08_General_Reference.zip']));
    expect(names('large')).not.toContain('09_Visual_Atlases.zip');
  });
  it('Full is every published pack, including any new ones', () => {
    const more = [...packs, { name: '10_Something_New.zip', size: 5 }];
    expect(packsForTier('full', more)).toHaveLength(more.length);
    expect(tierSubjects('full')).toBe('all');
  });
  it('adds up the download size of a size', () => {
    expect(tierBytes('small', packs)).toBe(100 + 200 + 300 + 700);
  });
});
