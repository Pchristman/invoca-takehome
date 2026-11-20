// How a core Change reads on screen, shared by the Overview tiles and the Campaigns table.
// No arithmetic on metrics: the text is the core format function's output.
import type { Change } from '../../core/metrics';
import { formatPercentChange, formatPointsChange } from '../../core/views/format';

export type Tone = 'up' | 'down' | 'flat' | 'new';

// The tone comes from the sign of the text the format function printed: '+' up, '-' down, else flat.
// So a +0.04 that prints '0.0%' is flat, with no rounding done here.
function toneOfText(text: string): Tone {
  if (text.startsWith('+')) return 'up';
  if (text.startsWith('-')) return 'down';
  return 'flat';
}

export function changeModel(change: Change): { text: string; tone: Tone } | null {
  switch (change.kind) {
    case 'percent': {
      const text = formatPercentChange(change.value);
      return { text, tone: toneOfText(text) };
    }
    case 'points': {
      const text = formatPointsChange(change.value);
      return { text, tone: toneOfText(text) };
    }
    case 'new':
      return { text: 'new', tone: 'new' };
    case 'none':
      return null;
  }
}
