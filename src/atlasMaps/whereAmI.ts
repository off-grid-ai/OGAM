/**
 * Knowing roughly where you are, with no internet: the nearest large cities to a GPS reading, from the built-in city list.
 * Used in the AI's instructions (so it can say what city you are in) and by the "my location" tool. Pure, so it is tested
 * without a device. Only large cities are listed, so a small town is reported as near the closest big city, never invented.
 */
import { CITY_ROWS, COUNTRY_NAMES } from './cities';
import { bearingDeg, compassName, distanceM } from './maps';

export interface City { name: string; cc: string; lat: number; lon: number; thousands: number }
export interface NearCity { city: City; km: number; direction: string }

let cities: City[] | null = null;
function all(): City[] {
  if (!cities) {
    cities = CITY_ROWS.split('\n').map((row) => {
      const [name, cc, lat, lon, k] = row.split('|');
      return { name, cc, lat: Number(lat), lon: Number(lon), thousands: Number(k) };
    });
  }
  return cities;
}

export const countryName = (cc: string) => COUNTRY_NAMES[cc] ?? cc;

/** The [n] cities closest to a point, nearest first. */
export function nearestCities(lat: number, lon: number, n = 3): NearCity[] {
  const here = { lat, lon };
  return all()
    .map((city) => ({ city, meters: distanceM(here, city) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, n)
    .map(({ city, meters }) => ({ city, km: meters / 1000, direction: compassName(bearingDeg(here, city)) }));
}

const kmText = (km: number) => (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);

/** "in or right next to Chicago, United States" / "about 40 km from Madison (to the N), United States". */
export function describePlace(lat: number, lon: number): { sentence: string; nearest: NearCity } | null {
  const near = nearestCities(lat, lon, 3);
  if (!near.length || !Number.isFinite(near[0].km)) return null;
  const [first, ...rest] = near;
  const country = countryName(first.city.cc);
  const lead = first.km <= 12 ? `in or right next to ${first.city.name}, ${country}`
    : `about ${kmText(first.km)} from ${first.city.name}, ${country} (${first.city.name} is to the ${first.direction})`;
  const others = rest.filter((r) => r.km < 150).map((r) => `${r.city.name} (${kmText(r.km)} ${r.direction})`);
  return { sentence: others.length ? `${lead}. Other cities nearby: ${others.join(', ')}` : lead, nearest: first };
}
