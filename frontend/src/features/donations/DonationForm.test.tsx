import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type * as MapModule from '@/components/map';
import { ApiError } from '@/services/apiError';
import type { FoodCategory } from '@/types';
import { toIstInputValue } from '@/utils/format';
import { renderWithProviders } from '../../../tests/utils';
import { DonationForm } from './components/DonationForm';

vi.mock('@/components/map', async (importOriginal) => ({
  ...(await importOriginal<typeof MapModule>()),
  LocationPicker: () => <div data-testid="location-picker" />,
  MapView: () => null,
}));

const categories: FoodCategory[] = [
  { id: '5adeec65-f4ca-4ce2-9d59-4a6398e6a033', code: 'COOKED_MEALS', name: 'Cooked meals', description: null, reviewFlagHoursAfterPreparation: 6, requiresRefrigeration: false },
  { id: '210a042e-dcd7-48fc-a18d-3fa286132c8a', code: 'DAIRY', name: 'Dairy products', description: null, reviewFlagHoursAfterPreparation: 12, requiresRefrigeration: true },
];

function setup(submit = vi.fn().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  renderWithProviders(<DonationForm categories={categories} profileLocation={{ lat: 18.6, lng: 73.76 }} profileAddress="Wakad, Pune" submit={submit} />);
  return { user, submit };
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Food name/), 'Veg biryani');
  await user.selectOptions(screen.getByLabelText(/Category/), 'Cooked meals');
  await user.type(screen.getByLabelText(/^Quantity/), '40');
}

describe('DonationForm', () => {
  it('requires food name, category and a whole-number quantity', async () => {
    const { user, submit } = setup();
    await user.click(screen.getByRole('button', { name: 'Publish donation' }));
    expect(await screen.findByText('Enter at least 2 characters')).toBeInTheDocument();
    expect(screen.getByText('Choose a category', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Enter a quantity')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Quantity/), '2.5');
    await user.click(screen.getByRole('button', { name: 'Publish donation' }));
    expect(await screen.findByText('Use a whole number')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('offers only MEALS, PACKETS and BOXES as units', () => {
    setup();
    const options = Array.from((screen.getByLabelText(/^Unit/) as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['MEALS', 'PACKETS', 'BOXES']);
  });

  it('requires the safety confirmation to publish but not to save a draft', async () => {
    const { user, submit } = setup();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Publish donation' }));
    expect(await screen.findByText(/Confirm the food is safe to donate before publishing/)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const input = submit.mock.calls[0]?.[0];
    expect(input).toMatchObject({ foodName: 'Veg biryani', categoryId: categories[0]?.id, quantity: 40, unit: 'MEALS', safetyConfirmed: false, publish: false });
    expect(input.preparedAt).toMatch(/\+05:30$/);
    expect(input).not.toHaveProperty('location'); // falls back to the profile location
  });

  it('publishes with the confirmation and IST timestamps', async () => {
    const { user, submit } = setup();
    await fillRequired(user);
    await user.click(screen.getByLabelText(/I confirm this food is safe/));
    await user.click(screen.getByRole('button', { name: 'Publish donation' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]?.[0]).toMatchObject({ safetyConfirmed: true, publish: true, pickupDeadline: expect.stringMatching(/T\d{2}:\d{2}:00\+05:30$/) });
  });

  it('rejects a preparation time in the future', async () => {
    const { user, submit } = setup();
    await fillRequired(user);
    fireEvent.change(screen.getByLabelText(/Prepared at/), { target: { value: toIstInputValue(new Date(Date.now() + 2 * 3_600_000)) } });
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText(/Preparation time cannot be in the future/)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('maps server 422 details and business codes onto the fields', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(422, 'VALIDATION_ERROR', 'The request is invalid.', [{ path: 'foodName', message: 'contains unsupported characters' }]))
      .mockRejectedValueOnce(new ApiError(422, 'DEADLINE_TOO_SOON', 'The pickup deadline must be at least 30 minutes from now.'));
    const { user } = setup(submit);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText('Contains unsupported characters')).toBeInTheDocument();
    expect(screen.getByLabelText(/Food name/)).toHaveAttribute('aria-invalid', 'true');

    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText('The pickup deadline must be at least 30 minutes from now.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Pickup deadline/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('maps LOCATION_OUTSIDE_INDIA onto the location field', async () => {
    const submit = vi.fn().mockRejectedValue(new ApiError(422, 'LOCATION_OUTSIDE_INDIA', 'The location must be in India.'));
    const { user } = setup(submit);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    // Placed on the location field, not as a form-level banner.
    expect(await screen.findByRole('alert')).toHaveTextContent('The location must be in India.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows unplaceable server errors at form level', async () => {
    const submit = vi.fn().mockRejectedValue(new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable. Please try again shortly.'));
    const { user } = setup(submit);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is unavailable. Please try again shortly.');
  });
});
