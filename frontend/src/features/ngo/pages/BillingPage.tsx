import { CalendarDays, Download, FileText, IndianRupee, Info, Landmark, Receipt, Wallet } from 'lucide-react';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { Badge, Banner, Button, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, PageHeader, Pagination, StatCard, StatusBadge, useToast } from '@/components/ui';
import { isOrganisationApproved, useCurrentUser } from '@/features/auth/auth-context';
import { formatDate, formatDateTime, formatINR, formatNumber, formatQuantity, unitLabel } from '@/utils/format';
import { UNIT_LABELS } from '@/utils/labels';
import { downloadInvoicePdf, useBillingHistory, useBillingSummary, useInvoices, usePayments } from '../api';
import { PayInvoiceDialog } from '../components/PayInvoiceDialog';
import type { Invoice } from '../types';

const LINE_STATUS: Record<string, string> = { PENDING: 'Not yet invoiced', INVOICED: 'Invoiced', PAID: 'Paid', WAIVED: 'Waived', VOID: 'Void' };

export default function BillingPage() {
  const user = useCurrentUser();
  const summary = useBillingSummary();
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Billing"
        description="A transparent service fee per meal, packet or box your NGO actually received, using the quantity both sides confirmed at handover. Donors never pay."
      />
      <div className="space-y-6">
        {summary.isError ? <ErrorState error={summary.error} onRetry={() => void summary.refetch()} title="The billing summary could not be loaded" /> : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Not yet invoiced" value={formatINR(s?.uninvoicedAmount)} hint={s ? `${formatNumber(s.billedCollections)} collections · ${formatNumber(s.billedQuantity)} units billed in total` : undefined} icon={<Receipt className="size-5" aria-hidden="true" />} loading={summary.isPending} />
          <StatCard label="Invoiced, unpaid" value={formatINR(s?.outstandingInvoicedAmount)} icon={<FileText className="size-5" aria-hidden="true" />} loading={summary.isPending} />
          <StatCard label="Paid" value={formatINR(s?.paidAmount)} icon={<Wallet className="size-5" aria-hidden="true" />} loading={summary.isPending} />
          <StatCard label="This month" value={formatINR(s?.thisMonthAmount)} icon={<CalendarDays className="size-5" aria-hidden="true" />} loading={summary.isPending} />
        </div>

        {s ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="How fees are calculated" as="h3" icon={<IndianRupee className="size-4" aria-hidden="true" />} />
              <CardBody className="space-y-4 text-sm">
                <ul className="space-y-1">
                  {s.feeRules.map((r) => (
                    <li key={r.unit} className="flex justify-between gap-3">
                      <span className="text-slate-300">{UNIT_LABELS[r.unit] ?? r.unit}</span>
                      <span className="font-medium text-white tabular-nums">
                        {formatINR(r.amountPerUnit)} per {unitLabel(r.unit, 1)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="rounded-lg border border-white/10 p-3">
                  <p className="font-medium text-white">
                    Tax: {s.tax.name ?? 'Tax'} {s.tax.ratePercent}% {s.tax.enabled ? <Badge tone="info">applied</Badge> : <Badge tone="neutral">not applied</Badge>}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">The tax setting is configurable by FoodBridge. Whether GST applies, and how it must be invoiced, requires validation by a qualified professional before production use.</p>
                </div>
                <p className="text-xs text-slate-400">Example: 40 meals handed over and confirmed by both sides → {formatINR((s.feeRules.find((r) => r.unit === 'MEALS')?.amountPerUnit ?? 5) * 40)} before any tax.</p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Good to know" as="h3" icon={<Info className="size-4" aria-hidden="true" />} />
              <CardBody className="space-y-3">
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">
                  {s.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                {s.onlinePaymentsAvailable ? (
                  <p className="text-xs text-slate-400">Invoices can be paid online with Razorpay. A payment shows as paid only after Razorpay confirms it.</p>
                ) : (
                  <Banner tone="info" icon={<Landmark className="size-5" aria-hidden="true" />}>
                    Online payment is not configured on this FoodBridge instance. Invoices stay payable: contact the administrator to pay by bank transfer.
                  </Banner>
                )}
              </CardBody>
            </Card>
          </div>
        ) : null}

        <InvoicesCard canPay={isOrganisationApproved(user)} />
        <PaymentsCard />
        <HistoryCard />
      </div>
    </>
  );
}

function InvoicesCard({ canPay }: { canPay: boolean }) {
  const query = useInvoices();
  const toast = useToast();
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Invoices" as="h3" description="FoodBridge groups confirmed fee lines into periodic invoices." icon={<FileText className="size-4" aria-hidden="true" />} />
      <CardBody>
        <QueryState query={query} empty={<EmptyState compact title="No invoices yet" description="Fee lines appear below as soon as a collection is confirmed; they are invoiced periodically." />}>
          {(rows) => (
            <DataTable
              caption="Invoices"
              rows={rows}
              rowKey={(i) => i.id}
              columns={[
                { key: 'number', header: 'Invoice', cell: (i) => <span className="font-mono text-white">{i.invoiceNumber}</span> },
                { key: 'period', header: 'Period', cell: (i) => `${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}` },
                {
                  key: 'total',
                  header: 'Total',
                  align: 'right',
                  cell: (i) => (
                    <span>
                      {formatINR(i.total)}
                      {i.taxTotal > 0 ? <span className="block text-xs text-slate-400">incl. {formatINR(i.taxTotal)} tax</span> : null}
                    </span>
                  ),
                },
                { key: 'due', header: 'Due', align: 'right', cell: (i) => formatINR(Math.max(0, Math.round((i.total - i.amountPaid) * 100) / 100)) },
                { key: 'dueAt', header: 'Due date', cell: (i) => (i.dueAt ? formatDate(i.dueAt) : '—') },
                { key: 'status', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
                {
                  key: 'actions',
                  header: <span className="sr-only">Actions</span>,
                  align: 'right',
                  cell: (i) => (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={downloading === i.id}
                        leftIcon={<Download className="size-4" aria-hidden="true" />}
                        onClick={() => {
                          setDownloading(i.id);
                          downloadInvoicePdf(i)
                            .catch((e: unknown) => toast.error(e))
                            .finally(() => setDownloading(null));
                        }}
                      >
                        PDF
                      </Button>
                      {canPay && i.status === 'ISSUED' && i.total - i.amountPaid > 0 ? (
                        <Button size="sm" onClick={() => setPaying(i)}>
                          Pay
                        </Button>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </QueryState>
      </CardBody>
      {paying ? <PayInvoiceDialog invoice={paying} onClose={() => setPaying(null)} /> : null}
    </Card>
  );
}

function PaymentsCard() {
  const query = usePayments();
  return (
    <Card>
      <CardHeader title="Payments" as="h3" icon={<Wallet className="size-4" aria-hidden="true" />} />
      <CardBody>
        <QueryState query={query} empty={<EmptyState compact title="No payments yet" />}>
          {(rows) => (
            <DataTable
              caption="Payments"
              rows={rows}
              rowKey={(p) => p.id}
              columns={[
                { key: 'when', header: 'Date', cell: (p) => formatDateTime(p.createdAt) },
                { key: 'invoice', header: 'Invoice', cell: (p) => <span className="font-mono">{p.invoiceNumber}</span> },
                { key: 'provider', header: 'Method', cell: (p) => (p.provider === 'MANUAL' ? 'Recorded by FoodBridge (bank transfer)' : 'Razorpay (online)') },
                { key: 'amount', header: 'Amount', align: 'right', cell: (p) => formatINR(p.amount) },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (p) => (
                    <div>
                      <StatusBadge status={p.status} label={p.status === 'PENDING' ? 'Awaiting confirmation' : undefined} />
                      {p.failureReason ? <p className="mt-0.5 text-xs text-red-300">{p.failureReason}</p> : null}
                      {p.referenceNote ? <p className="mt-0.5 text-xs text-slate-400">{p.referenceNote}</p> : null}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

function HistoryCard() {
  const [page, setPage] = useState(1);
  const query = useBillingHistory(page);
  return (
    <Card>
      <CardHeader title="Fee history" as="h3" description="One line per collection confirmed by both sides." icon={<Receipt className="size-4" aria-hidden="true" />} />
      <CardBody>
        <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<EmptyState compact title="No fees yet" description="Fees are recorded only when both sides confirm a handover." />}>
          {(data) => (
            <>
              <DataTable
                caption="Fee history"
                rows={data.items}
                rowKey={(l) => l.id}
                columns={[
                  { key: 'when', header: 'Confirmed', cell: (l) => formatDateTime(l.createdAt) },
                  {
                    key: 'food',
                    header: 'Collection',
                    cell: (l) => (
                      <div>
                        <p className="text-white">{l.foodName}</p>
                        <p className="text-xs text-slate-400">{l.donorName}</p>
                      </div>
                    ),
                  },
                  { key: 'qty', header: 'Quantity', cell: (l) => `${formatQuantity(l.billableQuantity, l.unit)} × ${formatINR(l.unitAmount)}` },
                  { key: 'base', header: 'Base', align: 'right', cell: (l) => formatINR(l.baseAmount) },
                  { key: 'tax', header: 'Tax', align: 'right', cell: (l) => (l.tax.amount > 0 ? `${formatINR(l.tax.amount)} (${l.tax.name ?? 'tax'} ${l.tax.ratePercent}%)` : '—') },
                  { key: 'total', header: 'Total', align: 'right', cell: (l) => <span className="font-medium text-white">{formatINR(l.totalAmount)}</span> },
                  { key: 'status', header: 'Status', cell: (l) => <StatusBadge status={l.status} label={LINE_STATUS[l.status]} /> },
                ]}
              />
              <Pagination className="mt-4" page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={setPage} />
            </>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}
