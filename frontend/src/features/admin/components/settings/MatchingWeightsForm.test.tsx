import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { apiError, mockApi, ok, renderWithProviders } from '../../../../../tests/utils';
import type { PlatformSetting } from '../../types';
import { MatchingWeightsForm, NumberSettingForm } from './SettingForms';

const weights: PlatformSetting = {
  key: 'matching.weights',
  value: { distance: 20, food_requirement: 20, quantity_capacity: 15, food_preference: 10, urgency: 15, pickup_availability: 10, reliability: 5, beneficiary_demand: 5 },
  description: 'Weighted ranking criteria (must sum to 100)',
  updatedAt: '2026-11-03T11:53:01.407Z',
};

function saveButton() {
  return screen.getByRole('button', { name: 'Save' });
}

async function setValue(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  if (value) await user.type(input, value);
}

describe('MatchingWeightsForm', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('shows the live sum and only enables Save when the weights total exactly 100', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MatchingWeightsForm setting={weights} />);

    expect(screen.getByTestId('weights-sum')).toHaveTextContent('100 / 100');
    expect(saveButton()).toBeDisabled(); // nothing changed yet

    await setValue(user, 'Distance', '25');
    expect(screen.getByTestId('weights-sum')).toHaveTextContent('105 / 100');
    expect(screen.getByText(/Remove 5 to get back to 100/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await setValue(user, 'Food needed', '10');
    expect(screen.getByTestId('weights-sum')).toHaveTextContent('95 / 100');
    expect(screen.getByText(/Add 5 more to reach 100/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await setValue(user, 'Food needed', '15');
    expect(screen.getByTestId('weights-sum')).toHaveTextContent('100 / 100');
    expect(saveButton()).toBeEnabled();
  });

  it('flags an invalid weight and keeps Save disabled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MatchingWeightsForm setting={weights} />);
    await setValue(user, 'Reliability', '');
    expect(screen.getByText('Enter a weight')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('asks for confirmation, then saves the eight numeric weights', async () => {
    const user = userEvent.setup();
    const api = mockApi((req) => ok({ key: 'matching.weights', value: (req.body as { value: unknown }).value }));
    restore = api.restore;
    renderWithProviders(<MatchingWeightsForm setting={weights} />);

    await setValue(user, 'Distance', '30');
    await setValue(user, 'Food needed', '10');
    await user.click(saveButton());

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/recorded in the audit log/)).toBeInTheDocument();
    expect(api.calls).toHaveLength(0); // nothing is sent before confirming
    await user.click(within(dialog).getByRole('button', { name: 'Save setting' }));

    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(api.calls[0]?.method).toBe('PUT');
    expect(api.calls[0]?.url).toBe('/admin/settings/matching.weights');
    expect(api.calls[0]?.body).toEqual({
      value: { distance: 30, food_requirement: 10, quantity_capacity: 15, food_preference: 10, urgency: 15, pickup_availability: 10, reliability: 5, beneficiary_demand: 5 },
    });
    expect(await screen.findByText('Setting saved')).toBeInTheDocument();
  });

  it('shows server validation errors', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => apiError(422, 'VALIDATION_ERROR', 'The request is invalid.', [{ path: '', message: 'weights must sum to 100' }]));
    restore = api.restore;
    renderWithProviders(<MatchingWeightsForm setting={weights} />);
    await setValue(user, 'Distance', '30');
    await setValue(user, 'Food needed', '10');
    await user.click(saveButton());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save setting' }));
    expect(await screen.findByText('The server rejected this value')).toBeInTheDocument();
    expect(screen.getByText(/weights must sum to 100/)).toBeInTheDocument();
  });
});

describe('NumberSettingForm', () => {
  it('validates the range of tracking.stale_after_seconds before saving', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NumberSettingForm
        spec={{ key: 'tracking.stale_after_seconds', title: 'Location becomes stale after', help: '', suffix: 'seconds', min: 10, max: 3600, integer: true, group: 'Pickup & tracking' }}
        setting={{ key: 'tracking.stale_after_seconds', value: 60, description: null, updatedAt: '2026-11-03T11:53:01.407Z' }}
      />,
    );
    const input = screen.getByLabelText('Location becomes stale after (seconds)');
    await user.clear(input);
    await user.type(input, '5');
    expect(screen.getByText('At least 10')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    await user.clear(input);
    await user.type(input, '90');
    expect(saveButton()).toBeEnabled();
  });
});
