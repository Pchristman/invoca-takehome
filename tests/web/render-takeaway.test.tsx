import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Takeaway } from '../../src/web/components/Takeaway';
import type { TakeawayShow } from '../../src/web/models/takeawayModel';

const html = (show: TakeawayShow) => renderToStaticMarkup(<Takeaway show={show} />);
const ready = (text: string, marker: 'AI' | 'template' = 'AI', note: string | null = null): TakeawayShow => ({
  kind: 'ready', text, marker, note,
});

describe('<Takeaway>', () => {
  it('prints the text and the marker', () => {
    const out = html(ready('Calls rose.', 'template'));
    expect(out).toContain('Calls rose.');
    expect(out).toContain('template');
  });

  it('escapes markup in the text', () => {
    const out = html(ready('<script>alert(1)</script>'));
    expect(out).toContain('&lt;script');
    expect(out).not.toContain('<script>');
  });

  it('keeps a 300-character name whole', () => {
    const name = 'N'.repeat(300);
    expect(html(ready(`Best is ${name}.`))).toContain(name);
  });

  it('loading prints the label and no old text', () => {
    const out = html({ kind: 'loading', label: 'Loading takeaway...' });
    expect(out).toContain('Loading takeaway...');
    expect(out).not.toContain('Calls rose.');
  });

  it('hidden prints nothing', () => {
    expect(html({ kind: 'hidden' })).toBe('');
  });

  it('shows a note only when the model gives one', () => {
    expect(html(ready('Text.', 'template', null))).not.toContain('AI is off');
    expect(html(ready('Text.', 'template', 'AI is off: no API key.'))).toContain('AI is off: no API key.');
  });
});
