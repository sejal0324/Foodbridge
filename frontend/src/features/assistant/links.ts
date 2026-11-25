import { rolePath } from '@/layouts/navigation';
import type { Role } from '@/types';

/**
 * Turns an assistant card link (some are role-neutral, e.g. "/donations") into
 * an in-app path for the current role. Links to another role's area are dropped.
 */
export function resolveAssistantLink(link: string | undefined, role: Role): string | null {
  if (!link || !link.startsWith('/') || link.startsWith('//')) return null;
  const generic: Record<string, string> = {
    '/donations': role === 'NGO' ? rolePath(role, 'marketplace') : rolePath(role, 'donations'),
    '/requests': role === 'DONOR' ? rolePath(role, 'donations') : rolePath(role, 'requests'),
    '/pickups': rolePath(role, 'pickups'),
  };
  if (generic[link]) return generic[link];
  const area = `/${link.split('/')[1]}`;
  const own = rolePath(role);
  if (['/donor', '/ngo', '/admin'].includes(area)) return area === own ? link : null;
  return null;
}

/** Best-effort in-app link for one item inside an assistant result. */
export function inferItemLink(item: Record<string, unknown>, role: Role): string | null {
  const id = typeof item.id === 'string' ? item.id : null;
  const nested = (k: string) => (typeof item[k] === 'object' && item[k] !== null ? (item[k] as Record<string, unknown>) : null);
  if (id && 'allocationId' in item && 'representative' in item) return rolePath(role, `pickups/${id}`);
  if (id && 'foodName' in item && 'origin' in item) return role === 'NGO' ? rolePath(role, `marketplace/${id}`) : rolePath(role, `donations/${id}`);
  if ('requestedQuantity' in item && nested('donation')?.id && role === 'DONOR') return rolePath(role, `donations/${String(nested('donation')?.id)}`);
  if (id && 'quantityRequired' in item) return rolePath(role, `assistance/${id}`);
  const request = nested('request');
  if (request && typeof request.id === 'string') return rolePath(role, `assistance/${request.id}`);
  const donation = nested('donation');
  if (donation && typeof donation.id === 'string' && role === 'NGO') return rolePath(role, `marketplace/${donation.id}`);
  return null;
}
