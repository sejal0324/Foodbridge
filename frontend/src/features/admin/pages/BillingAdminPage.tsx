import { zodResolver } from '@hookform/resolvers/zod';
import { Download, FileText, IndianRupee, Receipt } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Badge, Banner, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, SkeletonList, StatCard, StatusBadge, TabPanel, Tabs, useToast } from '@/components/ui';
import type { Unit } from '@/types';
import { formatDate, formatDateTime, formatINR, formatQuantity, todayIst, unitLabel } from '@/utils/format';
import { applyServerErrors } from '@/utils/formErrors';
import { UNIT_LABELS } from '@/utils/labels';
import { downloadInvoicePdf, useAdminAnalytics, useAdminFeeLines, useAdminInvoices, useAdminPayments, useFeeRules, useGenerateInvoices, usePlatformSettings, useSetFeeRule } from '../api';
import { ManualPaymentDialog } from '../components/ManualPaymentDialog';
import { TaxSettingForm } from '../components/settings/SettingForms';
import { outstandingOf } from '../helpers';
import { feeRuleSchema, invoicePeriodSchema, type FeeRuleValues, type InvoicePeriodValues } from '../schemas';
import type { GeneratedInvoice, Invoice } from '../types';

type TabValue = 'overview' | 'invoices' | 'fee-lines' | 'payments';
const TABS: { value: TabValue; label: string }[] = [
  { value: 'overview', label: 'Fees, tax and invoicing' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'fee-lines', label: 'Fee lines' },
  { value: 'payments', label: 'Payments' },
];

export default function BillingAdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'overview') as TabValue;
  const setTab = (v: TabValue) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true });
  const analytics = useAdminAnalytics();
  const revenue = analytics.data?.serviceFeeRevenue;

  return (
    <>
      <PageHeader title="Billing" description="NGO service fees (charged per verified unit; donors are never charged), tax, invoices and payments." />
      <div className="space-y-6">
        <section aria-label="Service-fee revenue" className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Billed" value={formatINR(revenue ? Number(revenue.billed) : null)} hint="All non-void fee lines" icon={<IndianRupee className="size-5" aria-hidden="true" />} loading={analytics.isPending} />
          <StatCard label="Collected" value={formatINR(revenue ? Number(revenue.collected) : null)} hint="Payments received, including partial and offline payments" loading={analytics.isPending} />
          <StatCard label="Outstanding" value={formatINR(revenue ? Number(revenue.outstanding) : null)} hint="Not yet invoiced, or invoiced and unpaid" loading={analytics.isPending} />
        </section>
        {analytics.isError ? <p className="text-sm text-amber-300">Revenue figures are unavailable right now.</p> : null}
        <Card>
          <div className="px-5 pt-3">
            <Tabs label="Billing sections" idPrefix="admin-billing" value={tab} onChange={setTab} items={TABS} />
          </div>
          <TabPanel value={tab} idPrefix="admin-billing" className="space-y-6 p-5 focus:outline-none">
            {tab === 'overview' ? <OverviewTab onShowInvoices={() => setTab('invoices')} /> : tab === 'invoices' ? <InvoicesTab /> : tab === 'fee-lines' ? <FeeLinesTab /> : <PaymentsTab />}
          </TabPanel>
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fees, tax and invoice generation
// ---------------------------------------------------------------------------
function OverviewTab({ onShowInvoices }: { onShowInvoices: () => void }) {
  const settings = usePlatformSettings();
  const tax = settings.data?.find((s) => s.key === 'billing.tax');
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <FeeRulesCard />
        <GenerateInvoicesCard onShowInvoices={onShowInvoices} />
      </div>
      {settings.isPending ? <SkeletonList rows={2} /> : settings.isError ? <ErrorState error={settings.error} compact onRetry={() => void settings.refetch()} /> : tax ? <TaxSettingForm key={tax.updatedAt} setting={tax} /> : null}
    </div>
  );
}

function FeeRulesCard() {
  const query = useFeeRules();
  const setRule = useSetFeeRule();
  const toast = useToast();
  const [pending, setPending] = useState<FeeRuleValues | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<FeeRuleValues>({ resolver: zodResolver(feeRuleSchema), defaultValues: { unit: 'MEALS', amountPerUnit: '', description: '' } });
  const unit = useWatch({ control, name: 'unit' });
  const active = (query.data ?? []).filter((r) => r.isActive);
  const history = (query.data ?? []).filter((r) => !r.isActive);
  const currentFor = (u: string) => active.find((r) => r.unit === u);

  const save = async () => {
    if (!pending) return;
    setFormError(null);
    try {
      await setRule.mutateAsync({ unit: pending.unit, amountPerUnit: Math.round(Number(pending.amountPerUnit) * 100) / 100, ...(pending.description.trim() ? { description: pending.description.trim() } : {}) });
      toast.success('Fee updated', `${formatINR(Number(pending.amountPerUnit))} per ${unitLabel(pending.unit, 1)} for future handovers.`);
      reset({ unit: pending.unit, amountPerUnit: '', description: '' });
    } catch (err) {
      const message = applyServerErrors(err, setError, { fields: ['unit', 'amountPerUnit', 'description'] });
      if (message) setFormError(message);
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Service-fee rules" description="What an NGO pays per unit confirmed at handover. A new rate applies to future handovers only." icon={<Receipt className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-5">
        {query.isPending ? (
          <SkeletonList rows={2} />
        ) : query.isError ? (
          <ErrorState error={query.error} compact onRetry={() => void query.refetch()} />
        ) : (
          <>
            <ul className="grid gap-3 sm:grid-cols-3" aria-label="Current fees">
              {(['MEALS', 'PACKETS', 'BOXES'] as Unit[]).map((u) => {
                const r = currentFor(u);
                return (
                  <li key={u} className="rounded-xl border border-white/10 p-3">
                    <p className="text-xs text-slate-400">{UNIT_LABELS[u]}</p>
                    <p className="mt-1 text-lg font-semibold text-white tabular-nums">{r ? formatINR(Number(r.amountPerUnit)) : '—'}</p>
                    <p className="text-xs text-slate-400">{r ? `per ${unitLabel(u, 1)} · since ${formatDate(r.effectiveFrom)}` : 'No active fee'}</p>
                  </li>
                );
              })}
            </ul>
            {history.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-sm text-slate-300 hover:text-white">Fee history ({history.length} earlier rates)</summary>
                <DataTable
                  className="mt-3"
                  caption="Fee rule history"
                  rows={history}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: 'unit', header: 'Unit', cell: (r) => UNIT_LABELS[r.unit] },
                    { key: 'amount', header: 'Fee', align: 'right', cell: (r) => `${formatINR(Number(r.amountPerUnit))} / ${unitLabel(r.unit, 1)}` },
                    { key: 'from', header: 'From', cell: (r) => formatDate(r.effectiveFrom) },
                    { key: 'to', header: 'Until', cell: (r) => formatDate(r.effectiveTo) },
                  ]}
                />
              </details>
            ) : null}
          </>
        )}
        <form className="space-y-4 border-t border-white/10 pt-4" noValidate onSubmit={handleSubmit((v) => setPending(v))}>
          <h3 className="text-sm font-semibold text-white">Change a fee</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unit" required error={errors.unit?.message}>
              <Select {...register('unit')} options={(['MEALS', 'PACKETS', 'BOXES'] as const).map((u) => ({ value: u, label: UNIT_LABELS[u] }))} />
            </Field>
            <Field label={`Fee per ${unitLabel(unit, 1)} (₹)`} required error={errors.amountPerUnit?.message} hint={currentFor(unit) ? `Currently ${formatINR(Number(currentFor(unit)?.amountPerUnit))}` : undefined}>
              <Input type="number" inputMode="decimal" min={0} step="0.01" {...register('amountPerUnit')} />
            </Field>
          </div>
          <Field label="Description" error={errors.description?.message} hint="Optional.">
            <Input {...register('description')} maxLength={300} />
          </Field>
          {formError ? (
            <Banner tone="danger" live>
              {formError}
            </Banner>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit">Review fee change</Button>
          </div>
        </form>
      </CardBody>
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Change this fee?"
        description={pending ? `${UNIT_LABELS[pending.unit]}: ${formatINR(Number(pending.amountPerUnit))} per ${unitLabel(pending.unit, 1)}` : undefined}
        confirmLabel="Save fee"
        loading={setRule.isPending}
        onConfirm={save}
      >
        <p className="text-sm text-slate-300">The current rate is closed and kept in the history. Handovers already confirmed keep the fee they were recorded with. The change is recorded in the audit log.</p>
      </ConfirmDialog>
    </Card>
  );
}

function GenerateInvoicesCard({ onShowInvoices }: { onShowInvoices: () => void }) {
  const generate = useGenerateInvoices();
  const invoices = useAdminInvoices();
  const toast = useToast();
  const today = todayIst();
  const [pending, setPending] = useState<InvoicePeriodValues | null>(null);
  const [result, setResult] = useState<{ period: InvoicePeriodValues; created: GeneratedInvoice[] } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<InvoicePeriodValues>({ resolver: zodResolver(invoicePeriodSchema), defaultValues: { periodStart: today, periodEnd: today } });

  const run = async () => {
    if (!pending) return;
    setFormError(null);
    try {
      const created = await generate.mutateAsync(pending);
      setResult({ period: pending, created });
      toast.success(created.length > 0 ? `${created.length} invoice${created.length === 1 ? '' : 's'} issued` : 'No invoices needed', created.length > 0 ? 'NGOs have been notified.' : 'There were no uninvoiced fee lines in this period.');
    } catch (err) {
      const message = applyServerErrors(err, setError, { fields: ['periodStart', 'periodEnd'], codeMap: { INVALID_PERIOD: 'periodEnd' } });
      if (message) setFormError(message);
    } finally {
      setPending(null);
    }
  };
  const byId = new Map((invoices.data ?? []).map((i) => [i.id, i]));

  return (
    <Card>
      <CardHeader title="Generate invoices" description="Groups each NGO’s uninvoiced fee lines in the period into one invoice and notifies the NGO. Dates are in IST." icon={<FileText className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-4">
        <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => setPending(v))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" required error={errors.periodStart?.message}>
              <Input type="date" max={today} {...register('periodStart')} />
            </Field>
            <Field label="To" required error={errors.periodEnd?.message}>
              <Input type="date" max={today} {...register('periodEnd')} />
            </Field>
          </div>
          {formError ? (
            <Banner tone="danger" live>
              {formError}
            </Banner>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit">Generate invoices</Button>
          </div>
        </form>
        {result ? (
          <section aria-live="polite" aria-label="Generated invoices" className="rounded-xl border border-white/10 p-4">
            <p className="text-sm font-medium text-white">
              {formatDate(result.period.periodStart)} – {formatDate(result.period.periodEnd)}: {result.created.length === 0 ? 'no new invoices' : `${result.created.length} invoice${result.created.length === 1 ? '' : 's'} created`}
            </p>
            {result.created.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm">
                {result.created.map((c) => {
                  const inv = byId.get(c.invoiceId);
                  return (
                    <li key={c.invoiceId} className="flex flex-wrap justify-between gap-2">
                      <span className="text-slate-200">{inv ? `${inv.invoiceNumber} · ${inv.ngo.name}` : c.invoiceId}</span>
                      <span className="tabular-nums text-white">{formatINR(Number(c.total))}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-400">Every fee line in this period is already invoiced, or there were no confirmed handovers.</p>
            )}
            {result.created.length > 0 ? (
              <Button size="sm" variant="link" className="mt-2 px-0" onClick={onShowInvoices}>
                Open invoices
              </Button>
            ) : null}
          </section>
        ) : null}
      </CardBody>
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Generate invoices for this period?"
        description={pending ? `${formatDate(pending.periodStart)} – ${formatDate(pending.periodEnd)}` : undefined}
        confirmLabel="Generate"
        loading={generate.isPending}
        onConfirm={run}
      >
        <p className="text-sm text-slate-300">One invoice per NGO with uninvoiced fee lines in the period. Each NGO is notified by email and in the app. This is recorded in the audit log.</p>
      </ConfirmDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------
function InvoicesTab() {
  const query = useAdminInvoices();
  const toast = useToast();
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const download = (inv: Invoice) => {
    setDownloading(inv.id);
    downloadInvoicePdf(inv)
      .catch((e: unknown) => toast.error(e))
      .finally(() => setDownloading(null));
  };
  return (
    <>
      <QueryState query={query} empty={<EmptyState icon={<FileText className="size-6" aria-hidden="true" />} title="No invoices yet" description="Generate invoices for a period on the first tab." />}>
        {(rows) => (
          <DataTable
            caption="Invoices"
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 'number',
                header: 'Invoice',
                cell: (r) => (
                  <div>
                    <p className="font-mono text-sm text-white">{r.invoiceNumber}</p>
                    <p className="text-xs text-slate-500">{r.ngo.name}</p>
                  </div>
                ),
              },
              { key: 'period', header: 'Period', cell: (r) => <span className="text-xs">{formatDate(r.periodStart)} – {formatDate(r.periodEnd)}</span> },
              { key: 'total', header: 'Total', align: 'right', cell: (r) => formatINR(Number(r.total)) },
              { key: 'paid', header: 'Paid', align: 'right', cell: (r) => formatINR(Number(r.amountPaid)) },
              { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              { key: 'due', header: 'Due', cell: (r) => <span className="text-xs text-slate-400">{formatDate(r.dueAt)}</span>, hideOnMobile: true },
              {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                cell: (r) => (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="ghost" leftIcon={<Download className="size-4" aria-hidden="true" />} loading={downloading === r.id} onClick={() => download(r)} aria-label={`Download ${r.invoiceNumber} as PDF`}>
                      PDF
                    </Button>
                    {outstandingOf(r) > 0 && r.status !== 'VOID' ? (
                      <Button size="sm" variant="outline" onClick={() => setPaying(r)} aria-label={`Record an offline payment for ${r.invoiceNumber}`}>
                        Record payment
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        )}
      </QueryState>
      {paying ? <ManualPaymentDialog invoice={paying} onClose={() => setPaying(null)} /> : null}
    </>
  );
}

function FeeLinesTab() {
  const [page, setPage] = useState(1);
  const query = useAdminFeeLines(page);
  return (
    <QueryState query={query} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="No fee lines yet" description="A fee line is created once per collection, when both sides confirm the handover." />}>
      {(data) => (
        <>
          <DataTable
            caption="Fee lines"
            rows={data.items}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 'ngo',
                header: 'NGO',
                cell: (r) => (
                  <div>
                    <p className="text-white">{r.ngo.name}</p>
                    <p className="text-xs text-slate-500">
                      {r.foodName} from {r.donorName}
                    </p>
                  </div>
                ),
              },
              { key: 'qty', header: 'Billable', align: 'right', cell: (r) => formatQuantity(r.billableQuantity, r.unit) },
              { key: 'base', header: 'Base', align: 'right', cell: (r) => `${formatINR(Number(r.baseAmount))}`, hideOnMobile: true },
              { key: 'tax', header: 'Tax', align: 'right', cell: (r) => (Number(r.tax.amount) > 0 ? `${formatINR(Number(r.tax.amount))} (${r.tax.name} ${r.tax.ratePercent}%)` : '—'), hideOnMobile: true },
              { key: 'total', header: 'Total', align: 'right', cell: (r) => formatINR(Number(r.totalAmount)) },
              { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} label={r.status === 'PENDING' ? 'Not invoiced' : undefined} /> },
              { key: 'created', header: 'Recorded', cell: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.createdAt)}</span>, hideOnMobile: true },
            ]}
          />
          <Pagination page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={setPage} />
        </>
      )}
    </QueryState>
  );
}

function PaymentsTab() {
  const query = useAdminPayments();
  return (
    <QueryState query={query} empty={<EmptyState title="No payments yet" description="Online payments and offline payments you record appear here." />}>
      {(rows) => (
        <DataTable
          caption="Payments"
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'invoice',
              header: 'Invoice',
              cell: (r) => (
                <div>
                  <p className="font-mono text-sm text-white">{r.invoiceNumber}</p>
                  <p className="text-xs text-slate-500">{r.ngoName}</p>
                </div>
              ),
            },
            { key: 'amount', header: 'Amount', align: 'right', cell: (r) => formatINR(Number(r.amount)) },
            { key: 'provider', header: 'Method', cell: (r) => (r.provider === 'MANUAL' ? <Badge tone="violet">Offline (manual)</Badge> : <Badge tone="info">{r.provider === 'RAZORPAY' ? 'Razorpay' : r.provider}</Badge>) },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'ref', header: 'Reference', cell: (r) => <span className="text-xs break-all text-slate-300">{r.referenceNote ?? r.failureReason ?? '—'}</span> },
            { key: 'when', header: 'Recorded', cell: (r) => <span className="text-xs text-slate-400">{formatDateTime(r.succeededAt ?? r.createdAt)}</span>, hideOnMobile: true },
          ]}
        />
      )}
    </QueryState>
  );
}
