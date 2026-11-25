import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, DistanceLabel, StatusBadge } from '@/components/ui';
import type { AssistantCard, Role } from '@/types';
import { formatDateTime, formatNumber, formatQuantity, humanize } from '@/utils/format';
import { inferItemLink, resolveAssistantLink } from '../links';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const HIDDEN_KEYS = new Set(['id', 'version', 'runId', 'algorithmVersion', 'ruleId', 'referenceId', 'location']);

function formatScalar(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string' && ISO.test(v)) return formatDateTime(v);
  if (typeof v === 'string' && /^[A-Z][A-Z_]+$/.test(v)) return humanize(v);
  return String(v);
}

function titleOf(item: Obj): string {
  const nested = (k: string) => (isObj(item[k]) ? (item[k] as Obj) : null);
  const candidate = nested('candidate');
  const request = nested('request');
  const donation = nested('donation');
  const ngo = nested('ngo');
  return String(
    item.foodName ??
      item.title ??
      item.name ??
      candidate?.name ??
      (request ? `${String(request.ngoName ?? 'NGO')} needs ${formatQuantity(Number(request.quantityRemaining ?? 0), String(request.unit ?? 'MEALS'))}` : null) ??
      (donation?.foodName ? `${String(donation.foodName)}${ngo?.name ? ` · ${String(ngo.name)}` : ''}` : null) ??
      item.donorName ??
      item.ngoName ??
      item.month ??
      item.date ??
      summarise(item),
  );
}

/** "Unit: Meals · Basis: Per unit · Points: 10" for items without a natural title. */
function summarise(item: Obj): string {
  const parts = Object.entries(item)
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && typeof v !== 'object')
    .slice(0, 5)
    .map(([k, v]) => `${humanize(k.replace(/([a-z])([A-Z])/g, '$1_$2'))}: ${formatScalar(v)}`);
  return parts.length > 0 ? parts.join(' · ') : 'Item';
}

/** One row of a list result: title, status, quantity, score, distance and a link. */
function ItemRow({ item, role }: { item: Obj; role: Role }) {
  const link = inferItemLink(item, role);
  const qty = typeof item.availableQuantity === 'number' ? item.availableQuantity : typeof item.requestedQuantity === 'number' ? item.requestedQuantity : typeof item.quantity === 'number' ? item.quantity : null;
  const unit = typeof item.unit === 'string' ? item.unit : isObj(item.donation) && typeof item.donation.unit === 'string' ? item.donation.unit : null;
  const title = titleOf(item);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        {link ? (
          <Link to={link} className="inline-flex items-center gap-1 text-sm font-medium text-white hover:underline">
            {title}
            <ArrowUpRight className="size-3.5 text-slate-500" aria-hidden="true" />
          </Link>
        ) : (
          <p className="text-sm font-medium text-white">{title}</p>
        )}
        {typeof item.explanation === 'string' ? <p className="mt-0.5 text-xs text-slate-400">{item.explanation}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {qty !== null && unit ? <span className="text-xs text-slate-300 tabular-nums">{formatQuantity(qty, unit)}</span> : null}
        {typeof item.score === 'number' ? <Badge tone="info">score {Math.round(item.score)}</Badge> : null}
        {typeof item.distanceKm === 'number' ? <DistanceLabel km={item.distanceKm} source={typeof item.distanceSource === 'string' ? item.distanceSource : null} className="text-xs" /> : null}
        {typeof item.status === 'string' ? <StatusBadge status={item.status} /> : null}
      </div>
    </li>
  );
}

function ListRenderer({ items, role }: { items: unknown[]; role: Role }) {
  if (items.length === 0) return <p className="text-sm text-slate-400">No items.</p>;
  if (!items.every(isObj)) return <p className="text-sm text-slate-300">{items.map(formatScalar).join(', ')}</p>;
  const shown = items.slice(0, 8);
  return (
    <div>
      <ul className="divide-y divide-white/5">
        {shown.map((it, i) => (
          <ItemRow key={typeof it.id === 'string' ? it.id : i} item={it} role={role} />
        ))}
      </ul>
      {items.length > shown.length ? <p className="pt-1 text-xs text-slate-500">+{items.length - shown.length} more</p> : null}
    </div>
  );
}

function KeyValueRenderer({ data, role, depth }: { data: Obj; role: Role; depth: number }) {
  const entries = Object.entries(data).filter(([k]) => !HIDDEN_KEYS.has(k));
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className={Array.isArray(v) || (isObj(v) && depth < 1) ? 'sm:col-span-2' : undefined}>
          <dt className="text-xs text-slate-400">{humanize(k.replace(/([a-z])([A-Z])/g, '$1_$2'))}</dt>
          <dd className="mt-0.5 text-sm text-slate-100">{renderValue(v, role, depth + 1)}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderValue(v: unknown, role: Role, depth: number): ReactNode {
  if (Array.isArray(v)) return depth > 2 ? `${v.length} items` : <ListRenderer items={v} role={role} />;
  if (isObj(v)) {
    if (depth > 1) return Object.entries(v)
      .filter(([k]) => !HIDDEN_KEYS.has(k))
      .map(([k, x]) => `${humanize(k.replace(/([a-z])([A-Z])/g, '$1_$2'))}: ${isObj(x) || Array.isArray(x) ? '…' : formatScalar(x)}`)
      .join(' · ');
    return <KeyValueRenderer data={v} role={role} depth={depth} />;
  }
  if (typeof v === 'string' && /^[A-Z][A-Z_]+$/.test(v) && v.length < 30) return <StatusBadge status={v} />;
  return formatScalar(v);
}

/** Generic renderer for one assistant tool result (lists, key-value objects, recommendations). */
export function ResultCard({ card, role }: { card: AssistantCard; role: Role }) {
  const link = resolveAssistantLink(card.link, role);
  const data = card.data;
  let body: ReactNode;
  if (isObj(data) && typeof data.message === 'string' && Object.keys(data).length <= 2) body = <p className="text-sm text-slate-300">{data.message}</p>;
  else if (isObj(data) && Array.isArray(data.recommendations)) {
    body = (
      <div className="space-y-2">
        {typeof data.rankingStatus === 'string' && data.rankingStatus === 'RANKING_UNAVAILABLE' ? <Badge tone="warning">AI ranking unavailable: ordered by distance</Badge> : null}
        <ListRenderer items={data.recommendations} role={role} />
      </div>
    );
  } else if (isObj(data) && data.truncated === true) body = <p className="text-sm text-slate-400">The result was too large to show here. Open the page for the full list.</p>;
  else body = renderValue(data, role, 0);

  return (
    <section className="rounded-xl border border-white/10 bg-surface-raised/60 p-4" aria-label={card.title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{card.title}</h4>
        {link ? (
          <Link to={link} className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:underline">
            Open <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {body}
    </section>
  );
}
