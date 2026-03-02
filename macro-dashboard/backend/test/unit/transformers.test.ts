import { describe, expect, it } from 'vitest';
import { parseNbsTimeCode, transformObservations } from '../../src/domain/transformers.js';

describe('transformers', () => {
  it('parses monthly and quarterly NBS time codes', () => {
    const m = parseNbsTimeCode('202601');
    const q = parseNbsTimeCode('2025D');

    expect(m?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(q?.toISOString().slice(0, 10)).toBe('2025-10-01');
  });

  it('computes yoy lag transform', () => {
    const observations = [
      { obsDate: new Date('2024-01-01T00:00:00.000Z'), rawValue: 100, sourceCode: 'X', hasData: true },
      { obsDate: new Date('2025-01-01T00:00:00.000Z'), rawValue: 110, sourceCode: 'X', hasData: true }
    ];

    const out = transformObservations(observations, { kind: 'YOY_LAG', lag: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].value).toBeCloseTo(10, 6);
  });

  it('computes index minus 100 transform', () => {
    const observations = [
      { obsDate: new Date('2026-01-01T00:00:00.000Z'), rawValue: 102.3, sourceCode: 'X', hasData: true }
    ];

    const out = transformObservations(observations, { kind: 'INDEX_MINUS_100' });
    expect(out[0].value).toBeCloseTo(2.3, 6);
  });
});
