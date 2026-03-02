import type { TriggerType } from '@prisma/client';
import { SERIES_BY_KEY, SERIES_REGISTRY } from '../config/series.registry.js';
import { DASHBOARD_VIEW_BY_KEY } from '../config/dashboard.views.js';
import { FredAdapter } from '../adapters/fred.adapter.js';
import { NbsAdapter } from '../adapters/nbs.adapter.js';
import { transformObservations, formatDate, formatQuarter } from '../domain/transformers.js';
import type { SourceAdapter, SyncResultBySeries } from '../domain/types.js';
import { PrismaRepository } from '../db/repository.js';
import { withRetry } from '../utils/retry.js';

interface ServiceDeps {
  fredApiKey: string;
  repository?: PrismaRepository;
  fredAdapter?: SourceAdapter;
  nbsAdapter?: SourceAdapter;
}

export class MacroService {
  private readonly repository: PrismaRepository;
  private readonly fredAdapter: SourceAdapter;
  private readonly nbsAdapter: SourceAdapter;

  constructor(deps: ServiceDeps) {
    this.repository = deps.repository ?? new PrismaRepository();
    this.fredAdapter = deps.fredAdapter ?? new FredAdapter(deps.fredApiKey);
    this.nbsAdapter = deps.nbsAdapter ?? new NbsAdapter();
  }

  async ensureSeriesRegistered() {
    await this.repository.upsertSeriesDefinitions(SERIES_REGISTRY);
  }

  async sync(triggerType: TriggerType, onlySeriesKeys?: string[]) {
    await this.ensureSeriesRegistered();

    const selectedDefs = (onlySeriesKeys?.length
      ? onlySeriesKeys.map((key) => SERIES_BY_KEY.get(key)).filter(Boolean)
      : SERIES_REGISTRY) as typeof SERIES_REGISTRY;

    const run = await this.repository.createRun(triggerType);
    const runStart = new Date();
    const results: SyncResultBySeries[] = [];

    try {
      const rows = await this.repository.listSeries();
      const byKey = new Map(rows.map((row) => [row.seriesKey, row]));

      for (const def of selectedDefs) {
        await this.repository.appendRunLog(run.id, def.seriesKey, 'FETCH_START', `Fetching ${def.seriesKey}`);

        const adapter = def.source === 'FRED' ? this.fredAdapter : this.nbsAdapter;
        const fetched = await withRetry(() => adapter.fetchSeries(def), 2, 500);
        const transformed = transformObservations(fetched.observations, def.transformConfig);

        const row = byKey.get(def.seriesKey);
        if (!row) {
          throw new Error(`Series not registered: ${def.seriesKey}`);
        }

        const inserted = await this.repository.upsertObservations(row.id, transformed);
        await this.repository.appendRunLog(
          run.id,
          def.seriesKey,
          'UPSERT_DONE',
          `Fetched=${fetched.observations.length}, inserted=${inserted}, source=${fetched.sourceCode}`
        );

        results.push({
          seriesKey: def.seriesKey,
          fetched: fetched.observations.length,
          inserted,
          sourceCode: fetched.sourceCode
        });
      }

      const observationInserted = results.reduce((sum, item) => sum + item.inserted, 0);
      const stats = {
        seriesCount: results.length,
        observationInserted,
        perSeries: results
      };

      const finished = await this.repository.finishRun(run.id, 'SUCCESS', stats);
      return {
        runId: run.id,
        triggerType,
        status: finished.status,
        startedAt: runStart.toISOString(),
        finishedAt: finished.finishedAt?.toISOString() ?? new Date().toISOString(),
        stats
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.appendRunLog(run.id, null, 'RUN_FAILED', message);
      await this.repository.finishRun(
        run.id,
        'FAILED',
        {
          seriesCount: results.length,
          observationInserted: results.reduce((sum, item) => sum + item.inserted, 0),
          perSeries: results
        },
        message
      );
      throw error;
    }
  }

  async getHealth() {
    const latestRun = await this.repository.latestRun();
    return {
      ok: true,
      now: new Date().toISOString(),
      latestRun: latestRun
        ? {
            id: latestRun.id,
            status: latestRun.status,
            triggerType: latestRun.triggerType,
            startedAt: latestRun.startedAt.toISOString(),
            finishedAt: latestRun.finishedAt?.toISOString() ?? null
          }
        : null
    };
  }

  async listSeries() {
    const rows = await this.repository.listSeries();
    return rows.map((row) => ({
      seriesKey: row.seriesKey,
      displayName: row.displayName,
      source: row.source,
      frequency: row.frequency,
      unit: row.unit,
      transformType: row.transformType,
      meta: row.meta
    }));
  }

  async getSeriesData(seriesKey: string, options: { start?: string; end?: string; limit?: number }) {
    const row = await this.repository.getSeriesByKey(seriesKey);
    if (!row) {
      throw new Error(`Series not found: ${seriesKey}`);
    }

    const start = options.start ? new Date(`${options.start}T00:00:00.000Z`) : undefined;
    const end = options.end ? new Date(`${options.end}T00:00:00.000Z`) : undefined;

    const observations = await this.repository.getObservations(row.id, {
      start: start && !Number.isNaN(start.getTime()) ? start : undefined,
      end: end && !Number.isNaN(end.getTime()) ? end : undefined,
      limit: options.limit
    });

    return {
      series: {
        seriesKey: row.seriesKey,
        displayName: row.displayName,
        source: row.source,
        frequency: row.frequency,
        unit: row.unit
      },
      observations: observations.map((obs) => ({
        date: formatDate(obs.obsDate),
        periodLabel: row.frequency === 'Q' ? formatQuarter(obs.obsDate) : formatDate(obs.obsDate),
        rawValue: Number(obs.rawValue),
        value: Number(obs.value),
        sourceCode: obs.sourceCode
      }))
    };
  }

  async getDashboard(view = 'macro-core') {
    const viewConfig = DASHBOARD_VIEW_BY_KEY.get(view);
    if (!viewConfig) {
      throw new Error(`Unsupported dashboard view: ${view}`);
    }

    const charts = await Promise.all(
      viewConfig.charts.map(async (chart) => {
        const series = await Promise.all(
          chart.seriesKeys.map(async (seriesKey) => {
            const data = await this.getSeriesData(seriesKey, {});
            return {
              seriesKey,
              displayName: data.series.displayName,
              source: data.series.source,
              frequency: data.series.frequency,
              unit: data.series.unit,
              points: data.observations
            };
          })
        );

        return {
          ...chart,
          series
        };
      })
    );

    return {
      view: viewConfig.key,
      title: viewConfig.title,
      charts
    };
  }

  async listRuns(limit = 20) {
    const runs = await this.repository.listRuns(limit);
    return runs.map((run) => ({
      id: run.id,
      triggerType: run.triggerType,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      stats: run.stats,
      errorMessage: run.errorMessage
    }));
  }
}
