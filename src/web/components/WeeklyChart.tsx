import { Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCount } from '../../core/views/format';
import type { WeeklyChartModel } from '../models/weeklyChart';
import { chartAnimation } from '../models/motionVariants';
import { useMotion } from '../useMotion';

type WeekBar = WeeklyChartModel['bars'][number];

// Colors come only from tokens. Partial bars use the hatch pattern defined below.
const BAR_FILL = 'var(--color-chart-bar)';
const BAR_FILL_PARTIAL = 'url(#partial-hatch)';

function BarTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload?: WeekBar }[] }) {
  const bar = active ? payload?.[0]?.payload : undefined;
  if (!bar) return null;
  return (
    <div className="notice small">
      <strong>{formatCount(bar.calls, ['call', 'calls'])}</strong>
      <div>{bar.range}</div>
      {bar.partial && <div>partial week</div>}
    </div>
  );
}

export function WeeklyChart({ model }: { model: WeeklyChartModel }) {
  const motion = useMotion();
  return (
    <figure className="chart">
      <figcaption>
        <h3 className="chart-title">{model.title}</h3>
      </figcaption>
      {model.allZero && <p role="status">No calls in these weeks.</p>}
      <div role="img" aria-label={`${model.title}. The same values are in the table below.`} hidden={model.allZero}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={model.bars} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <defs>
              <pattern id="partial-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" style={{ fill: 'var(--color-chart-bar-partial)' }} />
                <line x1="0" y1="0" x2="0" y2="6" strokeWidth="2" style={{ stroke: 'var(--color-chart-bar)' }} />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} style={{ stroke: 'var(--color-border)', strokeOpacity: 0.4 }} />
            <XAxis dataKey="label" tickLine={false} className="chart-axis" />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              className="chart-axis"
              tickFormatter={(value: number) => formatCount(value)}
            />
            <Tooltip content={BarTooltip} cursor={false} />
            <Bar dataKey="calls" {...chartAnimation(motion)} radius={[4, 4, 0, 0]}>
              {model.bars.map((bar) => (
                <Cell key={bar.range} fill={bar.partial ? BAR_FILL_PARTIAL : BAR_FILL} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {model.hasPartial && (
        <p className="chart-legend small muted">
          <span>
            <span className="chart-swatch chart-swatch-partial" aria-hidden="true" />
            Hatched bars are partial weeks.
          </span>
        </p>
      )}
      <table className="visually-hidden">
        <caption>{model.title}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Calls</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {model.bars.map((bar) => (
            <tr key={bar.range}>
              <th scope="row">{bar.range}</th>
              <td>{formatCount(bar.calls)}</td>
              <td>{bar.partial ? 'partial week' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
