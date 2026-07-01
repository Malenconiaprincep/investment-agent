import { describe, expect, it } from 'vitest';
import { parseEmNumber } from './tail-entry-outlook.js';

describe('tail-entry-outlook Eastmoney parsing', () => {
  it('normalizes missing or invalid numeric fields to fallback', () => {
    expect(parseEmNumber('-')).toBe(0);
    expect(parseEmNumber('')).toBe(0);
    expect(parseEmNumber(undefined)).toBe(0);
    expect(parseEmNumber(Number.NaN)).toBe(0);
  });

  it('parses Eastmoney numeric strings with percent or comma characters', () => {
    expect(parseEmNumber('3.21%')).toBe(3.21);
    expect(parseEmNumber('1,234.5')).toBe(1234.5);
  });
});
