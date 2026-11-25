import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import AssistantPage from '@/features/assistant/pages/AssistantPage';
import { authValue, mockApi, ok, renderWithProviders } from '../../../tests/utils';
import { ngoOwner } from './testing';

const payload = { categoryCode: 'COOKED_MEALS', dietaryRequirement: 'VEG_ONLY', quantityRequired: 100, unit: 'MEALS', neededFrom: '2026-11-04T12:00:00+05:30', neededUntil: '2026-11-04T14:00:00+05:30', urgency: 'HIGH', beneficiariesCount: 100 };

describe('NGO assistant: create_assistance_request', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('drafts the request and creates it only after the NGO confirms', async () => {
    const user = userEvent.setup();
    const api = mockApi((req) => {
      if (req.url === '/ai/suggestions') return ok([{ text: 'I need 100 meals tomorrow', intent: 'create_assistance_request' }]);
      if (req.url === '/ai/conversations') return ok([]);
      if (req.url === '/ai/chat')
        return ok({
          conversationId: 'conv-1',
          mode: 'LLM',
          message: 'I drafted the request. Please confirm it.',
          cards: [],
          pendingAction: { id: 12, tool: 'create_assistance_request', summary: 'Create an assistance request for 100 meals (cooked meals, vegetarian only) needed 4 Nov, 12:00 pm–4 Nov, 2:00 pm.', payload, expiresInMinutes: 30 },
        });
      if (req.url === '/ai/conversations/conv-1/messages') return ok([]);
      if (req.url === '/ai/actions/12/confirm') return { status: 201, data: { data: { id: 'ar-new', status: 'OPEN' } } };
      return { status: 404, data: { error: { code: 'NOT_FOUND', message: `unexpected ${req.url}` } } };
    });
    restore = api.restore;
    renderWithProviders(<AssistantPage />, { route: '/ngo/assistant', auth: authValue({ user: ngoOwner }) });

    await user.click(await screen.findByRole('button', { name: 'I need 100 meals tomorrow' }));
    expect(await screen.findByText(/Create an assistance request for 100 meals/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.url === '/ai/chat')?.body).toMatchObject({ message: 'I need 100 meals tomorrow', intent: 'create_assistance_request' });
    expect(api.calls.some((c) => c.url.startsWith('/ai/actions'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['/ai/chat', '/ai/actions/12/confirm']));
    expect(await screen.findByText('confirmed')).toBeInTheDocument();
  });
});
