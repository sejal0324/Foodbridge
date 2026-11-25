import { Camera, IdCard, Mail, Phone, UserPlus, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { QueryState } from '@/components/feedback';
import { Avatar, Badge, Button, Card, CardBody, ConfirmDialog, EmptyState, PageHeader, Skeleton, StatusBadge, useToast } from '@/components/ui';
import { useCurrentUser } from '@/features/auth/auth-context';
import { useRepresentativePhoto } from '@/features/pickups/api';
import { formatRelative } from '@/utils/format';
import { ID_DOCUMENT_LABELS } from '@/utils/labels';
import { useRepresentatives, useSetRepresentativeStatus, useUploadRepresentativePhoto } from '../api';
import { AddSelfDialog, InviteDialog } from '../components/RepresentativeDialogs';
import type { Representative } from '../types';

type StatusChange = { rep: Representative; status: 'ACTIVE' | 'INACTIVE' | 'REVOKED' };
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const CHANGE_COPY: Record<StatusChange['status'], { title: string; body: string; confirm: string; tone: 'primary' | 'danger' }> = {
  ACTIVE: { title: 'Activate this representative?', body: 'They can be assigned to collections and generate pickup passes again.', confirm: 'Activate', tone: 'primary' },
  INACTIVE: {
    title: 'Deactivate this representative?',
    body: 'Their outstanding QR passes are revoked immediately and donors will refuse them (“representative is no longer authorised”). Their other sessions are signed out. You can reactivate them later.',
    confirm: 'Deactivate',
    tone: 'danger',
  },
  REVOKED: {
    title: 'Revoke this representative permanently?',
    body: 'Their passes are revoked immediately and they can never collect for your NGO again. This cannot be undone; invite them again if needed.',
    confirm: 'Revoke',
    tone: 'danger',
  },
};

export default function RepresentativesPage() {
  const user = useCurrentUser();
  const query = useRepresentatives();
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [change, setChange] = useState<StatusChange | null>(null);

  return (
    <>
      <PageHeader
        title="Representatives"
        description="People authorised to collect food for your NGO. Each has their own login; donors verify them with a QR pass and photo ID."
        actions={
          <>
            {!user.representative ? (
              <Button variant="outline" onClick={() => setAdding(true)}>
                Add myself
              </Button>
            ) : null}
            <Button leftIcon={<UserPlus className="size-4" aria-hidden="true" />} onClick={() => setInviting(true)}>
              Invite someone
            </Button>
          </>
        }
      />
      <QueryState
        query={query}
        empty={
          <EmptyState
            icon={<Users className="size-6" aria-hidden="true" />}
            title="No representatives yet"
            description="Add yourself or invite the people who will collect food. Only the last 4 characters of their photo ID are recorded."
            action={
              <Button size="sm" onClick={() => setInviting(true)}>
                Invite someone
              </Button>
            }
          />
        }
      >
        {(reps) => (
          <ul className="grid gap-4 lg:grid-cols-2">
            {reps.map((r) => (
              <RepresentativeItem key={r.id} rep={r} isYou={r.userId === user.id} onChange={(status) => setChange({ rep: r, status })} />
            ))}
          </ul>
        )}
      </QueryState>
      <p className="mt-4 text-xs text-slate-500">Only the last 4 characters of each person’s photo ID are ever entered or stored. Photos are private and shown only to your NGO and to the donor during an active pickup.</p>

      {adding ? <AddSelfDialog onClose={() => setAdding(false)} /> : null}
      {inviting ? <InviteDialog onClose={() => setInviting(false)} /> : null}
      {change ? <StatusDialog change={change} onClose={() => setChange(null)} /> : null}
    </>
  );
}

function RepresentativeItem({ rep, isYou, onChange }: { rep: Representative; isYou: boolean; onChange: (s: StatusChange['status']) => void }) {
  const photo = useRepresentativePhoto(rep.id, rep.hasPhoto);
  const upload = useUploadRepresentativePhoto();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const revoked = rep.status === 'REVOKED';

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast.show({ title: 'Use a JPEG or PNG photo', tone: 'warning' });
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.show({ title: 'The photo is larger than 10 MB', tone: 'warning' });
      return;
    }
    upload.mutate({ id: rep.id, file }, { onSuccess: () => toast.success('Photo updated', 'Donors see it when they verify this representative.'), onError: (e) => toast.error(e) });
  };

  return (
    <li>
      <Card className={revoked ? 'opacity-70' : undefined}>
        <CardBody className="flex flex-col gap-4 sm:flex-row">
          <div className="flex shrink-0 flex-col items-center gap-2">
            {rep.hasPhoto && photo.isLoading ? <Skeleton className="size-20 rounded-full" /> : <Avatar name={rep.fullName} src={photo.url} size="xl" />}
            {!revoked ? (
              <>
                <input ref={input} type="file" accept="image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = '';
                }} />
                <Button size="sm" variant="ghost" loading={upload.isPending} leftIcon={<Camera className="size-4" aria-hidden="true" />} onClick={() => input.current?.click()} aria-label={`${rep.hasPhoto ? 'Replace' : 'Upload'} photo of ${rep.fullName}`}>
                  {rep.hasPhoto ? 'Replace photo' : 'Add photo'}
                </Button>
              </>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold text-white">{rep.fullName}</p>
              {isYou ? <Badge tone="brand">you</Badge> : null}
              <StatusBadge status={rep.status} />
              {rep.status === 'INVITED' || rep.accountStatus === 'INVITED' ? <Badge tone="info">invitation not accepted yet</Badge> : null}
            </div>
            <dl className="grid gap-1 text-sm text-slate-300">
              <div className="flex items-center gap-2">
                <Mail className="size-4 text-slate-500" aria-hidden="true" />
                <dt className="sr-only">Email</dt>
                <dd className="truncate">{rep.email}</dd>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="size-4 text-slate-500" aria-hidden="true" />
                <dt className="sr-only">Phone</dt>
                <dd className="font-mono">{rep.phone ?? <span className="font-sans text-amber-300">No phone on file</span>}</dd>
              </div>
              <div className="flex items-center gap-2">
                <IdCard className="size-4 text-slate-500" aria-hidden="true" />
                <dt className="sr-only">Photo ID</dt>
                <dd>
                  {ID_DOCUMENT_LABELS[rep.idDocumentType] ?? rep.idDocumentType} ending in <span className="font-mono font-semibold text-white">{rep.idDocumentLast4}</span>
                </dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500">Added {formatRelative(rep.createdAt)}</p>
            {!revoked ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {rep.status === 'INACTIVE' ? (
                  <Button size="sm" variant="outline" onClick={() => onChange('ACTIVE')}>
                    Activate
                  </Button>
                ) : null}
                {rep.status === 'ACTIVE' ? (
                  <Button size="sm" variant="outline" onClick={() => onChange('INACTIVE')}>
                    Deactivate
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => onChange('REVOKED')}>
                  {rep.status === 'INVITED' ? 'Revoke invitation' : 'Revoke'}
                </Button>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </li>
  );
}

function StatusDialog({ change, onClose }: { change: StatusChange; onClose: () => void }) {
  const set = useSetRepresentativeStatus();
  const toast = useToast();
  const copy = CHANGE_COPY[change.status];
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={copy.title}
      description={`${change.rep.fullName}. ${copy.body}`}
      confirmLabel={copy.confirm}
      tone={copy.tone}
      loading={set.isPending}
      onConfirm={() =>
        set
          .mutateAsync({ id: change.rep.id, status: change.status })
          .then(() => {
            toast.success(change.status === 'ACTIVE' ? 'Representative activated' : change.status === 'INACTIVE' ? 'Representative deactivated' : 'Representative revoked');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    />
  );
}
