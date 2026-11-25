import { Download, FileText, History, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Banner, Button, Card, CardBody, CardHeader, ConfirmDialog, DescriptionList, EmptyState, ErrorState, Field, SkeletonList, StatusBadge, Textarea, useToast } from '@/components/ui';
import { formatBytes, formatDateTime } from '@/utils/format';
import { DOCUMENT_TYPE_LABELS } from '@/utils/labels';
import { downloadVerificationDocument, useOrganisationDocuments, useReviewDocument } from '../api';
import { ORG_TYPE_LABEL } from '../labels';
import type { VerificationDecision } from '../schemas';
import type { AdminVerificationDocument, VerificationApplication } from '../types';
import { DecisionDialog } from './DecisionDialog';

const DECISIONS: { value: VerificationDecision; label: string; variant: 'primary' | 'outline' | 'danger' }[] = [
  { value: 'APPROVED', label: 'Approve', variant: 'primary' },
  { value: 'REJECTED', label: 'Reject', variant: 'outline' },
  { value: 'SUSPENDED', label: 'Suspend', variant: 'danger' },
];

/** One application: organisation details, its documents (download + review) and the decision buttons. */
export function ApplicationPanel({ application, onClose, onDecided }: { application: VerificationApplication; onClose: () => void; onDecided: () => void }) {
  const docs = useOrganisationDocuments(application.type, application.id);
  const [decision, setDecision] = useState<VerificationDecision | null>(null);
  const [review, setReview] = useState<{ doc: AdminVerificationDocument; status: 'ACCEPTED' | 'REJECTED' } | null>(null);
  const toast = useToast();
  const entity = application.type === 'DONOR' ? 'donor' : 'ngo';

  const download = (doc: AdminVerificationDocument) => {
    downloadVerificationDocument(doc).catch((e: unknown) => toast.error(e));
  };

  return (
    <Card>
      <CardHeader
        title={application.name}
        description={`${ORG_TYPE_LABEL[application.type]} application${application.city ? ` · ${application.city}` : ''}`}
        actions={
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close application">
            <X className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <CardBody className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={application.verificationStatus} />
          <Badge tone={application.type === 'DONOR' ? 'brand' : 'info'}>{ORG_TYPE_LABEL[application.type]}</Badge>
        </div>
        <DescriptionList
          columns={1}
          items={[
            { term: 'Owner', description: application.ownerName },
            { term: 'Owner email', description: <a className="text-brand-300 hover:underline" href={`mailto:${application.ownerEmail}`}>{application.ownerEmail}</a> },
            { term: 'City', description: application.city ?? 'Not given' },
            { term: 'Registered', description: formatDateTime(application.createdAt) },
            ...(application.verificationNotes ? [{ term: 'Last decision notes', description: application.verificationNotes }] : []),
          ]}
        />

        <section aria-labelledby={`docs-${application.id}`}>
          <h3 id={`docs-${application.id}`} className="mb-3 text-sm font-semibold text-white">
            Documents
          </h3>
          {docs.isPending ? (
            <SkeletonList rows={2} />
          ) : docs.isError ? (
            <ErrorState error={docs.error} compact onRetry={() => void docs.refetch()} />
          ) : docs.data.length === 0 ? (
            <EmptyState compact icon={<FileText className="size-6" aria-hidden="true" />} title="No documents uploaded" description="Ask the organisation to upload its licence or registration before approving." />
          ) : (
            <ul className="space-y-3">
              {docs.data.map((d) => (
                <li key={d.id} className="rounded-xl border border-white/10 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{DOCUMENT_TYPE_LABELS[d.documentType] ?? d.documentType}</p>
                      <p className="truncate text-xs text-slate-400" title={d.originalFilename}>
                        {d.originalFilename} · {formatBytes(d.sizeBytes)} · uploaded {formatDateTime(d.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={d.status} />
                  </div>
                  {d.reviewNotes ? <p className="mt-2 text-xs text-slate-300">Review notes: {d.reviewNotes}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" leftIcon={<Download className="size-4" aria-hidden="true" />} onClick={() => download(d)} aria-label={`Download ${d.originalFilename}`}>
                      Download
                    </Button>
                    {d.status !== 'ACCEPTED' ? (
                      <Button size="sm" variant="ghost" onClick={() => setReview({ doc: d, status: 'ACCEPTED' })}>
                        Accept
                      </Button>
                    ) : null}
                    {d.status !== 'REJECTED' ? (
                      <Button size="sm" variant="ghost" onClick={() => setReview({ doc: d, status: 'REJECTED' })}>
                        Reject
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Decision" className="space-y-3 border-t border-white/10 pt-4">
          {application.documentCount === 0 && application.verificationStatus === 'PENDING' ? (
            <Banner tone="warning">No documents have been uploaded. Approving without documents is possible but should be the exception.</Banner>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {DECISIONS.filter((d) => d.value !== application.verificationStatus).map((d) => (
              <Button key={d.value} variant={d.variant} onClick={() => setDecision(d.value)}>
                {d.label}
              </Button>
            ))}
          </div>
          <Link to={`/admin/audit?entityType=${entity}&entityId=${application.id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
            <History className="size-4" aria-hidden="true" /> Audit trail for this organisation
          </Link>
        </section>
      </CardBody>

      {decision ? <DecisionDialog target={application} decision={decision} onClose={() => setDecision(null)} onDone={onDecided} /> : null}
      {review ? <DocumentReviewDialog doc={review.doc} status={review.status} onClose={() => setReview(null)} /> : null}
    </Card>
  );
}

function DocumentReviewDialog({ doc, status, onClose }: { doc: AdminVerificationDocument; status: 'ACCEPTED' | 'REJECTED'; onClose: () => void }) {
  const [notes, setNotes] = useState('');
  const reviewDoc = useReviewDocument();
  const toast = useToast();
  const label = DOCUMENT_TYPE_LABELS[doc.documentType] ?? doc.documentType;
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      tone={status === 'REJECTED' ? 'danger' : 'primary'}
      title={`${status === 'ACCEPTED' ? 'Accept' : 'Reject'} ${label}?`}
      description={doc.originalFilename}
      confirmLabel={status === 'ACCEPTED' ? 'Accept document' : 'Reject document'}
      loading={reviewDoc.isPending}
      onConfirm={() =>
        reviewDoc
          .mutateAsync({ documentId: doc.id, status, notes: notes.trim() || undefined })
          .then(() => {
            toast.success(status === 'ACCEPTED' ? 'Document accepted' : 'Document rejected');
            onClose();
          })
          .catch((e: unknown) => toast.error(e))
      }
    >
      <Field label="Review notes" hint={status === 'REJECTED' ? 'Say what is wrong so the organisation can upload a better copy. Recorded in the audit log.' : 'Optional. Recorded in the audit log.'}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} data-autofocus />
      </Field>
    </ConfirmDialog>
  );
}
