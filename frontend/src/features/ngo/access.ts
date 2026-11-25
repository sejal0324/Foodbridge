import type { Me } from '@/types';

/**
 * The two kinds of NGO users (GET /auth/me):
 * - owner: `organization.type === 'NGO'` — full access; may also be a representative;
 * - representative only: `organization === null` with a `representative` — collects food
 *   for the NGO (own pickups, pass, LiveTrack, handover and delivery), nothing else.
 * These only shape navigation: the backend authorises every request.
 */
export function isNgoOwner(user: Me | null | undefined): boolean {
  return Boolean(user && user.role === 'NGO' && user.organization?.type === 'NGO');
}

export function isRepresentativeOnly(user: Me | null | undefined): boolean {
  return Boolean(user && user.role === 'NGO' && !user.organization && user.representative);
}

/** True for the owner's own representative record or a representative-only account that is ACTIVE. */
export function isActiveRepresentative(user: Me | null | undefined): boolean {
  return user?.representative?.status === 'ACTIVE';
}

/** Name of the NGO the user acts for. */
export function ngoNameOf(user: Me): string {
  return user.organization?.name ?? user.representative?.ngoName ?? 'your NGO';
}
