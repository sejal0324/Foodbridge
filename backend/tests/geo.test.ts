import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/config/logger.js';
import { GeocodingClient } from '../src/integrations/geocoding.js';
import { PASSWORD, approvedPair } from './helpers/factories.js';
import { createHarness, resetDatabase, type Harness } from './helpers/harness.js';
import { inMinutes } from './helpers/workflow.js';

const calls: string[] = [];
let failNext = false;
const nominatim = (async (input: string | URL) => {
  const url = String(input);
  calls.push(url);
  if (failNext) {
    failNext = false;
    return new Response('busy', { status: 503 });
  }
  if (url.includes('/reverse')) {
    return new Response(JSON.stringify({ display_name: 'Connaught Place, New Delhi, Delhi, 110001, India', lat: '28.6315', lon: '77.2167', address: { city: 'New Delhi', state: 'Delhi', postcode: '110001', country_code: 'in' } }));
  }
  return new Response(
    JSON.stringify([
      { display_name: 'Koramangala, Bengaluru, Karnataka, 560034, India', lat: '12.9352', lon: '77.6245', address: { suburb: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', postcode: '560034', country_code: 'in' } },
      { display_name: 'Somewhere abroad', lat: '51.5', lon: '-0.12', address: { city: 'London', country_code: 'gb' } },
    ]),
  );
}) as typeof fetch;

let h: Harness;
beforeAll(async () => {
  h = await createHarness((c) => c, { geocoding: new GeocodingClient(undefined, createLogger('silent'), nominatim) });
});
beforeEach(() => resetDatabase(h.ctx.db));
afterAll(() => h.close());

describe('India-wide location search', () => {
  it('searches OpenStreetMap restricted to India and returns structured address fields', async () => {
    const res = await h.http.get('/api/geo/search?q=Koramangala').expect(200);
    expect(res.body.data.provider).toBe('OPENSTREETMAP');
    expect(res.body.data.results).toEqual([
      { label: 'Koramangala, Bengaluru, Karnataka, 560034, India', lat: 12.9352, lng: 77.6245, city: 'Bengaluru', state: 'Karnataka', postalCode: '560034' },
    ]);
    expect(calls.at(-1)).toContain('countrycodes=in');
    // Cached: a repeated query does not hit the provider again.
    const before = calls.length;
    await h.http.get('/api/geo/search?q=koramangala').expect(200);
    expect(calls.length).toBe(before);
  });

  it('reverse-geocodes points in India and refuses points outside India', async () => {
    const res = await h.http.get('/api/geo/reverse?lat=28.6315&lng=77.2167').expect(200);
    expect(res.body.data.results[0]).toMatchObject({ city: 'New Delhi', state: 'Delhi', postalCode: '110001' });
    const abroad = await h.http.get('/api/geo/reverse?lat=51.5&lng=-0.12').expect(422);
    expect(abroad.body.error.code).toBe('LOCATION_OUTSIDE_INDIA');
  });

  it('reports the provider being unavailable honestly', async () => {
    failNext = true;
    const res = await h.http.get('/api/geo/search?q=Unique place 123').expect(503);
    expect(res.body.error.code).toBe('GEOCODING_UNAVAILABLE');
  });

  it('lists all 28 states and 8 union territories', async () => {
    const res = await h.http.get('/api/geo/states').expect(200);
    expect(res.body.data).toHaveLength(36);
    expect(res.body.data).toEqual(expect.arrayContaining(['Maharashtra', 'Tamil Nadu', 'Delhi', 'Ladakh', 'Lakshadweep']));
  });
});

describe('locations must be in India', () => {
  it('accepts organisations anywhere in India and rejects locations abroad', async () => {
    for (const [city, location] of [
      ['Guwahati', { lat: 26.1445, lng: 91.7362 }],
      ['Port Blair', { lat: 11.6234, lng: 92.7265 }],
      ['Leh', { lat: 34.1526, lng: 77.5771 }],
      ['Kochi', { lat: 9.9312, lng: 76.2673 }],
    ] as const) {
      await h.http
        .post('/api/auth/register')
        .send({ accountType: 'NGO', email: `${city.toLowerCase().replace(' ', '')}@example.org`, password: PASSWORD, fullName: 'Field Lead', organization: { name: `${city} Food Seva`, city, location } })
        .expect(201);
    }
    const london = await h.http
      .post('/api/auth/register')
      .send({ accountType: 'DONOR', email: 'abroad@example.org', password: PASSWORD, fullName: 'Abroad', organization: { name: 'Abroad Cafe', location: { lat: 51.5, lng: -0.12 } } })
      .expect(422);
    expect(london.body.error.code).toBe('LOCATION_OUTSIDE_INDIA');
    expect(london.body.error.details[0].path).toBe('organization.location');
  });

  it('rejects a donation pickup point outside India (e.g. swapped coordinates)', async () => {
    const { donor, cooked } = await approvedPair(h);
    const res = await h.http
      .post('/api/donations')
      .set(donor.auth)
      .send({ foodName: 'Rice', categoryId: cooked, dietaryType: 'VEG', quantity: 10, unit: 'MEALS', preparedAt: inMinutes(-10), storageType: 'HOT_HELD', pickupDeadline: inMinutes(120), safetyConfirmed: true, location: { lat: 73.76, lng: 18.59 } })
      .expect(422);
    expect(res.body.error.code).toBe('LOCATION_OUTSIDE_INDIA');
  });
});
