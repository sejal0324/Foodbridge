import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ConfirmDialog, Field, Textarea, useToast } from '@/components/ui';
import type { DonationDetail } from '@/types';
import { useCancelDonation } from '../api';

export function CancelDonationDialog({ donation, onClose }: { donation: DonationDetail; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const cancel = useCancelDonation(donation.id);
  const toast = useToast();
  const navigate = useNavigate();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      tone="danger"
      title="Cancel this donation?"
      description={
        donation.reservedQuantity > 0
          ? 'Reservations that have not been picked up are released and the NGOs are notified. This cannot be undone.'
          : 'The listing is withdrawn and matched NGOs can no longer request it. This cannot be undone.'
      }
      confirmLabel="Cancel donation"
      cancelLabel="Keep donation"
      confirmDisabled={reason.trim().length < 3}
      loading={cancel.isPending}
      onConfirm={() =>
        cancel
          .mutateAsync(reason.trim())
          .then(() => {
            toast.success('Donation cancelled');
            onClose();
            navigate('/donor/donations');
          })
          .catch((e: unknown) => toast.error(e))
      }
    >
      <Field label="Reason" hint="At least 3 characters; shared with affected NGOs." required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />
      </Field>
    </ConfirmDialog>
  );
}
