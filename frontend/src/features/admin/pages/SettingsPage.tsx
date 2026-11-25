import { ScrollText } from 'lucide-react';
import { Link } from 'react-router';
import { QueryState } from '@/components/feedback';
import { Banner, EmptyState, PageHeader, SectionTitle } from '@/components/ui';
import { usePlatformSettings } from '../api';
import { DemoDataCard, MatchingWeightsForm, NumberSettingForm, TaxSettingForm, UnknownSettingCard } from '../components/settings/SettingForms';
import { KNOWN_SETTING_KEYS, NUMBER_SETTINGS, type NumberSettingSpec } from '../settings';
import type { PlatformSetting } from '../types';

const GROUPS: NumberSettingSpec['group'][] = ['Matching', 'Pickup & tracking', 'Billing', 'AI assistant'];

export default function SettingsPage() {
  const query = usePlatformSettings();
  return (
    <>
      <PageHeader title="Platform settings" description="Matching, pickup verification, tracking, billing and assistant settings. Each value is validated by the server before it is saved." />
      <Banner tone="info" className="mb-6" icon={<ScrollText className="size-5 text-sky-300" aria-hidden="true" />} title="Every change is audited">
        Saving asks for confirmation and records the old and new values, your account and the time in the{' '}
        <Link to="/admin/audit?entityType=platform_setting" className="underline">
          audit log
        </Link>
        .
      </Banner>
      <QueryState query={query} empty={<EmptyState title="No settings found" />}>
        {(settings) => <SettingsGroups settings={settings} />}
      </QueryState>
    </>
  );
}

function SettingsGroups({ settings }: { settings: PlatformSetting[] }) {
  const byKey = new Map(settings.map((s) => [s.key, s]));
  const get = (key: string) => byKey.get(key);
  const weights = get('matching.weights');
  const tax = get('billing.tax');
  const demo = get('platform.demo_data');
  const unknown = settings.filter((s) => !KNOWN_SETTING_KEYS.has(s.key));
  // Remount a form when its value changes on the server (e.g. after saving), so it starts from the new value.
  const numberForm = (spec: NumberSettingSpec) => {
    const s = get(spec.key);
    return s ? <NumberSettingForm key={`${s.key}-${s.updatedAt}`} spec={spec} setting={s} /> : null;
  };

  return (
    <div className="space-y-10">
      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`settings-${group}`}>
          <SectionTitle>
            <span id={`settings-${group}`}>{group}</span>
          </SectionTitle>
          <div className="grid gap-6 xl:grid-cols-2">
            {group === 'Matching' && weights ? (
              <div className="xl:col-span-2">
                <MatchingWeightsForm key={weights.updatedAt} setting={weights} />
              </div>
            ) : null}
            {NUMBER_SETTINGS.filter((s) => s.group === group).map(numberForm)}
            {group === 'Billing' && tax ? (
              <div className="xl:col-span-2">
                <TaxSettingForm key={tax.updatedAt} setting={tax} />
                <p className="mt-2 text-xs text-slate-500">
                  Also available on the <Link to="/admin/billing" className="underline">Billing</Link> page with the fee rules.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ))}
      <section aria-labelledby="settings-platform">
        <SectionTitle>
          <span id="settings-platform">Platform</span>
        </SectionTitle>
        <div className="grid gap-6 xl:grid-cols-2">
          {demo ? <DemoDataCard setting={demo} /> : null}
          {unknown.map((s) => (
            <UnknownSettingCard key={s.key} setting={s} />
          ))}
        </div>
      </section>
    </div>
  );
}
