import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.connectionLimit,
  namedPlaceholders: true,
  dateStrings: true,
  waitForConnections: true,
  multipleStatements: true,
});

export async function query(sql, params = {}) {
  return pool.execute(sql, params);
}

export async function checkConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    return true;
  } finally {
    conn.release();
  }
}

export { mysql };