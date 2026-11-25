/**
 * DEVELOPMENT-ONLY demo seed: `npm run db:seed` (refuses to run in production
 * or on a database that already has users unless --force is given).
 *
 * Everything is created through the real service layer — registrations,
 * approvals, donations, requests, reservations, a fully verified handover —
 * so ledgers, histories and audit logs are produced by real business logic,
 * not inserted directly. Restaurant history rows are labelled SYNTHETIC and
 * the platform is flagged as containing demo data so analytics label it.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT, loadEnvFiles, parseConfig } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { createContext, createServices } from '../container.js';
import { provisionAdmin } from '../services/admin-provisioning.js';
import type { Actor, AuthContext } from '../types/auth.js';

interface DemoOrg {
  key: string;
  email: string;
  fullName: string;
  phone: string;
  name: string;
  address: string;
  city: string;
  state?: string;
  location: { lat: number; lng: number };
  approve: boolean;
}
interface DemoData {
  password: string;
  admin: { email: string; fullName: string; password: string };
  donors: DemoDonor[];
  ngos: DemoNgo[];
  cities: { city: string; state: string; donor: DemoDonor; ngo: DemoNgo; donation: { foodName: string; dietaryType: 'VEG' | 'NON_VEG'; quantity: number } }[];
}
type DemoDonor = DemoOrg & { businessType: string; baseMeals: number };
type DemoNgo = DemoOrg & { beneficiaries: number; capacity: number; radiusKm: number; acceptsNonVeg: boolean };

const at = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000);
const actor = (a: AuthContext): Actor => ({ type: 'USER', userId: a.userId, role: a.role });

async function main() {
  loadEnvFiles();
  const config = parseConfig();
  if (config.isProduction) throw new Error('Refusing to seed demo data in production.');
  const force = process.argv.includes('--force');
  const logger = createLogger('warn');
  const ctx = createContext(config, { logger });
  const s = createServices(ctx);
  const data = JSON.parse(await readFile(path.join(REPO_ROOT, 'database', 'seeds', 'demo-data.json'), 'utf8')) as DemoData;
  try {
    const users = await ctx.db.query<{ n: number }>('SELECT count(*) AS n FROM users');
    if ((users.rows[0]?.n ?? 0) > 0 && !force) throw new Error('Database already has users. Run `npm run db:reset` for a clean demo database, or pass --force.');

    console.log('Seeding FoodBridge demo data (development only)…');
    await provisionAdmin(ctx.db, data.admin);
    const login = async (email: string, password: string) => s.auth.authenticate((await s.auth.login(email, password, {})).tokens.accessToken);
    const admin = await login(data.admin.email, data.admin.password);
    const categories = new Map((await s.profiles.listFoodCategories()).map((c) => [c.code, c.id]));
    const cooked = categories.get('COOKED_MEALS') as string;
    const bakery = categories.get('BAKERY') as string;
    const packaged = categories.get('PACKAGED_FOOD') as string;

    const donors = new Map<string, AuthContext>();
    const addDonor = async (d: DemoDonor) => {
      await s.auth.register(
        { accountType: 'DONOR', email: d.email, password: data.password, fullName: d.fullName, phone: d.phone, organization: { name: d.name, businessType: d.businessType, addressLine: d.address, city: d.city, state: d.state, location: d.location } },
        {},
      );
      let auth = await login(d.email, data.password);
      if (d.approve) {
        await s.verification.decide('DONOR', auth.donorId as string, 'APPROVED', 'Demo organisation (synthetic)', actor(admin));
        auth = await login(d.email, data.password);
      }
      await s.profiles.setDonorCategories(auth, [cooked, bakery, packaged], actor(auth));
      await s.profiles.setDonorAvailability(auth, [1, 2, 3, 4, 5, 6, 7].map((day) => ({ isoDayOfWeek: day, opensAt: '10:00', closesAt: '23:00' })), actor(auth));
      donors.set(d.key, auth);
      return auth;
    };
    const ngos = new Map<string, AuthContext>();
    const addNgo = async (n: DemoNgo) => {
      await s.auth.register({ accountType: 'NGO', email: n.email, password: data.password, fullName: n.fullName, phone: n.phone, organization: { name: n.name, addressLine: n.address, city: n.city, state: n.state, location: n.location } }, {});
      let auth = await login(n.email, data.password);
      if (n.approve) {
        await s.verification.decide('NGO', auth.ngoId as string, 'APPROVED', 'Demo organisation (synthetic)', actor(admin));
        auth = await login(n.email, data.password);
      }
      await s.profiles.updateNgoProfile(auth, { beneficiariesCount: n.beneficiaries, maxDailyCapacity: n.capacity, collectionRadiusKm: n.radiusKm, acceptsNonVeg: n.acceptsNonVeg, acceptsVeg: true, defaultVehicleCapacity: 150, beneficiaryDescription: 'Daily meals for families and children in the area (demo)' }, actor(auth));
      await s.profiles.setNgoFoodPreferences(auth, [cooked, bakery, packaged], actor(auth));
      if (n.approve) {
        await s.representatives.create(auth, { self: true, phone: n.phone, idDocumentType: 'AADHAAR', idDocumentLast4: n.phone.slice(-4) }, actor(auth));
        auth = await login(n.email, data.password);
      }
      ngos.set(n.key, auth);
      return auth;
    };
    for (const d of data.donors) await addDonor(d);
    for (const n of data.ngos) await addNgo(n);
    // Organisations in other Indian cities (each with an open donation, matched locally).
    for (const c of data.cities) {
      const donor = await addDonor(c.donor);
      await addNgo(c.ngo);
      await s.donations.create(donor, { foodName: c.donation.foodName, categoryId: cooked, dietaryType: c.donation.dietaryType, quantity: c.donation.quantity, unit: 'MEALS', preparedAt: at(-30), storageType: 'HOT_HELD', pickupDeadline: at(300), safetyConfirmed: true, publish: true, description: `Surplus from today's service in ${c.city} (demo).` }, actor(donor));
    }

    // 120 days of SYNTHETIC restaurant history so forecasts and donor matching have data.
    for (const d of [...data.donors, ...data.cities.map((c) => c.donor)]) {
      const donorId = donors.get(d.key)?.donorId as string;
      await ctx.db.query(
        `INSERT INTO restaurant_daily_metrics (donor_id, metric_date, meal_period, prepared_qty, sold_qty, surplus_qty, is_holiday, data_source)
         SELECT $1, day::date, mp, prepared, LEAST(prepared, sold), LEAST(prepared, GREATEST(0, prepared - sold)), false, 'SYNTHETIC'
           FROM (
             SELECT day, mp,
                    round($2 * (CASE WHEN mp = 'DINNER' THEN 1.15 ELSE 1 END) * (CASE WHEN EXTRACT(ISODOW FROM day) >= 6 THEN 1.2 ELSE 1 END))::int AS prepared,
                    round($2 * (CASE WHEN mp = 'DINNER' THEN 1.15 ELSE 1 END) * (CASE WHEN EXTRACT(ISODOW FROM day) >= 6 THEN 1.2 ELSE 1 END)
                          * (0.80 + 0.12 * (0.5 + 0.5 * sin(EXTRACT(DOY FROM day)::float / 7.0 + length(mp))) ))::int AS sold
               FROM generate_series(current_date - 120, current_date - 1, interval '1 day') day, unnest(ARRAY['LUNCH','DINNER']) mp) x`,
        [donorId, d.baseMeals],
      );
    }

    const spice = donors.get('spice') as AuthContext;
    const sahyadri = donors.get('sahyadri') as AuthContext;
    const annapurna = donors.get('annapurna') as AuthContext;
    const helping = ngos.get('helping') as AuthContext;
    const rotibank = ngos.get('rotibank') as AuthContext;

    // Open donations (matching jobs are queued and run when the backend worker starts).
    const biryani = await s.donations.create(spice, { foodName: 'Veg biryani with raita', categoryId: cooked, dietaryType: 'VEG', quantity: 120, unit: 'MEALS', preparedAt: at(-40), storageType: 'HOT_HELD', pickupDeadline: at(300), safetyConfirmed: true, publish: true, description: 'Freshly cooked lunch surplus, packed in foil trays.' }, actor(spice));
    await s.donations.create(sahyadri, { foodName: 'Paneer curry and rotis', categoryId: cooked, dietaryType: 'VEG', quantity: 80, unit: 'MEALS', preparedAt: at(-20), storageType: 'HOT_HELD', pickupDeadline: at(240), safetyConfirmed: true, publish: true }, actor(sahyadri));
    await s.donations.create(sahyadri, { foodName: 'Chicken curry with rice', categoryId: cooked, dietaryType: 'NON_VEG', quantity: 45, unit: 'MEALS', preparedAt: at(-15), storageType: 'HOT_HELD', pickupDeadline: at(200), safetyConfirmed: true, publish: true }, actor(sahyadri));
    await s.donations.create(annapurna, { foodName: 'Bread loaves and buns', categoryId: bakery, dietaryType: 'VEG', quantity: 30, unit: 'PACKETS', preparedAt: at(-120), storageType: 'ROOM_TEMPERATURE', pickupDeadline: at(600), safetyConfirmed: true, publish: true }, actor(annapurna));

    // Workflow A: request + approval on the biryani (partial reservation).
    const req1 = await s.donations.createRequest(helping, biryani.id, { quantity: 50, message: 'For our evening community meal' }, actor(helping));
    await s.donations.approveRequest(spice, req1.id, undefined, actor(spice));
    await s.donations.createRequest(rotibank, biryani.id, { quantity: 40, message: 'Shelter dinner' }, actor(rotibank));

    // A completed, fully verified collection so rewards, fees and history are real.
    const thali = await s.donations.create(annapurna, { foodName: 'Dal, rice and sabzi thali', categoryId: cooked, dietaryType: 'VEG', quantity: 60, unit: 'MEALS', preparedAt: at(-30), storageType: 'HOT_HELD', pickupDeadline: at(180), safetyConfirmed: true, publish: true }, actor(annapurna));
    const req2 = await s.donations.createRequest(helping, thali.id, { quantity: 60 }, actor(helping));
    const approved = await s.donations.approveRequest(annapurna, req2.id, undefined, actor(annapurna));
    const pickup = await s.pickups.assign(helping, { allocationId: approved.allocationId, representativeId: helping.representativeId as string, scheduledPickupAt: at(30) }, actor(helping));
    const pass = await s.pickups.generatePass(helping, pickup.id, actor(helping));
    await s.pickups.verifyQr(annapurna, pass.token, {});
    await s.pickups.confirmIdentity(annapurna, pickup.id, {});
    await s.pickups.confirmHandover(annapurna, pickup.id, 60, undefined, actor(annapurna));
    await s.pickups.confirmHandover(helping, pickup.id, 60, undefined, actor(helping));
    await s.pickups.confirmDelivery(helping, pickup.id, { deliveredQuantity: 60, beneficiariesServed: 58, notes: 'Served at the community kitchen (demo)' }, actor(helping));

    // Workflow B: an open assistance request with one partial offer.
    const tomorrowNoon = new Date();
    tomorrowNoon.setDate(tomorrowNoon.getDate() + 1);
    tomorrowNoon.setUTCHours(6, 30, 0, 0); // 12:00 IST
    const assistance = await s.assistance.create(
      helping,
      { categoryId: cooked, dietaryRequirement: 'VEG_ONLY', quantityRequired: 150, unit: 'MEALS', neededFrom: tomorrowNoon, neededUntil: new Date(tomorrowNoon.getTime() + 2 * 3_600_000), urgency: 'HIGH', beneficiariesCount: 150, reason: 'Community kitchen lunch for construction workers’ families (demo)' },
      actor(helping),
    );
    await s.assistance.createOffer(sahyadri, assistance.id, { quantity: 60, foodName: 'Veg pulao', dietaryType: 'VEG', pickupAvailableFrom: new Date(tomorrowNoon.getTime() - 2 * 3_600_000), pickupDeadline: new Date(tomorrowNoon.getTime() + 30 * 60_000) }, actor(sahyadri));

    await ctx.db.query(
      `INSERT INTO platform_settings (key, value, description) VALUES ('platform.demo_data', $1, 'Development demo data is present in this database')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ seeded: true, seededAt: new Date().toISOString(), note: 'Synthetic demo organisations and records (development only)' })],
    );

    console.log('\nDemo data ready (DEVELOPMENT ONLY — synthetic records).');
    console.log(`  Admin:  ${data.admin.email} / ${data.admin.password}`);
    console.log(`  Donors: ${data.donors.map((d) => `${d.email}${d.approve ? '' : ' (pending verification)'}`).join(', ')}`);
    console.log(`  NGOs:   ${data.ngos.map((n) => `${n.email}${n.approve ? '' : ' (pending verification)'}`).join(', ')}`);
    console.log(`  Other cities (donor + NGO each): ${data.cities.map((c) => c.city).join(', ')} — e.g. ${data.cities[0]?.donor.email}, ${data.cities[0]?.ngo.email}`);
    console.log(`  Password for donor and NGO demo accounts: ${data.password}`);
  } finally {
    await ctx.db.close();
  }
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
