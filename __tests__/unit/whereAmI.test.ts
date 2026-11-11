import { describePlace, nearestCities, countryName } from '../../src/atlasMaps/whereAmI';
import { locationNote } from '../../src/atlasMaps/locationNote';
import { useMaps } from '../../src/atlasMaps/maps';
import { useAppStore } from '../../src/stores';

describe('knowing roughly where you are, offline', () => {
  it('finds the nearest large cities to a point, with distance and direction', () => {
    // Evanston, Illinois: next to Chicago.
    const [first] = nearestCities(42.045, -87.688, 3);
    expect(first.city.name).toBe('Chicago');
    expect(first.km).toBeGreaterThan(10);
    expect(first.km).toBeLessThan(25);
    expect(first.direction).toBe('S');
    expect(countryName(first.city.cc)).toMatch(/United States/);
  });
  it('says in or right next to a city when the point is inside it', () => {
    const chicago = describePlace(41.88, -87.63)!;
    expect(chicago.sentence).toMatch(/^in or right next to Chicago, United States/);
    const london = describePlace(51.51, -0.12)!;
    expect(london.sentence).toContain('London');
    expect(london.sentence).toMatch(/United Kingdom/);
  });
  it('for a place far from any big city, says how far and which way, and names the country', () => {
    const outback = describePlace(-25.3, 131.0)!; // near Uluru
    expect(outback.sentence).toMatch(/about \d+ km from .*Australia/);
  });
  it('works across the world, including the southern and eastern hemispheres', () => {
    expect(describePlace(-33.87, 151.21)!.nearest.city.name).toBe('Sydney');
    expect(describePlace(35.68, 139.69)!.nearest.city.name).toBe('Tokyo');
    expect(describePlace(-23.55, -46.63)!.nearest.city.name).toMatch(/S[aã]o Paulo/);
    expect(describePlace(30.04, 31.24)!.nearest.city.name).toBe('Cairo');
  });
});

describe('the line that tells the AI where the user is', () => {
  const fix = (minutesAgo: number) => ({ lat: 41.88, lon: -87.63, accuracy: 20, altitude: 180, time: Date.now() - minutesAgo * 60000 } as any);
  beforeEach(() => { useMaps.setState({ lastFix: null }); useAppStore.getState().updateSettings({ shareLocation: undefined }); });

  it('names the city and country, but never the coordinates', () => {
    useMaps.setState({ lastFix: fix(5) });
    const note = locationNote();
    expect(note).toContain('Chicago, United States');
    expect(note).toContain('5 minutes ago');
    expect(note).not.toMatch(/41\.88|-87\.63/);
  });
  it('says nothing without a reading, with an old one, or when the person turned it off', () => {
    expect(locationNote()).toBe('');
    useMaps.setState({ lastFix: fix(60 * 20) });
    expect(locationNote()).toBe('');
    useMaps.setState({ lastFix: fix(5) });
    useAppStore.getState().updateSettings({ shareLocation: false });
    expect(locationNote()).toBe('');
  });
});
