import {
  Prisma,
  type MacroSeries,
  type SyncRun,
  type TriggerType,
  type RunStatus,
  type SeriesSource,
  type SeriesFrequency,
  type TransformType
} from '@prisma/client';
import type { SeriesRegistryItem } from '../config/series.registry.js';
import { prisma } from './prisma.js';
import type { TransformedObservation } from '../domain/types.js';

export interface SeriesQueryOptions {
  start?: Date;
  end?: Date;
  limit?: number;
}

export class PrismaRepository {
  async upsertSeriesDefinitions(defs: SeriesRegistryItem[]): Promise<MacroSeries[]> {
    const saved: MacroSeries[] = [];

    for (const def of defs) {
      const row = await prisma.macroSeries.upsert({
        where: { seriesKey: def.seriesKey },
        create: {
          seriesKey: def.seriesKey,
          displayName: def.displayName,
          source: def.source as SeriesSource,
          frequency: def.frequency as SeriesFrequency,
          unit: def.unit,
          transformType: def.transformConfig.kind as TransformType,
          enabled: true,
          meta: {
            fetchConfig: def.fetchConfig,
            transformConfig: def.transformConfig,
            chartGroup: def.chartGroup
          }
        },
        update: {
          displayName: def.displayName,
          source: def.source as SeriesSource,
          frequency: def.frequency as SeriesFrequency,
          unit: def.unit,
          transformType: def.transformConfig.kind as TransformType,
          enabled: true,
          meta: {
            fetchConfig: def.fetchConfig,
            transformConfig: def.transformConfig,
            chartGroup: def.chartGroup
          }
        }
      });
      saved.push(row);
    }

    return saved;
  }

  async listSeries(): Promise<MacroSeries[]> {
    return prisma.macroSeries.findMany({
      where: { enabled: true },
      orderBy: { seriesKey: 'asc' }
    });
  }

  async getSeriesByKey(seriesKey: string): Promise<MacroSeries | null> {
    return prisma.macroSeries.findUnique({ where: { seriesKey } });
  }

  async upsertObservations(seriesId: string, observations: TransformedObservation[]): Promise<number> {
    if (!observations.length) return 0;

    const uniqueByDate = new Map<string, TransformedObservation>();
    for (const item of observations) {
      uniqueByDate.set(item.obsDate.toISOString().slice(0, 10), item);
    }

    const rows = [...uniqueByDate.values()];
    const statements = rows.map((obs) =>
      prisma.macroObservation.upsert({
        where: {
          seriesId_obsDate: {
            seriesId,
            obsDate: obs.obsDate
          }
        },
        create: {
          seriesId,
          obsDate: obs.obsDate,
          rawValue: new Prisma.Decimal(obs.rawValue),
          value: new Prisma.Decimal(obs.value),
          sourceCode: obs.sourceCode,
          hasData: obs.hasData
        },
        update: {
          rawValue: new Prisma.Decimal(obs.rawValue),
          value: new Prisma.Decimal(obs.value),
          sourceCode: obs.sourceCode,
          hasData: obs.hasData
        }
      })
    );

    await prisma.$transaction(statements);
    return rows.length;
  }

  async getObservations(seriesId: string, options: SeriesQueryOptions = {}) {
    return prisma.macroObservation.findMany({
      where: {
        seriesId,
        obsDate: {
          gte: options.start,
          lte: options.end
        }
      },
      orderBy: { obsDate: 'asc' },
      take: options.limit
    });
  }

  async createRun(triggerType: TriggerType): Promise<SyncRun> {
    return prisma.syncRun.create({
      data: {
        triggerType,
        status: 'RUNNING'
      }
    });
  }

  async appendRunLog(runId: string, seriesKey: string | null, stage: string, message: string): Promise<void> {
    await prisma.syncRunLog.create({
      data: {
        runId,
        seriesKey,
        stage,
        message
      }
    });
  }

  async finishRun(runId: string, status: RunStatus, stats: unknown, errorMessage?: string): Promise<SyncRun> {
    return prisma.syncRun.update({
      where: { id: runId },
      data: {
        status,
        stats: stats as Prisma.InputJsonValue,
        errorMessage,
        finishedAt: new Date()
      }
    });
  }

  async latestRun(): Promise<SyncRun | null> {
    return prisma.syncRun.findFirst({ orderBy: { startedAt: 'desc' } });
  }

  async listRuns(limit = 20): Promise<SyncRun[]> {
    return prisma.syncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit
    });
  }
}
