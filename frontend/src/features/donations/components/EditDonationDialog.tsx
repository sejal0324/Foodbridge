import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Banner, Button, Checkbox, Dialog, Field, Input, Select, Textarea, useToast } from '@/components/ui';
import { ApiError } from '@/services/apiError';
import { STORAGE_TYPES, type DonationDetail } from '@/types';
import { applyServerErrors } from '@/utils/formErrors';
import { STORAGE_LABELS } from '@/utils/labels';
import { useDonation, useUpdateDonation } from '../api';
import { DONATION_CODE_MAP, donationEditSchema, editValuesFrom, toDonationUpdateInput, type DonationEditValues } from '../schemas';

const EDIT_FIELDS = ['foodName', 'quantity', 'storageType', 'storageNotes', 'pickupAvailableFrom', 'pickupDeadline', 'description', 'safetyConfirmed'] as const;

/**
 * Edits a DRAFT/AVAILABLE/PARTIALLY_RESERVED donation with optimistic
 * concurrency: the PATCH carries `version`; a 409 STALE_VERSION reloads the
 * latest data into the form so the donor can review and save again.
 */
export function EditDonationDialog({ donation, onClose }: { donation: DonationDetail; onClose: () => void }) {
  const update = useUpdateDonation(donation.id);
  const { refetch } = useDonation(donation.id);
  const toast = useToast();
  const [base, setBase] = useState(donation);
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const isDraft = base.status === 'DRAFT';
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DonationEditValues>({ resolver: zodResolver(donationEditSchema), defaultValues: editValuesFrom(donation) });

  const save = (publish: boolean) =>
    handleSubmit(async (values) => {
      setFormError(null);
      setStale(false);
      try {
        await update.mutateAsync(toDonationUpdateInput(base, values, publish));
        toast.success(publish ? 'Donation published' : 'Donation updated');
        onClose();
      } catch (err) {
        if (ApiError.from(err).code === 'STALE_VERSION') {
          const fresh = await refetch();
          if (fresh.data) {
            setBase(fresh.data);
            reset(editValuesFrom(fresh.data));
          }
          setStale(true);
          return;
        }
        setFormError(applyServerErrors(err, setError, { fields: EDIT_FIELDS, codeMap: DONATION_CODE_MAP }));
      }
    })();

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={isDraft ? 'Edit draft' : 'Edit donation'}
      description={base.reservedQuantity > 0 ? `${base.reservedQuantity} already reserved: the quantity cannot go below that.` : undefined}
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant={isDraft ? 'outline' : 'primary'} onClick={() => void save(false)} loading={isSubmitting && !isDraft}>
            Save changes
          </Button>
          {isDraft ? (
            <Button onClick={() => void save(true)} loading={isSubmitting}>
              Save and publish
            </Button>
          ) : null}
        </>
      }
    >
      <form noValidate onSubmit={(e) => e.preventDefault()} className="grid gap-4 sm:grid-cols-2">
        {stale ? (
          <Banner tone="warning" live className="sm:col-span-2" title="This donation changed while you were editing">
            Someone (or an NGO reservation) updated it. The latest values are loaded below; review them and save again.
          </Banner>
        ) : null}
        {formError ? (
          <Banner tone="danger" live className="sm:col-span-2">
            {formError}
          </Banner>
        ) : null}
        <Field label="Food name" error={errors.foodName?.message} required className="sm:col-span-2">
          <Input {...register('foodName')} />
        </Field>
        <Field label="Quantity" error={errors.quantity?.message} required>
          <Input type="number" inputMode="numeric" min={Math.max(1, base.reservedQuantity)} step={1} {...register('quantity', { valueAsNumber: true })} />
        </Field>
        <Field label="Storage" error={errors.storageType?.message} required>
          <Select {...register('storageType')} options={STORAGE_TYPES.map((s) => ({ value: s, label: STORAGE_LABELS[s] }))} />
        </Field>
        <Field label="Available from (IST)" error={errors.pickupAvailableFrom?.message} required>
          <Input type="datetime-local" {...register('pickupAvailableFrom')} />
        </Field>
        <Field label="Pickup deadline (IST)" error={errors.pickupDeadline?.message} required>
          <Input type="datetime-local" {...register('pickupDeadline')} />
        </Field>
        <Field label="Storage notes" error={errors.storageNotes?.message} className="sm:col-span-2">
          <Input {...register('storageNotes')} />
        </Field>
        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          <Textarea {...register('description')} />
        </Field>
        {isDraft || !base.safetyConfirmed ? (
          <Checkbox
            className="sm:col-span-2"
            {...register('safetyConfirmed')}
            error={errors.safetyConfirmed?.message}
            label="I confirm this food is safe and fit for people to eat"
            description="Required to publish. I am responsible for the food; FoodBridge does not certify food safety."
          />
        ) : null}
      </form>
    </Dialog>
  );
}
