import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DistanceLabel } from './DistanceLabel';
import { STATUS_STYLES, statusStyle } from './status';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it.each([
    ['AVAILABLE', 'Available', 'success'],
    ['PARTIALLY_RESERVED', 'Partially reserved', 'info'],
    ['PICKUP_ASSIGNED', 'Pickup assigned', 'violet'],
    ['COMPLETED', 'Completed', 'brand'],
    ['DISPUTED', 'Disputed', 'danger'],
    ['PENDING', 'Pending', 'warning'],
    ['PENDING_NGO', 'Awaiting NGO', 'warning'],
    ['FAILED', 'Failed', 'danger'],
    ['EXPIRED', 'Expired', 'neutral'],
  ])('%s → "%s" (%s)', (status, label, tone) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(statusStyle(status).tone).toBe(tone);
  });

  it('covers every backend lifecycle status', () => {
    const backend = [
      // donations
      'DRAFT', 'AVAILABLE', 'PARTIALLY_RESERVED', 'RESERVED', 'PICKUP_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'DISPUTED',
      // requests, assistance requests, offers
      'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'PROPOSED', 'ACCEPTED',
      // pickups and handovers
      'ASSIGNED', 'EN_ROUTE', 'VERIFIED', 'HANDED_OVER', 'DELIVERED', 'FAILED', 'PENDING_DONOR', 'PENDING_NGO', 'CONFIRMED',
      // verification, documents, accounts, disputes, tracking
      'SUSPENDED', 'ACTIVE', 'INACTIVE', 'REVOKED', 'INVITED', 'UNDER_REVIEW', 'RESOLVED', 'ENDED', 'LIVE', 'STALE',
    ];
    for (const s of backend) expect(STATUS_STYLES[s], s).toBeDefined();
  });

  it('humanises unknown statuses instead of failing', () => {
    render(<StatusBadge status="SOMETHING_NEW" />);
    expect(screen.getByText('Something new')).toBeInTheDocument();
  });
});

describe('DistanceLabel', () => {
  it('labels straight-line estimates', () => {
    render(<DistanceLabel km={3.7} source="STRAIGHT_LINE_ESTIMATE" />);
    expect(screen.getByText('3.7 km')).toBeInTheDocument();
    expect(screen.getByText('straight-line estimate')).toBeInTheDocument();
    expect(screen.queryByText('road distance')).not.toBeInTheDocument();
  });

  it('labels road distances from Google Routes', () => {
    render(<DistanceLabel km={5.2} source="ROAD_GOOGLE_ROUTES" />);
    expect(screen.getByText('road distance')).toBeInTheDocument();
    expect(screen.queryByText('straight-line estimate')).not.toBeInTheDocument();
  });

  it('never presents an unknown source as road distance', () => {
    render(<DistanceLabel km={1.2} source={null} />);
    expect(screen.getByText('straight-line estimate')).toBeInTheDocument();
  });

  it('says when the distance is unknown', () => {
    render(<DistanceLabel km={null} source="STRAIGHT_LINE_ESTIMATE" />);
    expect(screen.getByText('Distance unknown')).toBeInTheDocument();
  });
});
