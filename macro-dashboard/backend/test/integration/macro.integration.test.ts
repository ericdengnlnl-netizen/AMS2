import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { MacroSeries, SyncRun, TriggerType } from '@prisma/client';
import { MacroService } from '../../src/services/macro.service.js';
import { createApp } from '../../src/app.js';
import type { SeriesRegistryItem } from '../../src/config/series.registry.js';
import type { SourceAdapter, SourceAdapterResult, TransformedObservation } from '../../src/domain/types.js';

function dateUtc(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m - 1, d));
}

function buildMonthlyRaw(sourceCode: string) {
  const points = [];
  for (let i = 0; i < 13; i += 1) {
    points.push({
      obsDate: dateUtc(2025 + Math.floor((i + 1) / 13), ((i % 12) + 1), 1),
      rawValue: 100 + i,
      sourceCode,
      hasData: true
    });
  }
  return points;
}

function buildQuarterlyRaw(sourceCode: string) {
  return [
    { obsDate: dateUtc(2025, 1, 1), rawValue: 1000, sourceCode, hasData: true },
    { obsDate: dateUtc(2025, 4, 1), rawValue: 1100, sourceCode, hasData: true },
    { obsDate: dateUtc(2025, 7, 1), rawValue: 1200, sourceCode, hasData: true },
    { obsDate: dateUtc(2025, 10, 1), rawValue: 1300, sourceCode, hasData: true },
    { obsDate: dateUtc(2026, 1, 1), rawValue: 1400, sourceCode, hasData: true }
  ];
}

class FakeAdapter implements SourceAdapter {
  constructor(private readonly sourceType: 'FRED' | 'NBS') {}

  async fetchSeries(def: SeriesRegistryItem): Promise<SourceAdapterResult> {
    if (def.source !== this.sourceType) {
      throw new Error(`Unexpected source ${def.source}`);
    }

    const sourceCode = def.fetchConfig.type === 'FRED'
      ? def.fetchConfig.seriesId
      : def.fetchConfig.valueCodeChain[0];

    return {
      sourceCode,
      observations: def.frequency === 'M' ? buildMonthlyRaw(sourceCode) : buildQuarterlyRaw(sourceCode)
    };
  }
}

class InMemoryRepository {
  private readonly series = new Map<string, MacroSeries>();
  private readonly observations = new Map<string, Map<string, TransformedObservation>>();
  private readonly runs = new Map<string, SyncRun>();

  async upsertSeriesDefinitions(defs: SeriesRegistryItem[]): Promise<MacroSeries[]> {
    const now = new Date();
    const rows = defs.map((def) => {
      const row: MacroSeries = {
        id: def.seriesKey,
        seriesKey: def.seriesKey,
        displayName: def.displayName,
        source: def.source,
        frequency: def.frequency,
        unit: def.unit,
        transformType: def.transformConfig.kind,
        enabled: true,
        meta: {},
        createdAt: now,
        updatedAt: now
      };
      this.series.set(def.seriesKey, row);
      if (!this.observations.has(row.id)) this.observations.set(row.id, new Map());
      return row;
    });
    return rows;
  }

  async listSeries(): Promise<MacroSeries[]> {
    return [...this.series.values()];
  }

  async getSeriesByKey(seriesKey: string): Promise<MacroSeries | null> {
    return this.series.get(seriesKey) ?? null;
  }

  async upsertObservations(seriesId: string, observations: TransformedObservation[]): Promise<number> {
    const bucket = this.observations.get(seriesId) ?? new Map<string, TransformedObservation>();
    this.observations.set(seriesId, bucket);
    for (const item of observations) {
      bucket.set(item.obsDate.toISOString().slice(0, 10), item);
    }
    return observations.length;
  }

  async getObservations(seriesId: string, options: { start?: Date; end?: Date; limit?: number }) {
    const bucket = this.observations.get(seriesId) ?? new Map();
    let rows = [...bucket.values()]
      .sort((a, b) => a.obsDate.getTime() - b.obsDate.getTime())
      .filter((row) => {
        if (options.start && row.obsDate < options.start) return false;
        if (options.end && row.obsDate > options.end) return false;
        return true;
      })
      .map((row, idx) => ({
        id: BigInt(idx + 1),
        seriesId,
        obsDate: row.obsDate,
        rawValue: row.rawValue,
        value: row.value,
        sourceCode: row.sourceCode,
        hasData: row.hasData,
        createdAt: new Date()
      }));

    if (options.limit) rows = rows.slice(0, options.limit);
    return rows;
  }

  async createRun(triggerType: TriggerType): Promise<SyncRun> {
    const run: SyncRun = {
      id: `run_${this.runs.size + 1}`,
      triggerType,
      status: 'RUNNING',
      startedAt: new Date(),
      finishedAt: null,
      stats: null,
      errorMessage: null,
      createdAt: new Date()
    };
    this.runs.set(run.id, run);
    return run;
  }

  async appendRunLog(): Promise<void> {}

  async finishRun(runId: string, status: SyncRun['status'], stats: unknown, errorMessage?: string): Promise<SyncRun> {
    const run = this.runs.get(runId);
    if (!run) throw new Error('run not found');
    const updated: SyncRun = {
      ...run,
      status,
      stats,
      errorMessage: errorMessage ?? null,
      finishedAt: new Date()
    };
    this.runs.set(runId, updated);
    return updated;
  }

  async latestRun(): Promise<SyncRun | null> {
    return [...this.runs.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null;
  }

  async listRuns(limit = 20): Promise<SyncRun[]> {
    return [...this.runs.values()]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  countObservations(seriesKey: string) {
    return this.observations.get(seriesKey)?.size ?? 0;
  }
}

describe('macro service integration', () => {
  it('syncs without duplicates and returns configured dashboard', async () => {
    const repository = new InMemoryRepository();
    const service = new MacroService({
      fredApiKey: 'x',
      repository: repository as never,
      fredAdapter: new FakeAdapter('FRED'),
      nbsAdapter: new FakeAdapter('NBS')
    });

    await service.sync('MANUAL');
    await service.sync('MANUAL');

    expect(repository.countObservations('us_cpi_yoy')).toBe(1);
    expect(repository.countObservations('us_gdp_yoy')).toBe(1);

    const dashboard = await service.getDashboard('macro-core');
    const allSeries = dashboard.charts.flatMap((chart) => chart.series.map((s) => s.seriesKey));
    expect(allSeries).toEqual(
      expect.arrayContaining([
        'us_gdp_yoy',
        'cn_gdp_yoy',
        'us_cpi_yoy',
        'cn_cpi_yoy',
        'us_ppi_yoy',
        'cn_ppi_yoy'
      ])
    );
  });

  it('serves sync and dashboard endpoints', async () => {
    const repository = new InMemoryRepository();
    const service = new MacroService({
      fredApiKey: 'x',
      repository: repository as never,
      fredAdapter: new FakeAdapter('FRED'),
      nbsAdapter: new FakeAdapter('NBS')
    });

    const app = createApp(service, '*');

    const syncResp = await request(app).post('/api/v1/sync').send({});
    expect(syncResp.status).toBe(200);
    expect(syncResp.body.ok).toBe(true);

    const dashboardResp = await request(app).get('/api/v1/dashboard?view=macro-core');
    expect(dashboardResp.status).toBe(200);
    expect(dashboardResp.body.ok).toBe(true);
    expect(dashboardResp.body.result.charts).toHaveLength(3);
  });
});
