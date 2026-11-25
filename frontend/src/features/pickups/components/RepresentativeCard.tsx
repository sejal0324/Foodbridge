import { IdCard, Phone } from 'lucide-react';
import { Avatar, Skeleton, StatusBadge } from '@/components/ui';
import type { PickupRepresentative } from '@/types';
import { ID_DOCUMENT_LABELS } from '@/utils/labels';
import { useRepresentativePhoto } from '../api';

/** Who should be at the counter: name, photo, ID type and last 4 characters. */
export function RepresentativeCard({ rep, ngoName }: { rep: PickupRepresentative; ngoName: string }) {
  const photo = useRepresentativePhoto(rep.id, rep.hasPhoto);
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:flex-row sm:items-center">
      {rep.hasPhoto && photo.isLoading ? (
        <Skeleton className="size-24 rounded-full" />
      ) : (
        <Avatar name={rep.name} src={photo.url} size="xl" className="self-center sm:self-auto" />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-lg font-semibold text-white">{rep.name}</p>
          <p className="text-sm text-slate-400">Representative of {ngoName}</p>
        </div>
        <dl className="grid gap-1.5 text-sm">
          <div className="flex items-center gap-2">
            <IdCard className="size-4 text-slate-500" aria-hidden="true" />
            <dt className="sr-only">Photo ID</dt>
            <dd className="text-slate-200">
              {ID_DOCUMENT_LABELS[rep.idDocumentType] ?? rep.idDocumentType} ending in <span className="font-mono text-base font-semibold text-white">{rep.idDocumentLast4}</span>
            </dd>
          </div>
          {rep.phone ? (
            <div className="flex items-center gap-2">
              <Phone className="size-4 text-slate-500" aria-hidden="true" />
              <dt className="sr-only">Phone</dt>
              <dd className="font-mono text-slate-300">{rep.phone}</dd>
            </div>
          ) : null}
        </dl>
        {!rep.hasPhoto ? <p className="text-xs text-amber-300">No photo on file: rely on the ID document check.</p> : null}
        {rep.status !== 'ACTIVE' ? <StatusBadge status={rep.status} /> : null}
      </div>
    </div>
  );
}
