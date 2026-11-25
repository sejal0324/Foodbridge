import { approvedPair, type Account } from './factories.js';
import type { Harness } from './harness.js';
import { createDonation, requestDonation } from './workflow.js';

export interface PickupFixture {
  admin: Account;
  donor: Account;
  ngo: Account;
  cooked: string;
  donationId: string;
  allocationId: string;
  representativeId: string;
  pickupId: string;
}

/** Approved pair → donation → approved request → NGO owner as representative → pickup assigned. */
export async function pickupFixture(h: Harness, opts: { quantity?: number; unit?: string; approve?: number } = {}): Promise<PickupFixture> {
  const { admin, donor, ngo, cooked } = await approvedPair(h);
  const d = await createDonation(h, donor, cooked, { quantity: opts.quantity ?? 100, unit: opts.unit ?? 'MEALS' });
  const requestId = await requestDonation(h, ngo, d.id, opts.approve ?? 40);
  const approved = await h.http.patch(`/api/requests/${requestId}/approve`).set(donor.auth).send({});
  if (approved.status !== 200) throw new Error(`approve failed ${approved.status} ${JSON.stringify(approved.body)}`);
  const rep = await h.http
    .post('/api/ngos/me/representatives')
    .set(ngo.auth)
    .send({ self: true, phone: '+919811112222', idDocumentType: 'AADHAAR', idDocumentLast4: '4321' });
  if (rep.status !== 201) throw new Error(`rep failed ${rep.status} ${JSON.stringify(rep.body)}`);
  const assigned = await h.http.post('/api/pickups/assign').set(ngo.auth).send({ allocationId: approved.body.data.allocationId, representativeId: rep.body.data.id });
  if (assigned.status !== 201) throw new Error(`assign failed ${assigned.status} ${JSON.stringify(assigned.body)}`);
  return {
    admin,
    donor,
    ngo,
    cooked,
    donationId: d.id,
    allocationId: approved.body.data.allocationId,
    representativeId: rep.body.data.id,
    pickupId: assigned.body.data.id,
  };
}

/** Runs QR pass → photo-ID check so the pickup is VERIFIED. Returns the QR token used. */
export async function verifyPickup(h: Harness, f: PickupFixture): Promise<string> {
  const pass = await h.http.post('/api/pickups/generate-pass').set(f.ngo.auth).send({ pickupId: f.pickupId });
  if (pass.status !== 200) throw new Error(`pass failed ${pass.status} ${JSON.stringify(pass.body)}`);
  const qr = await h.http.post('/api/pickups/verify-qr').set(f.donor.auth).send({ token: pass.body.data.token });
  if (qr.status !== 200) throw new Error(`qr failed ${qr.status} ${JSON.stringify(qr.body)}`);
  const id = await h.http.post('/api/pickups/confirm-identity').set(f.donor.auth).send({ pickupId: f.pickupId });
  if (id.status !== 200) throw new Error(`identity failed ${id.status} ${JSON.stringify(id.body)}`);
  return pass.body.data.token as string;
}

export async function confirmBoth(h: Harness, f: PickupFixture, donorQty: number, ngoQty: number) {
  await h.http.post('/api/pickups/confirm-handover').set(f.donor.auth).send({ pickupId: f.pickupId, quantity: donorQty }).expect(200);
  return h.http.post('/api/pickups/confirm-handover').set(f.ngo.auth).send({ pickupId: f.pickupId, quantity: ngoQty }).expect(200);
}
