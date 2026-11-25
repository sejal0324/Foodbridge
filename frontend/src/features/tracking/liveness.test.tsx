import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TrackingSessionView } from '@/types';
import { EtaSummary } from './components/TrackingViewer';
import { LivenessBadge } from './components/LivenessBadge';
import { effectiveLiveness } from './liveness';

const NOW = Date.parse('2026-11-03T10:00:00Z');

function session(overrides: Partial<TrackingSessionView> = {}): TrackingSessionView {
  return {
    id: 's1',
    pickupId: 'p1',
    stage: 'TO_PICKUP',
    status: 'ACTIVE',
    liveness: 'LIVE',
    lastPosition: { lat: 18.6, lng: 73.76, accuracyM: 12, recordedAt: new Date(NOW - 20_000).toISOString(), ageSeconds: 20 },
    destination: { lat: 18.5987, lng: 73.7645 },
    eta: { remainingDistanceM: 1800, etaSeconds: null, source: 'STRAIGHT_LINE_ESTIMATE', note: 'Road routing is not configured; showing straight-line distance only.' },
    totalDistanceM: 2400,
    representativeName: 'Asha Patil',
    startedAt: new Date(NOW - 600_000).toISOString(),
    endedAt: null,
    endReason: null,
    staleAfterSeconds: 60,
    ...overrides,
  };
}

describe('tracking liveness', () => {
  it('is LIVE for a fresh position', () => {
    expect(effectiveLiveness(session(), NOW)).toEqual({ liveness: 'LIVE', ageSeconds: 20 });
  });

  it('becomes STALE on the client clock even if the server last said LIVE', () => {
    // Server said LIVE 5 minutes ago; no update since.
    const s = session({ lastPosition: { lat: 18.6, lng: 73.76, accuracyM: 12, recordedAt: new Date(NOW - 300_000).toISOString(), ageSeconds: 0 } });
    expect(effectiveLiveness(s, NOW)).toEqual({ liveness: 'STALE', ageSeconds: 300 });
  });

  it('never upgrades a server STALE to LIVE (clock skew)', () => {
    expect(effectiveLiveness(session({ liveness: 'STALE' }), NOW).liveness).toBe('STALE');
  });

  it('is WAITING without a position and ENDED for finished sessions', () => {
    expect(effectiveLiveness(session({ lastPosition: null, liveness: 'WAITING_FOR_FIRST_POSITION' }), NOW).liveness).toBe('WAITING_FOR_FIRST_POSITION');
    expect(effectiveLiveness(session({ status: 'ENDED', liveness: 'ENDED' }), NOW).liveness).toBe('ENDED');
  });

  it('renders stale data with its age, never as live', () => {
    const s = session({ lastPosition: { lat: 18.6, lng: 73.76, accuracyM: 12, recordedAt: new Date(NOW - 180_000).toISOString(), ageSeconds: 0 } });
    const { liveness, ageSeconds } = effectiveLiveness(s, NOW);
    render(<LivenessBadge liveness={liveness} ageSeconds={ageSeconds} />);
    expect(screen.getByText(/Stale · last updated 3 min ago/)).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('renders LIVE only for fresh data', () => {
    render(<LivenessBadge liveness="LIVE" ageSeconds={5} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });
});

describe('ETA display', () => {
  it('says "ETA unavailable" when the backend has no road ETA and labels the straight-line distance', () => {
    render(<EtaSummary session={session()} stale={false} />);
    expect(screen.getByText('ETA unavailable')).toBeInTheDocument();
    expect(screen.getByText('(straight-line estimate)')).toBeInTheDocument();
  });

  it('shows a road ETA only when the source is Google Routes', () => {
    render(<EtaSummary session={session({ eta: { remainingDistanceM: 2500, etaSeconds: 600, source: 'ROAD_GOOGLE_ROUTES', note: 'Road distance and traffic-aware ETA from Google Routes.' } })} stale={false} />);
    expect(screen.getByText('10 min')).toBeInTheDocument();
    expect(screen.getByText(/by road/)).toBeInTheDocument();
    expect(screen.queryByText('(straight-line estimate)')).not.toBeInTheDocument();
  });

  it('marks an ETA computed from stale data as the last estimate', () => {
    render(<EtaSummary session={session({ eta: { remainingDistanceM: 2500, etaSeconds: 600, source: 'ROAD_GOOGLE_ROUTES', note: '' } })} stale />);
    expect(screen.getByText(/Last estimated arrival/)).toBeInTheDocument();
  });

  it('handles a missing ETA object', () => {
    render(<EtaSummary session={session({ eta: null })} stale={false} />);
    expect(screen.getByText(/ETA unavailable/)).toBeInTheDocument();
  });
});
