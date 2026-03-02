import axios from 'axios';
import type { SeriesRegistryItem } from '../config/series.registry.js';
import type { RawObservation, SourceAdapterResult } from '../domain/types.js';

interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations: FredObservation[];
}

export function parseFredObservations(items: FredObservation[], seriesId: string): RawObservation[] {
  const out: RawObservation[] = [];
  for (const item of items) {
    const value = Number(item.value);
    if (!Number.isFinite(value)) continue;
    const date = new Date(`${item.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) continue;
    out.push({
      obsDate: date,
      rawValue: value,
      sourceCode: seriesId,
      hasData: true
    });
  }
  return out;
}

export class FredAdapter {
  constructor(private readonly apiKey: string) {}

  async fetchSeries(def: SeriesRegistryItem): Promise<SourceAdapterResult> {
    if (def.fetchConfig.type !== 'FRED') {
      throw new Error(`Series ${def.seriesKey} is not a FRED series`);
    }

    const response = await axios.get<FredResponse>('https://api.stlouisfed.org/fred/series/observations', {
      timeout: 20_000,
      params: {
        api_key: this.apiKey,
        file_type: 'json',
        series_id: def.fetchConfig.seriesId,
        sort_order: 'asc'
      }
    });

    const observations = parseFredObservations(response.data.observations || [], def.fetchConfig.seriesId);
    return {
      observations,
      sourceCode: def.fetchConfig.seriesId
    };
  }
}
