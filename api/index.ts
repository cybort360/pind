import { createApp } from '../server/app';
import { getPool } from '../server/db/pool';
import { runMigrations } from '../server/db/migrate';

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
