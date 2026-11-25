import { zodResolver } from '@hookform/resolvers/zod';
import { RotateCcw, Save } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Badge, Banner, Button, Card, CardBody, CardFooter, CardHeader, ConfirmDialog, DescriptionList, Field, Input, ProgressBar, Switch } from '@/components/ui';
import type { ApiError } from '@/services/apiError';
import { cn } from '@/utils/cn';
import { formatDateTime, formatNumber } from '@/utils/format';
import { taxSettingSchema, type TaxSettingValues } from '../../schemas';
import {
  CRITERION_HELP,
  MATCHING_CRITERIA,
  criterionLabel,
  numberSettingError,
  parseWeights,
  weightError,
  weightsSum,
  weightsToStrings,
  type NumberSettingSpec,
} from '../../settings';
import type { PlatformSetting, TaxSetting } from '../../types';
import { JsonBlock } from '../common';
import { useSettingSaver, type SettingSaver } from './useSettingSaver';

// ---------------------------------------------------------------------------
// Frame, confirmation and server errors shared by every setting form
// ---------------------------------------------------------------------------
function SettingFrame({ setting, title, description, children, footer, badge }: { setting: PlatformSetting; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; badge?: ReactNode }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title} {badge}
          </span>
        }
        description={description ?? setting.description ?? undefined}
        actions={<code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-slate-400">{setting.key}</code>}
      />
      <CardBody className="space-y-4">{children}</CardBody>
      <CardFooter className="justify-between">
        <p className="text-xs text-slate-500">Last changed {formatDateTime(setting.updatedAt)}</p>
        <div className="flex flex-wrap gap-2">{footer}</div>
      </CardFooter>
    </Card>
  );
}

export function ServerErrorBanner({ error }: { error: ApiError | null }) {
  if (!error) return null;
  const issues = error.validationIssues;
  return (
    <Banner tone="danger" live title="The server rejected this value">
      <p>{error.message}</p>
      {issues.length > 0 ? (
        <ul className="mt-1 list-disc pl-5">
          {issues.map((i) => (
            <li key={`${i.path}-${i.message}`}>
              {i.path ? <code className="font-mono text-xs">{i.path}</code> : null} {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      {error.requestId ? <p className="mt-1 font-mono text-xs opacity-75">Request ID: {error.requestId}</p> : null}
    </Banner>
  );
}

function SaveConfirm({ saver, title }: { saver: SettingSaver; title: string }) {
  return (
    <ConfirmDialog
      open={saver.pending !== null}
      onClose={saver.cancel}
      title={`Save “${title}”?`}
      description="The new value applies immediately across the platform. Every change is recorded in the audit log with the old and new values."
      confirmLabel="Save setting"
      loading={saver.isSaving}
      onConfirm={saver.confirm}
    >
      {saver.pending?.summary}
    </ConfirmDialog>
  );
}

function FooterButtons({ onReset, canReset, canSave, saving }: { onReset: () => void; canReset: boolean; canSave: boolean; saving: boolean }) {
  return (
    <>
      <Button variant="ghost" onClick={onReset} disabled={!canReset || saving} leftIcon={<RotateCcw className="size-4" aria-hidden="true" />}>
        Reset
      </Button>
      <Button type="submit" disabled={!canSave} loading={saving} leftIcon={<Save className="size-4" aria-hidden="true" />}>
        Save
      </Button>
    </>
  );
}

function ChangeList({ rows }: { rows: { label: string; from: ReactNode; to: ReactNode }[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-wrap justify-between gap-2">
          <span className="text-slate-300">{r.label}</span>
          <span className="tabular-nums">
            <span className="text-slate-500 line-through">{r.from}</span> → <span className="font-medium text-white">{r.to}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// matching.weights: 8 weights that must sum to exactly 100
// ---------------------------------------------------------------------------
export function MatchingWeightsForm({ setting }: { setting: PlatformSetting }) {
  const initial = useMemo(() => weightsToStrings(setting.value), [setting.value]);
  const [values, setValues] = useState(initial);
  const saver = useSettingSaver(setting.key);
  const errors = Object.fromEntries(MATCHING_CRITERIA.map((c) => [c, weightError(values[c])])) as Record<string, string | null>;
  const fieldsValid = MATCHING_CRITERIA.every((c) => errors[c] === null);
  const sum = weightsSum(values);
  const sumOk = fieldsValid && Math.abs(sum - 100) < 1e-9;
  const changed = MATCHING_CRITERIA.some((c) => Number(values[c]) !== Number(initial[c]));
  const set = (c: string, v: string) => setValues((prev) => ({ ...prev, [c]: v }));

  const submit = () => {
    if (!sumOk || !changed) return;
    const next = parseWeights(values);
    saver.request(
      next,
      <ChangeList rows={MATCHING_CRITERIA.filter((c) => Number(initial[c]) !== next[c]).map((c) => ({ label: criterionLabel(c), from: initial[c], to: next[c] }))} />,
    );
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <SettingFrame
        setting={setting}
        title="Matching weights"
        description="How much each criterion counts when ranking eligible partners. Matching is a deterministic weighted ranking, not machine learning; the weights must add up to exactly 100."
        footer={<FooterButtons onReset={() => setValues(initial)} canReset={changed} canSave={sumOk && changed && !saver.isSaving} saving={saver.isSaving} />}
      >
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          {MATCHING_CRITERIA.map((c) => {
            const label = criterionLabel(c);
            return (
              <div key={c} className="space-y-1.5">
                <Field label={label} error={errors[c] ?? undefined} hint={CRITERION_HELP[c]}>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Number(values[c]) || 0}
                      onChange={(e) => set(c, e.target.value)}
                      aria-label={`${label} weight slider`}
                      className="h-2 flex-1 cursor-pointer accent-brand-500"
                    />
                    <div className="w-24 shrink-0">
                      <Input type="number" inputMode="decimal" min={0} max={100} step={1} value={values[c]} onChange={(e) => set(c, e.target.value)} className="text-right" />
                    </div>
                  </div>
                </Field>
              </div>
            );
          })}
        </div>
        <div className="rounded-xl border border-white/10 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-slate-300">Total</p>
            <p role="status" aria-live="polite" className={cn('text-lg font-semibold tabular-nums', sumOk ? 'text-emerald-300' : 'text-amber-300')} data-testid="weights-sum">
              {formatNumber(sum)} / 100
            </p>
          </div>
          <ProgressBar className="mt-2" value={Math.min(sum, 100)} max={100} label="Sum of matching weights" tone={sumOk ? 'brand' : 'warning'} />
          <p className="mt-2 text-xs text-slate-400">
            {!fieldsValid
              ? 'Fix the highlighted weights first.'
              : sum < 100
                ? `Add ${formatNumber(Math.round((100 - sum) * 100) / 100)} more to reach 100. Saving is disabled until the total is exactly 100.`
                : sum > 100
                  ? `Remove ${formatNumber(Math.round((sum - 100) * 100) / 100)} to get back to 100. Saving is disabled until the total is exactly 100.`
                  : changed
                    ? 'The total is 100. Ready to save.'
                    : 'The total is 100. Change a weight to save a new ranking.'}
          </p>
        </div>
        <ServerErrorBanner error={saver.error} />
      </SettingFrame>
      <SaveConfirm saver={saver} title="Matching weights" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Single numeric settings
// ---------------------------------------------------------------------------
export function NumberSettingForm({ spec, setting }: { spec: NumberSettingSpec; setting: PlatformSetting }) {
  const initial = typeof setting.value === 'number' ? String(setting.value) : '';
  const [raw, setRaw] = useState(initial);
  const saver = useSettingSaver(setting.key);
  const error = numberSettingError(spec, raw);
  const changed = raw.trim() !== initial;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (error || !changed) return;
        saver.request(Number(raw.trim()), <ChangeList rows={[{ label: spec.title, from: `${initial} ${spec.suffix}`, to: `${raw.trim()} ${spec.suffix}` }]} />);
      }}
    >
      <SettingFrame
        setting={setting}
        title={spec.title}
        description={spec.help}
        footer={<FooterButtons onReset={() => setRaw(initial)} canReset={changed} canSave={!error && changed && !saver.isSaving} saving={saver.isSaving} />}
      >
        <Field label={`${spec.title} (${spec.suffix})`} error={changed ? (error ?? undefined) : undefined} hint={`Allowed: ${spec.exclusiveMin ? `more than ${spec.min}` : spec.min} to ${spec.max} ${spec.suffix}${spec.integer ? ', whole numbers' : ''}.`}>
          <div className="max-w-40">
            <Input type="number" inputMode={spec.integer ? 'numeric' : 'decimal'} min={spec.min} max={spec.max} step={spec.integer ? 1 : 'any'} value={raw} onChange={(e) => setRaw(e.target.value)} />
          </div>
        </Field>
        <ServerErrorBanner error={saver.error} />
      </SettingFrame>
      <SaveConfirm saver={saver} title={spec.title} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// billing.tax
// ---------------------------------------------------------------------------
function readTax(value: unknown): TaxSetting {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<TaxSetting>;
  return { enabled: Boolean(v.enabled), name: typeof v.name === 'string' ? v.name : 'GST', rate_percent: typeof v.rate_percent === 'number' ? v.rate_percent : 0 };
}

export function TaxSettingForm({ setting }: { setting: PlatformSetting }) {
  const current = readTax(setting.value);
  const defaults: TaxSettingValues = { enabled: current.enabled, name: current.name, rate_percent: String(current.rate_percent) };
  const saver = useSettingSaver(setting.key);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<TaxSettingValues>({ resolver: zodResolver(taxSettingSchema), defaultValues: defaults });
  const enabled = useWatch({ control, name: 'enabled' });

  const onSubmit = handleSubmit((v) => {
    const next: TaxSetting = { enabled: v.enabled, name: v.name.trim(), rate_percent: Number(v.rate_percent) };
    saver.request(
      next,
      <div className="space-y-3">
        <ChangeList
          rows={[
            { label: 'Tax applied', from: current.enabled ? 'Yes' : 'No', to: next.enabled ? 'Yes' : 'No' },
            { label: 'Name', from: current.name, to: next.name },
            { label: 'Rate', from: `${current.rate_percent}%`, to: `${next.rate_percent}%` },
          ]}
        />
        {next.enabled ? <Banner tone="warning">From now on every new NGO fee line gets {next.rate_percent}% {next.name} on top of the base fee. Confirm that this treatment has been professionally validated.</Banner> : null}
      </div>,
    );
  });

  return (
    <form noValidate onSubmit={onSubmit}>
      <SettingFrame
        setting={setting}
        title="Tax on NGO service fees"
        badge={<Badge tone={current.enabled ? 'warning' : 'neutral'}>{current.enabled ? `${current.name} ${current.rate_percent}% applied` : 'Not applied'}</Badge>}
        description="Tax added on top of the base service fee (₹ per verified unit). The base fee and the tax are stored separately on every fee line."
        footer={<FooterButtons onReset={() => reset(defaults)} canReset={isDirty} canSave={isDirty && !saver.isSaving} saving={saver.isSaving} />}
      >
        <Banner tone="warning" title="GST treatment must be professionally validated">
          Whether GST applies to FoodBridge service fees, the registration, HSN/SAC codes and the invoice format must be confirmed by a qualified tax professional before production use. A change affects
          only fees recorded after it is saved; existing fee lines and invoices keep the tax they were created with.
        </Banner>
        <Switch checked={enabled} onChange={(v) => setValue('enabled', v, { shouldDirty: true })} label="Apply tax to new fee lines" description={enabled ? 'New fee lines include the tax below.' : 'New fee lines carry no tax.'} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tax name" required error={errors.name?.message} hint="Shown on invoices, e.g. GST.">
            <Input {...register('name')} maxLength={20} />
          </Field>
          <Field label="Rate (%)" required error={errors.rate_percent?.message} hint="0 to 100.">
            <div className="max-w-32">
              <Input type="number" inputMode="decimal" min={0} max={100} step="any" {...register('rate_percent')} />
            </div>
          </Field>
        </div>
        <ServerErrorBanner error={saver.error} />
      </SettingFrame>
      <SaveConfirm saver={saver} title="Tax on NGO service fees" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Read-only settings
// ---------------------------------------------------------------------------
export function DemoDataCard({ setting }: { setting: PlatformSetting }) {
  const v = (typeof setting.value === 'object' && setting.value !== null ? setting.value : {}) as { seeded?: boolean; seededAt?: string; note?: string };
  return (
    <SettingFrame setting={setting} title="Demo data" badge={<Badge tone={v.seeded ? 'violet' : 'success'}>{v.seeded ? 'Demo data present' : 'No demo data'}</Badge>} description="Set by the development seed so analytics label demo records instead of presenting them as real statistics. Read-only.">
      <DescriptionList
        items={[
          { term: 'Seeded', description: v.seeded ? 'Yes' : 'No' },
          { term: 'Seeded at', description: formatDateTime(v.seededAt) },
          ...(v.note ? [{ term: 'Note', description: v.note }] : []),
        ]}
      />
    </SettingFrame>
  );
}

export function UnknownSettingCard({ setting }: { setting: PlatformSetting }) {
  return (
    <SettingFrame setting={setting} title={setting.key} description={setting.description ?? 'This setting has no dedicated form in the web app. Read-only.'}>
      <JsonBlock label="Value" value={setting.value} />
    </SettingFrame>
  );
}
