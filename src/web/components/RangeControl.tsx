import { useEffect, useState } from 'react';
import type { Meta } from '../../server/api';
import type { ClientError } from '../api';
import { customRange, presetOf } from '../urlState';
import type { RangeChoice, UrlState } from '../urlState';

const PRESET_LABELS: Record<string, string> = {
  last7: 'Last 7 days',
  last28: 'Last 28 days',
  all: 'All data',
};

const RANGE_FIELDS = ['start', 'end', 'compareStart', 'compareEnd'];

/** Preset buttons and two date inputs. It stays on screen when the view request fails, so a bad range can be fixed here. */
export function RangeControl({
  state,
  meta,
  error,
  onChange,
}: {
  state: UrlState;
  meta: Meta;
  error: ClientError | null;
  onChange(range: RangeChoice | null): void;
}) {
  const fromUrl = state.range?.kind === 'custom' ? state.range : null;
  const [start, setStart] = useState(fromUrl?.start ?? '');
  const [end, setEnd] = useState(fromUrl?.end ?? '');
  // Back and forward buttons change the URL under the inputs.
  useEffect(() => {
    setStart(fromUrl?.start ?? '');
    setEnd(fromUrl?.end ?? '');
  }, [fromUrl?.start, fromUrl?.end]);

  const active = presetOf(state, meta.defaultPreset);
  const applied = customRange(start, end);
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
      {showError && (
        <p role="alert" className="range-error">
          {error.message}
        </p>
      )}
    </section>
  );
}
