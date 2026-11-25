import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../../tests/utils';
import type { AuditLogEntry } from '../types';
import { AuditLogList } from './AuditLogList';

const entry: AuditLogEntry = {
  id: 301,
  occurredAt: '2026-11-03T12:24:00.000Z',
  actorType: 'USER',
  actorUserId: '3d89c1ba-cb1f-47e8-90f5-3538115a4629',
  actorEmail: 'admin@foodbridge.local',
  actorRole: 'ADMIN',
  action: 'settings.updated',
  entityType: 'platform_setting',
  entityId: null,
  changes: { key: 'tracking.stale_after_seconds', before: 60, after: 90 },
  metadata: { source: 'web' },
  requestId: 'f0b32959-389a-4821-8780-bac765da9d7e',
  ip: '::ffff:127.0.0.1',
};

describe('AuditLogList', () => {
  it('expands a row to show the request id, IP and pretty-printed changes and metadata', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditLogList entries={[entry, { ...entry, id: 300, action: 'auth.login', changes: null, metadata: null }]} />);

    const toggle = screen.getByRole('button', { name: /settings\.updated/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Changes')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Changes').textContent).toBe(JSON.stringify(entry.changes, null, 2));
    expect(screen.getByLabelText('Metadata').textContent).toBe('{\n  "source": "web"\n}');
    expect(screen.getByText('f0b32959-389a-4821-8780-bac765da9d7e')).toBeInTheDocument();
    expect(screen.getByText('::ffff:127.0.0.1')).toBeInTheDocument();
    // Only the opened row is expanded.
    expect(screen.getByRole('button', { name: /auth\.login/ })).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Changes')).not.toBeInTheDocument();
  });
});
