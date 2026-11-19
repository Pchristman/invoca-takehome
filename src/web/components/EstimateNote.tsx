import { estimateFormulas } from '../models/estimates';

export function EstimateNote({ days }: { days: number }) {
  return (
    <details className="estimate-note small">
      <summary>How the estimates work</summary>
      <ul>
        {estimateFormulas(days).map((item) => (
          <li key={item.kind}>
            <strong>{item.label}.</strong> {item.formula}
          </li>
        ))}
      </ul>
    </details>
  );
}
