import { app } from './app.js';
import { config } from './config.js';
import { checkConnection } from './db.js';
import { assertProductionConfig } from './middlewares/security.js';

async function main() {
  assertProductionConfig(config);

  try {
    await checkConnection();
    console.log(`[db] connected to MySQL '${config.db.database}'`);
  } catch (err) {
    console.warn(`[db] WARNING: cannot reach MySQL at ${config.db.host}:${config.db.port} - ${err.message}`);
    console.warn('[db] Start MySQL and run database/schema.sql + seed.sql, then restart the server.');
  }

  app.listen(config.port, () => {
    console.log(`[api] Military Asset Management API listening on http://localhost:${config.port}`);
  });
}

main();