import { Router } from 'express';
import type { TriggerType } from '@prisma/client';
import { z } from 'zod';
import { MacroService } from '../services/macro.service.js';

const syncPayloadSchema = z.object({
  seriesKeys: z.array(z.string()).optional()
});

export function createApiRouter(service: MacroService) {
  const router = Router();

  router.get('/health', async (_req, res) => {
    try {
      const result = await service.getHealth();
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/series', async (_req, res) => {
    try {
      const result = await service.listSeries();
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/series/:seriesKey', async (req, res) => {
    try {
      const seriesKey = String(req.params.seriesKey);
      const start = typeof req.query.start === 'string' ? req.query.start : undefined;
      const end = typeof req.query.end === 'string' ? req.query.end : undefined;
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const result = await service.getSeriesData(seriesKey, {
        start,
        end,
        limit: Number.isFinite(limit) ? limit : undefined
      });
      res.json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });

  router.get('/dashboard', async (req, res) => {
    try {
      const view = typeof req.query.view === 'string' ? req.query.view : 'macro-core';
      const result = await service.getDashboard(view);
      res.json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('Unsupported') ? 400 : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });

  router.post('/sync', async (req, res) => {
    try {
      const payload = syncPayloadSchema.parse(req.body ?? {});
      const triggerType: TriggerType = 'MANUAL';
      const result = await service.sync(triggerType, payload.seriesKeys);
      res.json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('Invalid') ? 400 : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });

  router.get('/sync/runs', async (req, res) => {
    try {
      const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
      const result = await service.listRuns(Number.isFinite(limit) ? limit : 20);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
