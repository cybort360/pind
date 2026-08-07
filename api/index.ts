import { createApp } from '../dist-server/server/app.js';
import { getPool } from '../dist-server/server/db/pool.js';
import { runMigrations } from '../dist-server/server/db/migrate.js';

let appPromise: Promise<any> | null = null;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const pool = getPool();
      await runMigrations(pool);
      const { app } = createApp();
      return app;
    })();
  }
  return appPromise;
}

export default async (req: any, res: any) => {
  const app = await getApp();
  app(req, res);
};
