import express from 'express';
import cors from 'cors';
import { createApiRouter } from './routes/api.routes.js';
import { MacroService } from './services/macro.service.js';

export function createApp(service: MacroService, corsOrigin: string) {
  const app = express();
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());

  app.use('/api/v1', createApiRouter(service));

  return app;
}
