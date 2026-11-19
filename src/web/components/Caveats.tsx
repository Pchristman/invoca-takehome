import type { Caveat } from '../models/caveats';

export function Caveats({ items }: { items: Caveat[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="notice caveats">
      {items.map((item) => (
        <li key={item.id}>{item.text}</li>
      ))}
    </ul>
  );
}
