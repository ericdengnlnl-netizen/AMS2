import 'dotenv/config';
import cron from 'node-cron';
import { readEnv } from './utils/env.js';
import { MacroService } from './services/macro.service.js';
import { createApp } from './app.js';

async function main() {
  const env = readEnv();
  const service = new MacroService({ fredApiKey: env.FRED_API_KEY });

  await service.ensureSeriesRegistered();

  const app = createApp(service, env.CORS_ORIGIN);
  app.listen(env.PORT, () => {
    console.log(`Macro dashboard backend running at http://localhost:${env.PORT}`);
  });

  cron.schedule(
    env.SYNC_CRON,
    async () => {
      try {
        console.log('[scheduler] sync started');
        const result = await service.sync('SCHEDULED');
        console.log(`[scheduler] sync finished: ${result.status}`);
      } catch (error) {
        console.error('[scheduler] sync failed:', error);
      }
    },
    { timezone: env.SYNC_TZ }
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
