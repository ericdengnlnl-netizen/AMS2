import type { TriggerType } from '@prisma/client';
import type { SeriesRegistryItem } from '../config/series.registry.js';

export interface RawObservation {
  obsDate: Date;
  rawValue: number;
  sourceCode: string;
  hasData: boolean;
}

export interface TransformedObservation extends RawObservation {
  value: number;
}

export interface SyncResultBySeries {
  seriesKey: string;
  inserted: number;
  fetched: number;
  sourceCode: string;
}

export interface SyncRunSummary {
  runId: string;
  triggerType: TriggerType;
  status: 'SUCCESS' | 'FAILED';
  startedAt: string;
  finishedAt: string;
  stats: {
    seriesCount: number;
    observationInserted: number;
    perSeries: SyncResultBySeries[];
  };
  errorMessage?: string;
}

export interface SourceAdapterResult {
  observations: RawObservation[];
  sourceCode: string;
}

export interface SourceAdapter {
  fetchSeries(def: SeriesRegistryItem): Promise<SourceAdapterResult>;
}
