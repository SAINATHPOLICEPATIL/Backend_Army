import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const findSqlFile = (filename) => {
  const local = resolve(__dirname, '../database', filename);
  if (existsSync(local)) return local;
  return resolve(__dirname, '../../database', filename);
};

async function run() {
  const fresh = process.argv.includes('--fresh');
  console.log(`[db:setup] applying schema to MySQL at ${config.db.host}:${config.db.port}`);

  // Connect without a database selected first (schema creates the DB itself
  // if missing), then apply the seed against it.
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  try {
    await conn.query('SELECT 1');
    console.log('[db:setup] connected');

    if (fresh) {
      // Only ever drops the database named in .env (DB_NAME) - never anything else.
      const db = config.db.database;
      if (!db) throw new Error('DB_NAME is not set; refusing to drop a database');
      console.log(`[db:setup] --fresh: dropping database \`${db}\` ...`);
      await conn.query(`DROP DATABASE IF EXISTS \`${db.replace(/`/g, '')}\``);
    }

    console.log('[db:setup] running schema.sql ...');
    await conn.query(readFileSync(findSqlFile('schema.sql'), 'utf8'));
    console.log('[db:setup] running seed.sql ...');
    await conn.query(readFileSync(findSqlFile('seed.sql'), 'utf8'));
    console.log('[db:setup] done. Database ready.');
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error('[db:setup] failed:', err.message);
  process.exit(1);
});