import { describe, expect, it } from 'vitest';
import { parseFredObservations } from '../../src/adapters/fred.adapter.js';

describe('fred adapter parser', () => {
  it('filters invalid values and parses dates', () => {
    const out = parseFredObservations(
      [
        { date: '2026-01-01', value: '101.2' },
        { date: '2026-02-01', value: '.' }
      ],
      'CPIAUCSL'
    );

    expect(out).toHaveLength(1);
    expect(out[0].sourceCode).toBe('CPIAUCSL');
    expect(out[0].rawValue).toBe(101.2);
    expect(out[0].obsDate.toISOString().slice(0, 10)).toBe('2026-01-01');
  });
});
