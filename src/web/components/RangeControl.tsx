import { useEffect, useState } from 'react';
import type { Meta } from '../../server/api';
import type { ClientError } from '../api';
import { isIsoDate } from '../format';
import { customCompare, customRange, presetOf } from '../urlState';
import type { RangeChoice, UrlState } from '../urlState';

const PRESET_LABELS: Record<string, string> = {
  last7: 'Last 7 days',
  last28: 'Last 28 days',
  all: 'All data',
};

/** Only a real YYYY-MM-DD date may seed an input; anything else from the URL shows as blank. */
function validOrBlank(value: string | undefined): string {
  return value !== undefined && isIsoDate(value) ? value : '';
}

const RANGE_FIELDS = ['start', 'end', 'compareStart', 'compareEnd'];

/** Preset buttons and two date inputs. It stays on screen when the view request fails, so a bad range can be fixed here. */
export function RangeControl({
  state,
  meta,
  error,
  onChange,
  onCompare,
}: {
  state: UrlState;
  meta: Meta;
  error: ClientError | null;
  onChange(range: RangeChoice | null): void;
  onCompare(compare: { start: string; end: string } | null): void;
}) {
  const fromUrl = state.range?.kind === 'custom' ? state.range : null;
  const [start, setStart] = useState(validOrBlank(fromUrl?.start));
  const [end, setEnd] = useState(validOrBlank(fromUrl?.end));
  // Back and forward buttons change the URL under the inputs.
  useEffect(() => {
    setStart(validOrBlank(fromUrl?.start));
    setEnd(validOrBlank(fromUrl?.end));
  }, [fromUrl?.start, fromUrl?.end]);

  const compareFromUrl = state.compare;
  const [compareStart, setCompareStart] = useState(validOrBlank(compareFromUrl?.start));
  const [compareEnd, setCompareEnd] = useState(validOrBlank(compareFromUrl?.end));
  useEffect(() => {
    setCompareStart(validOrBlank(compareFromUrl?.start));
    setCompareEnd(validOrBlank(compareFromUrl?.end));
  }, [compareFromUrl?.start, compareFromUrl?.end]);
  const comparing = isIsoDate(compareStart) && isIsoDate(compareEnd) ? customCompare(compareStart, compareEnd) : null;

  const active = presetOf(state, meta.defaultPreset);
  const applied = isIsoDate(start) && isIsoDate(end) ? customRange(start, end) : null;
  const showError = error !== null && error.field !== undefined && RANGE_FIELDS.includes(error.field);

  return (
    <section className="range-control" aria-label="Date range">
      <div className="row" role="group" aria-label="Preset ranges">
        {meta.presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className="button"
            aria-pressed={active === preset}
            onClick={() => onChange({ kind: 'preset', preset })}
          >
            {PRESET_LABELS[preset] ?? preset}
          </button>
        ))}
      </div>
      <label>
        Start date
        <input type="date" value={start} min={meta.span?.start} max={meta.span?.end} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        End date
        <input type="date" value={end} min={meta.span?.start} max={meta.span?.end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <button type="button" className="button" disabled={applied === null} onClick={() => onChange(applied)}>
        Apply
      </button>
      <div className="row" role="group" aria-label="Comparison range">
        <label>
          Compare start date
          <input type="date" value={compareStart} min={meta.span?.start} max={meta.span?.end} onChange={(e) => setCompareStart(e.target.value)} />
        </label>
        <label>
          Compare end date
          <input type="date" value={compareEnd} min={meta.span?.start} max={meta.span?.end} onChange={(e) => setCompareEnd(e.target.value)} />
        </label>
        <button type="button" className="button" disabled={comparing === null} onClick={() => onCompare(comparing)}>
          Compare
        </button>
        {state.compare !== null && (
          <button type="button" className="button" onClick={() => onCompare(null)}>
            Use previous period
          </button>
        )}
      </div>
      {/* Plain text on purpose: the request frame below already announces this same error as an alert. */}
      {showError && (
        <p className="range-error">
          {error.message}
        </p>
      )}
    </section>
  );
}
