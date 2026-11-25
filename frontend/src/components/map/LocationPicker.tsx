import { Crosshair, MapPin, Search, X } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { Button, Spinner } from '@/components/ui';
import { controlClasses } from '@/components/ui/Input';
import { ApiError } from '@/services/apiError';
import type { GeoSearchResult, LatLng } from '@/types';
import { cn } from '@/utils/cn';
import { GEO_MIN_CHARS, useGeoSearch } from './geo';
import { MapView } from './MapView';
import type { MapMarker } from './types';

export interface LocationPickerProps {
  value: LatLng | null;
  onChange: (value: LatLng | null) => void;
  /** Called when an address search result is chosen (use it to pre-fill empty address fields). */
  onAddressSelect?: (result: GeoSearchResult) => void;
  /** Shown when nothing is picked (e.g. "Uses your profile location"). */
  emptyHint?: string;
  label?: string;
  height?: number;
  allowClear?: boolean;
  /** A reference point shown while nothing is picked (e.g. the profile location). */
  fallback?: { position: LatLng; title: string } | null;
}

/**
 * Choose a point in India: search an address (GET /geo/search, debounced),
 * use the device location (asked only on click), or click the map.
 * Coordinates are shown as text so the choice is accessible without a pointer.
 */
export function LocationPicker({ value, onChange, onAddressSelect, emptyHint = 'No location selected.', label = 'Location', height = 280, allowClear = true, fallback }: LocationPickerProps) {
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // The label of the chosen result is shown in the box but not searched again.
  const [chosen, setChosen] = useState<string | null>(null);
  const [chosenProvider, setChosenProvider] = useState<string | null>(null);
  const search = useGeoSearch(q, q !== chosen);
  const id = useId().replace(/:/g, '');
  const listId = `geo-list-${id}`;
  const inputId = `geo-input-${id}`;
  const results = search.enabled ? (search.data?.results ?? []) : [];
  const showList = open && q !== chosen && q.trim().length >= GEO_MIN_CHARS;

  const choose = (r: GeoSearchResult) => {
    onChange({ lat: Math.round(r.lat * 1e6) / 1e6, lng: Math.round(r.lng * 1e6) / 1e6 });
    onAddressSelect?.(r);
    setQ(r.label);
    setChosen(r.label);
    setChosenProvider(search.data?.provider ?? null);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Never submit the surrounding form from the search box.
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[active] ?? (results.length === 1 ? results[0] : undefined);
      if (r) choose(r);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const useDeviceLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeoError('This browser cannot share its location. Search for an address or click the map instead.');
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({ lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 });
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. Search for an address or click the map instead.'
            : 'Your location could not be determined. Search for an address or click the map instead.',
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const searchError = search.isError ? ApiError.from(search.error) : null;
  const markers: MapMarker[] = !value && fallback ? [{ id: '__fallback', position: fallback.position, kind: 'donor', title: fallback.title }] : [];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          Search for an address in India
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={q}
          placeholder="Search an address, area or landmark in India"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          className={cn(controlClasses, 'h-10 pr-9 pl-9')}
        />
        {search.isFetching || search.debouncing ? (
          q.trim().length >= GEO_MIN_CHARS ? <Spinner className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400" label="Searching" /> : null
        ) : null}
        {showList ? (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-surface-raised shadow-2xl shadow-black/50">
            <ul id={listId} role="listbox" aria-label="Address suggestions" className="max-h-64 overflow-y-auto py-1">
              {results.map((r, i) => (
                <li
                  key={`${r.lat},${r.lng},${i}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(r);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn('flex cursor-pointer gap-2 px-3 py-2 text-sm', i === active ? 'bg-brand-600/20 text-white' : 'text-slate-200')}
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate">{r.label}</span>
                    {r.city || r.state ? <span className="block text-xs text-slate-400">{[r.city, r.state, r.postalCode].filter(Boolean).join(', ')}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {search.isSuccess && !search.debouncing && results.length === 0 ? <p className="px-3 py-2 text-sm text-slate-400">No matching places in India.</p> : null}
            {searchError ? (
              <p role="alert" className="px-3 py-2 text-sm text-amber-300">
                {searchError.status === 429 ? 'Too many searches. Wait a moment and try again, or click the map.' : `Address search is unavailable: ${searchError.message}`}
              </p>
            ) : null}
            {search.data?.provider === 'OPENSTREETMAP' && results.length > 0 ? (
              <p className="border-t border-white/10 px-3 py-1.5 text-[11px] text-slate-500">Search © OpenStreetMap contributors</p>
            ) : null}
          </div>
        ) : null}
      </div>
      {chosen && q === chosen && chosenProvider === 'OPENSTREETMAP' ? <p className="text-[11px] text-slate-500">Search © OpenStreetMap contributors</p> : null}

      <MapView ariaLabel={`${label}: click the map to choose a point`} picked={value} markers={markers} onPick={onChange} height={height} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400" aria-live="polite">
          {value ? (
            <>
              Selected: <span className="font-mono text-slate-200">{value.lat.toFixed(5)}, {value.lng.toFixed(5)}</span>
            </>
          ) : (
            emptyHint
          )}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={useDeviceLocation} loading={locating} leftIcon={<Crosshair className="size-4" aria-hidden="true" />}>
            Use my current location
          </Button>
          {allowClear && value ? (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)} leftIcon={<X className="size-4" aria-hidden="true" />}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      {geoError ? (
        <p role="alert" className="text-xs text-amber-300">
          {geoError}
        </p>
      ) : null}
    </div>
  );
}
