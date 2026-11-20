import { describe, expect, test } from 'vitest';
import { readTable } from '../../src/core/csv';
import { LoadError } from '../../src/core/errors';

const file = 'calls.csv';
const required = ['a', 'b'] as const;

describe('readTable', () => {
  test('missing required column names file and column', () => {
    expect(() => readTable('a,c\n1,2', file, required)).toThrow(LoadError);
    expect(() => readTable('a,c\n1,2', file, required)).toThrow(/calls\.csv.*"b"/);
  });

  test('extra columns are ignored', () => {
    const t = readTable('a,b,zzz\n1,2,3', file, required);
    expect(t.rows[0]).toMatchObject({ a: '1', b: '2' });
  });

  test('reordered columns match by name', () => {
    const t = readTable('b,a\n2,1', file, required);
    expect(t.rows[0]).toMatchObject({ a: '1', b: '2' });
  });

  test('zero-byte file is empty, not an error', () => {
    for (const text of ['', '  \n ']) {
      const t = readTable(text, file, required);
      expect(t.isEmpty).toBe(true);
      expect(t.rows).toEqual([]);
    }
  });

  test('header-only file is empty but still checks columns', () => {
    expect(readTable('a,b\n', file, required).isEmpty).toBe(true);
    expect(() => readTable('a\n', file, required)).toThrow(LoadError);
  });

  test('quoted field with comma', () => {
    const t = readTable('a,b\n"x, y",2', file, required);
    expect(t.rows[0]?.a).toBe('x, y');
  });

  test('quoted field with doubled quote and embedded newline', () => {
    const t = readTable('a,b\n"say ""hi""\nthere",2', file, required);
    expect(t.rows[0]?.a).toBe('say "hi"\nthere');
  });

  test('CRLF line endings leave no trailing carriage return', () => {
    const t = readTable('a,b\r\n1,2\r\n3,4\r\n', file, required);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]).toEqual({ a: '3', b: '4' });
  });

  test('UTF-8 BOM does not break the first header', () => {
    const t = readTable('﻿a,b\n1,2', file, required);
    expect(t.rows[0]?.a).toBe('1');
  });

  test('BOM before a quoted first header still matches (needs the BOM option, not just trim)', () => {
    const t = readTable('﻿"a",b\n1,2', file, required);
    expect(t.rows[0]).toEqual({ a: '1', b: '2' });
  });

  test('mixed LF and CRLF line endings keep every row', () => {
    const t = readTable('a,b\r\n1,2\n3,4\r\n5,6\n', file, required);
    expect(t.rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
      { a: '5', b: '6' },
    ]);
  });

  test('a stray quote inside a field is kept as text, not a startup error', () => {
    expect(readTable('a,b\nx"y,2\n', file, required).rows[0]).toEqual({ a: 'x"y', b: '2' });
    expect(readTable('a,b\n"x" y,2\n', file, required).rows[0]).toEqual({ a: '"x" y', b: '2' });
  });

  test('a repeated required header is a LoadError naming the column', () => {
    expect(() => readTable('a,b,a\n1,2,3', file, required)).toThrow(LoadError);
    expect(() => readTable('a,b,a\n1,2,3', file, required)).toThrow(/"a"/);
  });

  test('a repeated extra header is ignored', () => {
    expect(readTable('a,b,z,z\n1,2,3,4', file, required).rows[0]).toMatchObject({ a: '1', b: '2' });
  });

  test('padded headers are trimmed', () => {
    const t = readTable(' a , b \n1,2', file, required);
    expect(t.rows[0]).toEqual({ a: '1', b: '2' });
  });

  test('short row gives empty cells; blank lines are skipped', () => {
    const t = readTable('a,b\n1\n\n3,4\n', file, required);
    expect(t.rows).toEqual([
      { a: '1', b: '' },
      { a: '3', b: '4' },
    ]);
  });

  test('unterminated quote is a LoadError naming the file', () => {
    expect(() => readTable('a,b\n"oops,2\n', file, required)).toThrow(LoadError);
    expect(() => readTable('a,b\n"oops,2\n', file, required)).toThrow(/calls\.csv/);
  });
});

describe('readTable header', () => {
  test('exposes the trimmed header, in file order', () => {
    expect(readTable('b, a\n2,1', file, required).header).toEqual(['b', 'a']);
    expect(readTable('', file, required).header).toEqual([]);
  });
});
