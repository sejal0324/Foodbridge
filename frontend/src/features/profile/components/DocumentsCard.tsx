import { Download, FileText, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { QueryState } from '@/components/feedback';
import { Banner, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Select, StatusBadge, useToast } from '@/components/ui';
import { DOCUMENT_TYPES, type DocumentType } from '@/types';
import { formatBytes, formatDateTime } from '@/utils/format';
import { DOCUMENT_TYPE_LABELS } from '@/utils/labels';
import { downloadVerificationDocument, useUploadDocument, useVerificationDocuments } from '../api';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png'];

/** Verification documents: upload (PDF/JPEG/PNG ≤ 10 MB), list with review status, download. */
export function DocumentsCard({ organisationType }: { organisationType: 'DONOR' | 'NGO' }) {
  const docs = useVerificationDocuments();
  const upload = useUploadDocument();
  const toast = useToast();
  const types = DOCUMENT_TYPES.filter((t) => (organisationType === 'DONOR' ? !['NGO_REGISTRATION', 'TAX_EXEMPTION'].includes(t) : t !== 'FSSAI_LICENCE' && t !== 'BUSINESS_LICENCE'));
  const [type, setType] = useState<DocumentType>(types[0] ?? 'OTHER');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Card>
      <CardHeader title="Verification documents" description="FoodBridge reviews these before approving your organisation." icon={<FileText className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return;
            upload.mutate(
              { documentType: type, file },
              {
                onSuccess: () => {
                  toast.success('Document uploaded', 'FoodBridge will review it.');
                  setFile(null);
                  if (inputRef.current) inputRef.current.value = '';
                },
                onError: (err) => toast.error(err),
              },
            );
          }}
        >
          <Field label="Document type">
            <Select value={type} onChange={(e) => setType(e.target.value as DocumentType)} options={types.map((t) => ({ value: t, label: DOCUMENT_TYPE_LABELS[t] ?? t }))} />
          </Field>
          <Field label="File" error={fileError ?? undefined} hint="PDF, JPEG or PNG, up to 10 MB">
            <Input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              className="py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-sm file:text-white"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFileError(null);
                if (f && f.size > MAX_BYTES) {
                  setFileError('The file is larger than 10 MB.');
                  setFile(null);
                  return;
                }
                if (f && f.type && !ACCEPTED.includes(f.type)) {
                  setFileError('Only PDF, JPEG and PNG files are accepted.');
                  setFile(null);
                  return;
                }
                setFile(f);
              }}
            />
          </Field>
          <Button type="submit" disabled={!file} loading={upload.isPending} leftIcon={<Upload className="size-4" aria-hidden="true" />}>
            Upload
          </Button>
        </form>
        <QueryState query={docs} empty={<EmptyState compact title="No documents uploaded" description="Upload your licence or registration to speed up verification." />}>
          {(list) => (
            <ul className="divide-y divide-white/5">
              {list.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-white">{DOCUMENT_TYPE_LABELS[d.documentType] ?? d.documentType}</p>
                      <StatusBadge status={d.status} />
                    </div>
                    <p className="truncate text-xs text-slate-400">
                      {d.originalFilename} · {formatBytes(d.sizeBytes)} · uploaded {formatDateTime(d.createdAt)}
                    </p>
                    {d.reviewNotes ? <p className="mt-1 text-xs text-slate-300">Reviewer: {d.reviewNotes}</p> : null}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={downloading === d.id}
                    leftIcon={<Download className="size-4" aria-hidden="true" />}
                    onClick={async () => {
                      setDownloading(d.id);
                      try {
                        await downloadVerificationDocument(d);
                      } catch (err) {
                        toast.error(err);
                      } finally {
                        setDownloading(null);
                      }
                    }}
                  >
                    Download
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
        {docs.data && docs.data.some((d) => d.status === 'REJECTED') ? <Banner tone="warning">A document was rejected. Read the reviewer’s note and upload a corrected version.</Banner> : null}
      </CardBody>
    </Card>
  );
}
