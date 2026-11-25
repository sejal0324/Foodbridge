import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi, renderWithProviders } from '../../../../tests/utils';
import { decisionSchema } from '../schemas';
import { DecisionDialog } from './DecisionDialog';

const target = { type: 'DONOR' as const, id: '160c93b9-0c88-4496-b79b-7d594a9ec115', name: 'Throwaway Kitchen' };

describe('verification decisions', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('schema: notes are required to reject but optional to approve or suspend', () => {
    expect(decisionSchema.safeParse({ status: 'REJECTED', notes: '   ' }).success).toBe(false);
    expect(decisionSchema.safeParse({ status: 'REJECTED', notes: 'Licence unreadable' }).success).toBe(true);
    expect(decisionSchema.safeParse({ status: 'APPROVED', notes: '' }).success).toBe(true);
    expect(decisionSchema.safeParse({ status: 'SUSPENDED', notes: '' }).success).toBe(true);
  });

  it('does not reject without notes, then sends the reason', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => ({ status: 204 }));
    restore = api.restore;
    const onDone = vi.fn();
    renderWithProviders(<DecisionDialog target={target} decision="REJECTED" onClose={vi.fn()} onDone={onDone} />);

    await user.click(screen.getByRole('button', { name: 'Reject application' }));
    expect(await screen.findByText(/Explain why the application is rejected/)).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);

    await user.type(screen.getByLabelText(/Reason for rejection/), 'Licence document is unreadable');
    await user.click(screen.getByRole('button', { name: 'Reject application' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`PATCH /admin/organizations/donor/${target.id}/verification`]);
    expect(api.calls[0]?.body).toEqual({ status: 'REJECTED', notes: 'Licence document is unreadable' });
  });

  it('approves without notes', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => ({ status: 204 }));
    restore = api.restore;
    renderWithProviders(<DecisionDialog target={{ ...target, type: 'NGO' }} decision="APPROVED" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Approve organisation' }));
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(api.calls[0]?.url).toBe(`/admin/organizations/ngo/${target.id}/verification`);
    expect(api.calls[0]?.body).toEqual({ status: 'APPROVED' });
  });

  it('explains that suspending signs the owner out, and maps REASON_REQUIRED onto the notes field', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => apiError(400, 'REASON_REQUIRED', 'A reason is required when rejecting an application.'));
    restore = api.restore;
    renderWithProviders(<DecisionDialog target={target} decision="SUSPENDED" onClose={vi.fn()} />);
    expect(screen.getByText('The owner is signed out immediately')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suspend organisation' }));
    expect(await screen.findByText('A reason is required when rejecting an application.')).toBeInTheDocument();
  });
});
