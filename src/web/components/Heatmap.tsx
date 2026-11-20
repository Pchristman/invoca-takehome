import { Reveal, RevealPresence } from './Reveal';
import type { HeatLevel, HeatmapMode, HeatmapModel } from '../models/heatmapModel';

const MODES: { mode: HeatmapMode; label: string }[] = [
  { mode: 'office', label: 'By office' },
  { mode: 'weekday', label: 'By weekday' },
];

const LEVELS: HeatLevel[] = [0, 1, 2, 3, 4];

export function Heatmap({
  model,
  mode,
  onModeChange,
}: {
  model: HeatmapModel;
  mode: HeatmapMode;
  onModeChange(mode: HeatmapMode): void;
}) {
  return (
    <div>
      <div className="row">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            className="button"
            aria-pressed={mode === m.mode}
            onClick={() => onModeChange(m.mode)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <RevealPresence wait>
      <Reveal key={mode} kind="panel" id={mode}>
      <div className="table-wrap heatmap-wrap">
        <table className="heatmap">
          <caption className="visually-hidden">
            Missed calls by hour of day, {mode === 'office' ? 'one row per office' : 'one row per weekday'}
          </caption>
          <thead>
            <tr>
              <th scope="col">{mode === 'office' ? 'Office' : 'Weekday'}</th>
              {model.hourLabels.map((hour) => (
                <th key={hour} scope="col" className="num">
                  {hour}
                </th>
              ))}
              <th scope="col" className="num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" title={row.label}>
                  {row.label}
                </th>
                {row.cells.map((cell, hour) => (
                  <td
                    key={hour}
                    className={`heat-cell heat-${cell.level}`}
                    data-level={cell.level}
                    title={cell.label}
                  >
                    {cell.text}
                    <span className="visually-hidden">{cell.label}</span>
                  </td>
                ))}
                <td className="num">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </Reveal>
      </RevealPresence>
      <div className="heat-legend small muted">
        <span>Fewer</span>
        {LEVELS.map((level) => (
          <span key={level} className={`heat-swatch heat-${level}`} aria-hidden="true" />
        ))}
        <span>More missed calls</span>
      </div>
    </div>
  );
}
