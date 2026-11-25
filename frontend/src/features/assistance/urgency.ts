import type { BadgeTone } from '@/components/ui';
import type { Urgency } from '@/types';

export const URGENCY_TONE: Record<Urgency, BadgeTone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger' };
