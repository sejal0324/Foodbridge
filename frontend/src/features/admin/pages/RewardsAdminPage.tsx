import { zodResolver } from '@hookform/resolvers/zod';
import { Award, Info, Trophy } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { QueryState } from '@/components/feedback';
import { Badge, Banner, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, EmptyState, Field, Input, PageHeader, Select, Textarea, useToast } from '@/components/ui';
import { useLeaderboard } from '@/features/rewards/api';
import { formatDate, formatNumber, unitLabel } from '@/utils/format';
import { applyServerErrors } from '@/utils/formErrors';
import { UNIT_LABELS } from '@/utils/labels';
import { useAdjustRewards, useDeactivateRewardRule, useRewardRules, useUpsertRewardRule, useVerificationQueue } from '../api';
import { describeRewardRules } from '../helpers';
import { rewardAdjustSchema, rewardRuleSchema, toRewardAdjustmentInput, toRewardRuleInput, type RewardAdjustValues, type RewardRuleValues } from '../schemas';
import type { RewardRuleRow } from '../types';

const UNIT_OPTIONS = (['MEALS', 'PACKETS', 'BOXES'] as const).map((u) => ({ value: u, label: UNIT_LABELS[u] }));

export default function RewardsAdminPage() {
  return (
    <>
      <PageHeader title="Rewards" description="FoodBridge Rewards: points donors earn for two-way verified handovers. Rules are versioned; adjustments are new ledger rows." />
      <div className="space-y-6">
        <RulesCard />
        <div className="grid gap-6 xl:grid-cols-2">
          <RuleForm />
          <AdjustmentForm />
        </div>
        <LeaderboardCard />
      </div>
    </>
  );
}

function ruleText(r: Pick<RewardRuleRow, 'unit' | 'basis' | 'points' | 'lifetimeThreshold'>) {
  if (r.basis === 'PER_ORDER') return `${formatNumber(r.points)} points per order`;
  return `${formatNumber(r.points)} points per ${unitLabel(r.unit, 1)}${r.lifetimeThreshold > 0 ? ` after ${formatNumber(r.lifetimeThreshold)} lifetime ${unitLabel(r.unit, 2)}` : ''}`;
}

function RulesCard() {
  const query = useRewardRules();
  const [deactivating, setDeactivating] = useState<RewardRuleRow | null>(null);
  const deactivate = useDeactivateRewardRule();
  const toast = useToast();
  return (
    <Card>
      <CardHeader title="How donors earn points now" description="Only quantities confirmed by both donor and NGO at handover earn points." icon={<Award className="size-4" aria-hidden="true" />} />
      <CardBody className="space-y-6">
        <QueryState query={query} empty={<EmptyState compact title="No reward rules configured" description="Donors earn no points until a rule is created." />}>
          {(rules) => {
            const active = rules.filter((r) => r.isActive);
            const history = rules.filter((r) => !r.isActive);
            return (
              <>
                <ul className="space-y-2" aria-label="Active rules in plain language">
                  {describeRewardRules(rules).map((line) => (
                    <li key={line.unit} className="flex items-start gap-2 text-sm text-slate-200">
                      <Info className="mt-0.5 size-4 shrink-0 text-brand-300" aria-hidden="true" />
                      {line.text}
                    </li>
                  ))}
                </ul>
                <section aria-labelledby="active-rules">
                  <h3 id="active-rules" className="mb-2 text-sm font-semibold text-white">
                    Active rules
                  </h3>
                  {active.length === 0 ? (
                    <p className="text-sm text-slate-400">No active rules.</p>
                  ) : (
                    <DataTable
                      caption="Active reward rules"
                      rows={active}
                      rowKey={(r) => r.id}
                      columns={[
                        { key: 'unit', header: 'Unit', cell: (r) => UNIT_LABELS[r.unit] },
                        { key: 'rule', header: 'Rule', cell: (r) => <span className="text-white">{ruleText(r)}</span> },
                        { key: 'basis', header: 'Basis', cell: (r) => <Badge tone="neutral">{r.basis === 'PER_UNIT' ? 'Per unit' : 'Per order'}</Badge> },
                        { key: 'since', header: 'Since', cell: (r) => <span className="text-xs text-slate-400">{formatDate(r.effectiveFrom)}</span> },
                        { key: 'desc', header: 'Description', cell: (r) => <span className="text-xs text-slate-400">{r.description ?? '—'}</span>, hideOnMobile: true },
                        {
                          key: 'actions',
                          header: <span className="sr-only">Actions</span>,
                          cell: (r) => (
                            <Button size="sm" variant="ghost" onClick={() => setDeactivating(r)} aria-label={`Deactivate rule: ${UNIT_LABELS[r.unit]}, ${ruleText(r)}`}>
                              Deactivate
                            </Button>
                          ),
                        },
                      ]}
                    />
                  )}
                </section>
                {history.length > 0 ? (
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium text-slate-300 hover:text-white">Rule history ({history.length} earlier versions)</summary>
                    <DataTable
                      className="mt-3"
                      caption="Reward rule history"
                      rows={history}
                      rowKey={(r) => r.id}
                      columns={[
                        { key: 'unit', header: 'Unit', cell: (r) => UNIT_LABELS[r.unit] },
                        { key: 'rule', header: 'Rule', cell: (r) => ruleText(r) },
                        { key: 'from', header: 'From', cell: (r) => <span className="text-xs text-slate-400">{formatDate(r.effectiveFrom)}</span> },
                        { key: 'to', header: 'Until', cell: (r) => <span className="text-xs text-slate-400">{formatDate(r.effectiveTo)}</span> },
                      ]}
                    />
                  </details>
                ) : null}
              </>
            );
          }}
        </QueryState>
      </CardBody>
      <ConfirmDialog
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        tone="danger"
        title="Deactivate this rule?"
        description={deactivating ? `${UNIT_LABELS[deactivating.unit]}: ${ruleText(deactivating)}` : undefined}
        confirmLabel="Deactivate rule"
        loading={deactivate.isPending}
        onConfirm={() =>
          deactivating
            ? deactivate
                .mutateAsync(deactivating.id)
                .then(() => {
                  toast.success('Rule deactivated', 'It is kept in the rule history.');
                  setDeactivating(null);
                })
                .catch((e: unknown) => toast.error(e))
            : undefined
        }
      >
        <p className="text-sm text-slate-300">Future handovers stop earning points from this rule. Points already credited are not changed. The rule stays in the history.</p>
      </ConfirmDialog>
    </Card>
  );
}

function RuleForm() {
  const upsert = useUpsertRewardRule();
  const toast = useToast();
  const [pending, setPending] = useState<RewardRuleValues | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    reset,
    formState: { errors },
  } = useForm<RewardRuleValues>({ resolver: zodResolver(rewardRuleSchema), defaultValues: { unit: 'MEALS', basis: 'PER_UNIT', points: '', lifetimeThreshold: '0', description: '' } });
  const basis = useWatch({ control, name: 'basis' });
  const unit = useWatch({ control, name: 'unit' });

  const save = async () => {
    if (!pending) return;
    setFormError(null);
    try {
      await upsert.mutateAsync(toRewardRuleInput(pending));
      toast.success('Reward rule saved', 'The previous version was closed and kept in the history.');
      reset();
    } catch (err) {
      const message = applyServerErrors(err, setError, { fields: ['unit', 'basis', 'points', 'lifetimeThreshold', 'description'], codeMap: { INVALID_RULE: 'lifetimeThreshold' } });
      if (message) setFormError(message);
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Create or replace a rule" description="Saving replaces the active rule for the same unit and threshold. The old version is kept as history, and points already credited never change." />
      <CardBody>
        <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => setPending(v))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unit" required error={errors.unit?.message}>
              <Select {...register('unit')} options={UNIT_OPTIONS} />
            </Field>
            <Field label="Basis" required error={errors.basis?.message} hint={basis === 'PER_ORDER' ? 'A fixed amount per verified order.' : 'Points for every verified unit.'}>
              <Select
                {...register('basis', { onChange: (e: { target: { value: string } }) => e.target.value === 'PER_ORDER' && setValue('lifetimeThreshold', '0') })}
                options={[
                  { value: 'PER_UNIT', label: 'Per unit' },
                  { value: 'PER_ORDER', label: 'Per order' },
                ]}
              />
            </Field>
            <Field label="Points" required error={errors.points?.message} hint={basis === 'PER_ORDER' ? 'Points per order (1–10,000)' : `Points per ${unitLabel(unit, 1)} (1–10,000)`}>
              <Input type="number" inputMode="numeric" min={1} max={10000} step={1} {...register('points')} />
            </Field>
            <Field label="Lifetime threshold" required error={errors.lifetimeThreshold?.message} hint={basis === 'PER_ORDER' ? 'Per-order rules always start at 0.' : `Applies after this many lifetime ${unitLabel(unit, 2)} (0 = from the first).`}>
              <Input type="number" inputMode="numeric" min={0} step={1} readOnly={basis === 'PER_ORDER'} {...register('lifetimeThreshold')} />
            </Field>
          </div>
          <Field label="Description" error={errors.description?.message} hint="Optional, shown in the rule list.">
            <Input {...register('description')} maxLength={300} />
          </Field>
          {basis === 'PER_ORDER' ? <Banner tone="info">A per-order rule replaces any per-unit rules for {UNIT_LABELS[unit].toLowerCase()} (and vice versa).</Banner> : null}
          {formError ? (
            <Banner tone="danger" live>
              {formError}
            </Banner>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit">Review and save</Button>
          </div>
        </form>
      </CardBody>
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Save this reward rule?"
        description={pending ? `${UNIT_LABELS[pending.unit]}: ${ruleText({ unit: pending.unit, basis: pending.basis, points: Number(pending.points), lifetimeThreshold: Number(pending.lifetimeThreshold) })}` : undefined}
        confirmLabel="Save rule"
        loading={upsert.isPending}
        onConfirm={save}
      >
        <p className="text-sm text-slate-300">It applies to handovers confirmed from now on. The change is recorded in the audit log.</p>
      </ConfirmDialog>
    </Card>
  );
}

function AdjustmentForm() {
  const donors = useVerificationQueue({ status: 'APPROVED', type: 'DONOR' });
  const adjust = useAdjustRewards();
  const toast = useToast();
  const [pending, setPending] = useState<RewardAdjustValues | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<RewardAdjustValues>({ resolver: zodResolver(rewardAdjustSchema), defaultValues: { donorId: '', points: '', reason: '' } });
  const donorName = (id: string) => donors.data?.find((d) => d.id === id)?.name ?? 'the donor';

  const save = async () => {
    if (!pending) return;
    setFormError(null);
    try {
      const res = await adjust.mutateAsync(toRewardAdjustmentInput(pending));
      toast.success('Points adjusted', `${donorName(pending.donorId)} now has ${formatNumber(res.balanceAfter)} points.`);
      reset();
    } catch (err) {
      const message = applyServerErrors(err, setError, { fields: ['donorId', 'points', 'reason'], codeMap: { NEGATIVE_BALANCE: 'points', INVALID_ADJUSTMENT: 'points' } });
      if (message) setFormError(message);
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Manual adjustment" description="Corrects a donor’s balance with a new ADJUSTMENT row in the ledger; existing rows are never edited. A balance can never go below zero." />
      <CardBody>
        <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => setPending(v))}>
          <Field label="Donor" required error={errors.donorId?.message} hint={donors.isError ? 'The donor list could not be loaded.' : 'Approved donors only.'}>
            <Select
              {...register('donorId')}
              placeholder={donors.isPending ? 'Loading donors…' : 'Choose a donor'}
              options={(donors.data ?? []).map((d) => ({ value: d.id, label: `${d.name}${d.city ? ` (${d.city})` : ''}` }))}
            />
          </Field>
          <Field label="Points" required error={errors.points?.message} hint="Positive to add, negative to deduct (e.g. -50).">
            <Input type="number" inputMode="numeric" step={1} {...register('points')} />
          </Field>
          <Field label="Reason" required error={errors.reason?.message} hint="Recorded on the ledger row and in the audit log.">
            <Textarea {...register('reason')} maxLength={300} rows={2} />
          </Field>
          {formError ? (
            <Banner tone="danger" live>
              {formError}
            </Banner>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit">Review adjustment</Button>
          </div>
        </form>
      </CardBody>
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Record this adjustment?"
        description={pending ? `${Number(pending.points) > 0 ? '+' : ''}${formatNumber(Number(pending.points))} points for ${donorName(pending.donorId)}` : undefined}
        confirmLabel="Record adjustment"
        loading={adjust.isPending}
        onConfirm={save}
      >
        <p className="text-sm text-slate-300">A new ledger row is added with your reason. It cannot be edited later; record a further adjustment to correct it.</p>
      </ConfirmDialog>
    </Card>
  );
}

function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
}

function LeaderboardCard() {
  const [month, setMonth] = useState(currentMonth);
  const valid = /^\d{4}-\d{2}$/.test(month);
  const query = useLeaderboard(valid ? month : undefined);
  return (
    <Card>
      <CardHeader
        title="Monthly leaderboard"
        description="Points credited per donor in the month (admins see every name; donors see only those who consented)."
        icon={<Trophy className="size-4" aria-hidden="true" />}
        actions={
          <Field label="Month" hideLabel>
            <div className="w-44">
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          </Field>
        }
      />
      <CardBody>
        <QueryState query={query} empty={<EmptyState compact title="No points credited in this month" />}>
          {(rows) => (
            <DataTable
              caption="Leaderboard"
              rows={rows}
              rowKey={(r) => `${r.rank}-${r.donorName}`}
              columns={[
                { key: 'rank', header: 'Rank', cell: (r) => <span className="tabular-nums">#{r.rank}</span> },
                { key: 'donor', header: 'Donor', cell: (r) => <span className="font-medium text-white">{r.donorName}</span> },
                { key: 'points', header: 'Points', align: 'right', cell: (r) => formatNumber(r.points) },
                { key: 'meals', header: 'Meals redistributed', align: 'right', cell: (r) => formatNumber(r.mealsRedistributed) },
              ]}
            />
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}
