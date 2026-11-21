import { useEffect, useRef, useState } from 'react';
import type { Meta } from '../../server/api';
import type { ClientError } from '../api';
import { isIsoDate } from '../format';
import { customDates, presetClick, presetOf } from '../urlState';
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

/**
 * Preset buttons and two date inputs, plus the comparison dates when `onCompare` is given (only views that show a
 * comparison pass it). It stays on screen when the view request fails, so a bad range can be fixed here.
 */
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
  onCompare: ((compare: { start: string; end: string } | null) => void) | null;
}) {
  // Clear dates and Use previous period remove themselves when clicked, so focus moves to the first input of their group.
  const startInput = useRef<HTMLInputElement>(null);
  const compareStartInput = useRef<HTMLInputElement>(null);
  const fromUrl = state.range?.kind === 'custom' ? state.range : null;
  const [start, setStart] = useState(validOrBlank(fromUrl?.start));
  const [end, setEnd] = useState(validOrBlank(fromUrl?.end));
  const [compareStart, setCompareStart] = useState(validOrBlank(state.compare?.start));
  const [compareEnd, setCompareEnd] = useState(validOrBlank(state.compare?.end));
  // A preset click, Back or Forward changes the active range: dates typed but not applied give way to the URL's.
  const activeRange = JSON.stringify([state.range, state.compare]);
  useEffect(() => {
    setStart(validOrBlank(fromUrl?.start));
    setEnd(validOrBlank(fromUrl?.end));
    setCompareStart(validOrBlank(state.compare?.start));
    setCompareEnd(validOrBlank(state.compare?.end));
  }, [activeRange]);
  const comparing = isIsoDate(compareStart) && isIsoDate(compareEnd) ? customDates(compareStart, compareEnd) : null;

  const active = presetOf(state, meta.defaultPreset);
  const dates = isIsoDate(start) && isIsoDate(end) ? customDates(start, end) : null;
  const applied: RangeChoice | null = dates && { kind: 'custom', ...dates };
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
            onClick={() => {
              const range = presetClick(state, preset, meta.defaultPreset);
              if (range !== null) onChange(range); // the active preset again: no new URL, no refetch, comparison kept
            }}
          >
            {PRESET_LABELS[preset] ?? preset}
          </button>
        ))}
      </div>
      <label>
        Start date
        <input ref={startInput} type="date" value={start} min={meta.span?.start} max={meta.span?.end} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        End date
        <input type="date" value={end} min={meta.span?.start} max={meta.span?.end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <button type="button" className="button" disabled={applied === null} onClick={() => onChange(applied)}>
        Apply
      </button>
      {(start !== '' || end !== '' || fromUrl !== null) && (
        <button
          type="button"
          className="button"
          onClick={() => {
            setStart('');
            setEnd('');
            startInput.current?.focus();
            if (fromUrl !== null) onChange(null); // back to the default range
          }}
        >
          Clear dates
        </button>
      )}
      {onCompare !== null && (
        <div className="row" role="group" aria-label="Comparison range">
          <label>
            Compare start date
            <input ref={compareStartInput} type="date" value={compareStart} min={meta.span?.start} max={meta.span?.end} onChange={(e) => setCompareStart(e.target.value)} />
          </label>
          <label>
            Compare end date
            <input type="date" value={compareEnd} min={meta.span?.start} max={meta.span?.end} onChange={(e) => setCompareEnd(e.target.value)} />
          </label>
          <button type="button" className="button" disabled={comparing === null} onClick={() => onCompare(comparing)}>
            Compare
          </button>
          {state.compare !== null ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                compareStartInput.current?.focus();
                onCompare(null);
              }}
            >
              Use previous period
            </button>
          ) : (
            (compareStart !== '' || compareEnd !== '') && (
              <button
                type="button"
                className="button"
                onClick={() => {
                  setCompareStart('');
                  setCompareEnd('');
                  compareStartInput.current?.focus();
                }}
              >
                Clear comparison dates
              </button>
            )
          )}
        </div>
      )}
      {/* Plain text on purpose: the request frame below already announces this same error as an alert. */}
      {showError && (
        <p className="range-error">
          {error.message}
        </p>
      )}
    </section>
  );
}
