import type { TransformConfig } from '../config/series.registry.js';
import type { RawObservation, TransformedObservation } from './types.js';

export function sortObservations(observations: RawObservation[]): RawObservation[] {
  return [...observations].sort((a, b) => a.obsDate.getTime() - b.obsDate.getTime());
}

export function transformObservations(
  observations: RawObservation[],
  transformConfig: TransformConfig
): TransformedObservation[] {
  const sorted = sortObservations(observations).filter((o) => o.hasData);

  if (transformConfig.kind === 'INDEX_MINUS_100') {
    return sorted
      .map((obs) => ({ ...obs, value: obs.rawValue - 100 }))
      .filter((obs) => Number.isFinite(obs.value));
  }

  const lag = transformConfig.lag;
  const transformed: TransformedObservation[] = [];

  for (let i = lag; i < sorted.length; i += 1) {
    const current = sorted[i];
    const previous = sorted[i - lag];
    if (!previous || previous.rawValue === 0) continue;

    const value = ((current.rawValue / previous.rawValue) - 1) * 100;
    if (!Number.isFinite(value)) continue;

    transformed.push({ ...current, value });
  }

  return transformed;
}

export function parseNbsTimeCode(code: string): Date | null {
  const monthly = code.match(/^(\d{4})(\d{2})$/);
  if (monthly) {
    const year = Number(monthly[1]);
    const month = Number(monthly[2]);
    if (month < 1 || month > 12) return null;
    return new Date(Date.UTC(year, month - 1, 1));
  }

  const quarterly = code.match(/^(\d{4})([ABCD])$/);
  if (quarterly) {
    const year = Number(quarterly[1]);
    const quarterCode = quarterly[2];
    const quarterMonthMap: Record<string, number> = {
      A: 0,
      B: 3,
      C: 6,
      D: 9
    };
    return new Date(Date.UTC(year, quarterMonthMap[quarterCode], 1));
  }

  return null;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatQuarter(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const quarter = Math.floor(month / 3) + 1;
  return `${year}-Q${quarter}`;
}
